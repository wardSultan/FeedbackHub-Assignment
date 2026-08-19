# AI Collaboration

> **Status: in progress.** This document is assembled from `docs/ai-log.md`, a running
> record kept while working rather than reconstructed afterwards. Verbatim prompts, first
> outputs and the moments where something turned out to be wrong only exist if they are
> captured at the time, so they are.

## 1. Tooling and division of labour

**Tool used:** Claude (Opus) as an implementation assistant inside an agentic coding
session with shell and file access.

**Division of labour — the current intent, updated as the work proceeds:**

| Delegated to AI | Kept by hand / reviewed line by line |
|---|---|
| Boilerplate: DTOs, module wiring, Angular component scaffolds | Authorization policies and ownership rules |
| Prisma schema drafting from an agreed model | The vote uniqueness and derived-count invariants |
| Dockerfiles, compose and Kubernetes manifests | Anything touching token validation |
| Test fixtures and table-driven test data | The settings resolution precedence rule |
| Documentation drafting | Every architectural decision in `DECISIONS.md` |

The line is drawn where a plausible-looking wrong answer is invisible in review and
expensive in production. Authorization and the two database invariants are exactly that:
code that looks correct, passes a happy-path test, and is wrong under concurrency or from
an unexpected caller.

> To be expanded with what actually happened, not what was planned.

## 2. Working method

Plan first, then generate against the plan. A full engineering analysis was produced and
reviewed before any code was written; that document sets the architecture, and the
implementation phases were agreed in advance. The model was explicitly instructed not to
implement every recommendation from its own analysis, and to raise architectural decisions
rather than make them silently.

Context supplied to the model: the original assignment PDF as the source of truth, the
approved analysis as architectural guidance, and the repository itself as it grows.

> To be updated if and when the method changes mid-project — it usually does.

## 3. Three worked examples

> To be written from `docs/ai-log.md` once the relevant work is done. Current
> candidates: the list query with composed filtering, sorting, search and pagination;
> the settings resolution and bootstrap payload; the derived-count triggers.

## 4. Failures

> To be written from `docs/ai-log.md`. Recorded as they happen — see entry
> 2026-08-19 #3 for the first one.

## 5. A rejection

> To be written if it happens. Not fabricated if it does not.

## 6. Attribution in history

Every commit carries a trailer:

```text
Assisted-By: Claude (heavy|moderate|none)
```

Levels are defined in the [README](../README.md#ai-attribution). To audit the split:

```bash
git log --pretty='%s%n%(trailers:key=Assisted-By,valueonly)' | sort | uniq -c
```
