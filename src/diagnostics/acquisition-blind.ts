import { createHmac, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { selectionCategories, type SelectionCategory } from "../shared/recommendation";
import type { AcquisitionComparison } from "./acquisition";
import { reportDirectory } from "./cli";

const options = {
  envie: "Envie de voir",
  peut_etre: "Peut-être",
  non: "Pas intéressé",
  deja_vu: "Déjà vu",
  informations: "Ne connais pas assez le film pour juger",
} as const;
const vote = z.enum(Object.keys(options) as [keyof typeof options, ...Array<keyof typeof options>]);
const cardId = z.string().regex(/^[a-f0-9]{16}$/);
const arm = z.enum(["A", "B"]);
const category = z.enum(Object.keys(selectionCategories) as [SelectionCategory, ...SelectionCategory[]]);
const strategy = z.enum(["baseline", "profile"]);
const manifestSchema = z.strictObject({
  format: z.literal("after-dark-acquisition-blind-v1"),
  session: cardId,
  mapping: z.strictObject({ A: strategy, B: strategy }).refine(({ A, B }) => A !== B),
  cards: z.record(cardId, z.strictObject({ arm, title: z.string(), year: z.number().nullable(), categories: z.array(category).min(1) })),
});
const responsesSchema = z.strictObject({
  format: z.literal("after-dark-acquisition-votes-v1"),
  session: cardId,
  answers: z.record(cardId, vote.nullable()),
});
type Manifest = z.infer<typeof manifestSchema>;
const safeText = (value: string) => value.replace(/[<>]/g, (char) => char === "<" ? "&lt;" : "&gt;")
  .replace(/[\r\n]+/g, " ").replace(/[\\`*_[\]]/g, "\\$&");

export function prepareBlindAcquisition(comparison: AcquisitionComparison, secret: string) {
  const hash = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  const session = hash("session").slice(0, 16);
  type Film = AcquisitionComparison["results"][number]["arms"][number]["rounds"][number]["selected"][number];
  const baseline = new Map<string, { film: Film; categories: Set<SelectionCategory> }>();
  const profile = new Map(baseline);
  for (const { category, arms } of comparison.results) {
    for (const [index, group] of [baseline, profile].entries()) {
      for (const round of arms[index].rounds) {
        for (const film of round.selected) {
          const entry = group.get(film.key) ?? { film, categories: new Set<SelectionCategory>() };
          entry.categories.add(category);
          group.set(film.key, entry);
        }
      }
    }
  }
  const baselineArm: "A" | "B" = Number.parseInt(hash("assignment")[0], 16) % 2 ? "A" : "B";
  const profileArm: "A" | "B" = baselineArm === "A" ? "B" : "A";
  const manifest: Manifest = {
    format: "after-dark-acquisition-blind-v1", session,
    mapping: { A: baselineArm === "A" ? "baseline" : "profile", B: baselineArm === "A" ? "profile" : "baseline" },
    cards: {},
  };
  const answers: Record<string, null> = {};
  const rows = [...[...baseline.values()].filter(({ film }) => !profile.has(film.key)).map((entry) => ({ ...entry, arm: baselineArm })),
    ...[...profile.values()].filter(({ film }) => !baseline.has(film.key)).map((entry) => ({ ...entry, arm: profileArm }))]
    .map(({ film, arm, categories }) => ({ film, arm, categories, order: hash("order:" + film.key), id: hash("card:" + film.key).slice(0, 16) }))
    .sort((a, b) => a.order.localeCompare(b.order));

  const markdown = [
    "# Évaluation à l’aveugle", "",
    `Comparaison du ${comparison.referenceDate} · ${comparison.sessions} séances par groupe`, "",
    "Pour chaque film, remplis son code dans `reponses.json` avec une des valeurs ci-dessous. La correspondance A/B est révélée après la dernière réponse.", "",
    ...Object.entries(options).map(([key, label]) => `- \`${key}\` · ${label}`), "",
    "Chaque film apparaît une fois. Les titres proposés dans les deux groupes sont communs et restent hors questionnaire.", "",
    ...(rows.length ? [] : ["Aucun film exclusif à évaluer pour cette comparaison.", ""]),
  ];
  for (const { film, arm, id, categories } of rows) {
    answers[id] = null;
    manifest.cards[id] = { arm, title: film.title, year: film.year, categories: [...categories] };
    const describe = (values: string[], fallback: string) => values.length ? values.map(safeText).join(", ") : fallback;
    markdown.push(`## ${safeText(film.title)} (${film.year ?? "année inconnue"}) · ${arm}`, "",
      `Code de réponse \`${id}\``,
      `Catégories · ${[...categories].map((value) => selectionCategories[value]).join(", ")}`,
      `Genres · ${describe(film.genres, "Genres non renseignés")}`,
      `Réalisation · ${describe(film.directors, "Réalisation non renseignée")}`, "",
      film.synopsis ? safeText(film.synopsis) : "Synopsis non disponible.", "",
      `Raisons · ${describe(film.reasons, "Motif détaillé non disponible")}`, "");
  }
  return { manifest, responses: { format: "after-dark-acquisition-votes-v1", session, answers }, markdown: markdown.join("\n") };
}

export function finishBlindAcquisition(privateManifest: unknown, responses: unknown) {
  const manifest = manifestSchema.parse(privateManifest);
  const { session, answers } = responsesSchema.parse(responses);
  const cards = Object.entries(manifest.cards);
  if (session !== manifest.session || cards.length !== Object.keys(answers).length || cards.some(([id]) => !Object.hasOwn(answers, id))) {
    throw new Error("Les réponses doivent correspondre à ce questionnaire.");
  }
  if (!cards.length || cards.some(([id]) => answers[id] === null)) throw new Error("Le questionnaire ne contient pas de réponses complètes.");
  const results = (["A", "B"] as const).map((group) => {
    const films = cards.filter(([, card]) => card.arm === group).map(([id, { title, year, categories }]) => ({ title, year, categories, answer: answers[id]! }));
    const counts = Object.fromEntries(Object.keys(options).map((key) => [key, films.filter(({ answer }) => answer === key).length]));
    const byCategory = Object.fromEntries([...new Set(films.flatMap((film) => film.categories))].map((category) =>
      [category, Object.fromEntries(Object.keys(options).map((key) => [key,
        films.filter((film) => film.categories.includes(category) && film.answer === key).length]))]));
    return { group, strategy: manifest.mapping[group], films, counts, byCategory };
  });
  return { format: "after-dark-acquisition-blind-result-v1", session, results };
}

export async function writeBlindAcquisition(comparison: AcquisitionComparison, output: string, secret = randomBytes(32).toString("hex")) {
  const directory = await reportDirectory(output, true);
  const packet = prepareBlindAcquisition(comparison, secret);
  const write = (name: string, data: string) => writeFile(join(directory, name), data, { flag: "wx", mode: 0o600 });
  await write("questionnaire.md", packet.markdown);
  await write("reponses.json", JSON.stringify(packet.responses, null, 2) + "\n");
  await write(".cle-privee.json", JSON.stringify(packet.manifest, null, 2) + "\n");
}

export async function writeBlindAcquisitionResult(output: string) {
  const directory = await reportDirectory(output, true);
  const read = async (file: string): Promise<unknown> => JSON.parse(await readFile(join(directory, file), "utf8"));
  const result = finishBlindAcquisition(await read(".cle-privee.json"), await read("reponses.json"));
  const categories = [...new Set(result.results.flatMap(({ films }) => films.flatMap((film) => film.categories)))];
  const markdown = ["# Bilan qualitatif", "", ...result.results.flatMap(({ group, strategy, films, counts, byCategory }) => [
    `## ${group} · ${strategy}`, "",
    ...Object.entries(options).map(([key, label]) => `- ${label} · ${counts[key]}`), "",
    ...Object.entries(byCategory).map(([category, totals]) => `- ${selectionCategories[category as SelectionCategory]} · ${Object.entries(options)
      .map(([key, label]) => `${label} ${totals[key]}`).join(", ")}`), "",
    ...films.map(({ title, year, answer }) => `- ${safeText(title)} (${year ?? "année inconnue"}) · ${options[answer]}`), "",
  ]), "## Décision par catégorie", "",
  ...categories.map((category) => `- **${selectionCategories[category]}** · À renseigner après lecture du bilan technique et des réponses. Choix : conserver baseline, poursuivre l’expérimentation, envisager une activation contrôlée.`), "",
  "Ces réponses décrivent l’intérêt déclaré pour les titres exclusifs de ce questionnaire. Les tailles des groupes et leurs films peuvent différer. Les bilans par catégorie peuvent inclure un même vote si le titre appartenait à plusieurs catégories. Le total du groupe le compte une seule fois. Les réponses « Déjà vu » et « Informations insuffisantes » restent séparées des refus.", ""].join("\n");
  const write = (name: string, data: string) => writeFile(join(directory, name), data, { flag: "wx", mode: 0o600 });
  await write("bilan.md", markdown);
  await write("bilan.json", JSON.stringify(result, null, 2) + "\n");
}
