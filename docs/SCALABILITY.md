# RaidKeep Scalability & Extension Patterns

Guidance for adding features and scaling the application.

## Extension Points

### New API Routes
- Add route file under `server/src/routes/` and mount in `server/src/index.ts`
- Use `requireAuth` from `middleware/auth.ts` for protected routes
- Follow existing patterns: `getDb()`, prepared statements, JSON response

### New Pages
- Add page under `client/src/pages/`
- Use `lazy()` import in `App.tsx` for non-critical path pages
- Use `api.get/post/put/delete` from `client/src/api.ts` for requests

### Database Migrations
- Add migration blocks in `server/src/db/init.ts` within the versioned migration system
- Use `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE` with version checks
- Never drop columns without a deprecation period

### Shared Logic
- **Hooks:** `client/src/` — extract reusable fetch/state logic
- **Utils:** `server/src/utils/` — shared helpers (e.g. `raidStatus.ts`)
- **Services:** `server/src/services/` — external API integrations (Blizzard, Battle.net)

## API Versioning (Future)
When breaking changes are needed, consider `/api/v2/` prefix and maintain v1 for compatibility.
