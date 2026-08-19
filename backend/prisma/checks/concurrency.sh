#!/usr/bin/env bash
#
# Concurrency check for the vote invariants.
#
# A single-session SQL script cannot prove either of the two properties that actually
# matter here, because both only fail when transactions overlap:
#
#   1. A double-clicked vote button must produce one vote, not two. An application-level
#      "has this user already voted?" check passes in both concurrent transactions and
#      both insert — only the composite primary key stops it.
#
#   2. Concurrent votes from different users must not lose counter updates. This is why
#      the trigger uses `vote_count = vote_count + 1` (evaluated under the row lock taken
#      by the UPDATE) rather than recomputing a COUNT(*) into the column.
#
# Usage: DATABASE_URL=... ./concurrency.sh   (defaults to the local dev database)

set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-feedbackhub}"
PGPASSWORD="${PGPASSWORD:-feedbackhub}"
PGDATABASE="${PGDATABASE:-feedbackhub}"
export PGHOST PGUSER PGPASSWORD PGDATABASE

CONCURRENCY="${CONCURRENCY:-20}"
q() { psql -qtA -v ON_ERROR_STOP=1 -c "$1"; }

# Section 4 temporarily demotes the real administrators so that exactly two exist during
# the test. They are restored here, and the trap makes that hold even if the script is
# interrupted partway.
SAVED_ADMINS=""

cleanup() {
  q "DELETE FROM feedback_requests WHERE title = 'Concurrency check fixture';" >/dev/null
  q "DELETE FROM users WHERE idp_subject LIKE 'concurrency-check-%';" >/dev/null
  q "DELETE FROM users WHERE idp_subject LIKE 'last-admin-check-%';" >/dev/null
  if [[ -n "${SAVED_ADMINS}" ]]; then
    q "UPDATE users SET role = 'ADMIN' WHERE id IN (${SAVED_ADMINS});" >/dev/null
    SAVED_ADMINS=""
  fi
}
trap cleanup EXIT
cleanup

echo "seeding fixture (${CONCURRENCY} users)"
q "INSERT INTO users (idp_subject, email, display_name)
   SELECT 'concurrency-check-' || i, 'cc' || i || '@example.test', 'CC ' || i
   FROM generate_series(1, ${CONCURRENCY}) AS i;" >/dev/null

q "INSERT INTO feedback_requests (title, description, category_id, status_id, author_id)
   SELECT 'Concurrency check fixture',
          'Fixture row used by the vote concurrency check.',
          (SELECT id FROM categories WHERE slug = 'feature'),
          (SELECT id FROM statuses   WHERE is_default),
          (SELECT id FROM users WHERE idp_subject = 'concurrency-check-1');" >/dev/null

REQUEST_ID=$(q "SELECT id FROM feedback_requests WHERE title = 'Concurrency check fixture';")
USER_ID=$(q "SELECT id FROM users WHERE idp_subject = 'concurrency-check-1';")

# -- 1. Same user, many simultaneous votes -----------------------------------
echo "1. ${CONCURRENCY} concurrent votes from the SAME user"
for _ in $(seq 1 "${CONCURRENCY}"); do
  psql -qtA -c "INSERT INTO votes (request_id, user_id) VALUES ('${REQUEST_ID}', '${USER_ID}');" \
    >/dev/null 2>&1 &
done
wait

rows=$(q "SELECT count(*) FROM votes WHERE request_id = '${REQUEST_ID}';")
count=$(q "SELECT vote_count FROM feedback_requests WHERE id = '${REQUEST_ID}';")
if [[ "${rows}" != "1" || "${count}" != "1" ]]; then
  echo "   FAILED: expected 1 vote row and vote_count 1, got ${rows} rows / count ${count}" >&2
  exit 1
fi
echo "   ok  exactly one vote row, vote_count = 1"

# -- 2. Different users, simultaneous votes ----------------------------------
echo "2. ${CONCURRENCY} concurrent votes from DIFFERENT users"
q "DELETE FROM votes WHERE request_id = '${REQUEST_ID}';" >/dev/null
for i in $(seq 1 "${CONCURRENCY}"); do
  psql -qtA -c "INSERT INTO votes (request_id, user_id)
                SELECT '${REQUEST_ID}', id FROM users WHERE idp_subject = 'concurrency-check-${i}';" \
    >/dev/null 2>&1 &
done
wait

rows=$(q "SELECT count(*) FROM votes WHERE request_id = '${REQUEST_ID}';")
count=$(q "SELECT vote_count FROM feedback_requests WHERE id = '${REQUEST_ID}';")
if [[ "${rows}" != "${CONCURRENCY}" || "${count}" != "${CONCURRENCY}" ]]; then
  echo "   FAILED: expected ${CONCURRENCY} vote rows and vote_count ${CONCURRENCY}," \
       "got ${rows} rows / count ${count} — the counter lost an update" >&2
  exit 1
fi
echo "   ok  ${rows} vote rows, vote_count = ${count} (no lost updates)"

# -- 3. Sequential idempotency ------------------------------------------------
# The two statements below are what the vote endpoints emit: Prisma's
# createMany({ skipDuplicates: true }) compiles to ON CONFLICT DO NOTHING, and
# deleteMany to an unqualified DELETE. Both must be safe to repeat, because a retried
# request and a double-clicked button are ordinary events, not errors.
echo "3. repeating the same cast and withdraw"
q "DELETE FROM votes WHERE request_id = '${REQUEST_ID}';" >/dev/null

for _ in 1 2 3; do
  q "INSERT INTO votes (request_id, user_id) VALUES ('${REQUEST_ID}', '${USER_ID}')
     ON CONFLICT DO NOTHING;" >/dev/null
done
count=$(q "SELECT vote_count FROM feedback_requests WHERE id = '${REQUEST_ID}';")
if [[ "${count}" != "1" ]]; then
  echo "   FAILED: three casts should leave vote_count 1, got ${count}" >&2
  exit 1
fi
echo "   ok  casting three times leaves one vote"

for _ in 1 2 3; do
  q "DELETE FROM votes WHERE request_id = '${REQUEST_ID}' AND user_id = '${USER_ID}';" >/dev/null
done
count=$(q "SELECT vote_count FROM feedback_requests WHERE id = '${REQUEST_ID}';")
if [[ "${count}" != "0" ]]; then
  echo "   FAILED: repeated withdrawal should leave vote_count 0, got ${count}" >&2
  exit 1
fi
echo "   ok  withdrawing three times leaves no vote and does not go negative"

# -- 4. The last administrator cannot be demoted -------------------------------
# Two administrators demoting each other at the same moment both read a count of two,
# both conclude they are not the last, and both proceed — leaving the board with no
# administrator and no way to appoint one. SELECT ... FOR UPDATE on the administrator
# rows is what serialises them.
#
# Removing FOR UPDATE from the block below makes this check fail with zero administrators
# remaining, which is the negative control for it.
echo "4. two administrators demoting each other simultaneously"

SAVED_ADMINS=$(q "SELECT string_agg(quote_literal(id), ',') FROM users
                   WHERE role = 'ADMIN' AND deleted_at IS NULL AND is_active;")
q "UPDATE users SET role = 'USER' WHERE role = 'ADMIN';" >/dev/null
q "INSERT INTO users (idp_subject, email, display_name, role) VALUES
     ('last-admin-check-1','lac1@example.test','Admin One','ADMIN'),
     ('last-admin-check-2','lac2@example.test','Admin Two','ADMIN');" >/dev/null

demote() {
  psql -qtA <<SQL >/dev/null 2>&1
BEGIN;
SELECT pg_sleep(0.2);
DO \$\$
DECLARE n INT;
BEGIN
    SELECT count(*) INTO n FROM (
        SELECT id FROM users
         WHERE role = 'ADMIN' AND deleted_at IS NULL AND is_active
         FOR UPDATE
    ) locked;
    IF n <= 1 THEN
        RAISE EXCEPTION 'refused: last administrator';
    END IF;
    UPDATE users SET role = 'USER' WHERE idp_subject = '$1';
END;
\$\$;
COMMIT;
SQL
}

demote last-admin-check-1 &
demote last-admin-check-2 &
wait

remaining=$(q "SELECT count(*) FROM users
                WHERE role = 'ADMIN' AND deleted_at IS NULL AND is_active;")
if [[ "${remaining}" != "1" ]]; then
  echo "   FAILED: expected exactly one administrator to survive, got ${remaining}" >&2
  exit 1
fi
echo "   ok  one demotion succeeded, one was refused, one administrator remains"

echo "Concurrency and idempotency checks passed."
