-- Verification for comment visibility under moderation.
--
-- Mirrors the filter built by CommentsService.visibilityFilter. The rule is an
-- authorization rule, not a presentation detail, so it is checked here against real rows
-- rather than trusted to read correctly.
--
--     psql -d feedbackhub -v ON_ERROR_STOP=1 -f prisma/checks/comment-visibility.sql
--
-- Requires prisma/seed.sql. Rolls back; leaves nothing behind.

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert(condition BOOLEAN, description TEXT) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT condition THEN RAISE EXCEPTION 'FAILED: %', description; END IF;
    RAISE NOTICE '  ok  %', description;
END;
$fn$;

-- viewer = the local user id, is_admin = their role. Both come from the verified token in
-- the application; here they are parameters so every combination can be exercised.
CREATE FUNCTION pg_temp.visible_comments(request UUID, viewer UUID, is_admin BOOLEAN)
RETURNS TABLE (id UUID, body TEXT, moderation_status TEXT, author_id UUID)
LANGUAGE sql STABLE AS $fn$
SELECT c.id, c.body, c.moderation_status::TEXT, c.author_id
  FROM comments c
 WHERE c.request_id = request
   AND c.deleted_at IS NULL
   AND (is_admin
        OR c.moderation_status = 'APPROVED'
        OR (viewer IS NOT NULL AND c.author_id = viewer))
 ORDER BY c.created_at ASC;
$fn$;

CREATE TEMP TABLE ctx (name TEXT PRIMARY KEY, id UUID) ON COMMIT DROP;
INSERT INTO ctx SELECT 'uma',   id FROM users WHERE email = 'user@feedbackhub.local';
INSERT INTO ctx SELECT 'sam',   id FROM users WHERE email = 'second@feedbackhub.local';
INSERT INTO ctx SELECT 'ada',   id FROM users WHERE email = 'admin@feedbackhub.local';
INSERT INTO ctx SELECT 'request', id FROM feedback_requests
 WHERE title = 'Merge duplicate requests instead of closing them';

-- The seed leaves exactly one PENDING comment on this request, authored by Uma.
SELECT pg_temp.assert(
    (SELECT count(*) FROM comments
      WHERE request_id = (SELECT id FROM ctx WHERE name='request')
        AND moderation_status = 'PENDING') = 1,
    'the fixture has one pending comment');

\echo ''
\echo 'pending comments'

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.visible_comments(
        (SELECT id FROM ctx WHERE name='request'), (SELECT id FROM ctx WHERE name='uma'), FALSE)) = 1,
    'the author sees their own pending comment');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.visible_comments(
        (SELECT id FROM ctx WHERE name='request'), (SELECT id FROM ctx WHERE name='sam'), FALSE)) = 0,
    'another user does not see it');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.visible_comments(
        (SELECT id FROM ctx WHERE name='request'), NULL, FALSE)) = 0,
    'an anonymous viewer does not see it');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.visible_comments(
        (SELECT id FROM ctx WHERE name='request'), (SELECT id FROM ctx WHERE name='ada'), TRUE)) = 1,
    'an administrator sees it in order to moderate it');

SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests
      WHERE id = (SELECT id FROM ctx WHERE name='request')) = 0,
    'a pending comment is not counted, whoever is looking');

\echo ''
\echo 'approved comments'

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.visible_comments(
        (SELECT id FROM ctx WHERE name='request'), (SELECT id FROM ctx WHERE name='sam'), FALSE)) = 0,
    'before approval, another user still sees nothing');

UPDATE comments SET moderation_status = 'APPROVED'
 WHERE request_id = (SELECT id FROM ctx WHERE name='request');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.visible_comments(
        (SELECT id FROM ctx WHERE name='request'), (SELECT id FROM ctx WHERE name='sam'), FALSE)) = 1,
    'after approval, every viewer sees it');

SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests
      WHERE id = (SELECT id FROM ctx WHERE name='request')) = 1,
    'approving it increments the count');

\echo ''
\echo 'rejected and deleted comments'

UPDATE comments SET moderation_status = 'REJECTED'
 WHERE request_id = (SELECT id FROM ctx WHERE name='request');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.visible_comments(
        (SELECT id FROM ctx WHERE name='request'), (SELECT id FROM ctx WHERE name='sam'), FALSE)) = 0,
    'a rejected comment is hidden from other users');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.visible_comments(
        (SELECT id FROM ctx WHERE name='request'), (SELECT id FROM ctx WHERE name='uma'), FALSE)) = 1,
    'its author can still see it, so the rejection is not silent');

UPDATE comments SET deleted_at = now()
 WHERE request_id = (SELECT id FROM ctx WHERE name='request');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.visible_comments(
        (SELECT id FROM ctx WHERE name='request'), (SELECT id FROM ctx WHERE name='ada'), TRUE)) = 0,
    'a deleted comment is hidden even from an administrator');

SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests
      WHERE id = (SELECT id FROM ctx WHERE name='request')) = 0,
    'deletion returns the count to zero');

\echo ''
\echo 'All comment visibility checks passed.'

ROLLBACK;
