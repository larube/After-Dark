CREATE TABLE `lab_proposals` (
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`movie_id` integer NOT NULL,
	`model` text NOT NULL,
	`original_rank` integer NOT NULL,
	`film` text NOT NULL,
	`interest` text,
	`seen` integer,
	`reason` text,
	`answered_at` text,
	PRIMARY KEY(`session_id`, `position`),
	FOREIGN KEY (`session_id`) REFERENCES `lab_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lab_proposal_position" CHECK("lab_proposals"."position" BETWEEN 1 AND 4 AND "lab_proposals"."original_rank" BETWEEN 1 AND 5),
	CONSTRAINT "lab_proposal_answer" CHECK(
    ("lab_proposals"."answered_at" IS NULL AND "lab_proposals"."interest" IS NULL AND "lab_proposals"."seen" IS NULL AND "lab_proposals"."reason" IS NULL)
    OR ("lab_proposals"."answered_at" IS NOT NULL AND
      (("lab_proposals"."seen" IS 1 AND "lab_proposals"."interest" IS NULL) OR
       ("lab_proposals"."seen" IS 0 AND "lab_proposals"."interest" IS NOT NULL AND "lab_proposals"."interest" IN ('eager', 'maybe', 'pass')))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lab_proposals_session_id_movie_id_unique` ON `lab_proposals` (`session_id`,`movie_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lab_proposals_session_id_model_unique` ON `lab_proposals` (`session_id`,`model`);--> statement-breakpoint
CREATE TABLE `lab_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`open` integer,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	`abandoned_at` text,
	`protocol` text NOT NULL,
	`engine` text NOT NULL,
	`seed` text NOT NULL,
	`reference_date` text NOT NULL,
	`criteria` text NOT NULL,
	`fingerprint` text NOT NULL,
	`selections` text NOT NULL,
	`classic_history` text NOT NULL,
	`lab_history` text NOT NULL,
	`collisions` integer NOT NULL,
	`repeated` integer NOT NULL,
	CONSTRAINT "lab_session_lifecycle" CHECK(("lab_sessions"."open" IS 1 AND "lab_sessions"."finished_at" IS NULL AND "lab_sessions"."abandoned_at" IS NULL)
    OR ("lab_sessions"."open" IS NULL AND "lab_sessions"."paused" = 0 AND
      (("lab_sessions"."finished_at" IS NULL) != ("lab_sessions"."abandoned_at" IS NULL))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lab_sessions_open_unique` ON `lab_sessions` (`open`);