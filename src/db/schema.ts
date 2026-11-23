import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { intentions } from "../shared/feedback";
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
