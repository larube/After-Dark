INSERT INTO movie_statuses (movie_id, status)
SELECT DISTINCT movie_id, 'seen'
FROM movie_evaluations
WHERE true
ON CONFLICT (movie_id) DO UPDATE SET status = 'seen'
WHERE movie_statuses.status = 'unknown';
