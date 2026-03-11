# RaidKeep QA Test Plan (Full)

**Instructions for the Agent:** Execute these tests in order when dependencies exist. Fix issues as you find them, commit and push changes, then continue. Use `QA:` in commit messages for traceability. Switch to the specified model for each section before running it (via Cursor's model selector). You may push changes as needed throughout testing.

---

## QA Test Mode (No Battle.net Required)

To run QA without Battle.net login, use the built-in test mode:

### Server
1. Set env var: `QA_TEST_MODE=1` (e.g. in `.env` or `QA_TEST_MODE=1 npm run dev:server`).

### Client
1. Visit the app with `?qa=1` in the URL (e.g. `http://localhost:5173/login?qa=1`), **or**
2. In the browser console: `localStorage.setItem("qaTestMode", "1")` then refresh.

### Auth
1. Register a test user (e.g. `qatest` / `qatest123`) via `/register`.
2. Log in with that user at `/login`. No Battle.net required.

### What Mock Mode Does
- **/me/characters** – Returns 5 mock characters in "Test Guild" on Stormrage (TBC Anniversary).
- **/me/guild-permissions** – Returns full permissions for any guild.
- **/me/guild-roster** – Returns the mock guild roster.
- **/me/character-search** – Returns mock data (e.g. search "QaTank", "QaHealer", "QaDps", or any name).
- **/me/saved-raids/my-assignments**, **/me/saved-raids** – Return empty arrays.
- **/me/raider-roster**, **/me/raid-teams** – Return mock/empty data.
- **/me/sync** – Returns `{ ok: true }` without calling Battle.net.

### Flow
1. Log in with test user (with `?qa=1` or `qaTestMode` in localStorage).
2. Dashboard shows "Test Guild" from mock characters.
3. Click Test Guild → guild-loading → guild-dashboard (permissions are mocked).
4. From guild-dashboard: Plan Raid, Raid Schedule, Guild Roster, etc. work with mock data.

### Disable
- Remove `QA_TEST_MODE` from server env.
- `localStorage.removeItem("qaTestMode")` and refresh (or use a clean session).

---

## Section 1: Race Conditions & Async Reliability

**Model: GPT-5.3 Codex**

### 1.1 Dashboard post-login race
- **Scenario:** User lands on Dashboard immediately after OAuth callback; characters/guilds may not be synced yet.
- **Test:** Open Dashboard right after Battle.net login. Confirm no flash of "No guilds found" or "No raids" when data exists.
- **Files:** `client/src/pages/Dashboard.tsx` (retry logic, `setInitialLoadDone`, visibility refetch).
- **Verify:** Never overwrite good data with empty responses; recovery refetch doesn't clear good data.

### 1.2 Guild Loading permissions vs sync
- **Scenario:** User navigates to guild-loading before character sync completes; permissions may be empty.
- **Test:** Go to `/guild-loading?realm=X&guild_name=Y` immediately after login. Confirm loading screen until permissions ready, not "No access."
- **Files:** `client/src/pages/GuildLoading.tsx` (permissions retry, `retryCount`, syncing card).
- **Verify:** `setTimeout` cleanup in effect return; no duplicate retries.

### 1.3 PlanRaid load-from race
- **Scenario:** User opens "Load From..." and selects a different raid/team while an in-flight fetch is running.
- **Test:** Start loading a raid, quickly change selection. Confirm no stale data applied, no double application of load.
- **Files:** `client/src/pages/PlanRaid.tsx` (`loadFromPreviousRaid`, `loadFromTeam`, modal state).

### 1.4 Visibility change refetch
- **Scenario:** User switches away and returns while data is loading.
- **Test:** Leave Dashboard during initial load, return after 3+ seconds. Confirm refetch uses current game version and doesn't overwrite good data with empty.
- **Files:** `client/src/pages/Dashboard.tsx` (`visibilitychange` handler, `gameVersionRef`, conditional updates).

---

## Section 2: Reliability & Error Handling

**Model: Sonnet 4.6**

### 2.1 API failure handling
- **Test:** Simulate failures (server down, 500) for `/auth/me/characters`, `/auth/me/saved-raids`, `/auth/me/guild-permissions`.
- **Verify:** Graceful error display; no unhandled promise rejections; no blank screen.

### 2.2 Raid save with minimal input
- **Test:** Create raid with only raid name, no date. Save.
- **Verify:** Raid created with default date and 2 parties; no "parties required" error.
- **Files:** `server/src/routes/auth.ts` – POST saved-raids validation.

### 2.3 Load from team with empty parties
- **Test:** Have 3 parties (one empty), load from team with 7 members.
- **Verify:** Members fill empty slots first; overflow creates new party only when needed.
- **Files:** `client/src/pages/PlanRaid.tsx` – `loadFromTeam`.

### 2.4 Realm search – character not found
- **Test:** Search for non-existent character in Add from Realm.
- **Verify:** Clear error message; no crash; can search again.

---

## Section 3: Performance

**Model: Opus 4.6 for analysis; Haiku 4.5 for running tests**

### 3.1 Initial load time
- **Test:** Measure Dashboard first paint and time until guilds/raids visible.
- **Verify:** No unnecessary sequential fetches; `Promise.all` where applicable.
- **Files:** `client/src/pages/Dashboard.tsx` – initial load `Promise.all`.

### 3.2 PlanRaid with many parties
- **Test:** Create raid with 8+ parties, many slots filled; interact (assign, move, save).
- **Verify:** No lag; `useMemo`/`useCallback` for expensive derived data.
- **Files:** `client/src/pages/PlanRaid.tsx` – `assignedNames`, `displayedRosterMembers`, handlers.

### 3.3 Large guild roster
- **Test:** Guild with 200+ members; filter, search, add to roster.
- **Verify:** UI responsive; no main-thread blocking.
- **Files:** `client/src/pages/GuildRoster.tsx`, `client/src/pages/RaidRoster.tsx`.

### 3.4 CPU profiling (cursor-ide-browser)
- **Test:** Use `browser_profile_start` / `browser_profile_stop` during heavy interactions (PlanRaid, Dashboard).
- **Verify:** Identify hot spots (re-renders, heavy computations). Read raw `cpu-profile-*.json` to verify summary.
- **Analysis model:** Opus 4.6.

---

## Section 4: Memory Leaks

**Model: GPT-5.3 Codex**

### 4.1 Effect cleanup
- **Check:** Every `useEffect` with `setTimeout`, `setInterval`, or `addEventListener` cleans up on unmount.
- **Files:** `Dashboard.tsx` (retry timeout, visibility listener, recovery timer), `GuildLoading.tsx` (permissions timeout), `RaidRoster.tsx` (save message timeout), `ToastContext.tsx`.
- **Pattern:** Return cleanup that clears timeouts and removes listeners.

### 4.2 Aborted fetch updates
- **Check:** In-flight fetches don't update state after unmount; no `setState` on unmounted component.
- **Files:** `Dashboard.tsx` (`cancelled`), `GuildLoading.tsx` (`cancelled`), `PlanRaid.tsx` (edit/load effects).
- **Pattern:** `if (cancelled) return` before `setState` in async callbacks.

### 4.3 Modal/popover unmount
- **Test:** Open and close Load From modal, Add from Guild/Realm drawer, officer notes popout repeatedly.
- **Verify:** No accumulation of subscriptions or listeners.
- **Files:** `PlanRaid.tsx`, `RaidOfficerNotesPopout.tsx`.

---

## Section 5: Crashes & Edge Cases

**Model: Opus 4.6 for analysis; Haiku 4.5 for running tests**

### 5.1 Malformed URL params
- **Test:** Visit with missing/invalid params: `/guild-loading`, `/plan-raid`, `/raid-schedule` with empty `realm` or `guild_name`.
- **Verify:** Graceful handling (error or redirect); no uncaught errors.

### 5.2 Empty/null API responses
- **Test:** APIs returning `null`, `undefined`, or empty arrays.
- **Verify:** No `Cannot read property of undefined`; defensive checks (`?? []`, `?.`) in place.
- **Files:** All pages consuming API responses.

### 5.3 Rapid navigation
- **Test:** Quickly switch between Dashboard, Raid Schedule, Plan Raid, Guild Roster.
- **Verify:** No "Can't perform a React state update on an unmounted component" warnings.
- **Run with:** Haiku 4.5.

### 5.4 Session expiry mid-flow
- **Test:** Let session expire (or clear cookies), then perform action (save raid, load roster).
- **Verify:** Redirect to login or clear error; no infinite loop or crash.

---

## Section 6: Server-Side Reliability

**Model: Sonnet 4.6**

### 6.1 Unit tests
- **Run:** `npm run test` in project root.
- **Verify:** All tests pass; add tests for raid status logic and critical utilities.
- **Files:** `server/src/utils/raidStatus.test.ts`, `server/src/services/blizzard.test.ts`.

### 6.2 DB constraints
- **Verify:** `party_count` and related columns handle NULL/legacy rows; migrations don't fail on existing data.
- **Files:** `server/src/db/init.ts`, `server/src/routes/auth.ts` – `enrichRaidWithSlotCounts`, create/update raid.

### 6.3 Concurrent requests
- **Test:** Fire multiple simultaneous requests (characters, raids, permissions).
- **Verify:** No SQLite "database is locked" or corruption; consistent responses.

---

## Section 7: Browser E2E (cursor-ide-browser)

**Model: Haiku 4.5**

### 7.1 Login → Dashboard → Guild flow
1. Log in (or use existing session).
2. Open Dashboard.
3. Wait for guilds/raids to load.
4. Click guild, wait for guild-loading, then guild-dashboard.
- **Verify:** Flow completes; no empty states when data exists.

### 7.2 Plan Raid full flow
1. Open Plan Raid.
2. Enter raid name, select instance, date.
3. Add from Guild and Add from Realm.
4. Load from team.
5. Save raid.
- **Verify:** Raid saves; party count and slots correct; Signups x/x accurate.

### 7.3 Sign-up flow (RaidView)
1. Open a raid.
2. Sign up as available.
3. Confirm availability.
- **Verify:** Status updates; no duplicate sign-ups.

---

## Section 8: Regression Checklist

**Model: Haiku 4.5**

After fixes, re-verify:

- [ ] Dashboard: no flash of "No guilds" or "No raids"
- [ ] Guild Loading: permissions load with retries
- [ ] Plan Raid: save with only raid name
- [ ] Plan Raid: Load from Team fills empty slots first
- [ ] Plan Raid: Add from Realm works
- [ ] Plan Raid: instance selection sets party count
- [ ] Raid Schedule: Signups x/x uses `party_count` (including empty parties)

---

## Execution Order

1. **Section 6.1** – run `npm run test` (Sonnet 4.6)
2. **Section 1** – race conditions (GPT-5.3 Codex)
3. **Section 2** – reliability (Sonnet 4.6)
4. **Section 4** – memory leaks (GPT-5.3 Codex)
5. **Section 5** – crashes (Haiku 4.5 run; Opus 4.6 if analysis needed)
6. **Section 3** – performance (Haiku 4.5 run; Opus 4.6 for analysis)
7. **Section 6.2–6.3** – server (Sonnet 4.6)
8. **Section 7** – E2E (Haiku 4.5)
9. **Section 8** – regression (Haiku 4.5)

**Escalation:** If a bug is difficult to reproduce or analyze, switch to **Opus 4.6**.

---

## Model Quick Reference

| Section | Primary Model | Notes |
|---------|---------------|-------|
| 1 – Race Conditions | GPT-5.3 Codex | Async flow analysis |
| 2 – Reliability | Sonnet 4.6 | Error handling, validation |
| 3 – Performance | Haiku 4.5 (run) / Opus 4.6 (analyze) | Profiling interpretation |
| 4 – Memory Leaks | GPT-5.3 Codex | Effect cleanup, lifecycle |
| 5 – Crashes | Haiku 4.5 (run) / Opus 4.6 (analyze) | Edge case execution |
| 6 – Server | Sonnet 4.6 | Tests, DB, concurrency |
| 7 – E2E | Haiku 4.5 | Automation |
| 8 – Regression | Haiku 4.5 | Quick verification |
| **Stuck / complex bugs** | **Opus 4.6** | Escalation |
