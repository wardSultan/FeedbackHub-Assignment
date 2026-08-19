# AI working log

Raw notes taken while working, kept so that `AI_COLLABORATION.md` can be written from
evidence rather than memory. Chronological, unpolished, and not a deliverable in itself.

---

## 2026-08-19

### #1 — Planning phase, before any code

Asked the model to analyse the assignment PDF and produce an engineering analysis covering
product understanding, requirements, domain model, architecture options, stack, module
boundaries, database design, API surface, auth, configuration, security, frontend, deployment,
testing, documentation, scope and ambiguities — explicitly *without* writing code.

**Accepted:** the modular-monolith argument, the domain model, the ambiguity list (21 items,
now carried into `SCOPE.md`), and the phase ordering.

**Modified:** the model recommended Node 24 LTS; the environment ships Node 22 LTS, which is
supported into 2027. Took the simpler path (ADR-0002).

**Deferred:** the model proposed several additions the brief does not ask for — a mock OIDC
provider container, a duplicate-suggestion hint on the create form, an ESLint module-boundary
rule. All plausible, none required. Parked rather than adopted, to be revisited only if the
core is complete.

### #2 — Version facts were verified, not recalled

The model was asked for current framework versions. Rather than trusting recall, the versions
were checked against release data during the analysis: Angular 22 (released June 2026, active
support to June 2027), NestJS 11.2.1 stable with v12 still in alpha, Keycloak 26.x. This
mattered — the model's initial instinct on the Angular release cadence would have put the
current version a release behind, and recommending an alpha NestJS would have been an
unforced error.

**Lesson applied going forward:** any version number that ends up in a `package.json` gets
checked against the registry rather than recalled.

### #3 — Environment blocker found during Phase 0 inspection

Phase 0 began with an inspection of the environment rather than with scaffolding. That
surfaced a blocker that would otherwise have appeared halfway through Phase 1:

- `registry.npmjs.org` returns `403` with `x-deny-reason: host_not_allowed`
- Docker Hub, GHCR, Quay, PyPI and the OS package mirrors are likewise unreachable
- GitHub *is* reachable (verified with a real `git clone`)
- The Docker daemon was not running; it starts fine (`dockerd`), so containers work once
  images can be pulled
- PostgreSQL 16 is installed locally and can run natively as a fallback

So no dependency can be installed and no image can be pulled in this environment. Raised with
the project owner rather than worked around silently, because every plausible workaround
(hand-writing `package.json` with unverified versions, vendoring dependencies from GitHub)
trades away the ability to actually run lint and tests — which the project's definition of
done requires.

**Decision:** proceed with the network-independent part of Phase 0 (repository, conventions,
documentation) and pause before scaffolding the backend.

### #4 — Git identity

The sandbox default git identity was `Claude <noreply@anthropic.com>` with commit signing
enabled. Left unchanged, every commit in an assignment submission would have been authored by
the assistant. Set to the project owner's identity, with AI involvement recorded in the
`Assisted-By` trailer instead — which is the honest arrangement: a human author who is
accountable for the work, and an explicit record of how much of each commit was generated.

### #5 — A blind `sed` broke what it was asked to fix

Markdown lint flagged fenced code blocks with no language. The fix the model reached for was
`sed -i 's/^```$/```text/' README.md` — which matches *every* bare fence, so it rewrote the
closing fences too and turned three code blocks into nested nonsense. Lint went quiet on the
original complaint, so the mistake would have survived a "the linter is green" check.

**How it was noticed:** the lint output afterwards was inspected rather than assumed, and the
remaining errors did not match the expected set. Reading the file confirmed the damage.

**Cost:** a few minutes. **Lesson applied:** for edits of the form "change some occurrences
of X", a global regex is the wrong instrument. Subsequent fixes targeted specific line
numbers and were verified by re-reading the file, not by trusting the tool's exit code.

This is a small instance of a general failure mode worth watching for in the rest of the
project: a change that silences the symptom the tool reported while introducing a different
problem the tool does not check for.
