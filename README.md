# RaidKeep

A web app for WoW guild leaders to organize raids. Manage your roster, schedule raids, assign raid slots, add notes for members, and let guild members soft sign up for raids.

## Features

- **Import from Blizzard**: Fetch guild roster automatically from the WoW Armory (Retail & Classic)
- **Login with Battle.net**: Sign in with your Battle.net account; guilds and characters are synced automatically
- **Auth**: Register as guild leader or member, or log in with Battle.net
- **Guilds**: Create guilds, join via 6-character code
- **Roster**: Add characters (name, class, spec, role)
- **Raids**: Create raids with date/time, publish schedule
- **Raid slots**: Assign characters to tank/healer/dps slots (2/4/14 default)
- **Raid notes**: Add notes for specific guild members per raid
- **Soft sign-up**: Members mark Interested / Tentative / Can't make it

## Setup

```bash
# Install dependencies
npm install
cd client && npm install
cd ../server && npm install
cd ..

# Initialize database
npm run db:init

# Configure Blizzard API (for guild import and Battle.net login)
cp server/.env.example server/.env
# Edit server/.env with your Client ID and Secret from https://develop.battle.net
# For Battle.net login, add this Redirect URI in your Battle.net app settings:
#   http://localhost:5173/auth/battlenet/callback

# Optional: Create site admin (for /admin)
# Set ADMIN_USERNAME and ADMIN_PASSWORD before first db:init to create the initial admin.
# Example: ADMIN_USERNAME=admin ADMIN_PASSWORD=yourSecret npm run db:init

# Start dev (client + server)
npm run dev
```

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3001
- **Admin panel**: http://localhost:5173/admin/login (requires ADMIN_USERNAME/ADMIN_PASSWORD)

## Deployment (Render / persistent data)

By default the SQLite database is stored in `server/data/raidkeep.db`. On Render and similar platforms, the project filesystem is **ephemeral** — it is wiped on every deploy or restart. To persist your data:

1. **Add a persistent disk** in the Render dashboard for your web service.
2. **Mount path**: Use `/opt/render/project/src/data` (or the path Render assigns).
3. **Environment variable**: Set `DATA_DIR=/opt/render/project/src/data` (or your mount path).
4. **Redeploy**: The database will be created and stored on the persistent disk.

Without `DATA_DIR` pointing to a persistent disk, all data (users, roster, raids, preferences) is lost on each deploy or service restart.

## Project structure

```
RaidKeep/
├── client/          # React + Vite + Tailwind
├── server/          # Express + SQLite
│   ├── data/        # raidkeep.db
│   └── src/
│       ├── db/      # Schema & init
│       ├── routes/  # Auth, guilds, characters, raids, signups
│       └── middleware/
└── package.json     # Root scripts
```

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, React Router
- **Backend**: Node.js, Express, better-sqlite3, bcryptjs, express-session
- **Database**: SQLite
