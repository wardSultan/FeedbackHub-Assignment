-- FeedbackHub initial schema.
--
-- Design notes that are not obvious from the DDL alone:
--
--  * The one-vote-per-user rule is the composite primary key on `votes`. It is a key,
--    not an application check, because two concurrent requests from a double-clicked
--    button both pass an application-level "has this user voted?" test and both insert.
--
--  * `vote_count` and `comment_count` are maintained by triggers rather than by
--    application code. Seeds, cascade deletes and any future writer then maintain the
--    invariant for free, atomically, inside the same transaction. The CHECK (>= 0)
--    constraints are tripwires: if the trigger logic is ever wrong the transaction
--    fails loudly instead of silently displaying a negative count.
--
--  * Nullable columns in `user_settings` mean "inherit the global default", not "off".
--    That is what makes an admin changing a global default propagate to users who never
--    customised the setting.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "Theme" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');
CREATE TYPE "ListSort" AS ENUM ('NEWEST', 'OLDEST', 'MOST_VOTED', 'MOST_COMMENTED', 'RECENTLY_UPDATED');
CREATE TYPE "RegistrationPolicy" AS ENUM ('OPEN', 'INVITE_ONLY', 'DOMAIN_RESTRICTED');
CREATE TYPE "CommentModerationStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE "users" (
    "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The OIDC `sub` claim. Immutable, and the only link to the identity provider.
    "idp_subject"   TEXT        NOT NULL,
    "email"         TEXT        NOT NULL,
    "display_name"  TEXT        NOT NULL,
    "avatar_url"    TEXT,
    -- Authorization is owned by this application, not by the identity provider.
    "role"          "UserRole"  NOT NULL DEFAULT 'USER',
    "is_active"     BOOLEAN     NOT NULL DEFAULT TRUE,
    -- Account deletion anonymises rather than cascades: authored content keeps a valid
    -- foreign key and renders as "Deleted user".
    "deleted_at"    TIMESTAMPTZ,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "users_display_name_length" CHECK (char_length("display_name") BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX "users_idp_subject_key" ON "users" ("idp_subject");
CREATE UNIQUE INDEX "users_email_key" ON "users" (lower("email"));
-- Supports the "is this the last admin?" check on demotion and account deletion.
CREATE INDEX "users_admin_idx" ON "users" ("role") WHERE "role" = 'ADMIN' AND "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- categories / statuses  (admin-curated taxonomy)
-- ---------------------------------------------------------------------------

CREATE TABLE "categories" (
    "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug"        TEXT        NOT NULL,
    "name"        TEXT        NOT NULL,
    "color"       TEXT        NOT NULL DEFAULT '#6b7280',
    "sort_order"  INTEGER     NOT NULL DEFAULT 0,
    -- "Retiring" a category deactivates it: it disappears from the create form but
    -- existing requests keep it and remain filterable by it.
    "is_active"   BOOLEAN     NOT NULL DEFAULT TRUE,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "categories_name_length" CHECK (char_length("name") BETWEEN 1 AND 40)
);

CREATE UNIQUE INDEX "categories_slug_key" ON "categories" ("slug");
CREATE INDEX "categories_active_order_idx" ON "categories" ("is_active", "sort_order");

CREATE TABLE "statuses" (
    "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug"        TEXT        NOT NULL,
    "name"        TEXT        NOT NULL,
    "color"       TEXT        NOT NULL DEFAULT '#6b7280',
    "sort_order"  INTEGER     NOT NULL DEFAULT 0,
    "is_default"  BOOLEAN     NOT NULL DEFAULT FALSE,
    "is_active"   BOOLEAN     NOT NULL DEFAULT TRUE,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "statuses_name_length" CHECK (char_length("name") BETWEEN 1 AND 40)
);

CREATE UNIQUE INDEX "statuses_slug_key" ON "statuses" ("slug");
CREATE INDEX "statuses_active_order_idx" ON "statuses" ("is_active", "sort_order");
-- Exactly one default status, enforced by the database. Swapping the default therefore
-- has to clear the old one in the same transaction, which is the correct behaviour.
CREATE UNIQUE INDEX "statuses_single_default_idx" ON "statuses" ("is_default") WHERE "is_default";

-- ---------------------------------------------------------------------------
-- feedback_requests
-- ---------------------------------------------------------------------------

CREATE TABLE "feedback_requests" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "title"          TEXT        NOT NULL,
    "description"    TEXT        NOT NULL,
    "category_id"    UUID        NOT NULL REFERENCES "categories" ("id") ON DELETE RESTRICT,
    "status_id"      UUID        NOT NULL REFERENCES "statuses" ("id")   ON DELETE RESTRICT,
    "author_id"      UUID        NOT NULL REFERENCES "users" ("id")      ON DELETE RESTRICT,
    "is_pinned"      BOOLEAN     NOT NULL DEFAULT FALSE,
    "pinned_at"      TIMESTAMPTZ,
    "vote_count"     INTEGER     NOT NULL DEFAULT 0,
    "comment_count"  INTEGER     NOT NULL DEFAULT 0,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"     TIMESTAMPTZ,

    -- A generated column cannot drift from the content it indexes, which a
    -- trigger-maintained or application-maintained column eventually would.
    "search_vector"  TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') ||
        setweight(to_tsvector('english'::regconfig, coalesce("description", '')), 'B')
    ) STORED,

    CONSTRAINT "feedback_requests_title_length"       CHECK (char_length("title") BETWEEN 5 AND 120),
    CONSTRAINT "feedback_requests_description_length" CHECK (char_length("description") BETWEEN 10 AND 5000),
    CONSTRAINT "feedback_requests_vote_count_positive"    CHECK ("vote_count" >= 0),
    CONSTRAINT "feedback_requests_comment_count_positive" CHECK ("comment_count" >= 0),
    -- pinned_at exists if and only if the request is pinned.
    CONSTRAINT "feedback_requests_pinned_consistency" CHECK (("is_pinned" IS FALSE) = ("pinned_at" IS NULL))
);

CREATE INDEX "feedback_requests_search_idx"    ON "feedback_requests" USING GIN ("search_vector");
CREATE INDEX "feedback_requests_default_sort_idx" ON "feedback_requests" ("is_pinned" DESC, "pinned_at" DESC, "created_at" DESC);
CREATE INDEX "feedback_requests_votes_sort_idx"   ON "feedback_requests" ("is_pinned" DESC, "vote_count" DESC, "created_at" DESC);
CREATE INDEX "feedback_requests_status_idx"    ON "feedback_requests" ("status_id");
CREATE INDEX "feedback_requests_category_idx"  ON "feedback_requests" ("category_id");
CREATE INDEX "feedback_requests_author_idx"    ON "feedback_requests" ("author_id");

-- ---------------------------------------------------------------------------
-- votes
-- ---------------------------------------------------------------------------

CREATE TABLE "votes" (
    "request_id" UUID        NOT NULL REFERENCES "feedback_requests" ("id") ON DELETE CASCADE,
    "user_id"    UUID        NOT NULL REFERENCES "users" ("id")             ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The one-vote-per-user invariant. There is no use case for addressing a vote by
    -- its own identity, so the natural key is the primary key.
    PRIMARY KEY ("request_id", "user_id")
);

-- "Requests I have voted on".
CREATE INDEX "votes_user_idx" ON "votes" ("user_id");

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------

CREATE TABLE "comments" (
    "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "request_id"        UUID        NOT NULL REFERENCES "feedback_requests" ("id") ON DELETE CASCADE,
    "author_id"         UUID        NOT NULL REFERENCES "users" ("id")             ON DELETE RESTRICT,
    "body"              TEXT        NOT NULL,
    "moderation_status" "CommentModerationStatus" NOT NULL DEFAULT 'APPROVED',
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set only when the body changes, so the "edited" indicator is not tripped by an
    -- admin approving or rejecting the comment.
    "edited_at"         TIMESTAMPTZ,
    "deleted_at"        TIMESTAMPTZ,

    CONSTRAINT "comments_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000)
);

CREATE INDEX "comments_request_idx" ON "comments" ("request_id", "created_at");
CREATE INDEX "comments_pending_idx" ON "comments" ("created_at")
    WHERE "moderation_status" = 'PENDING' AND "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- Derived counts
-- ---------------------------------------------------------------------------

-- Delta arithmetic rather than a recomputing COUNT(*): the increment is evaluated
-- while the row is locked by the UPDATE, so concurrent votes cannot lose an update.
CREATE FUNCTION "fh_votes_maintain_count"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE "feedback_requests" SET "vote_count" = "vote_count" + 1 WHERE "id" = NEW."request_id";
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE "feedback_requests" SET "vote_count" = "vote_count" - 1 WHERE "id" = OLD."request_id";
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "votes_maintain_count"
AFTER INSERT OR DELETE ON "votes"
FOR EACH ROW EXECUTE FUNCTION "fh_votes_maintain_count"();

-- A comment counts when it is approved and not deleted. Every transition between those
-- two states has to move the counter, which is why this is expressed as a delta between
-- the old and new visibility rather than as a set of special cases.
CREATE FUNCTION "fh_comments_maintain_count"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    was_visible INTEGER := 0;
    is_visible  INTEGER := 0;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        was_visible := (OLD."moderation_status" = 'APPROVED' AND OLD."deleted_at" IS NULL)::INTEGER;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        is_visible := (NEW."moderation_status" = 'APPROVED' AND NEW."deleted_at" IS NULL)::INTEGER;
    END IF;

    IF is_visible <> was_visible THEN
        UPDATE "feedback_requests"
           SET "comment_count" = "comment_count" + (is_visible - was_visible)
         WHERE "id" = COALESCE(NEW."request_id", OLD."request_id");
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "comments_maintain_count"
AFTER INSERT OR UPDATE OR DELETE ON "comments"
FOR EACH ROW EXECUTE FUNCTION "fh_comments_maintain_count"();

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

CREATE TABLE "app_settings" (
    -- Single-row table: the primary key can only ever hold one value.
    "id"                            BOOLEAN PRIMARY KEY DEFAULT TRUE,
    "registration_policy"           "RegistrationPolicy" NOT NULL DEFAULT 'OPEN',
    "allowed_email_domains"         TEXT[]      NOT NULL DEFAULT '{}',
    "comments_require_approval"     BOOLEAN     NOT NULL DEFAULT FALSE,
    "submission_limit_count"        INTEGER     NOT NULL DEFAULT 5,
    "submission_limit_window_hours" INTEGER     NOT NULL DEFAULT 24,
    -- Global defaults for the settings a user may override.
    "default_theme"                 "Theme"     NOT NULL DEFAULT 'SYSTEM',
    "default_language"              TEXT        NOT NULL DEFAULT 'en',
    "default_sort"                  "ListSort"  NOT NULL DEFAULT 'NEWEST',
    -- { "statuses": ["planned"], "categories": ["bug"] }. A blob rather than two array
    -- columns because the per-user override below has to distinguish "no override" from
    -- "an override that selects nothing", and a nullable array cannot be modelled in
    -- Prisma. Contents are validated by the API layer, not by the database.
    "default_filters"               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    "updated_by"                    UUID REFERENCES "users" ("id") ON DELETE SET NULL,
    "updated_at"                    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "app_settings_single_row" CHECK ("id"),
    CONSTRAINT "app_settings_limit_count_positive"  CHECK ("submission_limit_count" > 0),
    CONSTRAINT "app_settings_limit_window_positive" CHECK ("submission_limit_window_hours" > 0),
    -- A domain restriction with no domains would lock everybody out.
    CONSTRAINT "app_settings_domains_present" CHECK (
        "registration_policy" <> 'DOMAIN_RESTRICTED' OR cardinality("allowed_email_domains") > 0
    )
);

CREATE TABLE "user_settings" (
    "user_id"                UUID PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
    -- NULL means "no override, inherit the global default" — not "off".
    "theme"                  "Theme",
    "language"               TEXT,
    "default_sort"           "ListSort",
    "default_filters"        JSONB,
    "notify_on_comment"      BOOLEAN,
    "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "feature_flags" (
    "key"         TEXT PRIMARY KEY,
    "name"        TEXT        NOT NULL,
    "description" TEXT        NOT NULL,
    "enabled"     BOOLEAN     NOT NULL DEFAULT FALSE,
    "updated_by"  UUID REFERENCES "users" ("id") ON DELETE SET NULL,
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Reference data the application cannot start without.
-- Demo content lives in the seed script, not here.
-- ---------------------------------------------------------------------------

INSERT INTO "app_settings" ("id") VALUES (TRUE);

INSERT INTO "statuses" ("slug", "name", "color", "sort_order", "is_default") VALUES
    ('new',          'New',          '#3b82f6', 1, TRUE),
    ('under-review', 'Under Review', '#a855f7', 2, FALSE),
    ('planned',      'Planned',      '#0ea5e9', 3, FALSE),
    ('in-progress',  'In Progress',  '#f59e0b', 4, FALSE),
    ('done',         'Done',         '#22c55e', 5, FALSE),
    ('declined',     'Declined',     '#ef4444', 6, FALSE);

INSERT INTO "categories" ("slug", "name", "color", "sort_order") VALUES
    ('bug',         'Bug',         '#ef4444', 1),
    ('feature',     'Feature',     '#3b82f6', 2),
    ('improvement', 'Improvement', '#22c55e', 3),
    ('question',    'Question',    '#a855f7', 4);

-- Feature flags are code-coupled: admins toggle them, they do not invent them.
INSERT INTO "feature_flags" ("key", "name", "description", "enabled") VALUES
    ('comments.enabled', 'Comments',
     'When disabled, the comment section is hidden and the comment endpoints reject writes.',
     TRUE);
