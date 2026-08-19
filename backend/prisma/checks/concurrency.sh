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

cleanup() {
  q "DELETE FROM feedback_requests WHERE title = 'Concurrency check fixture';" >/dev/null
  q "DELETE FROM users WHERE idp_subject LIKE 'concurrency-check-%';" >/dev/null
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

echo "Concurrency checks passed."
