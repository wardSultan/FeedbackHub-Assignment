-- Schema invariant checks.
--
-- These verify that the guarantees the schema claims to make actually hold in the
-- database, independently of any application code. They are run against a scratch
-- database with the migration applied:
--
--     psql -v ON_ERROR_STOP=1 -f backend/prisma/checks/schema-invariants.sql
--
-- Any failure raises and aborts. The suite leaves no data behind.
--
-- These are not a replacement for the application-level integration tests that arrive
-- with the API; they cover the layer below it, where an application bug cannot reach.

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert(condition BOOLEAN, description TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT condition THEN
        RAISE EXCEPTION 'FAILED: %', description;
    END IF;
    RAISE NOTICE '  ok  %', description;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_rejects(stmt TEXT, description TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN others THEN
        RAISE NOTICE '  ok  % (rejected: %)', description, replace(SQLERRM, E'\n', ' ');
        RETURN;
    END;
    RAISE EXCEPTION 'FAILED: % — statement was accepted but should have been rejected', description;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE fx (name TEXT PRIMARY KEY, id UUID);

INSERT INTO users ("idp_subject", "email", "display_name", "role")
VALUES ('test-alice', 'alice@example.test', 'Alice', 'USER'),
       ('test-bob',   'bob@example.test',   'Bob',   'USER')
RETURNING 1;

INSERT INTO fx SELECT 'alice', id FROM users WHERE idp_subject = 'test-alice';
INSERT INTO fx SELECT 'bob',   id FROM users WHERE idp_subject = 'test-bob';
INSERT INTO fx SELECT 'status_new', id FROM statuses  WHERE slug = 'new';
INSERT INTO fx SELECT 'cat_feature', id FROM categories WHERE slug = 'feature';

INSERT INTO feedback_requests ("title", "description", "category_id", "status_id", "author_id")
SELECT 'Dark mode for the dashboard',
       'The dashboard is unusable at night. A dark theme would help a lot.',
       (SELECT id FROM fx WHERE name = 'cat_feature'),
       (SELECT id FROM fx WHERE name = 'status_new'),
       (SELECT id FROM fx WHERE name = 'alice');

INSERT INTO fx SELECT 'request', id FROM feedback_requests WHERE title = 'Dark mode for the dashboard';

\echo ''
\echo 'votes — one per user per request'

-- ---------------------------------------------------------------------------
-- Vote uniqueness and vote_count
-- ---------------------------------------------------------------------------

INSERT INTO votes ("request_id", "user_id")
VALUES ((SELECT id FROM fx WHERE name='request'), (SELECT id FROM fx WHERE name='alice'));

SELECT pg_temp.assert(
    (SELECT vote_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 1,
    'a vote increments vote_count');

SELECT pg_temp.assert_rejects(
    format('INSERT INTO votes (request_id, user_id) VALUES (%L, %L)',
           (SELECT id FROM fx WHERE name='request'), (SELECT id FROM fx WHERE name='alice')),
    'the same user cannot vote twice on the same request');

INSERT INTO votes ("request_id", "user_id")
VALUES ((SELECT id FROM fx WHERE name='request'), (SELECT id FROM fx WHERE name='bob'));

SELECT pg_temp.assert(
    (SELECT vote_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 2,
    'a second user''s vote increments vote_count again');

DELETE FROM votes
 WHERE request_id = (SELECT id FROM fx WHERE name='request')
   AND user_id = (SELECT id FROM fx WHERE name='bob');

SELECT pg_temp.assert(
    (SELECT vote_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 1,
    'withdrawing a vote decrements vote_count');

SELECT pg_temp.assert(
    (SELECT count(*) FROM votes WHERE request_id = (SELECT id FROM fx WHERE name='request'))
      = (SELECT vote_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')),
    'stored vote_count equals the recomputed count');

\echo ''
\echo 'comments — count follows visibility'

-- ---------------------------------------------------------------------------
-- Comment count across every visibility transition
-- ---------------------------------------------------------------------------

INSERT INTO comments ("request_id", "author_id", "body", "moderation_status")
VALUES ((SELECT id FROM fx WHERE name='request'), (SELECT id FROM fx WHERE name='bob'),
        'Strongly agree, this would help.', 'APPROVED');
INSERT INTO fx SELECT 'comment_approved', id FROM comments WHERE body = 'Strongly agree, this would help.';

SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 1,
    'an approved comment increments comment_count');

INSERT INTO comments ("request_id", "author_id", "body", "moderation_status")
VALUES ((SELECT id FROM fx WHERE name='request'), (SELECT id FROM fx WHERE name='bob'),
        'Awaiting moderation.', 'PENDING');
INSERT INTO fx SELECT 'comment_pending', id FROM comments WHERE body = 'Awaiting moderation.';

SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 1,
    'a pending comment does not count');

UPDATE comments SET moderation_status = 'APPROVED' WHERE id = (SELECT id FROM fx WHERE name='comment_pending');
SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 2,
    'approving a pending comment increments comment_count');

UPDATE comments SET moderation_status = 'REJECTED' WHERE id = (SELECT id FROM fx WHERE name='comment_pending');
SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 1,
    'rejecting an approved comment decrements comment_count');

UPDATE comments SET deleted_at = now() WHERE id = (SELECT id FROM fx WHERE name='comment_approved');
SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 0,
    'soft-deleting an approved comment decrements comment_count');

UPDATE comments SET deleted_at = NULL WHERE id = (SELECT id FROM fx WHERE name='comment_approved');
SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 1,
    'restoring a soft-deleted comment increments comment_count');

-- An edit that changes neither visibility flag must not move the counter.
UPDATE comments SET body = 'Edited body.', edited_at = now()
 WHERE id = (SELECT id FROM fx WHERE name='comment_approved');
SELECT pg_temp.assert(
    (SELECT comment_count FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')) = 1,
    'editing a comment body leaves comment_count unchanged');

\echo ''
\echo 'taxonomy'

-- ---------------------------------------------------------------------------
-- Taxonomy rules
-- ---------------------------------------------------------------------------

SELECT pg_temp.assert(
    (SELECT count(*) FROM statuses WHERE is_default) = 1,
    'exactly one default status exists');

SELECT pg_temp.assert_rejects(
    'UPDATE statuses SET is_default = TRUE WHERE slug = ''planned''',
    'a second default status cannot be set');

SELECT pg_temp.assert_rejects(
    'DELETE FROM categories WHERE slug = ''feature''',
    'a category still referenced by a request cannot be deleted');

SELECT pg_temp.assert_rejects(
    'DELETE FROM statuses WHERE slug = ''new''',
    'a status still referenced by a request cannot be deleted');

-- Retiring is always allowed; it is the supported alternative to deletion.
--
-- Asserted as "unchanged" rather than as a fixed number on purpose: this file is run
-- against a developer's database, which may or may not have the demo seed applied, and an
-- absolute count would make the check depend on how much other data happens to exist.
CREATE TEMP TABLE before_retire AS
SELECT count(*) AS n FROM feedback_requests r
  JOIN categories c ON c.id = r.category_id WHERE c.slug = 'feature';

UPDATE categories SET is_active = FALSE WHERE slug = 'feature';

SELECT pg_temp.assert(
    (SELECT n FROM before_retire) > 0
    AND (SELECT count(*) FROM feedback_requests r
           JOIN categories c ON c.id = r.category_id WHERE c.slug = 'feature')
        = (SELECT n FROM before_retire),
    'retiring a category leaves existing requests intact');

UPDATE categories SET is_active = TRUE WHERE slug = 'feature';
DROP TABLE before_retire;

\echo ''
\echo 'validation and integrity constraints'

-- ---------------------------------------------------------------------------
-- Field-level constraints
-- ---------------------------------------------------------------------------

SELECT pg_temp.assert_rejects(
    format('INSERT INTO feedback_requests (title, description, category_id, status_id, author_id)
            VALUES (%L, %L, %L, %L, %L)', 'abc', 'long enough description here',
           (SELECT id FROM fx WHERE name='cat_feature'), (SELECT id FROM fx WHERE name='status_new'),
           (SELECT id FROM fx WHERE name='alice')),
    'a title shorter than 5 characters is rejected');

SELECT pg_temp.assert_rejects(
    format('INSERT INTO users (idp_subject, email, display_name) VALUES (%L, %L, %L)',
           'test-duplicate', 'ALICE@example.test', 'Duplicate'),
    'email uniqueness is case-insensitive');

SELECT pg_temp.assert_rejects(
    format('UPDATE feedback_requests SET is_pinned = TRUE WHERE id = %L',
           (SELECT id FROM fx WHERE name='request')),
    'pinning without pinned_at is rejected');

UPDATE feedback_requests SET is_pinned = TRUE, pinned_at = now()
 WHERE id = (SELECT id FROM fx WHERE name='request');
SELECT pg_temp.assert(
    (SELECT pinned_at IS NOT NULL FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request')),
    'pinning with pinned_at is accepted');

SELECT pg_temp.assert_rejects(
    'INSERT INTO app_settings (id) VALUES (FALSE)',
    'app_settings cannot hold a second row');

SELECT pg_temp.assert_rejects(
    'UPDATE app_settings SET registration_policy = ''DOMAIN_RESTRICTED'', allowed_email_domains = ''{}''',
    'a domain restriction with no domains is rejected');

SELECT pg_temp.assert_rejects(
    format('UPDATE feedback_requests SET vote_count = -1 WHERE id = %L',
           (SELECT id FROM fx WHERE name='request')),
    'a negative vote_count is rejected by the tripwire constraint');

-- Users are anonymised rather than deleted, so authored content can never dangle.
-- This has to be asserted while the author still has content: the cascade checks below
-- remove it, and the restriction would then correctly no longer apply.
SELECT pg_temp.assert_rejects(
    format('DELETE FROM users WHERE id = %L', (SELECT id FROM fx WHERE name='alice')),
    'a user who authored content cannot be hard-deleted');

\echo ''
\echo 'search'

-- ---------------------------------------------------------------------------
-- Full-text search
-- ---------------------------------------------------------------------------

-- Every search assertion is scoped to the fixture row. Counting matches across the whole
-- table would make the result depend on whether the demo seed happens to be present.
SELECT pg_temp.assert(
    (SELECT count(*) FROM feedback_requests
      WHERE search_vector @@ websearch_to_tsquery('english', 'dark mode')
        AND id = (SELECT id FROM fx WHERE name='request')) = 1,
    'full-text search matches on the title');

SELECT pg_temp.assert(
    (SELECT count(*) FROM feedback_requests
      WHERE search_vector @@ websearch_to_tsquery('english', 'unusable night')
        AND id = (SELECT id FROM fx WHERE name='request')) = 1,
    'full-text search matches on the description');

SELECT pg_temp.assert(
    (SELECT count(*) FROM feedback_requests
      WHERE search_vector @@ websearch_to_tsquery('english', 'kubernetes')
        AND id = (SELECT id FROM fx WHERE name='request')) = 0,
    'full-text search does not match unrelated terms');

-- The search input is user-supplied, so it has to survive hostile input rather than
-- raising. websearch_to_tsquery never throws on malformed input, unlike to_tsquery.
SELECT pg_temp.assert(
    (SELECT count(*) FROM feedback_requests
      WHERE search_vector @@ websearch_to_tsquery('english', ''')); DROP TABLE users; --')
        AND id = (SELECT id FROM fx WHERE name='request')) = 0,
    'search survives SQL metacharacters without erroring');

-- The generated column cannot drift from the content.
UPDATE feedback_requests SET title = 'Kubernetes manifests are missing'
 WHERE id = (SELECT id FROM fx WHERE name='request');
SELECT pg_temp.assert(
    (SELECT count(*) FROM feedback_requests
      WHERE search_vector @@ websearch_to_tsquery('english', 'kubernetes')
        AND id = (SELECT id FROM fx WHERE name='request')) = 1,
    'the search vector updates when the title changes');

\echo ''
\echo 'cascades'

-- ---------------------------------------------------------------------------
-- Deleting a request takes its votes and comments with it
-- ---------------------------------------------------------------------------

DELETE FROM feedback_requests WHERE id = (SELECT id FROM fx WHERE name='request');

SELECT pg_temp.assert(
    (SELECT count(*) FROM votes WHERE request_id = (SELECT id FROM fx WHERE name='request')) = 0,
    'deleting a request cascades to its votes');
SELECT pg_temp.assert(
    (SELECT count(*) FROM comments WHERE request_id = (SELECT id FROM fx WHERE name='request')) = 0,
    'deleting a request cascades to its comments');

\echo ''
\echo 'All schema invariant checks passed.'

ROLLBACK;
