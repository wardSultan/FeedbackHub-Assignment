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
