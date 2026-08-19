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

### #6 — Schema built against a real database rather than written blind

npm is still unreachable, but PostgreSQL 16 is installed locally, so the database half of
Phase 1 could be done properly: the migration was applied to a real database and the
schema's guarantees asserted rather than assumed.

Written and run: 32 invariant checks (`backend/prisma/checks/schema-invariants.sql`)
covering vote uniqueness, both count triggers across every visibility transition, the
single-default-status rule, taxonomy retire-versus-delete, field constraints, full-text
search including hostile input, and cascade behaviour. Plus a separate concurrency check
firing twenty simultaneous votes from real parallel connections.

The concurrency check earned its place immediately. The obvious way to write a count
trigger is to recompute `COUNT(*)` into the column, which is simpler to read and *wrong*
under concurrency — the subquery is evaluated against a snapshot, so two simultaneous votes
can both compute the same starting value and one update is lost. Delta arithmetic under the
row lock is correct. A single-session test would have passed either version.

### #7 — A check that failed for the wrong reason

The first full run reported one failure out of 32: "a user who authored content cannot be
hard-deleted" — the delete succeeded when it should have been refused.

The schema was fine. The check was wrong: it ran *after* the cascade checks, which delete
the request and take the author's only content with it. By the time the assertion ran there
was nothing left for the foreign key to protect, so the delete was correctly permitted.

Worth recording because of how it could have gone. The obvious reading of a red test is
that the schema is missing a constraint, and "fixing" it by adding one would have shipped a
constraint the schema did not need, justified by a test that never actually tested it. The
fix was to move the assertion above the cascade block, where the precondition still holds.

### #8 — A Prisma limitation caught by review, not by a compiler

The user settings table originally used two nullable `text[]` columns for the default
status and category filters, with `NULL` meaning "inherit the global default".

Prisma cannot express a nullable list — lists are non-nullable by definition — so
`String[]?` is not valid schema syntax. With no Prisma binary available there was no build
to catch it; it surfaced by reading the schema back against Prisma's type system before
committing. Replaced with a single nullable `jsonb` column, which preserves the null/empty
distinction the inheritance rule depends on (ADR-0010).

This is the failure mode to watch while the toolchain is unavailable: code that is correct
SQL and plausible Prisma, with nothing to disprove it. Everything written in this state is
explicitly marked as unverified until it has actually been built.

### #9 — Network: partially open after all

`registry.npmjs.org` is still unreachable from the shell (`403 host_not_allowed`), so
`npm install`, `nest new` and `ng new` remain impossible, as does pulling any container
image. The web-fetch path *can* reach the registry, which is enough to read package
metadata and pin accurate versions — but not enough to install anything. So dependency
versions can be stated from fact rather than recall; the code that uses them still cannot
be compiled here.

### #10 — Checking versions instead of recalling them changed two decisions

Entry #2 committed to checking any version that ends up in a `package.json` against the
registry rather than trusting recall. That rule earned its keep immediately.

Recall would have produced Prisma 5 or 6 and TypeScript 5.x as unremarkable defaults. The
registry says the current releases are Prisma **7.9.1** and TypeScript **7.0.2** — and both
are breaking. Prisma 7 is ESM-only with mandatory driver adapters. TypeScript 7 is the
native compiler port, and `ts-jest`'s peer range is `>=4.3 <7`, so adopting it silently
breaks the test runner.

Two things worth noting about how this went. First, the model's initial instinct was to
write `"prisma": "^6"` and move on — which would have been *accidentally* right for the
wrong reason, and would have looked like a stale guess rather than a decision. Second, the
strongest signal for the TypeScript choice was not a version number but a dependency graph:
`@nestjs/cli` itself depends on TypeScript 5.9.3, which is the combination NestJS is
actually tested against.

Both decisions are recorded in ADR-0011, with the raw version facts attached so the
reasoning can be re-checked rather than taken on trust.

### #11 — Compiling was impossible, so the next best check was used

No dependency can be installed here, so the API foundation cannot be built. Rather than
hand over code with nothing behind it, the globally available `tsc` was run directly over
the sources with `--skipLibCheck`, and the output triaged by error code: everything
reported was `TS2307` (missing module), `TS7006`/`TS18046`/`TS2339` (types that come from
those missing modules) or `TS2593` (`@types/jest`). No syntax errors and no unexplained
type errors.

That is a real check, and it is worth being precise about what it does *not* prove: it
cannot catch a wrong Nest decorator, a bad DI wiring, a Prisma client method that does not
exist, or anything the type system would have caught with real definitions present. The
foundation is marked in `SCOPE.md` as syntax-checked but not compiled, and that stands
until someone runs `npm install && npm run build`.

Two fixes came out of reading the code back rather than from any tool: the health
controller was version-neutral only by accident of route ordering, so probe URLs would have
moved to `/api/v1/health/*` once versioning was enabled — an infrastructure contract
quietly changing under an application decision. And `bufferLogs: true` was copied in from
the standard Nest bootstrap without the custom logger that makes it useful, where it does
nothing but delay output.

### #12 — A shell slip that reported success

A batch of files was written with a `cd backend && cat > a.ts <<EOF ... cat > b.ts <<EOF`
sequence. The `cd` failed, because the working directory was already `backend`. The `&&`
bound only to the *first* `cat`, so that one file was silently skipped while every
subsequent one wrote correctly — and the script still printed its success message at the
end.

Caught by listing the directory afterwards instead of trusting the echo. The missing file
was an interface the other modules import, so it would have failed at first build with a
confusing error some distance from the cause.

Worth recording as a category rather than an incident: shell scripting that mixes `&&`
with a sequence of independent commands produces exactly this — partial execution
reported as success. Subsequent file batches use absolute paths and are verified by
listing the result.

### #13 — Keycloak was downloadable after all, and it found two real bugs

The container registries are still blocked, but Keycloak publishes its distribution as a
GitHub release, and GitHub is reachable. Java 21 is installed. So Keycloak 26.5.0 was
downloaded and run natively, and the realm configuration was verified against it instead of
being written blind and hoped over.

It found two bugs that would both have shipped, and neither would have been obvious from
reading the file.

**The realm import silently wiped every built-in client scope.** The realm JSON declared a
top-level `clientScopes` array in order to add one custom scope carrying an audience mapper.
That array does not *add* scopes — it *replaces* the realm's entire set, so `profile`,
`email`, `roles`, `web-origins`, `acr` and `basic` ceased to exist. The client's
`defaultClientScopes` then referenced six names that were gone, and Keycloak dropped them
without a warning. The import logged `Realm 'feedbackhub' imported` and looked completely
fine.

The symptom, found by fetching a real token and decoding it: no `aud` claim, no `email`, no
`preferred_username`. The API's audience check would have rejected every token in existence
and the whole application would have been unusable, with the cause several layers away from
the error. Fixed by dropping the custom scope entirely and attaching the audience mapper
directly to the client — fewer moving parts, and no way to clobber the defaults.

**The Keycloak healthcheck used LF where HTTP requires CRLF.** The Keycloak image ships no
curl, so the standard healthcheck talks HTTP over bash's `/dev/tcp`. The widely copied form
of it uses `echo -e "GET ... HTTP/1.1\nHost: ...\n\n"`. Against a real Keycloak that returns
**400 Bad Request**, so the container never becomes healthy and
`depends_on: condition: service_healthy` hangs `docker compose up` forever. `printf` with
`\r\n` returns 200. Verified by extracting the healthcheck exactly as `docker compose config`
resolves it and running that string against the live instance.

Both are the same category, and it is the category worth naming: **configuration that is
syntactically valid, reads correctly, and is wrong at runtime.** Neither a linter, a type
checker nor a review would have caught either. Only running it did.

### #14 — A stale cross-reference caught by grepping rather than by reading

A comment in `principal.ts` cited "ADR-0005" for the decision that the identity provider
proves identity while the application owns authorization. ADR-0005 is the Angular state
management decision; the auth ADR had not been written yet, and the number was invented.

Found by grepping every `ADR-` reference in the source against the headings in
`DECISIONS.md`, which takes one command and is worth repeating before each commit. A
confident, specific, wrong citation is worse than no citation: it sends a reader to the
wrong page and quietly undermines trust in every other reference in the codebase.

### #15 — The list query, developed against real data rather than reasoned about

The list endpoint is the most intricate SQL in the project and the easiest to get subtly
wrong, so it was built the other way round: seed realistic data first, develop the query
interactively against it, then write the TypeScript around a statement already known to
work. `prisma/checks/list-query.sql` keeps that as 24 assertions.

The seed itself is worth a note. Keycloak generates user ids, and the OIDC `sub` claim is
the key the application provisions users by — so demo content authored by invented user
rows would have been orphaned the moment somebody actually signed in, silently creating a
second account for the same person. Fixed by giving the realm's users fixed ids, verified
by signing in as each of the three accounts and decoding the returned token to confirm the
`sub` matches what the seed uses.

### #16 — A check that could never fail

While writing the list query suite, one assertion came out as:

    SELECT pg_temp.assert(
        (SELECT min(created_at) = max(created_at) FROM (SELECT 1 AS created_at) t) IS NOT NULL,
        'oldest and newest disagree about the second row');

It is a tautology. The subquery is a one-row literal, so the comparison is always true and
never NULL; the assertion passes regardless of what the query does. It sat in a green run
of 25 checks looking exactly like the other 24.

Noticed while re-reading the suite rather than from any failure — which is the point.
Deleted rather than repaired, because the assertion immediately after it ("oldest and
newest produce different orderings") is the real test of the same property.

This is the second instance in this project of the same failure mode, after entry #7: a
test that is green for a reason unrelated to the behaviour it names. Green suites earn less
trust than they appear to; the useful question about a new assertion is not "does it pass"
but "what would make it fail".

### #17 — What is verified here, and what is not

Verified against a real PostgreSQL: the schema and its invariants, the seed and its
idempotency, and the list query across the filter/sort/search/pagination matrix. Verified
against a real Keycloak: the realm import, the token claims, and the healthcheck.

Not verified, and worth naming precisely rather than leaving implied: the TypeScript has
still never been compiled, so Prisma's binding of a JavaScript array to a
`text[]` parameter in the raw query is assumed rather than observed. The SQL pattern itself
was tested with real NULL and array binds through psql, so the risk is confined to the
client's parameter handling — but it is the kind of assumption that should be checked by
the first `npm run build`, not discovered later.

### #18 — Voting: the smallest phase, and the one already proved

Voting took less code than any phase so far, because the hard part was done in Phase 1. The
"a user may vote at most once" rule is the composite primary key, and the counter is
maintained by a trigger, so the service does almost nothing: insert ignoring conflicts,
delete without complaint, read the count back.

That is worth noticing rather than glossing over. The endpoints are trivial *because* the
invariants were pushed into the database earlier — had they been left to application code,
this phase would have needed a read-then-write guard, a transaction, a race to reason
about, and tests to prove all three. The work did not disappear; it moved to where it could
be stated once.

Two properties are worth stating about the endpoint design. Neither method accepts a user
id, so there is no ownership check to write and nothing for a caller to tamper with — the
key *is* the authorization. And both are idempotent, which is a decision rather than an
accident: a double-clicked button and a retried mobile request are ordinary events, and the
honest response to both is the same final state and the same status code.

The checks were extended with the exact statements the endpoints emit — `ON CONFLICT DO
NOTHING` for a cast, an unqualified `DELETE` for a withdrawal — repeated three times each,
asserting the count settles at one and then at zero without going negative.

### #19 — Two rules the brief does not state, both of which matter

Comments needed two decisions the brief is silent on, and both are the kind that are easy
to get wrong by not noticing there is a decision to make.

The first: when "comments require approval" is on, does an administrator's own comment go
into the queue? Queueing a moderator's comment for their own approval is theatre, and it
would make an admin's reply to a moderation question invisible until they approved it
themselves. Administrators are approved on creation (SCOPE A-22).

The second is the one worth dwelling on. Does editing an *approved* comment send it back
for approval? The comfortable answer is no — re-queueing a typo fix is annoying. But the
comfortable answer makes moderation ornamental: post something innocuous, wait for
approval, then edit it into whatever you actually wanted to say. The whole feature exists
so that nothing appears unreviewed, and an edit is new text. It re-enters the queue
(SCOPE A-23).

Neither was surfaced by a requirement or a test. Both came from asking what an unfriendly
user would do with the feature as designed, which is a question worth asking of every
moderation control.

### #20 — Checking an authorization rule as data rather than as code

Comment visibility — approved to everyone, pending to its author and to administrators
only — is expressed as a Prisma `where` clause, which reads plausibly and cannot be run
here. So the same predicate was written as SQL and checked against real rows across every
combination of viewer and state: 13 assertions covering author, other user, anonymous and
administrator against pending, approved, rejected and deleted comments.

Two of those assertions are ones a happy-path test would not have contained. A *rejected*
comment stays visible to its author, so the rejection is not silent — a comment that simply
vanishes reads as a bug and gets re-posted. And a *deleted* comment is hidden even from an
administrator, because moderation removing something should remove it, not archive it into
a view only some people have.

### #21 — The third variant of the same bug, and this one was caught by luck

Running the full check suite after the comments phase, `schema-invariants.sql` reported
16 passing checks where it had previously reported 32. It had not been touched. What had
changed was the database: the demo seed now existed in it.

Two assertions counted rows across the whole table rather than scoping to their own
fixture:

    (SELECT count(*) FROM feedback_requests r JOIN categories c ON c.id = r.category_id
      WHERE c.slug = 'feature') = 1        -- retiring a category
    (SELECT count(*) FROM feedback_requests
      WHERE search_vector @@ websearch_to_tsquery('english', 'dark mode')) = 1

Both were correct on an empty database and wrong the moment any other data existed — and
the README tells the reader to seed *before* running the checks, so the documented order of
operations was the one that broke them.

Fixed by scoping the search assertions to the fixture row and by asserting the category
count is *unchanged* rather than equal to one. Then verified properly, which is what should
have happened the first time: on a clean database with only the migration; on the same
database after seeding; and after seeding twice. All four suites pass in all three states.

This is the third instance of the same underlying error in this project — after the
ordering-dependent check in entry #7 and the tautology in #16. The shape is consistent: an
assertion that passes for a reason other than the behaviour it names. Here the reason was
ambient state, and it surfaced only because the count in the output happened to be
memorable. That is not a detection strategy. The durable fix is the one applied above —
every assertion scoped to data it created itself — rather than noticing.

It is also the strongest argument in this project for running the suite in more than one
state. A check suite that has only ever been run against one database is not a suite, it
is a snapshot.

### #22 — A pure function, actually executed, was wrong

Category and status slugs are derived from the display name. The generated implementation
looked unremarkable:

    name.toLowerCase().normalize('NFKD')
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')

`toSlug` is pure and depends on nothing, so unlike the rest of the TypeScript in this
project it could be pasted into `node -e` and run. It fails: NFKD decomposes `Ü` into a
base letter plus a combining diaeresis, and the combining mark is neither a letter nor a
number, so it becomes a separator. `Ünicode Wörter` slugs to `u-nicode-wo-rter`.

The fix is one line — strip `\p{Mark}` after normalising — but the interesting part is that
the bug is invisible on ASCII input. Every obvious test case passes. It would have reached
production and then produced broken filter URLs for the first administrator who named a
category in a language with accents.

Lesson worth generalising while the toolchain is unavailable: extract the logic that *can*
be run without dependencies, and run it. Not everything in this codebase can be, but more
of it can than the "nothing compiles" framing suggests.

### #23 — Proving the lock does the work

The last-administrator rule is the kind of check that looks obviously correct and is
obviously correct only in a single session. Two administrators demoting each other
simultaneously both read a count of two, both conclude they are not the last, and both
proceed.

Rather than assert that `SELECT ... FOR UPDATE` fixes it, both versions were run against a
real database with two genuinely concurrent connections. With the lock: one demotion
succeeds, one is refused, one administrator remains. Without it: both succeed and **zero**
administrators remain — a board that can never appoint another administrator.

The negative control is what makes the check worth having. Two earlier entries in this log
(#7, #16, #21) are all variants of "an assertion that passes for the wrong reason"; running
the failing configuration deliberately is the cheapest defence against writing another one.

### #24 — The check failed for the wrong reason, and that was fine

Folding the last-administrator race into the check suite, the first run reported two
administrators surviving instead of one. Not a locking failure: the shell argument inside
the SQL heredoc had been written `\$1` rather than `$1`, so it never expanded, the UPDATE
matched no rows, and both transactions committed having changed nothing.

Worth recording because of the direction it failed in. The escaping mistake made the check
report a *failure* rather than a false pass — the UPDATE did nothing, so no administrator
was demoted, so the count stayed at two and the assertion tripped. Had the same mistake
been made in the opposite direction it would have sat green and untested indefinitely,
which is precisely what happened in entries #7 and #16.

### #25 — Writing the rule so it could be run, having learned that lesson twice

Entry #22 ended with "extract the logic that can be run without dependencies, and run it".
The settings resolution was the first thing built that way rather than discovered that way:
`settings-resolution.ts` is a pure function over plain data — no Prisma types, no Nest
decorators, no database — precisely so it could be pasted into `node` and executed before
anything was wired around it.

Fourteen cases, all passing on the first run, which is less interesting than *which* cases
they are. Three would have been easy to get wrong and hard to notice:

- Clearing an override must revert to the **current** global, not to whatever the global
  was when the user first signed in. This is the entire reason NULL means "inherit" rather
  than the defaults being copied into each user's row at signup — the copy looks identical
  until an administrator changes a default and nothing happens.
- `notifyOnComment: false` is an override, not an absence. A `||` in place of `??` here
  silently re-enables notifications for everyone who turned them off, and no test that only
  checks the true case would catch it.
- A malformed filter blob degrades to the next layer instead of throwing. It is stored as
  JSON, so it can be anything; a preference that has been hand-edited into nonsense should
  cost the user their filter, not the page.

Choosing a shape that can be executed changed what got verified. The same logic embedded in
a service method would have been checked by reading it.

### #26 — Two more shell mistakes that reported success

Writing the settings DTOs, `cat > src/modules/settings/dto/settings.dto.ts` failed because
the `dto` directory did not exist — and the script's final `echo "written"` ran anyway and
said so. Identical in shape to entry #12, from a batch of file writes several phases
earlier.

Twice is a pattern rather than an accident, and the fix is not "be more careful". It is
that a script which writes files should end by *listing what it wrote*, not by echoing that
it wrote something. The verification and the claim have to be the same operation, or the
claim is just a comment.

### #27 — The same shell mistake, a third time, after writing down the fix twice

`cat > src/app/core/http/problem-details.ts` failed because `core/http/` did not exist. The
script's closing `echo "written"` ran regardless and reported success. This is the third
occurrence — entries #12 and #26 are the same failure — and #26 states the fix explicitly:
*a script that writes files should end by listing what it wrote, not by echoing that it
wrote something.*

Writing the lesson down twice did not apply it. What applied it was changing the command
itself, so the last line of every file-writing batch is now `find … | sort`. The
verification and the claim are the same operation, and there is nothing left to remember.

Worth being precise about the failure mode, because it is the general one in this session:
noticing a recurring error and recording a rule is not the same as removing the
possibility. The rule lives in a document nobody re-reads mid-task; the `find` lives in the
thing being run.

### #28 — Writing the frontend so that some of it could still be executed

Angular cannot be compiled here, so the strategy from entries #22 and #25 was applied
deliberately from the start rather than after the fact: the part of the list feature most
likely to be wrong — the conversion between URL query parameters and typed filter state —
was written as pure functions in their own file, with no Angular imports, specifically so
it could be run.

Twenty-two cases, including the round-trip property (`parse(toParams(q)) === q`) against two
different default sets. All passed first time, which is a weaker result than the slug
function in #22 — but the value was in what the shape forced. Writing it as pure functions
made the absent-versus-empty distinction obvious enough to test; the same logic spread
across a component's methods would have been checked by reading it, and that distinction is
exactly the kind that survives review and fails in use.

Everything else in `frontend/` — components, templates, styles, dependency injection — is
unexecuted. Type-checked with a standalone `tsc` and triaged to nothing but missing-module
diagnostics, which says the syntax is valid and says nothing about whether it works.

### #29 — The audit found a bug in itself, not in the code

The first version of the route audit reported that `DELETE /requests/:id` was
administrator-only. It is not — it is author-or-administrator, enforced in the service, and
the controller has no role decorator on it.

The audit was wrong. It read a handler's decorators with a fixed twelve-line lookahead,
which ran past the end of that handler and picked up the `@Roles(UserRole.ADMIN)` belonging
to the *next* one. Bounded to the actual decorator block — from the HTTP decorator to the
method signature — it reports correctly.

The near-miss is the point. A tool that reports "this endpoint is admin-only" about an
endpoint that should not be admin-only invites exactly the wrong fix: changing correct code
to match a broken analysis. The thing that prevented it was reading the source the tool was
complaining about before believing it.

A second defect in the same tool, found the same way: it reported zero feature-gated routes,
because `@RequiresFeature(COMMENTS_FEATURE)` passes a constant and the pattern only matched
a quoted string. Four routes were silently unaudited for their feature gate — the failure
mode being a *false pass*, which is worse than the first one and would not have announced
itself at all.

### #30 — Breaking the audit on purpose

Both defects above were found by chance — one because a result looked wrong, one because a
count looked wrong. That is not a method, so the audit was then broken deliberately in
three ways to confirm it fails where it should: a rule deleted, a rule claiming an admin
guard the handler does not have, and a feature gate the code does not apply. Each produced
the specific error it should.

This project has now accumulated four instances of a check that passed for the wrong reason
(#7, #16, #21, and the feature-gate false pass above). Running the failing configuration
deliberately is the only one of the responses that has actually worked. Asserting that a
check is correct, documenting that checks can be wrong, and being more careful have each
been tried and have each been followed by another instance.

### #31 — Documentation drifts the same way code does

Assembling the final README surfaced three stale passages that had accumulated from
incremental edits across the phases: a repository layout still annotating directories with
"added in Phase 8", a "not yet runnable — the API lands next" line written before the API
existed, and a paragraph about the unit tests that appeared twice because a later edit
inserted a fuller version above the original without removing it.

None of these were introduced carelessly. Each was correct when written and became false
when the next phase landed. That is the same failure as a stale comment above a changed
function, and it deserves the same treatment: a scan for phrases that assert a state
(`lands next`, `added in Phase`, `not yet`, `TBD`) rather than trusting that the document
was updated alongside the thing it describes.

Worth noting alongside entries #12, #26 and #27 as a variant of the same theme running
through this project: **the claim and the reality have to be checked against each other by
something mechanical, because they will diverge silently otherwise.** In the shell case the
fix was ending file writes with `find`. Here it is grepping for state-asserting phrases
before committing documentation.

### #32 — A negative control that did not test what it claimed

The manifest validator was broken seven ways to confirm it catches what it claims. Six
produced the expected error. The seventh — a Service selector that matches no pod — produced
nothing.

The validator was fine. The test was wrong: the mutation used `sed` to replace the first
occurrence of `app.kubernetes.io/name: api` in the file, which is the Service's *metadata
label*, not its `spec.selector`. Changing a label the check does not read changes nothing.
Re-run against the pod template's labels instead, the check fires correctly.

This is the same shape as log entries #7, #16, #21 and #30 — a check that appears to prove
something and does not — except that this time it appeared inside the negative control
itself. The practice adopted after #30 was "run the failing configuration deliberately", and
this is its failure mode: *the failing configuration has to actually fail for the reason you
think*. A negative control that produces no error is only evidence if you have confirmed
the mutation was real.

Five instances now, across SQL assertions, a shell audit and a Python validator. The
consistent factor is not the language or the tool. It is that a check and the thing it
checks are two separate artefacts, and nothing keeps them aligned unless something
mechanical does.

### #33 — What Phase 10 could and could not be

No container registry was reachable, so no image was built and no cluster was applied.
Writing Dockerfiles and manifests anyway would have produced plausible YAML with no evidence
behind it — and the brief says explicitly that the manifests are being assessed.

What was possible: the compose file validates through `docker compose config`, and the
dependency graph was printed and read rather than assumed — which is how the `migrate`
service's `service_completed_successfully` condition was confirmed to be what actually gates
the API. And the manifests get a structural validator that needs nothing installed, aimed at
the cross-file mistakes that per-file review misses.

The honest boundary, stated in `SCOPE.md` rather than implied: the Dockerfiles have never
been built and the manifests have never been applied. A structural check is not a cluster.
