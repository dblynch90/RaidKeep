# RaidKeep Agent Instructions

## Optimization Workflow

When optimizing RaidKeep for performance, reliability, or scalability:

1. **Reference:** See `OPTIMIZATION.md` for the full phased workflow and model assignments.
2. **Rule:** The Cursor rule `optimization-workflow` provides condensed guidance when selected.
3. **Models:** Switch models in Cursor's model selector before each phase:
   - **Sonnet 4.6** — Architecture scanning, bottleneck analysis
   - **GPT-5.4** — Reliability fixes, performance analysis, scalability planning
   - **GPT-5.3 Codex** — Code edits, refactoring, tests
   - **Opus 4.6** — Deep debugging (async/concurrency)
   - **Haiku 4.5** — Quick fixes, validation

4. **Phases (in order):** Architecture → Reliability → Performance → Refactoring → Scalability → Tests

5. **Output:** Provide a summary of changes, performance gains, reliability fixes, and build confirmation.
