-- Verification for account deletion.
--
-- Mirrors UsersService.deleteOwnAccount. Deleting an account anonymises the row rather
-- than removing it, and the point of that choice is entirely about what happens to
-- *other people's* content — so it is checked here against real rows.
--
--     psql -d feedbackhub -v ON_ERROR_STOP=1 -f prisma/checks/account-deletion.sql
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

CREATE OR REPLACE FUNCTION pg_temp.assert_rejects(stmt TEXT, description TEXT) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN others THEN
        RAISE NOTICE '  ok  % (rejected)', description;
        RETURN;
    END;
    RAISE EXCEPTION 'FAILED: % — accepted but should have been rejected', description;
END;
$fn$;

CREATE TEMP TABLE ctx (name TEXT PRIMARY KEY, id UUID) ON COMMIT DROP;
INSERT INTO ctx SELECT 'uma', id FROM users WHERE email = 'user@feedbackhub.local';
INSERT INTO ctx SELECT 'sam', id FROM users WHERE email = 'second@feedbackhub.local';

CREATE TEMP TABLE before_state AS
SELECT (SELECT count(*) FROM feedback_requests WHERE author_id = (SELECT id FROM ctx WHERE name='uma')) AS requests,
       (SELECT count(*) FROM votes            WHERE user_id   = (SELECT id FROM ctx WHERE name='uma')) AS votes,
       (SELECT count(*) FROM comments          WHERE author_id = (SELECT id FROM ctx WHERE name='uma')) AS comments,
       (SELECT vote_count FROM feedback_requests WHERE title = 'Dark mode for the whole application') AS dark_mode_votes;

SELECT pg_temp.assert((SELECT requests FROM before_state) > 0, 'the fixture user has authored requests');

\echo ''
\echo 'anonymisation'

UPDATE users
   SET email = 'deleted-' || id || '@invalid',
       display_name = 'Deleted user',
       avatar_url = NULL,
       is_active = FALSE,
       deleted_at = now(),
       role = 'USER'
 WHERE id = (SELECT id FROM ctx WHERE name='uma');

SELECT pg_temp.assert(
    (SELECT count(*) FROM feedback_requests WHERE author_id = (SELECT id FROM ctx WHERE name='uma'))
      = (SELECT requests FROM before_state),
    'their feedback requests survive');

SELECT pg_temp.assert(
    (SELECT count(*) FROM comments WHERE author_id = (SELECT id FROM ctx WHERE name='uma'))
      = (SELECT comments FROM before_state),
    'their comments survive, so other people''s threads stay readable');

SELECT pg_temp.assert(
    (SELECT vote_count FROM feedback_requests WHERE title = 'Dark mode for the whole application')
      = (SELECT dark_mode_votes FROM before_state),
    'vote counts are unaffected — other people''s signal is not rewritten');

SELECT pg_temp.assert(
    (SELECT count(*) FROM feedback_requests r
       LEFT JOIN users u ON u.id = r.author_id WHERE u.id IS NULL) = 0,
    'no request is left without an author row');

SELECT pg_temp.assert(
    (SELECT u.display_name FROM feedback_requests r JOIN users u ON u.id = r.author_id
      WHERE r.author_id = (SELECT id FROM ctx WHERE name='uma') LIMIT 1) = 'Deleted user',
    'their content renders as "Deleted user" rather than as a blank');

SELECT pg_temp.assert(
    (SELECT count(*) FROM users WHERE id = (SELECT id FROM ctx WHERE name='uma')
       AND email LIKE 'deleted-%@invalid' AND avatar_url IS NULL AND NOT is_active) = 1,
    'the personal details are gone from the row');

\echo ''
\echo 'the deleted account cannot be reused'

-- The placeholder address must stay unique, or a second deletion would collide.
SELECT pg_temp.assert_rejects(
    format('INSERT INTO users (idp_subject, email, display_name) VALUES (%L, %L, %L)',
           'someone-else', 'deleted-' || (SELECT id FROM ctx WHERE name='uma') || '@invalid', 'Impostor'),
    'the placeholder address is still subject to the unique index');

-- Signing in again creates a genuinely new account rather than resurrecting the old one.
INSERT INTO users (idp_subject, email, display_name)
VALUES ('uma-returns', 'user@feedbackhub.local', 'Uma Again');

SELECT pg_temp.assert(
    (SELECT count(*) FROM users WHERE email = 'user@feedbackhub.local') = 1,
    'the original address is free again, so the person can return as a new account');

SELECT pg_temp.assert(
    (SELECT count(*) FROM feedback_requests
      WHERE author_id = (SELECT id FROM users WHERE idp_subject = 'uma-returns')) = 0,
    'the returning account does not inherit the deleted account''s content');

\echo ''
\echo 'All account deletion checks passed.'

ROLLBACK;
