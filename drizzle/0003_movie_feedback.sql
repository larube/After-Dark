CREATE TABLE `movie_feedback` (
	`movie_id` integer PRIMARY KEY NOT NULL,
	`intention` text DEFAULT 'none' NOT NULL,
	`seen_at` text,
	`score_id` integer,
	`appreciation` text,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`score_id`) REFERENCES `movie_evaluations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "feedback_intention" CHECK("movie_feedback"."intention" IN ('none', 'watch_later', 'tonight', 'not_interested')),
	CONSTRAINT "feedback_seen" CHECK(("movie_feedback"."seen_at" IS NULL AND "movie_feedback"."score_id" IS NULL AND "movie_feedback"."appreciation" IS NULL)
    OR ("movie_feedback"."seen_at" IS NOT NULL AND "movie_feedback"."intention" = 'none'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movie_feedback_score_id_unique` ON `movie_feedback` (`score_id`);