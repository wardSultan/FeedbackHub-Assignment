-- Demo content.
--
-- Separate from the migration on purpose: the migration creates the reference data the
-- application cannot start without (settings row, statuses, categories, flags), and this
-- creates data that exists only to make the board worth looking at.
--
--     psql -d feedbackhub -v ON_ERROR_STOP=1 -f prisma/seed.sql
--
-- Idempotent: safe to re-run. Authored by the same accounts the Keycloak realm seeds, so
-- signing in as admin@feedbackhub.local lands on an account that already owns content
-- rather than an empty duplicate.

\set ON_ERROR_STOP on
BEGIN;

-- The idp_subject values are the fixed user ids in infra/keycloak/realm-feedbackhub.json.
-- If those change, these must change with them or first sign-in creates a second account.
INSERT INTO users (idp_subject, email, display_name, role) VALUES
    ('00000000-0000-4000-a000-00000000ad01', 'admin@feedbackhub.local',  'Ada Admin',  'ADMIN'),
    ('00000000-0000-4000-a000-000000005e01', 'user@feedbackhub.local',   'Uma User',   'USER'),
    ('00000000-0000-4000-a000-000000005e02', 'second@feedbackhub.local', 'Sam Second', 'USER')
ON CONFLICT (idp_subject) DO NOTHING;

CREATE TEMP TABLE seed_request (
    title TEXT, description TEXT, category TEXT, status TEXT, author TEXT, pinned BOOLEAN
) ON COMMIT DROP;

INSERT INTO seed_request VALUES
    ('Dark mode for the whole application',
     'The board is hard to read late in the day. A dark theme that follows the operating system preference would help everyone who works outside office hours.',
     'feature', 'planned', 'user@feedbackhub.local', TRUE),
    ('Export the feedback list to CSV',
     'Product planning happens in a spreadsheet. Being able to export the current filtered list would save copying rows by hand every week.',
     'feature', 'under-review', 'second@feedbackhub.local', FALSE),
    ('Search returns nothing for partial words',
     'Searching for "auth" does not find "authentication". People give up and file a duplicate instead of finding the existing request.',
     'bug', 'in-progress', 'user@feedbackhub.local', FALSE),
    ('Keyboard shortcut to submit a request',
     'Submitting means reaching for the mouse every time. Ctrl+Enter in the description field would be enough.',
     'improvement', 'new', 'second@feedbackhub.local', FALSE),
    ('Email notification when my request changes status',
     'I file something and never hear about it again. A short email when the status changes would close the loop.',
     'feature', 'new', 'user@feedbackhub.local', FALSE),
    ('Comment box loses text on accidental navigation',
     'Half-written comments disappear when you hit the back button. Losing a long comment is genuinely annoying.',
     'bug', 'new', 'second@feedbackhub.local', FALSE),
    ('Show who has voted on a request',
     'It would help to know whether support comes from one team or across the company before prioritising something.',
     'question', 'declined', 'user@feedbackhub.local', FALSE),
    ('Merge duplicate requests instead of closing them',
     'When the same idea is filed twice the votes get split, which makes both look less popular than the idea actually is.',
     'improvement', 'under-review', 'second@feedbackhub.local', FALSE);

INSERT INTO feedback_requests (title, description, category_id, status_id, author_id, is_pinned, pinned_at, created_at)
SELECT s.title,
       s.description,
       c.id,
       st.id,
       u.id,
       s.pinned,
       CASE WHEN s.pinned THEN now() ELSE NULL END,
       -- Spread creation times so "newest" and "oldest" sort into a visible order.
       now() - (row_number() OVER (ORDER BY s.title) * INTERVAL '13 hours')
  FROM seed_request s
  JOIN categories c ON c.slug = s.category
  JOIN statuses  st ON st.slug = s.status
  JOIN users     u  ON u.email = s.author
 WHERE NOT EXISTS (SELECT 1 FROM feedback_requests r WHERE r.title = s.title);

-- Votes. Deliberately uneven so sorting by popularity is not the same as sorting by date.
INSERT INTO votes (request_id, user_id)
SELECT r.id, u.id
  FROM feedback_requests r
  CROSS JOIN users u
 WHERE (r.title LIKE 'Dark mode%')
    OR (r.title LIKE 'Search returns%' AND u.email <> 'second@feedbackhub.local')
    OR (r.title LIKE 'Export the%' AND u.email = 'admin@feedbackhub.local')
ON CONFLICT DO NOTHING;

INSERT INTO comments (request_id, author_id, body, moderation_status)
SELECT r.id, u.id, v.body, v.status::"CommentModerationStatus"
  FROM (VALUES
        ('Dark mode for the whole application', 'admin@feedbackhub.local',
         'Planned for the next cycle. It will follow the system setting by default.', 'APPROVED'),
        ('Dark mode for the whole application', 'second@feedbackhub.local',
         'Please make sure the status colours stay readable in dark mode.', 'APPROVED'),
        ('Search returns nothing for partial words', 'second@feedbackhub.local',
         'Same here — searching for a partial word finds nothing at all.', 'APPROVED'),
        ('Merge duplicate requests instead of closing them', 'user@feedbackhub.local',
         'This comment is awaiting moderation, so it should not appear in the count.', 'PENDING')
       ) AS v(title, author, body, status)
  JOIN feedback_requests r ON r.title = v.title
  JOIN users u ON u.email = v.author
 WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.request_id = r.id AND c.body = v.body);

COMMIT;
