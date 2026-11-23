import type { Metadata } from "../shared/recommendation";
import { normalizeTitle } from "./ratings";

const formatKeywords = {
  concert: ["concert film", "live concert", "filmed concert", "captation de concert"],
  stage_performance: ["filmed play", "filmed theater", "filmed theatre", "live theatre", "live theater", "filmed stage performance", "captation theatrale"],
  other_special: ["television special", "tv special", "educational video", "instructional video", "christmas special", "recap special"],
  short_film: ["short film", "court metrage"],
} as const;

export const contentTypes = ["feature_film", "short_film", "concert", "stage_performance", "other_special", "unknown"] as const;
type ContentType = typeof contentTypes[number];
export type CandidatePolicy = { referenceDate: string; mode?: "classic" | "legacy" };
export const todayUtc = () => new Date().toISOString().slice(0, 10);

export function calendarDate(raw?: string | null) {
  const date = raw?.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/)?.[1];
  if (!date) return;
  const time = new Date(date + "T00:00:00Z");
  if (Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === date) return date;
}

export function classifyContent(metadata: Metadata, referenceDate: string) {
  const { minutes, keywords, genres, release } = metadata;
  const duration = minutes ?? (release?.runtime && release.runtime > 0 ? release.runtime : undefined);
  const tags = new Set([...keywords, ...(release?.keywords ?? []).map(({ name }) => name)].map(normalizeTitle));
  const cues = Object.entries(formatKeywords).flatMap(([category, labels]) => {
    const matches = labels.filter((label) => tags.has(label));
    return matches.length ? [{ category: category as keyof typeof formatKeywords, matches }] : [];
  });
  const televised = release?.genres?.some(({ id }) => id === 10770)
    || genres.some((name) => ["tv movie", "telefilm"].includes(normalizeTitle(name)));
  const episodic = ["tv series spin off", "based on tv series", "tv series", "series finale", "tv pilot"].filter((label) => tags.has(label));
  const dates = [release?.primaryDate, ...(release?.events ?? []).filter(({ type }) => type >= 1 && type <= 6).map(({ date }) => date)]
    .flatMap((raw) => calendarDate(raw) ?? []).sort();
  const releaseConflict = dates.length > 0 && dates[0] > referenceDate && release?.status?.trim().toLowerCase() === "released";
  const future = dates.length > 0 && dates[0] > referenceDate && !releaseConflict;
  const missing = [
    !duration && "minutes", !tags.size && "keywords", !genres.length && !release?.genres?.length && "genres",
    !dates.length && "releaseDate", !release?.status?.trim() && "releaseStatus",
  ].filter((field): field is string => typeof field === "string");
  const evidence = [
    ...cues.flatMap(({ matches }) => matches.map((tag) => "keyword:" + tag)),
    ...(episodic.map((tag) => "keyword:" + tag)),
    ...(televised ? ["genre:TV Movie"] : []),
    ...(duration ? ["runtime:" + duration] : []),
    ...(dates.length ? ["earliestRelease:" + dates[0]] : []),
    ...(release?.status ? ["releaseStatus:" + release.status] : []),
    ...(releaseConflict ? ["conflict:releasedStatusWithFutureDates"] : []),
  ];
  // A short special or concert remains a special or concert. Contradictory format tags stay ambiguous.
  const formats: ContentType[] = cues.filter(({ category }) => category !== "short_film").map(({ category }) => category);
  if (televised && episodic.length && !formats.includes("other_special")) formats.push("other_special");
  const shortTag = cues.some(({ category }) => category === "short_film");
  let category: ContentType = "unknown";
  if (formats.length === 1) category = formats[0];
  else if (!formats.length) {
    if (duration !== undefined && duration < 40) category = "short_film";
    else if (shortTag && duration === undefined) category = "short_film";
    else if (!shortTag && !televised && duration !== undefined) category = "feature_film";
  }
  const formatExclusion = category === "feature_film" || category === "unknown" ? null : category;
  return {
    category, certainty: category === "unknown" ? "uncertain" as const : category === "feature_film" || category === "short_film" ? "inferred" as const : "strong" as const,
    evidence, missing,
    exclusionReasons: [...(formatExclusion ? [formatExclusion] : []), ...(future ? ["future_release" as const] : [])],
  };
}
