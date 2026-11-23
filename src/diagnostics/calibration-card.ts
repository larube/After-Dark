import { allocineSearch } from "../shared/allocine";
import type { planBlindCalibration } from "./calibration";

type Card = ReturnType<typeof planBlindCalibration>["proposals"][number]["card"];
const regions = new Intl.DisplayNames("fr", { type: "region" });

function safeText(value: string | undefined) {
  return value?.replace(/\p{Cc}|\p{Cf}/gu, " ").replace(/\s+/g, " ").trim() ?? "";
}

export function formatCalibrationCard(card: Card, index: number, total: number, showFull = false) {
  const title = safeText(card.title);
  const overview = safeText(card.fullSynopsis);
  const lead = safeText(card.synopsis) || overview.match(/^.{10,280}?[.!?](?=\s|$)/u)?.[0];
  const country = card.countries.map((code) => /^[A-Z]{2}$/.test(code) ? regions.of(code) : undefined).filter(Boolean);
  const list = (values: string[]) => values.map(safeText).filter(Boolean).join(", ") || "Non renseigné";
  const sections = [
    `${index}/${total}  ·  ${title}${card.year ? ` (${card.year})` : ""}`,
    `Réalisation  ${list(card.directors)}\nGenres       ${list(card.genres.slice(0, 3))}\nProduction   ${country.join(", ") || "Non renseignée"}\nDurée        ${card.minutes ? `${card.minutes} min` : "Non renseignée"}`,
    lead ? `En bref (extrait)\n${lead}` : "Pitch indisponible dans les métadonnées locales.",
    overview && overview !== lead
      ? showFull ? `Synopsis complet (peut dévoiler l’intrigue)\n${overview}` : "Synopsis complet disponible · tapez s pour le lire."
      : "",
    !overview ? "Synopsis complet indisponible dans les métadonnées locales." : "",
    `Allociné ↗  ${allocineSearch({ title, year: card.year })}`,
  ];
  return sections.filter(Boolean).join("\n\n");
}
