import { Router } from "express";
import { getDb } from "../db/init.js";
import { requireAuth } from "../middleware/auth.js";
import { fetchGuildRoster } from "../services/blizzard.js";
import { paramStr } from "../utils.js";

export const guildRoutes = Router();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// List guilds for current user
guildRoutes.get("/", requireAuth, (req, res) => {
  const db = getDb();
  const guilds = db
    .prepare(
      `SELECT g.*, gm.is_leader
       FROM guilds g
       JOIN guild_members gm ON g.id = gm.guild_id
       WHERE gm.user_id = ?
       ORDER BY g.name`
    )
    .all(req.session!.user!.id) as Array<{
    id: number;
    name: string;
    server: string;
    is_leader: number;
    created_at: string;
  }>;
  res.json({ guilds });
});

const VALID_SERVER_TYPES = ["Retail", "Classic Era", "TBC Anniversary", "MOP Classic"];

// Create guild (leader only)
guildRoutes.post("/", requireAuth, (req, res) => {
  const { name, server, server_type = "Retail" } = req.body;
  if (!name || !server) {
    res.status(400).json({ error: "Guild name and server required" });
    return;
  }
  if (!VALID_SERVER_TYPES.includes(server_type)) {
    res.status(400).json({ error: "Invalid server type" });
    return;
  }

  const db = getDb();
  let joinCode = generateCode();
  while (db.prepare("SELECT 1 FROM guilds WHERE join_code = ?").get(joinCode)) {
    joinCode = generateCode();
  }
  const result = db
    .prepare("INSERT INTO guilds (name, server, server_type, join_code) VALUES (?, ?, ?, ?)")
    .run(name, server, server_type, joinCode);
  const guildId = result.lastInsertRowid as number;
  db.prepare(
    "INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 1)"
  ).run(guildId, req.session!.user!.id);

  const guild = db.prepare("SELECT * FROM guilds WHERE id = ?").get(guildId) as Record<string, unknown>;
  res.status(201).json({ guild: { ...guild } });
});

// Join guild by code
guildRoutes.post("/join", requireAuth, (req, res) => {
  const { join_code } = req.body;
  if (!join_code) {
    res.status(400).json({ error: "Join code required" });
    return;
  }

  const db = getDb();
  const guild = db
    .prepare("SELECT id FROM guilds WHERE join_code = ?")
    .get(join_code.toUpperCase()) as { id: number } | undefined;
  if (!guild) {
    res.status(404).json({ error: "Invalid join code" });
    return;
  }

  try {
    db.prepare(
      "INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 0)"
    ).run(guild.id, req.session!.user!.id);
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(400).json({ error: "Already a member of this guild" });
      return;
    }
    throw e;
  }

  const fullGuild = db.prepare("SELECT * FROM guilds WHERE id = ?").get(guild.id);
  res.json({ guild: fullGuild });
});

// Import guild from addon export (paste JSON from RaidKeep addon)
guildRoutes.post("/import-export", requireAuth, async (req, res) => {
  const { region = "us", export: exportData } = req.body;

  let parsed: { guild_name?: string; realm?: string; server_type?: string; members?: Array<{ name: string; class: string; level?: number; role?: string }> };
  if (typeof exportData === "string") {
    try {
      parsed = JSON.parse(exportData) as typeof parsed;
    } catch {
      res.status(400).json({ error: "Invalid JSON export. Paste the full export from the RaidKeep addon." });
      return;
    }
  } else if (typeof exportData === "object" && exportData) {
    parsed = exportData;
  } else {
    res.status(400).json({ error: "Export data required. Paste the JSON from /raidkeep in-game." });
    return;
  }

  const guildName = parsed.guild_name?.trim();
  const realm = parsed.realm?.trim();
  const serverType = parsed.server_type || "Retail";
  const members = Array.isArray(parsed.members) ? parsed.members : [];

  if (!guildName || !realm) {
    res.status(400).json({ error: "Export must include guild_name and realm." });
    return;
  }
  if (!VALID_SERVER_TYPES.includes(serverType)) {
    res.status(400).json({ error: "Invalid server_type. Use: Retail, Classic Era, TBC Anniversary, MOP Classic" });
    return;
  }

  const validRegions = ["us", "eu", "kr", "tw"];
  const regionLower = String(region).toLowerCase();
  if (!validRegions.includes(regionLower)) {
    res.status(400).json({ error: "region must be us, eu, kr, or tw" });
    return;
  }

  const db = getDb();
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const existing = db
    .prepare("SELECT id, join_code FROM guilds WHERE name = ? AND server = ? AND server_type = ?")
    .get(guildName, realmSlug, serverType) as { id: number; join_code: string } | undefined;

  let guildId: number;
  let joinCode: string;

  if (existing) {
    guildId = existing.id;
    joinCode = existing.join_code ?? "";
    const memberExists = db
      .prepare("SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?")
      .get(guildId, req.session!.user!.id);
    if (!memberExists) {
      db.prepare("INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 1)").run(
        guildId,
        req.session!.user!.id
      );
    }
  } else {
    let code = generateCode();
    while (db.prepare("SELECT 1 FROM guilds WHERE join_code = ?").get(code)) {
      code = generateCode();
    }
    joinCode = code;
    const result = db
      .prepare("INSERT INTO guilds (name, server, server_type, join_code) VALUES (?, ?, ?, ?)")
      .run(guildName, realmSlug, serverType, joinCode);
    guildId = result.lastInsertRowid as number;
    db.prepare("INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 1)").run(
      guildId,
      req.session!.user!.id
    );
  }

  const insertChar = db.prepare(
    `INSERT OR IGNORE INTO characters (guild_id, name, class, role, user_id) VALUES (?, ?, ?, ?, NULL)`
  );
  let imported = 0;
  for (const m of members) {
    const name = String(m.name || "").trim();
    const cls = String(m.class || "Unknown").trim();
    const role = ["tank", "healer", "dps"].includes(String(m.role || "").toLowerCase())
      ? (m.role as string).toLowerCase()
      : "dps";
    if (name) {
      const r = insertChar.run(guildId, name, cls, role);
      if (r.changes > 0) imported++;
    }
  }

  const guild = db.prepare("SELECT * FROM guilds WHERE id = ?").get(guildId) as Record<string, unknown>;
  res.status(201).json({
    guild: { ...guild },
    imported,
    message: `Imported ${imported} characters from ${guildName}`,
  });
});

// Import guild from Blizzard API
guildRoutes.post("/import", requireAuth, async (req, res) => {
  const { region, realm, guild_name, server_type = "Retail" } = req.body;
  if (!region || !realm || !guild_name) {
    res.status(400).json({ error: "region, realm, and guild_name required" });
    return;
  }
  if (!VALID_SERVER_TYPES.includes(server_type)) {
    res.status(400).json({ error: "Invalid server type" });
    return;
  }
  const validRegions = ["us", "eu", "kr", "tw"];
  if (!validRegions.includes(region.toLowerCase())) {
    res.status(400).json({ error: "region must be us, eu, kr, or tw" });
    return;
  }

  try {
    const roster = await fetchGuildRoster(
      region,
      realm,
      guild_name,
      server_type
    );

    const db = getDb();
    const existing = db.prepare(
      "SELECT id FROM guilds WHERE name = ? AND server = ?"
    ).get(roster.name, roster.realm) as { id: number } | undefined;

    let guildId: number;
    let joinCode: string;

    if (existing) {
      guildId = existing.id;
      const g = db.prepare("SELECT join_code FROM guilds WHERE id = ?").get(existing.id) as { join_code: string } | undefined;
      joinCode = g?.join_code ?? "";
      const memberExists = db.prepare(
        "SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?"
      ).get(guildId, req.session!.user!.id);
      if (!memberExists) {
        db.prepare(
          "INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 1)"
        ).run(guildId, req.session!.user!.id);
      }
    } else {
      let code = generateCode();
      while (db.prepare("SELECT 1 FROM guilds WHERE join_code = ?").get(code)) {
        code = generateCode();
      }
      joinCode = code;
      const result = db
        .prepare("INSERT INTO guilds (name, server, server_type, join_code) VALUES (?, ?, ?, ?)")
        .run(roster.name, roster.realm, server_type, joinCode);
      guildId = result.lastInsertRowid as number;
      db.prepare(
        "INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 1)"
      ).run(guildId, req.session!.user!.id);
    }

    const insertChar = db.prepare(
      `INSERT OR IGNORE INTO characters (guild_id, name, class, role, user_id)
       VALUES (?, ?, ?, ?, NULL)`
    );
    for (const m of roster.members) {
      insertChar.run(guildId, m.name, m.class, m.role);
    }

    const guild = db.prepare("SELECT * FROM guilds WHERE id = ?").get(guildId) as Record<string, unknown>;
    res.status(201).json({
      guild: { ...guild },
      imported: roster.members.length,
      message: `Imported ${roster.members.length} characters from ${roster.name}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Blizzard API error";
    res.status(502).json({ error: `Failed to fetch guild: ${message}` });
  }
});

function isLeader(db: ReturnType<typeof import("better-sqlite3")>, guildId: number, userId: number) {
  const m = db.prepare("SELECT is_leader FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId) as { is_leader: number } | undefined;
  return m?.is_leader === 1;
}

// List guild members (leader only)
guildRoutes.get("/:id/members", requireAuth, (req, res) => {
  const guildId = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  if (!isLeader(db, guildId, req.session!.user!.id)) {
    res.status(403).json({ error: "Leader access required" });
    return;
  }
  const members = db
    .prepare(
      `SELECT gm.user_id, gm.is_leader, u.username,
        (SELECT COUNT(*) FROM characters c WHERE c.guild_id = gm.guild_id AND c.user_id = gm.user_id) as character_count
       FROM guild_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.guild_id = ?
       ORDER BY gm.is_leader DESC, u.username`
    )
    .all(guildId);
  res.json({ members });
});

// Remove guild member (leader only; cannot remove self if last leader)
guildRoutes.delete("/:id/members/:userId", requireAuth, (req, res) => {
  const guildId = parseInt(paramStr(req.params.id), 10);
  const targetUserId = parseInt(paramStr(req.params.userId), 10);
  const db = getDb();
  if (!isLeader(db, guildId, req.session!.user!.id)) {
    res.status(403).json({ error: "Leader access required" });
    return;
  }
  if (targetUserId === req.session!.user!.id) {
    res.status(400).json({ error: "Use leave guild to remove yourself" });
    return;
  }
  const member = db.prepare("SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, targetUserId);
  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  db.prepare("UPDATE characters SET user_id = NULL WHERE guild_id = ? AND user_id = ?").run(guildId, targetUserId);
  db.prepare("DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?").run(guildId, targetUserId);
  res.json({ ok: true });
});

// Leave guild (member removes self)
guildRoutes.post("/:id/leave", requireAuth, (req, res) => {
  const guildId = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  const member = db.prepare("SELECT is_leader FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, req.session!.user!.id) as { is_leader: number } | undefined;
  if (!member) {
    res.status(404).json({ error: "Not a member of this guild" });
    return;
  }
  if (member.is_leader === 1) {
    const leaderCount = db.prepare("SELECT COUNT(*) as n FROM guild_members WHERE guild_id = ? AND is_leader = 1").get(guildId) as { n: number };
    if (leaderCount.n <= 1) {
      res.status(400).json({ error: "Promote another leader before leaving, or delete the guild" });
      return;
    }
  }
  db.prepare("UPDATE characters SET user_id = NULL WHERE guild_id = ? AND user_id = ?").run(guildId, req.session!.user!.id);
  db.prepare("DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?").run(guildId, req.session!.user!.id);
  res.json({ ok: true });
});

// Get single guild (must be member)
guildRoutes.get("/:id", requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare(
    `SELECT g.*, gm.is_leader FROM guilds g
     JOIN guild_members gm ON g.id = gm.guild_id
     WHERE g.id = ? AND gm.user_id = ?`
  ).get(parseInt(paramStr(req.params.id), 10), req.session!.user!.id);
  if (!row) {
    res.status(404).json({ error: "Guild not found" });
    return;
  }
  res.json({ guild: row });
});
