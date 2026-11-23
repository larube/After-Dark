import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { DiscoverySnapshot, Rotation } from "../domain/discovery";
import { discoveryModes } from "../shared/discovery";
import { intentions } from "../shared/feedback";
import type { LabSelections } from "../domain/lab";
import type { LabFilmSnapshot } from "../shared/lab";
import type { Criteria } from "../shared/recommendation";
import type { Mood } from "../shared/profile";

export const movies = sqliteTable("movies", {
  id: integer().primaryKey({ autoIncrement: true }),
  displayTitle: text("display_title").notNull(),
  originalTitle: text("original_title"),
  year: integer(),
  tmdbId: integer("tmdb_id").unique(),
  metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
}, (table) => [
  check("movie_title", sql`length(trim(${table.displayTitle})) > 0`),
  check("movie_year", sql`${table.year} BETWEEN 1 AND 9999`),
  check("movie_tmdb_id", sql`${table.tmdbId} > 0`),
]);

export const movieIdentifiers = sqliteTable("movie_identifiers", {
  namespace: text().notNull(),
  value: text().notNull(),
  movieId: integer("movie_id").notNull().references(() => movies.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.namespace, table.value] }),
  index("movie_identifiers_movie").on(table.movieId),
]);

export const movieTitles = sqliteTable("movie_titles", {
  movieId: integer("movie_id").notNull().references(() => movies.id, { onDelete: "cascade" }),
  title: text().notNull(),
  normalizedTitle: text("normalized_title").notNull(),
}, (table) => [
  primaryKey({ columns: [table.movieId, table.title] }),
  index("movie_titles_matching").on(table.normalizedTitle),
]);

export const movieEvaluations = sqliteTable("movie_evaluations", {
  id: integer().primaryKey(),
  movieId: integer("movie_id").notNull().references(() => movies.id, { onDelete: "cascade" }),
  source: text().notNull(),
  sourceId: text("source_id").notNull(),
  kind: text({ enum: ["score", "historical_score", "historical_range", "qualitative"] }).notNull(),
  score: text(),
  rangeMin: text("range_min"),
  rangeMax: text("range_max"),
  appreciation: text(),
  evaluatedOn: text("evaluated_on"),
}, (table) => [
  unique("evaluation_source_id").on(table.source, table.sourceId),
  index("evaluations_movie_id").on(table.movieId),
  check("evaluation_payload", sql`
    (${table.kind} = 'qualitative' AND ${table.score} IS NULL AND ${table.rangeMin} IS NULL AND ${table.rangeMax} IS NULL
      AND ${table.appreciation} IS NOT NULL AND length(trim(${table.appreciation})) > 0)
    OR
    (${table.kind} IN ('score', 'historical_score') AND ${table.appreciation} IS NULL
      AND ${table.rangeMin} IS NULL AND ${table.rangeMax} IS NULL AND ${table.score} IS NOT NULL
      AND (${table.kind} = 'historical_score' OR ${table.score} IN ('0','1','2','3','4','5','6','7','8','9','10')))
    OR
    (${table.kind} = 'historical_range' AND ${table.appreciation} IS NULL AND ${table.score} IS NULL
      AND ${table.rangeMin} IS NOT NULL AND ${table.rangeMax} IS NOT NULL)
  `),
]);

export const movieStatuses = sqliteTable("movie_statuses", {
  movieId: integer("movie_id").primaryKey().references(() => movies.id, { onDelete: "cascade" }),
  status: text({ enum: ["seen", "unseen", "unknown"] }).notNull(),
}, (table) => [check("movie_status", sql`${table.status} IN ('seen', 'unseen', 'unknown')`)]);

export const movieFeedback = sqliteTable("movie_feedback", {
  movieId: integer("movie_id").primaryKey().references(() => movies.id, { onDelete: "cascade" }),
  intention: text({ enum: intentions }).notNull().default("none"),
  seenAt: text("seen_at"),
  previousStatus: text("previous_status", { enum: ["seen", "unseen", "unknown"] }),
  scoreId: integer("score_id").unique().references(() => movieEvaluations.id, { onDelete: "set null" }),
  appreciation: text(),
}, (table) => [
  check("feedback_intention", sql`${table.intention} IN ('none', 'watch_later', 'tonight', 'not_interested')`),
  check("feedback_seen", sql`(${table.seenAt} IS NULL AND ${table.scoreId} IS NULL AND ${table.appreciation} IS NULL)
    OR (${table.seenAt} IS NOT NULL AND ${table.intention} = 'none')`),
]);

export const favorites = sqliteTable("favorites", {
  movieId: integer("movie_id").notNull().references(() => movies.id, { onDelete: "cascade" }),
  source: text().notNull(),
  spontaneous: integer({ mode: "boolean" }),
  memorable: integer({ mode: "boolean" }),
  rewatch: integer({ mode: "boolean" }),
}, (table) => [
  primaryKey({ columns: [table.movieId, table.source] }),
  check("favorite_spontaneous", sql`${table.spontaneous} IN (0, 1)`),
  check("favorite_memorable", sql`${table.memorable} IN (0, 1)`),
  check("favorite_rewatch", sql`${table.rewatch} IN (0, 1)`),
]);

export const plannedViewings = sqliteTable("planned_viewings", {
  id: integer().primaryKey(),
  movieId: integer("movie_id").notNull().references(() => movies.id),
  selectedAt: text("selected_at").notNull(),
  watchedAt: text("watched_at"),
  status: text({ enum: ["planned", "watched", "cancelled"] }).notNull().default("planned"),
}, (table) => [
  index("planned_viewings_movie").on(table.movieId),
  uniqueIndex("planned_viewings_active_movie").on(table.movieId).where(sql`${table.status} = 'planned'`),
  check("viewing_status", sql`${table.status} IN ('planned', 'watched', 'cancelled')`),
  check("viewing_watched_date", sql`${table.watchedAt} IS NULL OR ${table.status} = 'watched'`),
]);

export const moodSessions = sqliteTable("mood_sessions", {
  id: integer().primaryKey(),
  date: text().notNull(),
  criteria: text({ mode: "json" }).$type<Omit<Mood, "date">>().notNull(),
});

export const recommendationHistory = sqliteTable("recommendation_history", {
  id: integer().primaryKey(),
  moodSessionId: integer("mood_session_id").notNull().references(() => moodSessions.id),
  movieId: integer("movie_id").notNull().references(() => movies.id),
  rank: integer().notNull(),
  engineVersion: text("engine_version").notNull(),
  explanation: text(),
  prediction: text({ mode: "json" }).$type<Record<string, unknown>>(),
  outcome: text({ mode: "json" }).$type<Record<string, unknown>>(),
}, (table) => [
  unique("recommendation_session_movie").on(table.moodSessionId, table.movieId),
  unique("recommendation_session_rank").on(table.moodSessionId, table.rank),
  check("recommendation_rank", sql`${table.rank} > 0`),
]);

export const labSessions = sqliteTable("lab_sessions", {
  id: text().primaryKey(),
  open: integer().unique(),
  paused: integer({ mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
  abandonedAt: text("abandoned_at"),
  protocol: text().notNull(),
  engine: text().notNull(),
  seed: text().notNull(),
  referenceDate: text("reference_date").notNull(),
  criteria: text({ mode: "json" }).$type<Criteria>().notNull(),
  fingerprint: text().notNull(),
  selections: text({ mode: "json" }).$type<LabSelections>().notNull(),
  classicHistory: text("classic_history", { mode: "json" }).$type<number[]>().notNull(),
  labHistory: text("lab_history", { mode: "json" }).$type<number[]>().notNull(),
  collisions: integer().notNull(),
  repeated: integer().notNull(),
}, (table) => [
  check("lab_session_lifecycle", sql`(${table.open} IS 1 AND ${table.finishedAt} IS NULL AND ${table.abandonedAt} IS NULL)
    OR (${table.open} IS NULL AND ${table.paused} = 0 AND
      ((${table.finishedAt} IS NULL) != (${table.abandonedAt} IS NULL)))`),
]);

export const labProposals = sqliteTable("lab_proposals", {
  sessionId: text("session_id").notNull().references(() => labSessions.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  movieId: integer("movie_id").notNull(),
  model: text({ enum: ["current", "normalized", "rarity", "hybrid"] }).notNull(),
  originalRank: integer("original_rank").notNull(),
  film: text({ mode: "json" }).$type<LabFilmSnapshot>().notNull(),
  interest: text({ enum: ["eager", "maybe", "pass"] }),
  seen: integer({ mode: "boolean" }),
  reason: text(),
  answeredAt: text("answered_at"),
}, (table) => [
  primaryKey({ columns: [table.sessionId, table.position] }),
  unique().on(table.sessionId, table.movieId),
  unique().on(table.sessionId, table.model),
  check("lab_proposal_position", sql`${table.position} BETWEEN 1 AND 4 AND ${table.originalRank} BETWEEN 1 AND 5`),
  check("lab_proposal_answer", sql`
    (${table.answeredAt} IS NULL AND ${table.interest} IS NULL AND ${table.seen} IS NULL AND ${table.reason} IS NULL)
    OR (${table.answeredAt} IS NOT NULL AND
      ((${table.seen} IS 1 AND ${table.interest} IS NULL) OR
       (${table.seen} IS 0 AND ${table.interest} IS NOT NULL AND ${table.interest} IN ('eager', 'maybe', 'pass'))))`),
]);

export const discoveryExplorations = sqliteTable("discovery_explorations", {
  id: integer().primaryKey({ autoIncrement: true }),
  mode: text({ enum: discoveryModes }).notNull(),
  createdAt: text("created_at").notNull(),
  seed: text().notNull(),
  protocol: text().notNull(),
  engine: text().notNull(),
  fingerprint: text().notNull(),
  rotation: text({ mode: "json" }).$type<Rotation>().notNull(),
  films: text({ mode: "json" }).$type<DiscoverySnapshot[]>().notNull(),
  eligible: integer().notNull(),
  renewed: integer(),
}, (table) => [
  index("discovery_mode_history").on(table.mode, table.id),
  check("discovery_mode", sql`${table.mode} IN ('gems', 'affinities', 'offbeat')`),
]);
