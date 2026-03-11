# RaidKeep Optimization: Performance, Reliability & Scalability

You are optimizing RaidKeep for production readiness and future feature growth.

## MODEL ROLES — Switch models in Cursor before each phase

| Model | Use for |
|-------|---------|
| **Sonnet 4.6** | Codebase scanning, architecture mapping, multi-file analysis, identifying bottlenecks |
| **GPT-5.4** | Architecture reasoning, race condition detection, performance analysis, scalability planning |
| **GPT-5.3 Codex** | Code editing, refactoring, implementation, writing tests |
| **Opus 4.6** | Deep debugging when complex async/concurrency issues appear |
| **Haiku 4.5** | Small edits, minor refactors, quick fixes, running tests, validation checks |

---

## PROJECT CONTEXT

- **Frontend:** React 19 + Vite 7, Tailwind 4, React Router
- **Backend:** Express, SQLite (better-sqlite3), Blizzard.js for Battle.net
- **Auth:** express-session, Battle.net OAuth
- **Hosting:** Vercel (client), Render (server)

---

## PHASE 1 — Architecture & Bottleneck Analysis
**MODEL: Sonnet 4.6**

1. Map entry points, routing, global state (AuthContext, ToastContext)
2. Map API routes, services, DB schema, session handling
3. Identify: N+1 queries, redundant API calls, heavy bundle chunks
4. List hot paths: auth, dashboard load, Battle.net sync, guild/raid ops

---

## PHASE 2 — Reliability Improvements
**MODEL: GPT-5.4**

1. Fix race conditions (e.g. guild permissions, post-login navigation)
2. Ensure async flows are cancellation-safe and avoid stale state
3. Add transactions for multi-step DB writes
4. Harden error handling and idempotency where needed

---

## PHASE 3 — Performance Optimization
**MODEL: GPT-5.4**

1. Frontend: code splitting, dynamic imports, memoization, reduce redundant fetches
2. Backend: fix N+1 queries, add indexes, pagination, caching where appropriate
3. Reduce bundle size and improve TTFB

---

## PHASE 4 — Code Refactoring & Implementation
**MODEL: GPT-5.3 Codex**

1. Apply reliability and performance changes
2. Deduplicate components and consolidate services
3. Create reusable hooks and shared abstractions
4. Keep behavior identical

---

## PHASE 5 — Scalability for Future Features
**MODEL: GPT-5.4**

1. Identify extension points for new features
2. Suggest modular service structure, API versioning, migration patterns
3. Document patterns for new routes, components, and DB changes

---

## PHASE 6 — Tests & Validation
**MODEL: GPT-5.3 Codex** (or **Haiku 4.5** for simple checks)

1. Add tests for critical paths and reliability fixes
2. Run full test suite, lint, and build
3. Fix any failures

---

## OUTPUT

Report: summary of changes, performance improvements, reliability fixes, tests added, and confirmation that build succeeded.

---

## Workflow

1. Copy this prompt or reference `OPTIMIZATION.md` when starting an optimization run.
2. Switch to the specified model before each phase.
3. Run phases sequentially; use Opus 4.6 if complex debugging arises mid-phase.
