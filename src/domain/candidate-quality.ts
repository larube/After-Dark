import type { Metadata } from "../shared/recommendation";
import { normalizeTitle } from "./ratings";

const formatKeywords = {
  concert: ["concert film", "live concert", "concert performance", "live concert broadcast", "concert special", "filmed concert", "captation de concert"],
  stage_performance: ["filmed play", "filmed theater", "filmed theatre", "live theatre", "live theater", "filmed stage performance", "recorded stage performance", "filmed musical", "captation theatrale"],
  other_special: ["television special", "tv special", "educational video", "instructional video", "christmas special", "recap special", "variety special", "awards show", "stand-up comedy special"],
  short_film: ["short film", "court metrage"],
} as const;

export const contentTypes = ["feature_film", "short_film", "concert", "stage_performance", "other_special", "tv_program", "tv_movie", "unknown"] as const;
type ContentType = typeof contentTypes[number];
export type CandidatePolicy = { referenceDate: string; mode?: "classic" | "legacy"; excludedIds?: ReadonlySet<number>; genreTagsOnly?: boolean };
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
  const episodic = ["tv episode", "television episode", "tv miniseries", "television miniseries", "episode compilation"]
    .filter((label) => tags.has(label));
  const broadcast = release?.events?.some(({ type, date }) => type === 6 && !!calendarDate(date));
  const theatrical = release?.events?.some(({ type, date }) => (type === 2 || type === 3) && !!calendarDate(date));
  const weakTv = ["tv series", "series finale", "tv pilot"].filter((label) => tags.has(label));
  const music = release?.genres?.some(({ id }) => id === 10402)
    || genres.some((name) => ["music", "musique"].includes(normalizeTitle(name)));
  const musicOnly = genres.length > 0 && genres.every((name) => ["music", "musique"].includes(normalizeTitle(name)))
    && !release?.genres?.some(({ id, name }) => id !== 10402 && !["music", "musique"].includes(normalizeTitle(name)));
  const concertCue = ["live performance", "live recording", "livestream", "tribute concert"].find((label) => tags.has(label));
  const concert = music && tags.has("concert") && (concertCue ||
    (musicOnly && tags.has("celebration") && tags.has("musician") ? "celebration+musician" : undefined));
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
    ...[...episodic, ...weakTv].map((tag) => "keyword:" + tag),
    ...(concert ? ["combined:music+concert+" + concert] : []),
    ...(tags.has("concert footage") ? ["keyword:concert footage (incidental)"] : []),
    ...(broadcast ? ["releaseType:TV"] : []),
    ...(theatrical ? ["releaseType:theatrical"] : []),
    ...(televised ? ["genre:TV Movie"] : []),
    ...(tags.has("tv series spin off") ? ["keyword:tv series spin off"] : []),
    ...(duration ? ["runtime:" + duration] : []),
    ...(dates.length ? ["earliestRelease:" + dates[0]] : []),
    ...(release?.status ? ["releaseStatus:" + release.status] : []),
    ...(releaseConflict ? ["conflict:releasedStatusWithFutureDates"] : []),
  ];
  // A short special or concert remains a special or concert. Contradictory format tags stay ambiguous.
  const formats: ContentType[] = cues.filter(({ category }) => category !== "short_film").map(({ category }) => category);
  if (concert && !formats.includes("concert")) formats.push("concert");
  if (formats.includes("other_special") && formats.some((type) => type === "concert" || type === "stage_performance") &&
    cues.find(({ category }) => category === "other_special")?.matches.every((tag) => tag === "television special" || tag === "tv special")) {
    formats.splice(formats.indexOf("other_special"), 1);
  }
  if (televised && tags.has("tv series spin off") && !theatrical && !formats.length) formats.push("other_special");
  if ((episodic.length && !theatrical) || (weakTv.length && televised && broadcast && !theatrical)) {
    // A broadcast special can also be a concert or a filmed performance. Keep the more specific format.
    if (!formats.length) formats.push("tv_program");
  }
  const shortTag = cues.some(({ category }) => category === "short_film");
  let category: ContentType = "unknown";
  if (formats.length === 1) category = formats[0];
  else if (!formats.length && !episodic.length) {
    if (duration !== undefined && duration < 40) category = "short_film";
    else if (shortTag && duration === undefined) category = "short_film";
    else if (televised && !weakTv.length) category = "tv_movie";
    else if (!shortTag && !televised && !weakTv.length && duration !== undefined) category = "feature_film";
  }
  const formatExclusion = category === "feature_film" || category === "unknown" || category === "tv_movie" ? null : category;
  return {
    category, certainty: category === "unknown" ? "uncertain" as const : ["feature_film", "short_film", "tv_movie"].includes(category) ? "inferred" as const : "strong" as const,
    evidence, missing,
    exclusionReasons: [...(formatExclusion ? [formatExclusion] : []), ...(future ? ["future_release" as const] : [])],
  };
}
