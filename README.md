# FeedbackHub

An internal product feedback board. Employees submit feature requests and product
feedback, browse what already exists, upvote the requests they care about, and discuss
them in comments. A product-team member (admin) triages incoming requests: setting
status, curating categories, and moderating content.

The point is to stop the same suggestion arriving five times by email, and to make it
visible what is actually being worked on.

> **Status: Phase 0 — project foundation.** No application code yet.
> See [`docs/SCOPE.md`](docs/SCOPE.md) for what is built, what is not, and why.

---

## Planned stack

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
backend/    NestJS API (added in Phase 1)
frontend/   Angular application (added in Phase 8)
infra/      Dockerfiles, compose, Kubernetes manifests (added in Phase 10)
docs/       Decisions, scope, AI collaboration write-up
```

Directories are created when they receive real content rather than up front as empty
placeholders.

## Requirements

- Node.js 22 LTS (see [`.nvmrc`](.nvmrc))
- Docker + Docker Compose

## Running it

Not yet runnable — the backend lands in Phase 1. This section will carry the verified
one-command quick start, and will be checked from a clean clone before it is written.

## Running the tests

Not yet applicable.

## What works / what doesn't

Tracked honestly in [`docs/SCOPE.md`](docs/SCOPE.md) as the project progresses.

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
