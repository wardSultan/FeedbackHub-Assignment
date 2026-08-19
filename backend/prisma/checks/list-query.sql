-- Verification for the feedback list query.
--
-- The query below mirrors the one in src/modules/feedback/feedback.repository.ts. It is
-- raw SQL there for a reason worth stating: relevance ranking, "pinned first under every
-- sort" and the per-viewer has_voted flag are clearer as SQL than as query-builder calls,
-- and keeping them as SQL means they can be verified exactly as written — which is what
-- this file does. If the query changes there, it changes here.
--
--     psql -d feedbackhub -v ON_ERROR_STOP=1 -f prisma/checks/list-query.sql
--
-- Requires prisma/seed.sql to have been applied. Rolls back; leaves nothing behind.

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert(condition BOOLEAN, description TEXT) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT condition THEN RAISE EXCEPTION 'FAILED: %', description; END IF;
    RAISE NOTICE '  ok  %', description;
END;
$fn$;

CREATE FUNCTION pg_temp.list(
    viewer     UUID,
    statuses   TEXT[] DEFAULT NULL,
    categories TEXT[] DEFAULT NULL,
    author     UUID   DEFAULT NULL,
    q          TEXT   DEFAULT NULL,
    sort       TEXT   DEFAULT 'NEWEST',
    lim        INT    DEFAULT 20,
    off        INT    DEFAULT 0
) RETURNS TABLE (
    id UUID, title TEXT, is_pinned BOOLEAN, vote_count INT, comment_count INT,
    status_slug TEXT, category_slug TEXT, has_voted BOOLEAN, total_count BIGINT
) LANGUAGE sql STABLE AS $fn$
SELECT r.id,
       r.title,
       r.is_pinned,
       r.vote_count,
       r.comment_count,
       s.slug,
       c.slug,
       (v.user_id IS NOT NULL),
       count(*) OVER ()
  FROM feedback_requests r
  JOIN categories c ON c.id = r.category_id
  JOIN statuses   s ON s.id = r.status_id
  JOIN users      u ON u.id = r.author_id
  LEFT JOIN votes v ON v.request_id = r.id AND v.user_id = viewer
 WHERE r.deleted_at IS NULL
   AND (statuses   IS NULL OR s.slug = ANY(statuses))
   AND (categories IS NULL OR c.slug = ANY(categories))
   AND (author     IS NULL OR r.author_id = author)
   AND (q          IS NULL OR r.search_vector @@ websearch_to_tsquery('english', q))
 -- Pinned first regardless of the chosen sort: "pins an important one to the top of the
 -- list" only holds under every sort, otherwise it is a property of the default ordering.
 ORDER BY r.is_pinned DESC,
          r.pinned_at DESC NULLS LAST,
          -- Relevance leads when searching. Negated rather than DESC because a DESC here
          -- would apply to the CASE expression as a whole.
          CASE WHEN q IS NULL THEN 0
               ELSE -ts_rank(r.search_vector, websearch_to_tsquery('english', q)) END,
          CASE WHEN sort = 'MOST_VOTED'     THEN -r.vote_count
               WHEN sort = 'MOST_COMMENTED' THEN -r.comment_count END,
          CASE WHEN sort = 'OLDEST'           THEN r.created_at END ASC,
          CASE WHEN sort = 'RECENTLY_UPDATED' THEN r.updated_at END DESC,
          r.created_at DESC
 LIMIT lim OFFSET off;
$fn$;

CREATE TEMP TABLE who (name TEXT PRIMARY KEY, id UUID) ON COMMIT DROP;
INSERT INTO who SELECT 'uma', id FROM users WHERE email = 'user@feedbackhub.local';
INSERT INTO who SELECT 'sam', id FROM users WHERE email = 'second@feedbackhub.local';

\echo ''
\echo 'ordering'

SELECT pg_temp.assert(
    (SELECT is_pinned FROM pg_temp.list((SELECT id FROM who WHERE name='uma')) LIMIT 1),
    'the pinned request leads the default sort');

SELECT pg_temp.assert(
    (SELECT is_pinned FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), sort => 'MOST_VOTED') LIMIT 1),
    'the pinned request still leads when sorting by votes');

SELECT pg_temp.assert(
    (SELECT is_pinned FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), sort => 'OLDEST') LIMIT 1),
    'the pinned request still leads when sorting oldest first');

SELECT pg_temp.assert(
    (SELECT vote_count FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), sort => 'MOST_VOTED') OFFSET 1 LIMIT 1) = 2,
    'below the pin, most-voted orders by vote count');

SELECT pg_temp.assert(
    (SELECT comment_count FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), sort => 'MOST_COMMENTED') OFFSET 1 LIMIT 1) = 1,
    'below the pin, most-commented orders by comment count');

SELECT pg_temp.assert(
    (SELECT title FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), sort => 'OLDEST') OFFSET 1 LIMIT 1)
      <> (SELECT title FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), sort => 'NEWEST') OFFSET 1 LIMIT 1),
    'oldest and newest produce different orderings');

\echo ''
\echo 'filtering'

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), statuses => ARRAY['new'])) = 3,
    'filtering by status narrows the result');

SELECT pg_temp.assert(
    (SELECT bool_and(category_slug = 'bug') FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), categories => ARRAY['bug'])),
    'filtering by category returns only that category');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'),
        statuses => ARRAY['new','under-review'], categories => ARRAY['feature'])) = 2,
    'status and category filters compose');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'),
        author => (SELECT id FROM who WHERE name='uma'))) = 4,
    'filtering by author supports "my requests"');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), statuses => ARRAY['no-such-status'])) = 0,
    'an unknown filter value returns nothing rather than everything');

\echo ''
\echo 'search'

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), q => 'dark mode')) = 1,
    'search matches the title');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), q => 'spreadsheet')) = 1,
    'search matches the description');

SELECT pg_temp.assert(
    (SELECT title FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), q => 'duplicate') LIMIT 1)
      LIKE 'Merge duplicate%',
    'search ranks a title match above a description match');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), q => 'kubernetes')) = 0,
    'search returns nothing for an unrelated term');

-- User-supplied input reaches websearch_to_tsquery directly. Unlike to_tsquery it never
-- raises on malformed input, which is exactly why it is the right function here.
SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), q => ''')); DROP TABLE users; --')) = 0,
    'search survives SQL metacharacters');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), q => '&&& ||| !!!')) >= 0,
    'search survives tsquery operator characters');

\echo ''
\echo 'pagination and the viewer'

SELECT pg_temp.assert(
    (SELECT DISTINCT total_count FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), lim => 3)) = 8,
    'the window total counts the whole result, not the page');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), lim => 3)) = 3,
    'the page size is honoured');

SELECT pg_temp.assert(
    (SELECT id FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), lim => 1, off => 1))
      <> (SELECT id FROM pg_temp.list((SELECT id FROM who WHERE name='uma'), lim => 1, off => 0)),
    'the offset moves the window');

SELECT pg_temp.assert(
    (SELECT has_voted FROM pg_temp.list((SELECT id FROM who WHERE name='uma')) LIMIT 1),
    'has_voted is true for a viewer who voted');

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma')) WHERE has_voted)
      <> (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='sam')) WHERE has_voted),
    'has_voted is computed per viewer, not globally');

\echo ''
\echo 'soft deletion'

UPDATE feedback_requests SET deleted_at = now() WHERE is_pinned;

SELECT pg_temp.assert(
    (SELECT count(*) FROM pg_temp.list((SELECT id FROM who WHERE name='uma'))) = 7,
    'a soft-deleted request disappears from the list');

SELECT pg_temp.assert(
    NOT (SELECT is_pinned FROM pg_temp.list((SELECT id FROM who WHERE name='uma')) LIMIT 1),
    'the pinned-but-deleted request no longer leads');

\echo ''
\echo 'All list query checks passed.'

ROLLBACK;
