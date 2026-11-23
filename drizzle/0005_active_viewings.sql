-- Preserve duplicate legacy choices as cancelled history, retaining the most recent.
UPDATE planned_viewings AS older
SET status = 'cancelled'
WHERE older.status = 'planned' AND EXISTS (
  SELECT 1 FROM planned_viewings AS newer
  WHERE newer.movie_id = older.movie_id AND newer.status = 'planned'
    AND (newer.selected_at, newer.id) > (older.selected_at, older.id)
);
--> statement-breakpoint
UPDATE planned_viewings
SET status = 'cancelled'
WHERE status = 'planned' AND movie_id IN (SELECT movie_id FROM movie_statuses WHERE status = 'seen');
--> statement-breakpoint
CREATE UNIQUE INDEX `planned_viewings_active_movie` ON `planned_viewings` (`movie_id`) WHERE "planned_viewings"."status" = 'planned';
