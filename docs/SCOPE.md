# Scope

What was built, what was deliberately left out, what another week would buy, and how every
ambiguity in the brief was interpreted.

> **Current status: Phase 2 — authentication and authorization.** The domain modules and
> the frontend are still to come.

---

## Built

- **Database schema** — nine tables with the vote-uniqueness and derived-count invariants
  enforced by the database rather than by application code, verified by 32 invariant
  checks and a concurrency check that run against a real PostgreSQL instance.
- **Identity** — a Keycloak realm committed as configuration: the SPA as a public client
  with PKCE, an audience mapper so tokens carry a verifiable `aud`, brute-force protection,
  and three seeded demo accounts. Verified by importing it into a real Keycloak 26.5 and
  decoding an issued token.
- **Authentication and authorization** — token verification against the realm's JWKS with a
  pinned algorithm, just-in-time user provisioning, globally applied guards with an explicit
  public opt-out, and ownership rules as pure functions with unit tests.
- **Local stack** — Docker Compose for PostgreSQL and Keycloak, with a healthcheck verified
  against a running instance rather than assumed.
- **API foundation** — NestJS application skeleton: environment validation that refuses to
  start on bad configuration, a Prisma module, RFC 9457 problem-details error handling,
  field-level validation errors, mass-assignment protection, security headers, an explicit
  CORS allowlist, and versioned routing with unversioned health probes.

> The API foundation has not been compiled: the build environment cannot reach the npm
> registry, so no dependency can be installed. It is syntax-checked only. This is stated
> here rather than discovered by the next person to run `npm install`.

## Deliberately not built

Recorded now so the omissions read as decisions rather than gaps. Each is revisited if a
requirement turns out to need it.

| Not building | Reason |
|---|---|
| Microservice split | See ADR-0001. The invariants are co-located; splitting them buys weaker guarantees. |
| Event bus, message broker, CQRS, event sourcing | Nothing in this domain needs asynchronous fan-out or a separate read model. |
| Redis or any caching layer | No measured performance problem. Postgres handles this workload with orders of magnitude of headroom. |
| Elasticsearch / external search | Postgres full-text search covers "searchable by text" for a board of this size. |
| GraphQL or tRPC | No shape-variability problem, and the brief names OpenAPI as the API-spec deliverable. |
| WebSockets / real-time updates | Not requested. |
| NgRx or another global store | See ADR-0005. |
| Comment threading | Not requested; roughly doubles the comment UI. |
| Rich text / markdown / attachments | Not requested, and adds XSS surface for no stated benefit. |
| Avatar file upload and object storage | The brief says "avatar **or** initials". Initials, with an optional URL. |
| Multi-tenancy, teams, billing | The product is explicitly a single-tenant internal board. |
| Audit-log platform, observability stack, service mesh | Operational concerns, not deliverables of this assignment. |
| Helm charts | Kustomize is the right level of abstraction for one application with two environments. |
| Duplicate detection and merging | Genuinely tempting given the product's stated purpose, but not requested. Top of the "next week" list. |

## What another week would buy

To be written as the picture becomes concrete. Current candidates: duplicate-request
detection on the create form, real email delivery for notification preferences, an
invitation flow for invite-only registration, and an admin audit log.

---

## Ambiguities and how they were interpreted

The brief invites questions ("If anything in this brief is unclear, ask us"). These are the
interpretations this implementation runs on. Items marked **ASK** are worth raising with
the reviewer directly.

### A-1 — The brief has structural gaps **ASK**

Sections run 1 → 3 → 4 with no §2; §6 runs 6.1–6.5 then 6.7 with no 6.6; and §7 ends with
the sentence "Two things worth stating plainly:" followed by nothing before §8. Content
appears to be missing, possibly including two constraints that are being graded.

**Interpretation.** Treated as omissions from the document rather than hidden requirements.
Worth confirming with the reviewer.

### A-2 — "an open-source identity"

The sentence is incomplete. Read as *open-source identity provider*, self-hosted as part of
the stack — the only reading consistent with the containerized, one-command-up requirement.

### A-3 — "Do not implement authentication primitives yourself"

**Interpretation.** No password hashing, credential storage, token minting, session issuing
or reset flows written by us. Validating a token the identity provider issued, against its
published JWKS, is integration rather than a primitive — the alternative is trusting
unverified tokens, which is the vulnerability the instruction exists to prevent. Verification
uses a maintained library, not hand-rolled crypto.

### A-4 — Registration policy versus identity-provider ownership

Registration policy (open / invite-only / domain-restricted) is defined as an *application*
setting, but Keycloak owns registration.

**Interpretation.** Enforced in the API at first-login provisioning, because that is the
boundary the application controls and the policy is an application setting. A user may hold
a Keycloak account and still be refused provisioning, with a clear message rather than a
broken half-logged-in state.

### A-5 — What "invite-only" means

No invitation entity, expiry or delivery mechanism is specified.

**Interpretation.** Implemented as an admin-managed allowlist of permitted email addresses,
which satisfies the stated requirement at a fraction of the cost of tokens and emails.
A full invitation flow is listed under "next week".

### A-6 — "Retires an unused" category

**Interpretation.** Retirement is deactivation, not deletion: a retired category disappears
from the create form but still renders and filters on existing requests. Hard delete is
available and returns `409 Conflict` when the category is in use. Same rule for statuses.

### A-7 — Are statuses a workflow?

The example list (New → Under Review → Planned → In Progress → Done / Declined) looks like a
lifecycle.

**Interpretation.** Free-form. An admin may set any status at any time. A transition graph
over an admin-editable taxonomy is a substantial feature invented from nothing.

### A-8 — Delete semantics

**Interpretation.** Soft delete for requests and comments. Moderation should be reversible,
hard-deleting a request destroys a discussion many people contributed to, and soft delete
keeps referential integrity intact for counts.

### A-9 — Email notification preferences versus actual email

Listed under *settings*, so the preference is certainly required; delivery is not clearly
required.

**Interpretation.** The preference is stored and genuinely honoured — notifications are
written to an outbox that respects it, so the setting is not a dead control. Real SMTP
delivery (to a local mail catcher) only if time allows, and the README will say plainly
which of the two shipped.

### A-10 — Account deletion scope

**Interpretation.** Anonymise rather than cascade: the user row is retained and scrubbed,
their content stays attributed to "Deleted user", and the Keycloak account is disabled.
Cascading would destroy other people's discussion context. Blocked if it would remove the
last admin.

### A-11 — Can anonymous visitors read the board?

"Everyone can browse" versus a journey that starts with signing in.

**Interpretation.** Authentication required. It is an explicitly *internal* tool, and the
user journey lists sign-in as step 1 and the list as step 2. Read endpoints are written to
take an *optional* principal, so opening them later is a configuration change rather than a
rewrite.

### A-12 — "Rate limits on submissions per user"

**Interpretation.** "Submissions" means feedback requests. That is the admin-configurable
product setting (count and window). Comments and votes get a separate, non-configurable
technical throttle — infrastructure protection, not a product rule.

### A-13 — Which fields may an author edit?

The journey says "edits its description".

**Interpretation.** Title, description and category — the journey gives an example, not a
restriction, and forbidding a typo fix in a title would be strange. Status and pinning stay
admin-only. An "edited" indicator addresses the legitimate concern that people may have
voted on the original text.

### A-14 — The language setting

**Interpretation.** Runtime i18n wired up with English complete and a second locale
partially translated. A setting that changes nothing is a dead control; a fully translated
second locale is a day of translation work that demonstrates nothing further. Coverage will
be stated honestly.

### A-15 — What counts as "at least one feature flag"?

**Interpretation.** A flag enforced on *both* sides: the UI hides the feature and the API
refuses the request. A flag that only hides a button is a UI preference, and the brief
grades server-side enforcement explicitly.

### A-16 — Can users vote on their own requests?

**Interpretation.** Yes, with an automatic self-vote on submission. Submitting a request is
itself an expression of support, and a request showing zero votes from its own author looks
broken.

### A-17 — What does the comment count count?

**Interpretation.** Approved, non-deleted comments only. A count of 5 leading to 3 visible
comments reads as a bug.

### A-18 — Sort options and pinning

**Interpretation.** Newest, oldest, most voted, most commented, recently updated; default
newest. Pinned requests sort first under *every* sort, otherwise "pins an important one to
the top of the list" only holds under the default.

### A-19 — Search scope

**Interpretation.** Full-text over title (higher weight) and description, relevance-ranked.
Comments are not searched — the de-duplication use case is finding an existing *request*.

### A-20 — Pinning limits

**Interpretation.** No limit; pinned items ordered most-recently-pinned first. The admin UI
shows how many are currently pinned so admins can self-regulate.

---

## Environment assumptions

- The build environment for this repository has no access to the npm registry or to
  container registries. Where that affected a decision it is recorded in `DECISIONS.md`
  and in `docs/ai-log.md`.
