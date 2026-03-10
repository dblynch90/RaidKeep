import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Use DATA_DIR env for persistent storage (e.g. Render persistent disk at /opt/render/project/src/data)
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "../../data");
const dbPath = path.join(dataDir, "raidkeep.db");

export function getDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  return db;
}

export function initDb() {
  const db = getDb();

  db.exec(`
    -- Users (guild leaders and members)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('leader', 'member')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Guilds
    CREATE TABLE IF NOT EXISTS guilds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      server TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      join_code TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Guild membership
    CREATE TABLE IF NOT EXISTS guild_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_leader INTEGER NOT NULL DEFAULT 0,
      UNIQUE(guild_id, user_id)
    );

    -- Characters (roster)
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      class TEXT NOT NULL,
      spec TEXT,
      off_spec TEXT,
      professions TEXT,
      role TEXT NOT NULL CHECK(role IN ('tank', 'healer', 'dps')),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, name)
    );

    -- Raids
    CREATE TABLE IF NOT EXISTS raids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      instance TEXT,
      raid_date TEXT NOT NULL,
      raid_time TEXT NOT NULL,
      is_published INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Raid slots (composition)
    CREATE TABLE IF NOT EXISTS raid_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('tank', 'healer', 'dps')),
      character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      UNIQUE(raid_id, position)
    );

    -- Sign-ups
    CREATE TABLE IF NOT EXISTS sign_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'interested' CHECK(status IN ('interested', 'tentative', 'cannot')),
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(raid_id, character_id)
    );

    -- Raid notes
    CREATE TABLE IF NOT EXISTS raid_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(raid_id, character_id)
    );

    CREATE INDEX IF NOT EXISTS idx_characters_guild ON characters(guild_id);
    CREATE INDEX IF NOT EXISTS idx_raids_guild ON raids(guild_id);
    CREATE INDEX IF NOT EXISTS idx_raid_slots_raid ON raid_slots(raid_id);
    CREATE INDEX IF NOT EXISTS idx_sign_ups_raid ON sign_ups(raid_id);
    CREATE INDEX IF NOT EXISTS idx_raid_notes_raid ON raid_notes(raid_id);
  `);

  // Migration: add server_type to existing guilds tables
  try {
    const tableInfo = db.prepare("PRAGMA table_info(guilds)").all() as Array<{ name: string }>;
    if (!tableInfo.some((c) => c.name === "server_type")) {
      db.exec("ALTER TABLE guilds ADD COLUMN server_type TEXT NOT NULL DEFAULT 'Retail'");
    }
  } catch {
    // Column may already exist
  }

  // Migration: add off_spec and professions to characters
  try {
    const charInfo = db.prepare("PRAGMA table_info(characters)").all() as Array<{ name: string }>;
    if (!charInfo.some((c) => c.name === "off_spec")) {
      db.exec("ALTER TABLE characters ADD COLUMN off_spec TEXT");
    }
    if (!charInfo.some((c) => c.name === "professions")) {
      db.exec("ALTER TABLE characters ADD COLUMN professions TEXT");
    }
  } catch {
    // Columns may already exist
  }

  // Migration: add Battle.net OAuth fields to users
  try {
    const userInfo = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    if (!userInfo.some((c) => c.name === "battlenet_id")) {
      db.exec("ALTER TABLE users ADD COLUMN battlenet_id TEXT");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_battlenet ON users(battlenet_id) WHERE battlenet_id IS NOT NULL");
    }
    if (!userInfo.some((c) => c.name === "battlenet_region")) {
      db.exec("ALTER TABLE users ADD COLUMN battlenet_region TEXT");
    }
    if (!userInfo.some((c) => c.name === "battlenet_battletag")) {
      db.exec("ALTER TABLE users ADD COLUMN battlenet_battletag TEXT");
    }
  } catch {
    // Columns may already exist
  }

  // Sync status for Battle.net users (last sync result)
  try {
    const userInfo = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    if (!userInfo.some((c) => c.name === "last_sync_at")) {
      db.exec("ALTER TABLE users ADD COLUMN last_sync_at TEXT");
    }
    if (!userInfo.some((c) => c.name === "last_sync_characters")) {
      db.exec("ALTER TABLE users ADD COLUMN last_sync_characters INTEGER");
    }
    if (!userInfo.some((c) => c.name === "last_sync_error")) {
      db.exec("ALTER TABLE users ADD COLUMN last_sync_error TEXT");
    }
    if (!userInfo.some((c) => c.name === "last_sync_debug")) {
      db.exec("ALTER TABLE users ADD COLUMN last_sync_debug TEXT");
    }
  } catch {
    // Columns may already exist
  }

  // Battle.net profile characters (all chars from profile, shown on My Characters)
  db.exec(`
    CREATE TABLE IF NOT EXISTS battle_net_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      realm_slug TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      class TEXT DEFAULT 'Unknown',
      guild_id INTEGER REFERENCES guilds(id) ON DELETE SET NULL,
      UNIQUE(user_id, name, realm_slug, server_type)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_battle_net_characters_user ON battle_net_characters(user_id)");

  // Saved raids (from Plan Raid - guild name/realm, not guild_id)
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_raids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guild_name TEXT NOT NULL,
      guild_realm TEXT NOT NULL,
      guild_realm_slug TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      raid_name TEXT NOT NULL,
      raid_instance TEXT,
      raid_date TEXT NOT NULL,
      start_time TEXT,
      finish_time TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_saved_raids_user ON saved_raids(user_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_saved_raids_guild ON saved_raids(guild_name, guild_realm_slug, server_type)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_raid_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raid_id INTEGER NOT NULL REFERENCES saved_raids(id) ON DELETE CASCADE,
      party_index INTEGER NOT NULL,
      slot_index INTEGER NOT NULL,
      character_name TEXT NOT NULL,
      character_class TEXT NOT NULL,
      role TEXT NOT NULL,
      is_raid_lead INTEGER NOT NULL DEFAULT 0,
      is_raid_assist INTEGER NOT NULL DEFAULT 0,
      availability_status TEXT DEFAULT 'pending' CHECK(availability_status IN ('pending', 'confirmed', 'unavailable'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_saved_raid_slots_raid ON saved_raid_slots(raid_id)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_raid_available (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raid_id INTEGER NOT NULL REFERENCES saved_raids(id) ON DELETE CASCADE,
      character_name TEXT NOT NULL,
      character_class TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(raid_id, character_name)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_saved_raid_available_raid ON saved_raid_available(raid_id)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_raid_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raid_id INTEGER NOT NULL REFERENCES saved_raids(id) ON DELETE CASCADE,
      character_name TEXT NOT NULL,
      character_class TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_saved_raid_backups_raid ON saved_raid_backups(raid_id)");

  // Raider roster (guild members marked as raiders with specs/notes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS raider_roster (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guild_name TEXT NOT NULL,
      guild_realm_slug TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      character_name TEXT NOT NULL,
      character_class TEXT NOT NULL,
      primary_spec TEXT,
      off_spec TEXT,
      secondary_spec TEXT,
      notes TEXT,
      raid_role TEXT,
      raid_lead INTEGER NOT NULL DEFAULT 0,
      raid_assist INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, guild_name, guild_realm_slug, server_type, character_name)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_raider_roster_user_guild ON raider_roster(user_id, guild_name, guild_realm_slug, server_type)");

  // Raid teams (named teams for a guild)
  db.exec(`
    CREATE TABLE IF NOT EXISTS raid_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guild_name TEXT NOT NULL,
      guild_realm_slug TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      team_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_raid_teams_user_guild ON raid_teams(user_id, guild_name, guild_realm_slug, server_type)");

  // Raid team members (raiders assigned to a team)
  db.exec(`
    CREATE TABLE IF NOT EXISTS raid_team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES raid_teams(id) ON DELETE CASCADE,
      character_name TEXT NOT NULL,
      character_class TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(team_id, character_name)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_raid_team_members_team ON raid_team_members(team_id)");

  // Migration: add portrait_url to battle_net_characters
  try {
    const bnCols = db.prepare("PRAGMA table_info(battle_net_characters)").all() as Array<{ name: string }>;
    if (!bnCols.some((c) => c.name === "portrait_url")) {
      db.exec("ALTER TABLE battle_net_characters ADD COLUMN portrait_url TEXT");
    }
    if (!bnCols.some((c) => c.name === "level")) {
      db.exec("ALTER TABLE battle_net_characters ADD COLUMN level INTEGER DEFAULT 1");
    }
    if (!bnCols.some((c) => c.name === "race")) {
      db.exec("ALTER TABLE battle_net_characters ADD COLUMN race TEXT DEFAULT 'Unknown'");
    }
    if (!bnCols.some((c) => c.name === "guild_name")) {
      db.exec("ALTER TABLE battle_net_characters ADD COLUMN guild_name TEXT");
    }
    if (!bnCols.some((c) => c.name === "guild_rank")) {
      db.exec("ALTER TABLE battle_net_characters ADD COLUMN guild_rank TEXT");
    }
    if (!bnCols.some((c) => c.name === "guild_rank_index")) {
      db.exec("ALTER TABLE battle_net_characters ADD COLUMN guild_rank_index INTEGER");
    }
  } catch {
    // Column may already exist
  }

  // Migration: add raid_role, raid_lead, raid_assist to raider_roster
  try {
    const rrCols = db.prepare("PRAGMA table_info(raider_roster)").all() as Array<{ name: string }>;
    if (!rrCols.some((c) => c.name === "raid_role")) {
      db.exec("ALTER TABLE raider_roster ADD COLUMN raid_role TEXT");
    }
    if (!rrCols.some((c) => c.name === "raid_lead")) {
      db.exec("ALTER TABLE raider_roster ADD COLUMN raid_lead INTEGER NOT NULL DEFAULT 0");
    }
    if (!rrCols.some((c) => c.name === "raid_assist")) {
      db.exec("ALTER TABLE raider_roster ADD COLUMN raid_assist INTEGER NOT NULL DEFAULT 0");
    }
    if (!rrCols.some((c) => c.name === "availability")) {
      db.exec("ALTER TABLE raider_roster ADD COLUMN availability TEXT DEFAULT '0000000'");
    }
    if (!rrCols.some((c) => c.name === "officer_notes")) {
      db.exec("ALTER TABLE raider_roster ADD COLUMN officer_notes TEXT");
    }
    if (!rrCols.some((c) => c.name === "notes_public")) {
      db.exec("ALTER TABLE raider_roster ADD COLUMN notes_public INTEGER NOT NULL DEFAULT 0");
    }
    if (!rrCols.some((c) => c.name === "secondary_spec")) {
      db.exec("ALTER TABLE raider_roster ADD COLUMN secondary_spec TEXT");
    }
  } catch {
    // Column may already exist
  }

  // One-time migration: clear all availability for everyone
  try {
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)");
    const applied = db.prepare("SELECT 1 FROM _migrations WHERE name = 'clear_all_availability'").get();
    if (!applied) {
      db.prepare("UPDATE raider_roster SET availability = '0000000'").run();
      db.prepare("INSERT INTO _migrations (name) VALUES ('clear_all_availability')").run();
    }
  } catch {
    /* ignore */
  }

  // Migration: add availability_status to saved_raid_slots
  try {
    const slotCols = db.prepare("PRAGMA table_info(saved_raid_slots)").all() as Array<{ name: string }>;
    if (!slotCols.some((c) => c.name === "availability_status")) {
      db.exec("ALTER TABLE saved_raid_slots ADD COLUMN availability_status TEXT DEFAULT 'pending'");
    }
  } catch {
    /* ignore */
  }

  // Migrate: drop old admin_overrides table if it exists
  try {
    db.exec("DROP TABLE IF EXISTS admin_overrides");
  } catch {
    /* ignore */
  }

  // Web admins (separate login for site administration)
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminUsername && adminPassword) {
    try {
      const hash = bcrypt.hashSync(adminPassword, 10);
      db.prepare("INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES (?, ?)").run(adminUsername, hash);
    } catch {
      /* ignore - admin may already exist */
    }
  }

  // Character permission overrides (per-character, per-guild)
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_character_overrides (
      guild_realm_slug TEXT NOT NULL,
      guild_name TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      character_name TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      PRIMARY KEY (guild_realm_slug, guild_name, server_type, character_name)
    )
  `);

  // Guild permission config (rank-based access control, per guild)
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_permission_config (
      guild_realm_slug TEXT NOT NULL,
      guild_name TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      config_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (guild_realm_slug, guild_name, server_type)
    )
  `);

  // Migrations: add officer_notes to saved_raids if not present
  try {
    db.exec("ALTER TABLE saved_raids ADD COLUMN officer_notes TEXT");
  } catch {
    /* column may already exist */
  }

  // Migration: add professions to raider_roster (JSON array of profession names)
  try {
    const rrCols = db.prepare("PRAGMA table_info(raider_roster)").all() as Array<{ name: string }>;
    if (!rrCols.some((c) => c.name === "professions")) {
      db.exec("ALTER TABLE raider_roster ADD COLUMN professions TEXT");
    }
  } catch {
    /* column may already exist */
  }

  // Guild profession stars: mark character as "Guild Enchanter", "Guild Alchemist", etc.
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_profession_stars (
      guild_realm_slug TEXT NOT NULL,
      guild_name TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      character_name TEXT NOT NULL,
      profession_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (guild_realm_slug, guild_name, server_type, character_name, profession_type)
    )
  `);

  // Guild crafter roster (TBC Anniversary): manual crafter list when Blizzard API has no professions
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_crafter_roster (
      guild_realm_slug TEXT NOT NULL,
      guild_name TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      character_name TEXT NOT NULL,
      professions TEXT,
      profession_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (guild_realm_slug, guild_name, server_type, character_name)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_guild_crafter_roster_lookup ON guild_crafter_roster(guild_realm_slug, guild_name, server_type)");

  // Guild member professions: per (member, profession) with notes and level
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_member_professions (
      guild_realm_slug TEXT NOT NULL,
      guild_name TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      character_name TEXT NOT NULL,
      profession_type TEXT NOT NULL,
      notes TEXT,
      profession_level INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (guild_realm_slug, guild_name, server_type, character_name, profession_type)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_guild_member_professions_lookup ON guild_member_professions(guild_realm_slug, guild_name, server_type)");

  // Migration: add profession_level to guild_member_professions
  try {
    const gmpCols = db.prepare("PRAGMA table_info(guild_member_professions)").all() as Array<{ name: string }>;
    if (!gmpCols.some((c) => c.name === "profession_level")) {
      db.exec("ALTER TABLE guild_member_professions ADD COLUMN profession_level INTEGER");
    }
  } catch {
    /* ignore */
  }

  // Migration: populate guild_member_professions from guild_profession_stars and guild_crafter_roster (fresh DBs only)
  try {
    const count = (db.prepare("SELECT COUNT(*) as n FROM guild_member_professions").get() as { n: number }).n;
    if (count === 0) {
      const ins = db.prepare(
        `INSERT OR IGNORE INTO guild_member_professions (guild_realm_slug, guild_name, server_type, character_name, profession_type, notes, profession_level)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`
      );
      const roster = db.prepare(
        `SELECT guild_realm_slug, guild_name, server_type, character_name, professions, profession_notes
         FROM guild_crafter_roster`
      ).all() as Array<{ guild_realm_slug: string; guild_name: string; server_type: string; character_name: string; professions: string | null; profession_notes: string | null }>;
      for (const r of roster) {
        let profs: string[] = [];
        try {
          if (r.professions) profs = JSON.parse(r.professions) as string[];
        } catch {
          /* ignore */
        }
        const notes = (r.profession_notes || "").trim() || null;
        for (let i = 0; i < profs.length; i++) {
          ins.run(r.guild_realm_slug, r.guild_name, r.server_type, r.character_name, profs[i], i === 0 ? notes : null, null);
        }
      }
      const stars = db.prepare(
        `SELECT guild_realm_slug, guild_name, server_type, character_name, profession_type FROM guild_profession_stars`
      ).all() as Array<{ guild_realm_slug: string; guild_name: string; server_type: string; character_name: string; profession_type: string }>;
      for (const s of stars) {
        ins.run(s.guild_realm_slug, s.guild_name, s.server_type, s.character_name, s.profession_type, null);
      }
    }
  } catch {
    /* migration is best-effort */
  }

  // Character recipes: which raid-support recipes a character has (for search/filter)
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_realm_slug TEXT NOT NULL,
      guild_name TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'Retail',
      character_name TEXT NOT NULL,
      recipe_name TEXT NOT NULL,
      profession TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_realm_slug, guild_name, server_type, character_name, recipe_name)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_character_recipes_lookup ON character_recipes(guild_realm_slug, guild_name, server_type)");

  // User preferences (game version, favorite guilds)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pref_key TEXT NOT NULL,
      pref_value TEXT,
      PRIMARY KEY (user_id, pref_key)
    )
  `);

  db.close();
  console.log("Database initialized at", dbPath);
}
