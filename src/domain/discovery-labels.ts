import { normalizeTitle } from "./ratings";

const regions = new Intl.DisplayNames(["fr"], { type: "region" });
const labels: Record<string, string> = {
  action: "action", adventure: "aventure", animation: "animation", comedy: "comédie", crime: "film policier",
  documentary: "documentaire", drama: "drame", family: "film familial", fantasy: "fantastique", history: "film historique",
  horror: "horreur", music: "musique", mystery: "mystère", romance: "romance", "science fiction": "science-fiction",
  thriller: "thriller", "tv movie": "téléfilm", war: "film de guerre", western: "western",
  "based on novel or book": "adaptation littéraire", creature: "créature", remake: "nouvelle adaptation",
  "space travel": "voyage spatial", "dark comedy": "humour noir", "body horror": "horreur corporelle",
  "psychological thriller": "thriller psychologique", surrealism: "surréalisme", survival: "survie",
};

const genericKeywords = new Set(["based on novel or book", "friendship", "creature", "remake", "love", "family"]);

export function discoveryLabel({ key, label }: { key: string; label: string }, explain = false) {
  const normalized = normalizeTitle(label);
  if (key === "country" && /^[A-Z]{2}$/.test(label)) return regions.of(label);
  if (key === "keyword") return genericKeywords.has(normalized) && explain ? undefined : labels[normalized];
  return key === "genre" ? labels[normalized] ?? label : label;
}

export function discoveryLabels(traits: { key: string; label: string }[]) {
  return [...new Set(traits.flatMap((trait) => discoveryLabel(trait, true) ?? []))].slice(0, 2);
}
