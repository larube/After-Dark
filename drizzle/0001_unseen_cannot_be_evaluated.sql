CREATE TRIGGER evaluation_insert_requires_not_unseen
BEFORE INSERT ON movie_evaluations
WHEN EXISTS (SELECT 1 FROM movie_statuses WHERE movie_id = NEW.movie_id AND status = 'unseen')
BEGIN
  SELECT RAISE(ABORT, 'An explicitly unseen movie cannot be evaluated');
END;
--> statement-breakpoint
CREATE TRIGGER evaluation_update_requires_not_unseen
BEFORE UPDATE OF movie_id ON movie_evaluations
WHEN EXISTS (SELECT 1 FROM movie_statuses WHERE movie_id = NEW.movie_id AND status = 'unseen')
BEGIN
  SELECT RAISE(ABORT, 'An explicitly unseen movie cannot be evaluated');
END;
--> statement-breakpoint
CREATE TRIGGER unseen_insert_requires_no_evaluation
BEFORE INSERT ON movie_statuses
WHEN NEW.status = 'unseen' AND EXISTS (SELECT 1 FROM movie_evaluations WHERE movie_id = NEW.movie_id)
BEGIN
  SELECT RAISE(ABORT, 'An evaluated movie cannot be marked as explicitly unseen');
END;
--> statement-breakpoint
CREATE TRIGGER unseen_update_requires_no_evaluation
BEFORE UPDATE ON movie_statuses
WHEN NEW.status = 'unseen' AND EXISTS (SELECT 1 FROM movie_evaluations WHERE movie_id = NEW.movie_id)
BEGIN
  SELECT RAISE(ABORT, 'An evaluated movie cannot be marked as explicitly unseen');
END;
