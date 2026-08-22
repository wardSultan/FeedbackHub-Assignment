# Scope

What was built, what was deliberately left out, what another week would buy, and how every
ambiguity in the brief was interpreted.

> **Current status: all phases complete.** The settings and administration screens remain
> unbuilt, and nothing in this repository has been compiled or containerised — see the
> known gaps below.

---

## Built

- **Database schema** — nine tables with the vote-uniqueness and derived-count invariants
  enforced by the database rather than by application code, verified by 32 invariant
  checks and a concurrency check that run against a real PostgreSQL instance.
- **Identity** — a Keycloak realm committed as configuration: the SPA as a public client
  with PKCE, an audience mapper so tokens carry a verifiable `aud`, brute-force protection,
  and three seeded demo accounts. Verified by importing it into a real Keycloak 26.5 and
  decoding an issued token.
- **Social login** — a Google identity provider in the same realm file, configured from the
  environment at import so no credential is committed, and disabled unless a client id and
  secret are supplied. The application offers a direct "Continue with Google" button that
  skips the realm's form via `kc_idp_hint`. Verified against Keycloak 26.5 in both states:
  with credentials the provider imports enabled and the login page renders the button; with
  none the realm imports clean and the login page carries no social markup at all.
- **Authentication and authorization** — token verification against the realm's JWKS with a
  pinned algorithm, just-in-time user provisioning, globally applied guards with an explicit
  public opt-out, and ownership rules as pure functions with unit tests.
- **Local stack** — Docker Compose for PostgreSQL and Keycloak, with a healthcheck verified
  against a running instance rather than assumed.
- **Feedback requests** — create, read, edit and soft-delete, with the list supporting
  status and category filters, five sorts, full-text search with relevance ranking, "my
  requests", pagination, and pinned-first ordering under every sort. Content editing,
  status changes and pinning are three endpoints with three different authorization rules
  rather than one endpoint with a permission matrix inside.
- **Voting** — cast and withdraw, both idempotent, with the count read back from the
  trigger-maintained column so an optimistic client can reconcile. Neither endpoint takes
  a user identifier: the voter comes from the token and the composite primary key is the
  "at most once" rule.
- **Comments** — create, edit own, delete own or moderate as an administrator, with the
  approval workflow and a visibility rule verified against the database: a pending comment
  is visible to its author and to administrators and to nobody else.
- **Deployment artefacts** — multi-stage Dockerfiles for both applications, a Compose
  stack that brings up the whole system with migrations gated as a one-shot job, and
  Kustomize manifests with a base and a local overlay. Validated structurally by a
  dependency-free checker verified against seven deliberate breakages.
- **Authorization coverage** — all 39 endpoints in one table, with a dependency-free audit
  that fails if a route has no rule, a rule has no route, or the decorators disagree with
  the rule. Verified by breaking it three ways.
- **Settings and administration screens** — the preferences screen shows both layers of
  the settings model, with "Use the default" as a real option on every control so an
  override can be cleared and the global default becomes reachable again. The
  administration screen covers taxonomy (retire versus delete), application settings and
  feature-flag toggles that take effect without a reload.
- **Frontend** — Angular 22 with signals and no global store: the application shell,
  runtime configuration, OIDC sign-in, light/dark/system theming without a flash on load,
  and the board itself — search, status and category filters, five sorts, pagination with a
  selectable page size and optimistic voting, all driven from the URL. Loading, empty and
  error states are shared components, and the three empty states are distinguished: an
  empty board, a filter that matches nothing, and a page number past the end. Request
  detail carries an administrator triage panel — status, pin and delete — shown on the
  request itself rather than in a separate console, because triage is a judgement about
  one request made while reading it. Request detail with the
  discussion, and the submission form with server errors mapped onto the fields that caused
  them.
- **Registration policy and submission limits** — both enforced, not merely stored. Domain
  restriction uses exact matching, so `evil-acme.com` and `acme.com.attacker.net` are
  refused where an `endsWith` check would admit them; existing users are never evicted by a
  policy change; and deleted requests still count against the submission limit, so deleting
  does not reset the budget.
- **Configuration** — three-layer resolution (code default, global default, user override)
  as a pure function, exposed through one `GET /bootstrap` that also carries the user,
  feature flags and taxonomy, so the client makes a single call before first render.
  Administrators edit global settings and toggle flags; users set and clear their own
  overrides, where clearing returns the setting to the current global.
- **Account deletion** — anonymises the row rather than cascading, so other people's
  threads and vote counts survive. Refused for the last administrator.
- **Comment moderation** — a queue of everything awaiting approval, oldest first, with
  approve and reject in place.
- **Administration** — taxonomy management with retire-versus-delete and an atomic default
  status swap, a comment moderation queue, and user role changes with both lockout routes
  closed. Grouped under `/admin` as routes rather than as a module.
- **Feature flags** — read from the database and enforced by a route guard, so disabling a
  feature refuses the request rather than only hiding the control.
- **Demo data** — an idempotent seed attributing content to the same accounts the Keycloak
  realm creates, so signing in lands on an account that already owns requests.
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

In the order the time would be spent:

1. **Compile and run everything.** The single largest gap. Everything else on this list is
   speculative until the TypeScript has been built once.
2. **Dockerfiles and Kubernetes manifests**, applied on kind and confirmed reaching Ready —
   untested manifests are transparently untested to anyone who reads them carefully.
3. **The settings and administration screens.** The endpoints are complete, so this is
   user interface work against a finished API.
4. **Enforce what is currently only stored**: the registration policy at provisioning time
   and the submission rate limit on request creation.
5. **Duplicate-request detection on the create form** — search-as-you-type against existing
   titles. Not requested, but it addresses the product's stated purpose more directly than
   anything else that could be built: the brief says the point is "to stop the same
   suggestion arriving five times".
6. **An end-to-end test** of the golden journey, and email delivery for the notification
   preference that is currently honoured only as far as an outbox.

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

### A-22 — Does "comments require approval" apply to administrators?

The setting says comments require approval; it does not say whose.

**Interpretation.** Administrators' own comments are approved on creation. They are the
moderators, so queueing their comments for their own approval would be theatre, and it
would make an admin's reply to a moderation question invisible until they approved it
themselves.

### A-23 — Does editing an approved comment send it back for approval?

Not addressed by the brief, and the answer matters more than it first appears.

**Interpretation.** Yes, when approval is required. Otherwise moderation is trivially
bypassed: post something innocuous, wait for it to be approved, then edit it into whatever
you actually wanted to say. The cost is that a typo fix re-enters the queue, which is the
right trade for a setting whose entire purpose is that nothing appears unreviewed.

---

## Known gaps

- **Nothing has been built or deployed.** No image was built, no cluster was applied: the
  environment could not reach any container registry. The Compose file validates and the
  manifests pass a structural check, which is not the same as running. This and the point
  below are the two things to verify first.
- **The frontend has never been compiled.** The build environment cannot reach the npm
  registry, so no Angular dependency can be installed. Pure logic was executed directly
  under `node`; everything else is type-checked only. This is the largest unverified
  surface in the project and the first thing a reviewer should run.
- Deleting an account does not disable the corresponding Keycloak account. Doing so
  requires identity-provider admin credentials inside the API, which is a real expansion of
  what the service is trusted with; the local account is inactive and cannot authenticate,
  so the practical effect is limited. See ADR-0018.

## Environment assumptions

- The build environment for this repository has no access to the npm registry or to
  container registries. Where that affected a decision it is recorded in `DECISIONS.md`
  and in `docs/ai-log.md`.
