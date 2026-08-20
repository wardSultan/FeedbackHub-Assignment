# FeedbackHub

An internal product feedback board. Employees submit feature requests and product
feedback, browse what already exists, upvote the requests they care about, and discuss
them in comments. A product-team member (admin) triages incoming requests: setting
status, curating categories, and moderating content.

The point is to stop the same suggestion arriving five times by email, and to make it
visible what is actually being worked on.

> The API is feature-complete and the board is built. Deployment artefacts and the
> settings and administration screens are not. See
> [`docs/SCOPE.md`](docs/SCOPE.md) for the full account, including what has and has not
> been verified.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Angular + Angular Material/CDK, signals, URL-driven list state |
| Backend | NestJS (modular monolith), REST + OpenAPI |
| Database | PostgreSQL + Prisma |
| Identity | Keycloak (OIDC — email/password + one social provider) |
| Local dev | Docker Compose |
| Deployment | Container images + Kubernetes manifests |

Rationale for each choice lives in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Repository layout

```text
backend/            NestJS API
  prisma/           Schema, migrations, seed, and database-level checks
  src/platform/     Configuration, database access, error handling, health probes
  src/modules/      Domain modules — auth, users, taxonomy, feedback, votes,
                    comments, settings
  test/             Authorization matrix and its audit
frontend/           Angular application
  src/app/core/     Runtime config, OIDC auth, theme, API clients
  src/app/features/ Feature areas, lazily loaded
infra/              Keycloak realm, database bootstrap, nginx config
  k8s/base/         Kubernetes manifests
  k8s/overlays/     Per-environment Kustomize overlays
docs/               Decisions, scope, AI collaboration write-up
```

## Requirements

- Node.js 22 LTS (see [`.nvmrc`](.nvmrc))
- Docker + Docker Compose (provides PostgreSQL 16 and Keycloak 26)

## Running it

Three steps: the backing services, the API, then the web application.

> The API and web application have not been compiled in the environment this was built in —
> the npm registry was unreachable. Expect `npm install` to be the first real test of them,
> and see [`docs/SCOPE.md`](docs/SCOPE.md) for the full account.

Start the backing services first — PostgreSQL and Keycloak, with the realm imported:

```bash
cp .env.example .env
docker compose up -d
```

Keycloak takes 30–60 seconds on a cold start; the API waits for its healthcheck. The
realm arrives pre-configured with the SPA client and three demo accounts:

| Account | Password | Notes |
|---|---|---|
| `admin@feedbackhub.local` | `Passw0rd!demo` | Provisioned as an administrator on first sign-in |
| `user@feedbackhub.local` | `Passw0rd!demo` | Ordinary user |
| `second@feedbackhub.local` | `Passw0rd!demo` | A second user, for checking that one user cannot edit another's content |

The migration creates the schema plus the reference data the application cannot start
without — the settings row, the default statuses and categories, and the feature flags.
Demo content is separate, in `prisma/seed.sql`, and is safe to re-run.

```bash
cd backend
cp .env.example .env      # adjust DATABASE_URL if needed
npm install
npm run prisma:generate
npm run prisma:migrate
psql -d feedbackhub -f prisma/seed.sql   # demo content, safe to re-run
npm run start:dev
```

`GET /health/live` and `GET /health/ready` are unversioned; everything else is served
under `/api/v1`. Interactive API documentation is at `/api/docs` outside production.

Then the web application:

```bash
cd frontend
npm install
npm start
```

It reads `public/config.json` at start-up rather than baking the API and Keycloak URLs into
the bundle, so the same build runs against any environment — see
[`docs/DECISIONS.md`](docs/DECISIONS.md), ADR-0020.

## Running the tests

The schema's guarantees are verified directly against PostgreSQL, below the application
layer where no application bug can reach:

```bash
# 32 invariant checks — constraints, triggers, cascades, search. Rolls back cleanly.
psql -d feedbackhub -qtA -v ON_ERROR_STOP=1 -f backend/prisma/checks/schema-invariants.sql

# 24 checks over the list query: filters, sorts, search, pagination, per-viewer state.
psql -d feedbackhub -qtA -v ON_ERROR_STOP=1 -f backend/prisma/checks/list-query.sql

# Vote uniqueness, counter correctness under genuine concurrency, and idempotency.
./backend/prisma/checks/concurrency.sh
```

The application layer has unit tests for the logic that carries risk rather than for
coverage: environment validation, the ownership rules, slug derivation, settings
resolution, and the URL/filter conversion that the board's state depends on.

```bash
cd backend  && npm test          # unit tests
cd backend  && npm run test:e2e  # authorization matrix against a real database
cd frontend && npm test
```

The authorization rules for all 39 endpoints live in one table
(`backend/test/authorization-matrix.ts`). It is audited against the controllers by a check
that needs nothing installed — it reads the source — and fails if any endpoint has no rule:

```bash
cd backend && npx tsx test/route-audit.ts
```

The Kubernetes manifests get the same treatment — a check that needs nothing installed, for
the cross-file mistakes a per-file review misses (a Service selector matching no pod, a
`secretKeyRef` naming a key that does not exist, an Ingress pointing at a port that is not
exposed):

```bash
python3 infra/k8s/validate.py
```

## Where to look first

A reviewer with forty minutes will not find the parts worth seeing by browsing. These are
the five that carry the most thought:

1. **`backend/prisma/migrations/…/migration.sql`** — the two invariants the brief names by
   name are database objects, not application checks. One vote per user is the composite
   primary key on `votes`; the derived counts are maintained by triggers using delta
   arithmetic. `prisma/checks/concurrency.sh` fires twenty simultaneous votes to prove the
   second, and removing the row lock from the last-administrator check in the same file is
   a documented negative control that leaves zero administrators.
2. **`backend/test/authorization-matrix.ts`** — all 39 endpoints with an explicit access
   level, audited against the controllers by `npx tsx test/route-audit.ts`, which needs
   nothing installed. Try deleting a row and running it.
3. **`backend/src/modules/settings/settings-resolution.ts`** — global defaults resolved
   against user overrides, as a pure function. `NULL` means *inherit*, which is what makes
   changing a global default reach everyone who never customised it.
4. **`backend/src/modules/feedback/feedback.repository.ts`** — the list query, with
   `prisma/checks/list-query.sql` verifying it against real data across the filter, sort,
   search and pagination matrix.
5. **`docs/AI_COLLABORATION.md`** — including two bugs caught only by running a real
   Keycloak, and four separate instances of a check that passed for the wrong reason.

### Things to try

- Sign in as `user@feedbackhub.local`, then as `second@feedbackhub.local`, and try to edit
  the other one's request. The button is not there, and the endpoint refuses.
- Sign in as `admin@feedbackhub.local` and try to edit — not delete — someone else's
  comment. Also refused: moderation is not impersonation.
- `PATCH /api/v1/admin/feature-flags/comments.enabled` with `{"enabled": false}`, then
  reload a request. The discussion disappears *and* `POST …/comments` returns 403.
- `PATCH /api/v1/me` with `{"role": "ADMIN"}` returns 400 — the field is rejected, not
  ignored.
- In **Settings**, change the theme, then set it back to "Use the default". The control
  distinguishes choosing a value from inheriting one, which is the whole point of the
  resolution model — and an administrator changing the global default then reaches you.
- In **Administration → Feature flags**, toggle `comments.enabled` and go back to a
  request. The discussion is gone and the endpoint refuses, without a reload.

## What works / what doesn't

**Works, and has been verified against real infrastructure:**

- The complete database schema, its constraints and its triggers — 79 assertions across
  five check files, run against PostgreSQL 16, including concurrency.
- The Keycloak realm: imported into a real Keycloak 26.5, with a token fetched and decoded
  to confirm it carries the audience and identity claims the API verifies.
- The list query, verified across filters, sorts, search, pagination and per-viewer state.
- Settings resolution, slug derivation and the URL/filter conversion — pure functions,
  executed directly.
- The authorization matrix, audited against the controllers.

**Built but not verified:**

- **No TypeScript in this repository has ever been compiled.** The build environment could
  not reach the npm registry, so no dependency could be installed and no test runner could
  run. Sources were type-checked with a standalone `tsc` and every diagnostic traced to a
  missing module. This is the honest state of the project and the first thing to check.

**Built but never executed:**

- Dockerfiles for both applications, a Compose stack covering the whole system, and
  Kustomize manifests with a local overlay. No image was built and no cluster was applied —
  no container registry was reachable. The Compose file validates via
  `docker compose config`, and `python3 infra/k8s/validate.py` checks the manifests
  structurally. Neither is the same as running them.

**Not built:**

- The comment moderation queue exists as an API but has no dedicated screen; comments are
  approved through `PATCH /api/v1/admin/comments/:id/moderation`.

The full list, with reasoning, is in [`docs/SCOPE.md`](docs/SCOPE.md).

---

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat(scope):`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.

### AI attribution

This project was built with AI assistance. Every commit carries a trailer recording how
much of it was AI-generated:

```text
Assisted-By: Claude (heavy)
```

| Level | Meaning |
|---|---|
| `heavy` | Substantially AI-generated, then read and reviewed line by line before committing |
| `moderate` | AI-generated, then materially rewritten or restructured |
| `none` | Written by hand |

The trailer is greppable, so the split is auditable:

```bash
git log --grep='Assisted-By: Claude (heavy)' --oneline | wc -l
```

The full account of how AI was used — division of labour, working method, worked
examples, and where its output was wrong or rejected — is in
[`docs/AI_COLLABORATION.md`](docs/AI_COLLABORATION.md).
