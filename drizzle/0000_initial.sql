CREATE TABLE `favorites` (
	`movie_id` integer NOT NULL,
	`source` text NOT NULL,
	`spontaneous` integer,
	`memorable` integer,
	`rewatch` integer,
	PRIMARY KEY(`movie_id`, `source`),
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "favorite_spontaneous" CHECK("favorites"."spontaneous" IN (0, 1)),
	CONSTRAINT "favorite_memorable" CHECK("favorites"."memorable" IN (0, 1)),
	CONSTRAINT "favorite_rewatch" CHECK("favorites"."rewatch" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `mood_sessions` (
	`id` integer PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`criteria` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movie_evaluations` (
	`id` integer PRIMARY KEY NOT NULL,
	`movie_id` integer NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`score` text,
	`range_min` text,
	`range_max` text,
	`appreciation` text,
	`evaluated_on` text,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "evaluation_payload" CHECK(
    ("movie_evaluations"."kind" = 'qualitative' AND "movie_evaluations"."score" IS NULL AND "movie_evaluations"."range_min" IS NULL AND "movie_evaluations"."range_max" IS NULL
      AND "movie_evaluations"."appreciation" IS NOT NULL AND length(trim("movie_evaluations"."appreciation")) > 0)
    OR
    ("movie_evaluations"."kind" IN ('score', 'historical_score') AND "movie_evaluations"."appreciation" IS NULL
      AND "movie_evaluations"."range_min" IS NULL AND "movie_evaluations"."range_max" IS NULL AND "movie_evaluations"."score" IS NOT NULL
      AND ("movie_evaluations"."kind" = 'historical_score' OR "movie_evaluations"."score" IN ('0','1','2','3','4','5','6','7','8','9','10')))
    OR
    ("movie_evaluations"."kind" = 'historical_range' AND "movie_evaluations"."appreciation" IS NULL AND "movie_evaluations"."score" IS NULL
      AND "movie_evaluations"."range_min" IS NOT NULL AND "movie_evaluations"."range_max" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX `evaluations_movie_id` ON `movie_evaluations` (`movie_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_source_id` ON `movie_evaluations` (`source`,`source_id`);--> statement-breakpoint
CREATE TABLE `movie_identifiers` (
	`namespace` text NOT NULL,
	`value` text NOT NULL,
	`movie_id` integer NOT NULL,
	PRIMARY KEY(`namespace`, `value`),
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `movie_identifiers_movie` ON `movie_identifiers` (`movie_id`);--> statement-breakpoint
CREATE TABLE `movie_statuses` (
	`movie_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "movie_status" CHECK("movie_statuses"."status" IN ('seen', 'unseen', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE `movie_titles` (
	`movie_id` integer NOT NULL,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	PRIMARY KEY(`movie_id`, `title`),
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `movie_titles_matching` ON `movie_titles` (`normalized_title`);--> statement-breakpoint
CREATE TABLE `movies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_title` text NOT NULL,
	`original_title` text,
	`year` integer,
	`tmdb_id` integer,
	`metadata` text,
	CONSTRAINT "movie_title" CHECK(length(trim("movies"."display_title")) > 0),
	CONSTRAINT "movie_year" CHECK("movies"."year" BETWEEN 1 AND 9999),
	CONSTRAINT "movie_tmdb_id" CHECK("movies"."tmdb_id" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movies_tmdb_id_unique` ON `movies` (`tmdb_id`);--> statement-breakpoint
CREATE TABLE `planned_viewings` (
	`id` integer PRIMARY KEY NOT NULL,
	`movie_id` integer NOT NULL,
	`selected_at` text NOT NULL,
	`watched_at` text,
	`status` text DEFAULT 'planned' NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "viewing_status" CHECK("planned_viewings"."status" IN ('planned', 'watched', 'cancelled')),
	CONSTRAINT "viewing_watched_date" CHECK("planned_viewings"."watched_at" IS NULL OR "planned_viewings"."status" = 'watched')
);
--> statement-breakpoint
CREATE INDEX `planned_viewings_movie` ON `planned_viewings` (`movie_id`);--> statement-breakpoint
CREATE TABLE `recommendation_history` (
	`id` integer PRIMARY KEY NOT NULL,
	`mood_session_id` integer NOT NULL,
	`movie_id` integer NOT NULL,
	`rank` integer NOT NULL,
	`engine_version` text NOT NULL,
	`explanation` text,
	`prediction` text,
	`outcome` text,
	FOREIGN KEY (`mood_session_id`) REFERENCES `mood_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recommendation_rank" CHECK("recommendation_history"."rank" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recommendation_session_movie` ON `recommendation_history` (`mood_session_id`,`movie_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recommendation_session_rank` ON `recommendation_history` (`mood_session_id`,`rank`);