# AI Collaboration

This is written from `docs/ai-log.md`, a log kept while working rather than reconstructed
afterwards. Thirty entries, written at the moment each thing happened, because the
interesting parts of this document — what the first output actually was, how a mistake was
noticed, what it cost — only exist if they are captured at the time.

Everything below is what happened. Where a number is given it was counted, not estimated.

---

## 1. Tooling and division of labour

**One tool**: Claude (Opus), in an agentic session with shell and filesystem access. Not an
autocomplete in an editor — a process that reads files, writes them, runs commands and
reports back. That distinction matters for everything that follows, because it means the
model could *verify its own work* wherever the environment permitted, and the interesting
question became where the environment permitted it.

**The division was not by file type. It was by direction versus generation.**

| Kept by the human | Delegated |
|---|---|
| Whether to build a monolith or services | Every line of the schema, the API and the frontend |
| Which dependency majors to target | The DTOs, guards, controllers, components |
| Phase order, and what was out of scope | The SQL, the checks, the Keycloak realm |
| Every ambiguity interpretation (22 of them) | The documentation drafts, including this one |
| The standing rule: surface architectural decisions, do not make them silently | |

Two of those need naming specifically, because they changed the codebase.

**Prisma 6 over Prisma 7.** The model checked the registry rather than recalling, found
Prisma 7 was current, and surfaced that adopting it meant moving the whole backend to ESM
with mandatory driver adapters. That was escalated rather than decided. The answer was to
stay on 6, and the reasoning is ADR-0011. Had the model decided for itself it would
plausibly have taken the newest version and spent the remaining time fighting ESM in a
NestJS and Jest toolchain that could not be run.

**Git identity.** The sandbox's default author was the assistant's. Left unchanged, every
commit in this submission would have been authored by an AI. That was surfaced and
corrected before the first commit, and AI involvement is recorded in a trailer instead —
a human author who is accountable, plus an explicit record of how much of each commit was
generated.

### What was deliberately *not* delegated, and why

Nothing was withheld from the model on principle. What was withheld was *trust in its
output* in specific places — the places where a plausible-looking wrong answer is invisible
in review and expensive later:

- **Authorization rules.** Every rule was restated as a table and audited against the code
  (§4, ADR-0021), rather than read and approved.
- **The two database invariants** the brief names — one vote per user, and correct derived
  counts. Both were pushed into the database and then attacked with concurrent connections.
- **Anything the model asserted about concurrency.** In every case the failing
  configuration was run deliberately to confirm the fix was doing the work.

---

## 2. Working method

**Plan first, then generate against the plan.** Before any code, the model produced a full
engineering analysis — domain model, architecture options, module boundaries, database
design, API surface, security, testing, and 21 ambiguities in the brief. That was reviewed
and approved, and it became the reference the implementation was checked against. The
standing instruction was explicit: *do not blindly implement every recommendation from the
analysis*. Several were dropped (§5).

Then phase by phase, with a review and a commit at each boundary. Context given to the
model at each phase: the original assignment PDF as the source of truth, the approved
analysis as guidance, and the repository as it grew.

### The method changed, and the reason is the most interesting thing in this document

The build environment could not reach the npm registry or any container registry. **No
dependency could be installed. Nothing could be compiled. No test runner could run.**

That was discovered in the first ten minutes of Phase 0, by inspecting the environment
before scaffolding anything — and it was surfaced immediately rather than worked around,
because every plausible workaround traded away the ability to verify.

What followed was a deliberate change in method. Rather than "write code, run tests" — the
normal loop, unavailable here — the working rule became:

> **Push as much logic as possible into layers that *can* be executed, and execute them.**

Three layers turned out to be reachable:

1. **The database.** PostgreSQL 16 was installed locally. So the invariants went into the
   schema as constraints and triggers, and 79 assertions across five check files were run
   against a real database — including concurrency tests with twenty simultaneous
   connections.
2. **Pure functions.** Logic with no framework imports can be pasted into `node` and run.
   Slug derivation, settings resolution and the URL/filter conversion were each written as
   pure modules *specifically so this was possible*, and each was executed.
3. **The source itself.** The authorization matrix is audited by a script that reads the
   controllers and compares them to a declared table. It needs nothing installed.

And one more that was not obvious: **Keycloak publishes its distribution as a GitHub
release, and GitHub was reachable.** So a real Keycloak 26.5 was downloaded and run, the
realm imported into it, and a real token decoded — which is how two shipping bugs were
caught (§3.1).

The honest limit: the TypeScript has never been compiled. That is stated at the top of
`SCOPE.md`'s known gaps rather than left to be discovered.

---

## 3. Three worked examples

### 3.1 The Keycloak realm — where the gap was largest

**The prompt** (Phase 2, verbatim from the assignment brief's own phase list):

> "PHASE 2 — Authentication and authorization"

with the standing project rules in context: *do not implement custom authentication
primitives when the assignment explicitly requires an identity provider*, and *security
must be enforced server-side*.

**What came back.** A realm JSON that looked entirely correct: a public client with PKCE,
brute-force protection, seeded users, and — to make the API able to verify an audience — a
custom client scope carrying an `oidc-audience-mapper`, declared in a top-level
`clientScopes` array.

It imported successfully. Keycloak logged `Realm 'feedbackhub' imported`. Nothing warned.

**What shipped, and the gap.** Because a real Keycloak was running, a token was actually
fetched and decoded. It had **no `aud` claim, no `email`, and no `preferred_username`.**

The cause: a realm-level `clientScopes` array does not *add* scopes, it **replaces the
realm's entire built-in set**. Declaring one custom scope deleted `profile`, `email`,
`roles`, `web-origins`, `acr` and `basic`. The client's references to them were then
silently dropped.

The consequence would have been total: the API verifies `aud`, so **every token in
existence would have been rejected**, with the cause five layers from the error message.

Shipped instead: no custom scope at all, the audience mapper attached directly to the
client. Fewer moving parts and no way to clobber the defaults. Verified by decoding a token
and asserting `aud`, `email` and `sub` are present.

**The second bug in the same file.** The Keycloak image ships no `curl`, so the standard
healthcheck talks HTTP over bash's `/dev/tcp`. The generated version used the widely copied
`echo -e "GET ... \n..."` form. HTTP requires CRLF. A real Keycloak answers **400 Bad
Request**, the container never becomes healthy, and `depends_on: condition:
service_healthy` hangs `docker compose up` **forever**. `printf` with `\r\n` returns 200.
Verified by extracting the healthcheck exactly as `docker compose config` resolves it and
running that string against the live server.

**Both are the same category, and it is the category that matters here: configuration that
is syntactically valid, reads correctly, and is wrong at runtime.** No linter, type checker
or review catches either. Only running it does.

### 3.2 The derived-count triggers — where the first answer worked and was still wrong

**The prompt** (Phase 1): *"Use database constraints for important invariants… A user must
not be able to create duplicate votes for the same feedback request. Do not rely only on
application-level checks when a database constraint can enforce the invariant."*

**What came back.** A trigger that recomputes the count:

```sql
UPDATE feedback_requests
   SET vote_count = (SELECT count(*) FROM votes WHERE request_id = NEW.request_id)
 WHERE id = NEW.request_id;
```

This is the more obvious implementation. It is easier to read, obviously correct by
inspection, and **it passes every single-session test.**

**What shipped, and the gap.** It is wrong under concurrency. The subquery is evaluated
against a snapshot, so two simultaneous votes both compute the same starting value and one
update is lost. Delta arithmetic evaluated under the row lock taken by the `UPDATE` is
correct:

```sql
UPDATE feedback_requests SET vote_count = vote_count + 1 WHERE id = NEW.request_id;
```

The difference is invisible in any test that does not overlap transactions. So a
concurrency check was written that fires twenty simultaneous votes from parallel
connections and asserts the counter reaches twenty. It is in `prisma/checks/concurrency.sh`
and it runs on a real database.

**Note what changed and what did not.** The model wrote the fix once the failure mode was
named. What it did not do on its own was doubt an implementation that looked right and
tested green. The verification was the human contribution; the code was not.

### 3.3 The authorization matrix — where the tool was wrong about the code

**The prompt** (Phase 9): *"Test behavior and risk, not lines of code. Prioritize:
Authentication, Authorization, Ownership rules…"*

**What came back.** A table of all 39 endpoints with an access level each, plus a static
audit that parses the controllers and checks the table against them — a good answer to the
real risk, which is not a rule tested wrongly but an endpoint added with **no rule at all**.

**What shipped, and the gap.** The audit's first run reported `DELETE /requests/:id` as
**administrator-only**. It is not; it is author-or-administrator, with no role decorator on
the handler.

The audit was wrong. It read each handler's decorators with a fixed twelve-line lookahead,
which ran past the end of the handler and picked up the `@Roles(UserRole.ADMIN)` belonging
to the *next* one.

This is the most dangerous shape of AI error encountered in the project: **a tool
confidently reporting a security property, incorrectly.** The natural response — change the
code to match the analysis — would have made a correct endpoint admin-only. What prevented
it was reading the source the tool was complaining about before believing it.

A second defect in the same tool, found the same way: it reported *zero* feature-gated
routes, because `@RequiresFeature(COMMENTS_FEATURE)` passes a constant and the pattern only
matched string literals. Four routes silently unaudited — a **false pass**, which is worse
than the first, because it announces nothing.

Shipped: the lookahead bounded to the actual decorator block, constants resolved, and the
audit then **broken deliberately three ways** — a removed rule, a rule claiming a guard the
code lacks, a feature gate the code does not apply — to confirm each is caught.

---

## 4. Failures

Beyond the three above, one pattern recurred often enough to be the main finding of this
project.

### The pattern: checks that pass for the wrong reason

Four separate instances, all AI-generated, all initially green:

| # | The check | Why it passed |
|---|---|---|
| 1 | "A user who authored content cannot be hard-deleted" | Ran *after* the cascade test had removed that user's only content, so the constraint had nothing to protect |
| 2 | "Oldest and newest disagree about the second row" | The assertion was `(SELECT 1) IS NOT NULL` — a tautology that can never fail |
| 3 | 16 of 32 schema checks | Two assertions counted rows across the whole table, so they were correct on an empty database and wrong once the seed existed — and the README tells the reader to seed *first* |
| 4 | "Zero feature-gated routes" | The pattern only matched string literals, so four gated routes were silently unaudited |

**How each was noticed:** the first by a red result that turned out to have the wrong
cause; the second by re-reading the suite; the third because a count in the output looked
memorable and had changed; the fourth because a number looked implausible.

**Three of the four were luck.** That is the honest assessment, and it is why the response
matters more than the individual fixes.

**What was tried, in order:**

1. *Assert the check is correct.* Failed — instance #2 followed.
2. *Write down that checks can be wrong.* Failed — instance #3 followed.
3. *Be more careful.* Failed — instance #4 followed.
4. **Run the failing configuration deliberately.** This worked, and is now the standing
   practice: the last-administrator lock, the count triggers and the route audit each have
   a documented negative control, and each was observed failing before being trusted.

The generalisable claim: **a green suite earns less trust than it appears to, and the
useful question about a new assertion is not "does it pass" but "what would make it fail".**

### A smaller failure, repeated three times, that says something about process

A shell heredoc batch of the form `cd dir && cat > a.ts <<EOF … cat > b.ts <<EOF …`. The
`&&` binds only to the first command, so when the `cd` or a missing directory caused the
first write to fail, every subsequent write succeeded — and the script's closing
`echo "written"` reported success regardless.

It happened three times (log entries #12, #26, #27). After the second, the fix was written
down explicitly: *a script that writes files should end by listing what it wrote, not by
echoing that it wrote something.* **It happened a third time anyway.**

What eventually stopped it was not remembering the rule but changing the command, so every
file-writing batch now ends with `find … | sort`. The verification and the claim became the
same operation.

That is the honest lesson and it generalises past shell scripts: **noticing a recurring
error and recording a rule is not the same as removing the possibility.** The rule lives in
a document nobody re-reads mid-task.

### Two hallucination-adjacent errors worth naming

**Slug derivation.** `toSlug` used `normalize('NFKD')` and then treated anything that is
not a letter or number as a separator. NFKD decomposes `Ü` into a base letter plus a
combining mark; the mark is neither. `Ünicode Wörter` became `u-nicode-wo-rter`. **Invisible
on ASCII input** — every obvious test case passes. Found only because the function is pure
and was executed.

**Version recall.** Asked for framework versions, the model's instinct was to write
plausible ones. Checking the registry instead found Prisma **7.9.1** and TypeScript
**7.0.2** were current, and that `ts-jest` declares `typescript >=4.3 <7` — so adopting the
current TypeScript silently breaks the test runner. Recall would have produced `^6` for
Prisma, which would have been *accidentally right for the wrong reason*.

---

## 5. Rejections

**The recompute trigger** (§3.2) is the clearest: it worked, it was readable, it passed
every test written against it, and it was replaced because it was wrong in a way none of
those tests could show.

**Four suggestions from the model's own analysis were rejected** during implementation,
under the standing instruction not to implement recommendations blindly:

| Proposed | Why it was dropped |
|---|---|
| A separate `admin` module | "Admin" is an audience, not a bounded context. It would hold a second copy of rules that must agree with the first, which is how authorization bugs are made. Became a route grouping instead (ADR-0015). |
| A mock OIDC provider container | Would have made social login demonstrable without secrets. Genuinely useful; not requested by the brief, and the time was better spent on verification. |
| Duplicate-suggestion hints on the create form | The most tempting cut item, because it directly serves the product's stated purpose. Still not requested. Recorded as the top "next week" item. |
| An ESLint module-boundary rule | Would enforce the module graph mechanically. Real value, but the boundaries are currently maintained by review and the graph is small enough that the rule would be ceremony. |

**One structural proposal was rejected before implementation started**: the analysis floated
UUIDv7 primary keys for index locality. PostgreSQL 16 has no `uuidv7()`, so it would have
meant an extension or generating keys in the application — splitting key generation across
two places and breaking raw-SQL seeding — to buy a property that is invisible at this scale
(ADR-0008).

---

## 6. Attribution in history

Every commit carries a trailer:

```text
Assisted-By: Claude (heavy)
```

The README defines three levels — `heavy`, `moderate`, `none`. **All 17 commits are
`heavy`, and none are anything else.** That is the truth rather than a manufactured spread:
every line in this repository was generated by the model and then read, and the human
contribution was direction, scope, verification strategy and review, not authorship.

To audit it:

```bash
git log --pretty='%(trailers:key=Assisted-By,valueonly)' | sort | uniq -c
```

The brief says a fully honest "I generated it and reviewed it" is a perfectly good answer
if it can be defended. The defence is the rest of this document: 79 database assertions
against a real PostgreSQL, a real Keycloak used to catch two shipping bugs, pure logic
executed rather than read, an authorization table audited against the source, and a
documented negative control for every concurrency claim.

The gap that defence does not cover is stated plainly in `SCOPE.md`: **the TypeScript has
never been compiled**, because this environment could not install a single dependency.
