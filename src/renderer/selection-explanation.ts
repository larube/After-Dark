import type { Recommendation } from "../shared/recommendation";
import { normalizeTitle } from "../domain/ratings";

const regions = new Intl.DisplayNames(["fr"], { type: "region" });
const positive = "Traits associés à vos appréciations positives : ";
const negative = "Traits associés aussi à des appréciations négatives : ";
const genreDetails: Record<string, string> = {
  "psychological horror": "Horreur psychologique",
  "psychological thriller": "Thriller psychologique",
};

export function selectionExplanation({ metadata, reasons, warnings }: Recommendation["films"][number]) {
  if (reasons.includes("Pays de production parmi vos préférences.") && metadata.countries.length === 1) {
    return `Pays de production parmi tes préférences · ${regions.of(metadata.countries[0])}`;
  }
  if (reasons.includes("Langue originale parmi vos préférences.")) return "Langue originale parmi tes préférences";
  if (reasons.some((reason) => reason.startsWith(positive) && reason.slice(positive.length).replace(/\.$/, "").trim()) &&
      !warnings.some((warning) => warning.startsWith(negative))) {
    return "Des éléments associés à des films que tu as appréciés";
  }
  if (reasons.some((reason) => reason.startsWith("Avis TMDB favorables, pondérés par le nombre de votes ("))) {
    return "Avis favorables sur TMDB, pondérés par le nombre de votes";
  }
  const tags = new Set([...metadata.keywords, ...(metadata.release?.keywords ?? []).map(({ name }) => name)].map(normalizeTitle));
  for (const [tag, label] of Object.entries(genreDetails)) {
    if (tags.has(tag)) return label;
  }
  return metadata.genres.slice(0, 2).join(" · ");
}
