CREATE TABLE `discovery_explorations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`created_at` text NOT NULL,
	`seed` text NOT NULL,
	`protocol` text NOT NULL,
	`engine` text NOT NULL,
	`fingerprint` text NOT NULL,
	`rotation` text NOT NULL,
	`films` text NOT NULL,
	`eligible` integer NOT NULL,
	`renewed` integer,
	CONSTRAINT "discovery_mode" CHECK("discovery_explorations"."mode" IN ('gems', 'affinities', 'offbeat'))
);
--> statement-breakpoint
CREATE INDEX `discovery_mode_history` ON `discovery_explorations` (`mode`,`id`);