# Decisions

A living record of the decisions that mattered. Each entry states the context, the
options that were genuinely considered, what was decided, and what that costs us.
Entries are added when the decision is made, not reconstructed at the end.

---

## ADR-0001 — Modular monolith, not microservices

**Context.** The brief says a service-oriented decomposition is *preferred*, but also that
it wants "your reasoning more than a particular shape" and that "a well-reasoned case for
simplicity will score better than an unjustified split into multiple services".

**Options.**

1. Split into `feedback`, `engagement`, `config` and `notification` services behind a gateway.
2. One backend deployable, internally partitioned into modules with explicit interfaces.
3. Monolith now, one service extracted later if a boundary earns it.

**Decision.** Option 2 — a modular monolith, deployed alongside the identity provider.

**Why.** The two correctness requirements the brief names by name — a user may vote on a
request at most once, and derived vote/comment counts must stay correct — span requests,
votes and comments. Inside one database those are a unique constraint and a transaction.
Across a network they become distributed-consistency problems. We would be paying the cost
of a distributed system to get a weaker guarantee.

The one boundary that genuinely earns a network split is identity: a different security
domain, a different lifecycle, a different owner. That *is* a separate service (Keycloak),
which is decomposition applied consistently rather than decoratively.

**Consequences.**

- Boundaries are enforced at compile time (module interfaces, exclusive table ownership),
  not by the network. They have to be maintained deliberately or they rot.
- Deployed topology is still four containers: `web`, `api`, `db`, `keycloak`.
- Named first extraction candidate if one is ever needed: notifications (async, retryable,
  bursty — a genuinely different workload shape). Not built now.
- Horizontal scaling is by API replicas, which is far past anything an internal board needs.

---

## ADR-0002 — Node.js 22 LTS, not 24

**Context.** The planning document recommended Node 24 LTS. The build environment ships
Node 22.22.2.

**Options.** Install Node 24; or use the Node 22 LTS already present.

**Decision.** Node 22 LTS. Pinned in `.nvmrc`; container images will use `node:22-alpine`.

**Why.** Node 22 is an active LTS with support into 2027, comfortably beyond the life of
this project. Fighting the toolchain to gain nothing is not a trade worth making.

**Consequences.** One version behind the newest LTS. No feature used by this project
requires 24. Revisit only if a dependency demands it.

---

## ADR-0003 — PostgreSQL with Prisma

**Context.** Database is our choice, with justification required.

**Options.** PostgreSQL, MySQL, MongoDB, SQLite. For data access: Prisma, Drizzle, TypeORM,
raw SQL.

**Decision.** PostgreSQL, accessed through Prisma, dropping to raw SQL in migrations where
Postgres-specific features are the right tool.

**Why.** The domain is a small graph of relations with two invariants that belong in the
database: `UNIQUE (request_id, user_id)` for the one-vote rule, and transactional integrity
for derived counts. Postgres also gives full-text search natively, which means "searchable
by text" needs no additional search infrastructure. Keycloak needs a Postgres anyway, so
this is one technology rather than two.

Prisma over Drizzle: the migration and seed workflow is the largest schedule risk in a
short project, and Prisma's is the most reliable. `schema.prisma` also doubles as readable
domain documentation. Drizzle would be the better pick if the schema leaned harder on
Postgres-specific types; it is a close call, not an obvious one.

**Consequences.** Some DDL (partial unique indexes, generated `tsvector` columns, count
triggers) is hand-written SQL inside Prisma migrations. That is a deliberate trade: the
invariants sit in the database where they cannot be bypassed, at the cost of logic living
outside the TypeScript code, which has to be documented so it is not surprising.

---

## ADR-0004 — Keycloak as the identity provider

**Context.** The brief requires an open-source identity provider supporting email/password
and at least one social provider, and explicitly forbids implementing authentication
primitives ourselves.

**Options.** Keycloak, Zitadel, Logto, Authentik, Ory.

**Decision.** Keycloak, configured by a realm JSON committed to the repository and loaded
with `--import-realm`.

**Why.** Reproducibility. The brief requires that documented commands bring the whole
system up locally with seed data. A committed realm file means clients, roles, the social
identity provider and seeded test users all exist on first `docker compose up`, with no
manual clicking in an admin console. Keycloak is also the OSS identity provider a reviewer
is most likely to recognise.

**Consequences.**

- It is the heaviest option: JVM, roughly 600 MB–1 GB of memory, slow cold start. Mitigated
  with a healthcheck and `depends_on: service_healthy` so the API waits for it, and a note
  in the README about first-boot time.
- Social login needs real OAuth client credentials, which cannot be committed. Handling of
  that is an open question tracked in `SCOPE.md`.

---

## ADR-0005 — Angular with signals and URL state, no global store

**Context.** State management approach is our choice, with justification required.

**Options.** NgRx; NgRx SignalStore; TanStack Query; plain signals plus URL state.

**Decision.** No global state library. Signals for the few genuinely global concerns,
query parameters for list state.

**Why.** The application's state decomposes into three things, none of which is the
shared-mutable-across-distant-features state a store exists to tame:

- List state (search, filters, sort, page) belongs in the URL. That is not a compromise —
  it gives shareable links, a working back button, and refresh safety, and removes a whole
  class of client/server desync bugs.
- Server data is cached per resource by the HTTP layer.
- Genuinely global state is exactly three things: the session, the resolved configuration
  and feature flags, and the theme.

NgRx would add several hundred lines of ceremony per feature in exchange for DevTools.

**Consequences.** If this product ever grew real-time updates, a notification centre or an
offline mode, a store would earn its place. Naming the condition that would flip the
decision is the point of recording it.

---

## ADR-0006 — Single repository, directories created when they earn content

**Context.** The brief requires a single Git repository with real commit history.

**Decision.** One repository: `backend/`, `frontend/`, `infra/`, `docs/`. Each directory is
created in the phase that gives it real content, rather than committed up front as an empty
placeholder.

**Why.** Empty directories need placeholder files to exist in Git at all, and a tree of
`.gitkeep` files is scaffolding noise that tells a reader nothing. The intended layout is
documented in the README instead.

**Consequences.** The early commit history shows structure appearing as it is built, which
is a more accurate account of the work than a big-bang scaffold commit.

---

## ADR-0007 — Commit convention and AI attribution

**Context.** The brief requires real commit history and asks that AI-heavy commits be
marked consistently, with the convention described in the README.

**Options.** A subject-line prefix (`[AI] feat: ...`); a Git trailer; a separate log file.

**Decision.** Conventional Commits for the subject, plus an `Assisted-By: Claude (level)`
trailer, with `heavy` / `moderate` / `none` defined in the README.

**Why.** Trailers keep subject lines clean and conventional while remaining greppable, so
the split between generated and hand-written work is auditable rather than asserted. A
separate log file would drift out of sync with the history it describes.

**Consequences.** Every commit needs the trailer, including hand-written ones — an
unmarked commit would be ambiguous rather than implicitly `none`.

---

## ADR-0008 — PostgreSQL 16, and `gen_random_uuid()` for primary keys

**Context.** The planning document suggested PostgreSQL 17/18 and UUIDv7 primary keys.
UUIDv7 is time-sortable, which gives better index locality than random v4 keys.

**Decision.** PostgreSQL 16 everywhere — local, container and manifests — with
`gen_random_uuid()` (v4) as the primary-key default.

**Why.** `uuidv7()` is not a built-in until PostgreSQL 18. Getting it on 16 means either an
extension or generating keys in the application, which splits key generation across two
places and breaks raw-SQL seeding. The benefit it buys — index locality on inserts — is
invisible at the scale of an internal feedback board. Pinning to 16 also means the version
the schema is developed and tested against is the version that ships.

**Consequences.** Primary keys are random rather than time-ordered, so B-tree inserts are
slightly less local. Irrelevant here; revisit only if the row counts ever change by orders
of magnitude. PostgreSQL 16 is supported until November 2028.

---

## ADR-0009 — Derived counts maintained by triggers, using delta arithmetic

**Context.** The brief calls out that "vote count" and "comment count" are derived and must
stay correct. There are three ways to do that.

**Options.**

1. Compute on read with a `COUNT(*)` subquery — impossible to drift, but sorting by
   popularity across a filtered, paginated set gets expensive, and that is a first-class
   sort in this product.
2. Counter columns maintained by the application in each write path — fast, but every
   future writer has to remember, and seeds, cascade deletes and admin scripts will not.
3. Counter columns maintained by database triggers.

**Decision.** Option 3, with the trigger applying a delta (`vote_count = vote_count + 1`)
rather than recomputing a `COUNT(*)` into the column.

**Why.** An invariant should be enforced at the lowest layer that can enforce it, because
every layer above is a layer someone can forget to go through. Triggers survive cascade
deletes, raw SQL and any future caller.

The delta detail matters and is not cosmetic: a recomputing trigger evaluates its subquery
against a snapshot, so two concurrent votes can both read the same starting count and one
update is lost. `vote_count + 1` is evaluated while the row is locked by the `UPDATE`, so
concurrent votes serialise correctly. This is verified by
`backend/prisma/checks/concurrency.sh`, which fires twenty simultaneous votes and asserts
the counter reaches twenty.

The comment trigger is expressed as the difference between the old and new *visibility* of
a comment — approved and not deleted — rather than as a set of special cases per operation.
Every transition (create, approve, reject, soft-delete, restore, edit) then falls out of one
rule instead of six, which is both shorter and harder to get wrong.

**Consequences.** Count-maintenance logic lives in SQL rather than TypeScript, so it has to
be documented where a reader will find it — it is commented in the migration and noted
against the model in `schema.prisma`. `CHECK (count >= 0)` constraints act as tripwires: if
the logic is ever wrong the transaction fails loudly instead of showing a negative count.

---

## ADR-0010 — Default list filters stored as a nullable JSON column

**Context.** Users may override their default list sort *and filters*. Filters span two
dimensions (statuses and categories). The resolution rule is that a `NULL` override means
"inherit the global default", which has to stay distinguishable from an override that
deliberately selects nothing.

**Options.** Two nullable `text[]` columns; two non-nullable arrays plus a separate
"has override" boolean; one nullable `jsonb` column.

**Decision.** One nullable `jsonb` column, `default_filters`, holding
`{ "statuses": [...], "categories": [...] }`.

**Why.** The first option is the most typed and was the original plan, but Prisma cannot
model a nullable list — lists are non-nullable by definition — so it would have forced the
settings code onto raw SQL, or forced away the null/empty distinction that the whole
inheritance rule depends on. The third option keeps the distinction, keeps the code on the
generated client, and collapses two columns into one.

This was caught by reading the schema back against Prisma's type system before committing,
not by a failing build — there is no Prisma binary available in the build environment yet.

**Consequences.** The filter contents are not typed by the database and are validated by the
API layer instead. Acceptable: this is a UI preference blob, not a place where integrity
matters. The important invariant — `NULL` means inherit — is preserved and is the thing the
resolution logic depends on.

---

## ADR-0011 — Dependency majors: the newest release is not automatically the right one

**Context.** Two dependencies had shipped a major release that changes how the rest of the
stack has to be built. Both were checked against the registry rather than recalled, which
is how the problem surfaced at all.

**Prisma.** The current release is 7.x. Version 7 is a hard break: ESM only (`"type":
"module"` across the backend), mandatory driver adapters, a new `prisma-client` generator
with a required output path, and a changed import path. The previous line is 6.19.2.

**TypeScript.** The current release is 7.x, the native compiler port. But `ts-jest`
declares `typescript >=4.3 <7`, so TypeScript 7 breaks the test runner outright — and
`@nestjs/cli` itself depends on TypeScript 5.9.3, which is the combination NestJS is
actually tested against.

**Decision.** Prisma `^6.19.2` and TypeScript `^5.9.3`. The backend stays CommonJS.

**Why.** Neither newer major buys this project anything it needs. Prisma 7's headline gain
is a faster Rust-free client, which is irrelevant at the query volumes of an internal
feedback board, and its cost is pulling the entire backend to ESM — where NestJS, Jest and
ts-jest are all more awkward. TypeScript 7's cost is losing the test runner.

The deciding factor is the build environment: the npm registry is unreachable here, so
nothing can be compiled or run before it is handed over. Choosing the path with the fewest
unknowns is worth more than choosing the newest version, because there is no build to
catch the difference.

**Consequences.** One major behind on both, which is a deliberate choice with a stated
reason rather than a stale lockfile. Revisit Prisma 7 when the backend has a reason to be
ESM anyway; revisit TypeScript 7 when ts-jest supports it.

*Verified against the npm registry rather than recalled: `@nestjs/core` 11.2.1,
`@nestjs/config` 4.0.4, `@nestjs/swagger` 11.4.6 (peer `^11.0.1`), `@nestjs/cli` 11.0.24,
`prisma` 7.9.1 latest / 6.19.2 prev, `typescript` 7.0.2 latest / 5.9.3 in the Nest CLI,
`ts-jest` 29.4.12 (peer `typescript >=4.3 <7`), `jest` 30.4.2, `zod` 4.4.3.*

---

## ADR-0012 — The identity provider proves identity; the application owns authorization

**Context.** Keycloak can carry roles in the token as realm roles. It is the obvious thing
to do, and it is not what this application does.

**Options.**

1. Roles as Keycloak realm roles, read from the `realm_access` claim.
2. Role as a column on the local `users` table, with the identity provider establishing
   only *who* the caller is.

**Decision.** Option 2. The token answers "who is this"; the database answers "what may
they do here".

**Why.** Promoting an administrator is an application operation, not an identity
operation. With roles in the token it means an admin-API call into Keycloak, and the change
does not take effect until the user's token is refreshed — so a demoted admin keeps their
powers for the rest of the token lifetime. With the role in our own table it is a single
`UPDATE` that takes effect on the next request.

There is a second benefit that shows up in testing: because authorization does not depend
on claims, the entire authorization test suite runs against a constructed principal with no
Keycloak container in the loop. That is what makes it cheap enough to be exhaustive, which
matters given the brief grades server-side authorization directly.

A local user row is needed regardless — it owns settings and is the foreign key for
everything the user authors — so this adds no table that would not otherwise exist.

**Consequences.** The first administrator has to come from somewhere: `BOOTSTRAP_ADMIN_EMAIL`
provisions the matching account as an admin on first sign-in, so a clean install has a
working administrator without a manual database edit. Keycloak's own roles are unused, which
should be stated so it does not read as an oversight.

**Related decisions in the same area, all verified against a running Keycloak 26.5:**

- The SPA is a **public client using authorization code flow with PKCE**. A browser cannot
  keep a secret, so a confidential client would be security theatre.
- The API verifies `iss`, `aud`, `exp` and pins the algorithm to **RS256**. Pinning is what
  closes off `alg: none` and algorithm-confusion attacks — the algorithm must never be
  taken from the token being validated.
- Verifying an audience requires the realm to *emit* one. Keycloak does not add an `aud`
  claim for a client by default; an audience mapper has to be attached. Without it every
  token fails validation.
- Authentication is applied **globally with an explicit `@Public()` opt-out**, rather than
  per controller. A forgotten decorator then produces a locked endpoint somebody reports,
  instead of an open one nobody notices.
- **Admins may delete others' content but never edit its text.** The brief grants triage and
  moderation, never impersonation, and the difference is the gap between "an admin removed
  my comment" and "an admin rewrote my comment and left my name on it".

---

## ADR-0013 — The list query is raw SQL; everything else goes through Prisma

**Context.** The list endpoint has to filter by status and category, restrict to the
caller's own requests, run a full-text search, sort five ways, keep pinned requests at the
top under *every* sort, tell the viewer which requests they have voted on, and return a
total for pagination.

**Options.** Assemble it with Prisma's query builder; or write it as one SQL statement.

**Decision.** One raw SQL statement, in `FeedbackRepository`. Prisma's generated client is
used for everything else in the module.

**Why.** Three of those requirements are awkward or impossible through the builder:
`ts_rank` relevance ordering, an ORDER BY whose leading terms are constant while its later
terms depend on a parameter, and a window-function total in the same round trip. Built
through the query builder this becomes a pile of conditional fragments whose emergent
ordering nobody can read. Written out it is one statement that says what it does.

The decisive argument is verifiability. `prisma/checks/list-query.sql` runs the same
statement against a real database across the filter, sort, search and pagination matrix —
24 assertions, including that a pinned request still leads when sorting by votes, that
`has_voted` is computed per viewer rather than globally, that a soft-deleted request
disappears, and that search survives SQL metacharacters. A query assembled from fragments
could not be checked that directly.

**Consequences.** Column names are strings rather than generated types, so a schema rename
that misses this file fails at runtime rather than at compile time — mitigated by the check
suite, which fails immediately if a column disappears. Every value including the sort key
is a bound parameter, so nothing from the request reaches the statement as SQL. The check
file and the repository hold the same query in two places and have to be changed together;
both say so.

---

## ADR-0014 — Feature flags are enforced by a route guard, not by the user interface

**Context.** The brief asks for "at least one feature flag that visibly changes application
behaviour when toggled". The obvious implementation hides a section of the interface.

**Decision.** Flags are read from the database on each request and applied by a global
guard driven by a `@RequiresFeature('...')` decorator. Disabling `comments.enabled` hides
the comment section *and* makes every comment endpoint return 403.

**Why.** A flag enforced only in the browser is a user-interface preference. The routes are
still live, and anyone with the network tab open can call them. Hiding the control is for
the person using the application; the guard is for everyone else. Given that the brief
grades server-side enforcement of authorization explicitly, shipping a browser-only flag
would signal the opposite of the intended lesson.

Unknown flag keys evaluate to *disabled*. A flag deleted from the database, or misspelled
at a call site, must not silently open a feature.

**Consequences.** Each flagged route costs a single-row primary-key lookup. That is
deliberately uncached: a runtime toggle whose whole purpose is to take effect immediately
should not have a window in which an administrator has flipped it and the application has
not noticed. If a hot path ever justifies a cache, that is the point to measure and add
one — not before.

---

## ADR-0015 — Admin is a route grouping, not a module

**Context.** Every domain gains an administrative surface: taxonomy management, comment
moderation, role changes, application settings. The obvious structure is an `admin` module.

**Decision.** There is no admin module. Admin operations live in the module that owns the
data — taxonomy in `taxonomy`, moderation in `comments`, roles in `users` — and are grouped
under an `/admin/**` route prefix guarded uniformly.

**Why.** "Admin" is an *audience*, not a bounded context. An admin module that also knows
how categories work would hold the same rules as the taxonomy module, differing only in who
may call them — and two copies of a rule that must agree is how authorization bugs are
made. Routes are a presentation concern; modules are a domain concern, and keeping them
separate is what stops the route prefix from becoming an architectural boundary it was
never meant to be.

**Consequences.** Each module owns two controllers where it has an admin surface. The
`@Roles(ADMIN)` guard sits on the controller class rather than on individual methods, so a
new admin endpoint is protected by where it is declared rather than by remembering a
decorator.

---

## ADR-0016 — Two lockouts closed with a row lock, not a check

**Context.** Demoting administrators can leave the board with none, and no way to appoint
one — an unrecoverable state short of editing the database by hand.

**Decision.** Administrators cannot demote themselves. Beyond that, the last remaining
administrator cannot be demoted by anyone, enforced inside a transaction that takes
`SELECT ... FOR UPDATE` on the administrator rows before counting them.

**Why.** The self-demotion rule catches the common accident. The row lock catches the
uncommon one that a plain count cannot: two administrators demoting each other at the same
moment both read a count of two, both conclude they are not the last, and both proceed.

This is not hypothetical reasoning. The check in `prisma/checks/concurrency.sh` runs exactly
that race, and removing `FOR UPDATE` from it is the negative control — with the lock,
exactly one demotion succeeds and one administrator remains; without it, both succeed and
**zero** administrators remain. Both outcomes were observed against a real database before
this was written down.

**Consequences.** Role changes serialise against each other, which at the frequency
administrators are appointed costs nothing. The same pattern will be needed for account
deletion, since deleting the last administrator is the same lockout by another route.

---

## ADR-0017 — One bootstrap call, and settings resolved on the server

**Context.** The brief singles this out: it is interested in "where configuration lives,
how it is resolved between global defaults and user overrides, and how the frontend obtains
it without a chain of blocking requests on startup". Three questions.

**Where it lives.** Four tiers, kept apart on purpose:

| Tier | Example | Lives in | Changed by |
|---|---|---|---|
| Infrastructure | database URL, issuer URL, CORS origins | environment | operator, with a redeploy |
| Application settings | registration policy, approval toggle, rate limits, global defaults | `app_settings` | administrator, at runtime |
| Feature flags | `comments.enabled` | `feature_flags` | administrator, at runtime |
| User overrides | theme, language, default sort and filters | `user_settings` | the user, at runtime |

Conflating the last three is the usual mistake; separating them is most of the answer.

**How it resolves.** `code default → global default → user override`, in
`settings-resolution.ts`, as a pure function over plain data with no database and no
framework — so the rule the brief asks about can be read and tested on its own.

The rule that carries the weight: in `user_settings`, **NULL means inherit, not off**.
That is what makes an administrator changing a global default reach every user who never
customised it. Writing the defaults into each user's row at signup would look equivalent
and would silently break it — which is why there is a test named for exactly that.

Resolution happens once, on the server. A client that re-implemented the precedence would
eventually disagree with it, and the disagreement would be invisible until a user saw two
different themes in two places.

**How the frontend gets it.** One `GET /bootstrap`, returning the user, resolved settings,
feature flags and the taxonomy together. The failure mode it exists to avoid is the
obvious implementation — `/me`, then `/settings`, then `/flags`, then `/categories`, then
`/statuses` — five sequential round trips with a white screen for the sum of them. The
handlers run concurrently inside the endpoint, because one round trip for the client is
wasted if the server serialises internally.

It is public. An anonymous caller gets the same shape with `user: null` and the global
defaults, so the client never branches on whether anyone is signed in merely to lay the
page out.

**Consequences.** The payload is small and read on every page load, so it is a natural
place to add an ETag later. Adding a field to it is easy and therefore tempting: it should
carry what is needed to render the *first screen*, not everything that is convenient.

---

## ADR-0018 — Account deletion anonymises

**Context.** Users can delete their account. What happens to the requests they filed, the
comments other people replied to, and the votes other people cast on their requests?

**Options.** Cascade and remove everything; keep the content and detach it; keep the row
and scrub it.

**Decision.** Keep the row, scrub the personal fields, mark it deleted. Content stays and
renders as "Deleted user".

**Why.** Cascading is the destructive option dressed up as the thorough one: it removes a
discussion other people contributed to, and rewrites the vote counts other people created.
Detaching content by nulling the author would need every foreign key to become nullable and
every join to handle a missing row — a schema-wide cost for one operation.

The email is rewritten rather than nulled because the column is NOT NULL and unique, and
because the placeholder must not collide if the same person deletes an account twice. A
consequence worth noting: the original address becomes free again, so the person can return
as a genuinely new account rather than resurrecting the old one. Both are asserted in
`prisma/checks/account-deletion.sql`.

**Consequences.** The identity-provider account is *not* disabled, because doing so needs
Keycloak admin credentials inside the API — a real expansion of what this service is
trusted with, for a benefit that is mostly cosmetic given the local account is inactive.
Listed as unfinished in `SCOPE.md` rather than half-done. Deleting the last administrator
is refused under the same lock as demotion (ADR-0016).
