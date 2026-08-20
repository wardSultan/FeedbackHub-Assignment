-- Verification for the submission-limit window query.
--
-- Mirrors FeedbackService.assertWithinSubmissionLimit. The rule is "N requests per rolling
-- window per author", and the two ways to get it wrong are both checked here: counting
-- only live requests (so deleting and resubmitting resets the budget), and counting across
-- all authors rather than per author.
--
--     psql -d feedbackhub -v ON_ERROR_STOP=1 -f prisma/checks/submission-limit.sql
--
-- Rolls back; leaves nothing behind.

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert(condition BOOLEAN, description TEXT) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT condition THEN RAISE EXCEPTION 'FAILED: %', description; END IF;
    RAISE NOTICE '  ok  %', description;
END;
$fn$;

CREATE FUNCTION pg_temp.recent_count(author UUID, window_hours INT)
RETURNS BIGINT LANGUAGE sql STABLE AS $fn$
SELECT count(*) FROM feedback_requests
 WHERE author_id = author
   AND created_at >= now() - make_interval(hours => window_hours);
$fn$;

CREATE TEMP TABLE ctx (name TEXT PRIMARY KEY, id UUID) ON COMMIT DROP;
INSERT INTO ctx SELECT 'author', id FROM users WHERE email = 'user@feedbackhub.local';
INSERT INTO ctx SELECT 'other',  id FROM users WHERE email = 'second@feedbackhub.local';

-- A clean slate for this author so the assertions are absolute rather than relative to
-- whatever the seed happens to contain.
DELETE FROM feedback_requests WHERE author_id = (SELECT id FROM ctx WHERE name='author');

CREATE FUNCTION pg_temp.submit(author UUID, age INTERVAL, suffix TEXT) RETURNS UUID
LANGUAGE sql AS $fn$
INSERT INTO feedback_requests (title, description, category_id, status_id, author_id, created_at)
SELECT 'Submission limit fixture ' || suffix,
       'Fixture row used by the submission limit check.',
       (SELECT id FROM categories WHERE slug = 'feature'),
       (SELECT id FROM statuses WHERE is_default),
       author,
       now() - age
RETURNING id;
$fn$;

\echo ''
\echo 'the rolling window'

SELECT pg_temp.submit((SELECT id FROM ctx WHERE name='author'), INTERVAL '1 hour',  'a');
SELECT pg_temp.submit((SELECT id FROM ctx WHERE name='author'), INTERVAL '5 hours', 'b');

SELECT pg_temp.assert(
    pg_temp.recent_count((SELECT id FROM ctx WHERE name='author'), 24) = 2,
    'requests inside the window are counted');

SELECT pg_temp.submit((SELECT id FROM ctx WHERE name='author'), INTERVAL '30 hours', 'c');

SELECT pg_temp.assert(
    pg_temp.recent_count((SELECT id FROM ctx WHERE name='author'), 24) = 2,
    'a request older than the window is not counted');

SELECT pg_temp.assert(
    pg_temp.recent_count((SELECT id FROM ctx WHERE name='author'), 48) = 3,
    'widening the window includes it again');

\echo ''
\echo 'the two ways to get this wrong'

UPDATE feedback_requests SET deleted_at = now()
 WHERE author_id = (SELECT id FROM ctx WHERE name='author')
   AND title LIKE '%fixture a';

-- Counting only live rows would let anyone reset their budget by deleting a request.
SELECT pg_temp.assert(
    pg_temp.recent_count((SELECT id FROM ctx WHERE name='author'), 24) = 2,
    'a deleted request still counts, so deleting does not reset the budget');

SELECT pg_temp.submit((SELECT id FROM ctx WHERE name='other'), INTERVAL '1 hour', 'other');

SELECT pg_temp.assert(
    pg_temp.recent_count((SELECT id FROM ctx WHERE name='author'), 24) = 2,
    'another author''s submissions do not count against this one');

SELECT pg_temp.assert(
    pg_temp.recent_count((SELECT id FROM ctx WHERE name='other'), 24) = 1,
    'each author is counted separately');

\echo ''
\echo 'All submission limit checks passed.'

ROLLBACK;
