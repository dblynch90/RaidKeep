import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { getDb } from "../db/init.js";
import { fetchGuildRoster } from "../services/blizzard.js";

export const adminRoutes = Router();

export function requireAdmin(req: Request, res: Response, next: () => void) {
  const session = req.session as { adminId?: number };
  if (!session?.adminId) {
    res.status(401).json({ error: "Admin login required" });
    return;
  }
  next();
}

function getOrCreateUserIdForGuild(db: ReturnType<typeof getDb>, realmSlug: string, guildName: string, serverType: string): number {
  let uid = (db.prepare("SELECT user_id FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? LIMIT 1")
    .get(realmSlug, guildName, serverType) as { user_id: number } | undefined)?.user_id;
  if (!uid) {
    uid = (db.prepare("SELECT user_id FROM raid_teams WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? LIMIT 1")
      .get(realmSlug, guildName, serverType) as { user_id: number } | undefined)?.user_id;
  }
  if (!uid) {
    uid = (db.prepare("SELECT user_id FROM saved_raids WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? LIMIT 1")
      .get(realmSlug, guildName, serverType) as { user_id: number } | undefined)?.user_id;
  }
  if (!uid) {
    const guildRow = db.prepare("SELECT id FROM guilds WHERE name = ? AND server = ? AND server_type = ? LIMIT 1")
      .get(guildName, realmSlug, serverType) as { id: number } | undefined;
    if (guildRow) {
      uid = (db.prepare("SELECT user_id FROM guild_members WHERE guild_id = ? LIMIT 1").get(guildRow.id) as { user_id: number } | undefined)?.user_id;
    }
  }
  if (!uid) {
    uid = (db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number } | undefined)?.id ?? 1;
  }
  return uid;
}

adminRoutes.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  const db = getDb();
  const admin = db.prepare("SELECT id, username, password_hash FROM admin_users WHERE username = ?").get(username) as
    | { id: number; username: string; password_hash: string }
    | undefined;
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  (req.session as { adminId?: number }).adminId = admin.id;
  res.json({ ok: true, username: admin.username });
});

adminRoutes.post("/logout", (req, res) => {
  (req.session as { adminId?: number }).adminId = undefined;
  res.json({ ok: true });
});

adminRoutes.get("/me", requireAdmin, (req, res) => {
  const session = req.session as { adminId?: number };
  const db = getDb();
  const admin = db.prepare("SELECT id, username FROM admin_users WHERE id = ?").get(session.adminId) as
    | { id: number; username: string }
    | undefined;
  if (!admin) {
    (req.session as { adminId?: number }).adminId = undefined;
    res.status(401).json({ error: "Admin session invalid" });
    return;
  }
  res.json({ id: admin.id, username: admin.username });
});

function capitalizeRealm(s: string): string {
  if (!s) return "";
  return s
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

adminRoutes.get("/users", requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare(
    `SELECT id, username, role, battlenet_id, battlenet_battletag, created_at FROM users ORDER BY id`
  ).all() as Array<{ id: number; username: string; role: string; battlenet_id: string | null; battlenet_battletag: string | null; created_at: string }>;
  const prefs = db.prepare(
    `SELECT user_id, pref_value FROM user_preferences WHERE pref_key = 'game_version'`
  ).all() as Array<{ user_id: number; pref_value: string | null }>;
  const gameVersionByUser = new Map(prefs.map((p) => [p.user_id, p.pref_value || null]));
  const usersWithPrefs = users.map((u) => ({
    ...u,
    game_version: gameVersionByUser.get(u.id) ?? null,
  }));
  res.json({ users: usersWithPrefs });
});

adminRoutes.delete("/users/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

adminRoutes.get("/guilds", requireAdmin, (req, res) => {
  const db = getDb();
  const guilds = new Map<string, { guild_name: string; realm_slug: string; realm_display: string; server_type: string }>();
  const add = (name: string, realm: string, serverType: string) => {
    const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
    const key = `${realmSlug}|${name}|${serverType}`;
    if (!guilds.has(key)) {
      guilds.set(key, {
        guild_name: name,
        realm_slug: realmSlug,
        realm_display: capitalizeRealm(realmSlug),
        server_type: serverType || "Retail",
      });
    }
  };
  const fromGuilds = db.prepare("SELECT name, server, server_type FROM guilds").all() as Array<{ name: string; server: string; server_type: string }>;
  for (const g of fromGuilds) {
    add(g.name, g.server, g.server_type || "Retail");
  }
  const fromRoster = db.prepare("SELECT DISTINCT guild_name, guild_realm_slug, server_type FROM raider_roster").all() as Array<{
    guild_name: string;
    guild_realm_slug: string;
    server_type: string;
  }>;
  for (const r of fromRoster) {
    add(r.guild_name, r.guild_realm_slug.replace(/-/g, " "), r.server_type || "Retail");
  }
  const fromTeams = db.prepare("SELECT DISTINCT guild_name, guild_realm_slug, server_type FROM raid_teams").all() as Array<{
    guild_name: string;
    guild_realm_slug: string;
    server_type: string;
  }>;
  for (const t of fromTeams) {
    add(t.guild_name, t.guild_realm_slug.replace(/-/g, " "), t.server_type || "Retail");
  }
  const fromSavedRaids = db.prepare("SELECT DISTINCT guild_name, guild_realm_slug, server_type FROM saved_raids").all() as Array<{
    guild_name: string;
    guild_realm_slug: string;
    server_type: string;
  }>;
  for (const s of fromSavedRaids) {
    add(s.guild_name, s.guild_realm_slug.replace(/-/g, " "), s.server_type || "Retail");
  }
  const fromPermConfig = db.prepare("SELECT DISTINCT guild_name, guild_realm_slug, server_type FROM guild_permission_config").all() as Array<{
    guild_name: string;
    guild_realm_slug: string;
    server_type: string;
  }>;
  for (const p of fromPermConfig) {
    add(p.guild_name, p.guild_realm_slug.replace(/-/g, " "), p.server_type || "Retail");
  }
  const list = Array.from(guilds.values()).sort((a, b) => {
    const c = a.guild_name.localeCompare(b.guild_name);
    if (c !== 0) return c;
    return a.realm_slug.localeCompare(b.realm_slug);
  });
  res.json({ guilds: list });
});

adminRoutes.get("/guild/:realmSlug/:guildName/permissions", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realmSlug || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const row = db.prepare(
    "SELECT config_json FROM guild_permission_config WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).get(realmSlug, guildName, serverType) as { config_json: string } | undefined;
  const charOverrides = db.prepare(
    `SELECT character_name, permissions_json FROM guild_character_overrides
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? ORDER BY character_name`
  ).all(realmSlug, guildName, serverType) as Array<{ character_name: string; permissions_json: string }>;
  const defaultConfig: Record<string, Record<string, boolean>> = {};
  for (let i = 0; i <= 9; i++) {
    defaultConfig[`rank_${i}`] = {
      view_guild_dashboard: true,
      view_guild_roster: true,
      view_raid_roster: true,
      view_raid_schedule: true,
      manage_raids: i <= 3,
      manage_raid_roster: i <= 3,
      manage_permissions: i === 0,
      manage_guild_crafters: i <= 3,
    };
  }
  let config = { ...defaultConfig };
  if (row?.config_json) {
    try {
      const stored = JSON.parse(row.config_json) as Record<string, Record<string, boolean>>;
      for (const k of Object.keys(stored)) {
        if (config[k]) config[k] = { ...config[k], ...stored[k] };
      }
    } catch {
      /* ignore */
    }
  }
  const character_overrides = charOverrides.map((o) => {
    let perms: Record<string, boolean> = {};
    try {
      perms = JSON.parse(o.permissions_json) as Record<string, boolean>;
    } catch {
      /* ignore */
    }
    return { character_name: o.character_name, permissions: perms };
  });
  res.json({ config, character_overrides });
});

const PERMISSION_KEYS = [
  "view_guild_dashboard",
  "view_guild_roster",
  "view_raid_roster",
  "view_raid_schedule",
  "manage_raids",
  "manage_raid_roster",
  "manage_permissions",
];

adminRoutes.put("/guild/:realmSlug/:guildName/permissions", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.body.server_type as string) || "Retail";
  const { config } = req.body;
  if (!realmSlug || !guildName || !config || typeof config !== "object") {
    res.status(400).json({ error: "realm, guild_name, and config required" });
    return;
  }
  const db = getDb();
  const sanitized: Record<string, Record<string, boolean>> = {};
  for (const rankKey of Object.keys(config)) {
    if (!/^rank_\d+$/.test(rankKey)) continue;
    const perms = (config as Record<string, Record<string, boolean>>)[rankKey];
    if (!perms || typeof perms !== "object") continue;
    sanitized[rankKey] = {};
    for (const pk of PERMISSION_KEYS) {
      if (typeof perms[pk] === "boolean") sanitized[rankKey][pk] = perms[pk];
    }
  }
  db.prepare(
    `INSERT OR REPLACE INTO guild_permission_config (guild_realm_slug, guild_name, server_type, config_json, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(realmSlug, guildName, serverType, JSON.stringify(sanitized));
  res.json({ ok: true });
});

adminRoutes.put("/guild/:realmSlug/:guildName/character-overrides", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.body.server_type as string) || "Retail";
  const { character_name, permissions } = req.body;
  if (!realmSlug || !guildName || !character_name || typeof character_name !== "string") {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const db = getDb();
  const charName = String(character_name).trim();
  const sanitized: Record<string, boolean> = {};
  const permsObj = permissions && typeof permissions === "object" ? permissions : {};
  for (const pk of PERMISSION_KEYS) {
    if (typeof permsObj[pk] === "boolean") sanitized[pk] = permsObj[pk];
  }
  db.prepare(
    `INSERT OR REPLACE INTO guild_character_overrides (guild_realm_slug, guild_name, server_type, character_name, permissions_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(realmSlug, guildName, serverType, charName, JSON.stringify(sanitized));
  res.json({ ok: true });
});

adminRoutes.delete("/guild/:realmSlug/:guildName/character-overrides/:charName", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const charName = decodeURIComponent((req.params.charName as string) || "");
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realmSlug || !guildName || !charName) {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const db = getDb();
  db.prepare(
    `DELETE FROM guild_character_overrides
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).run(realmSlug, guildName, serverType, charName);
  res.json({ ok: true });
});

adminRoutes.get("/guild/:realmSlug/:guildName/raids", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realmSlug || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const raids = db
    .prepare(
      `SELECT sr.* FROM saved_raids sr
       WHERE sr.guild_realm_slug = ? AND sr.guild_name = ? AND sr.server_type = ?
       ORDER BY sr.raid_date DESC, sr.start_time`
    )
    .all(realmSlug, guildName, serverType);
  res.json({ raids });
});

adminRoutes.post("/guild/:realmSlug/:guildName/raids", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.body.server_type as string) || "Retail";
  const { raid_name, raid_instance, raid_date, start_time, finish_time } = req.body;
  if (!realmSlug || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const raidName = typeof raid_name === "string" && raid_name.trim() ? raid_name.trim() : "New Raid";
  const raidDate = typeof raid_date === "string" && raid_date.trim() ? raid_date.trim() : new Date().toISOString().slice(0, 10);
  const db = getDb();
  const uid = getOrCreateUserIdForGuild(db, realmSlug, guildName, serverType);
  db.prepare(
    `INSERT INTO saved_raids (user_id, guild_name, guild_realm, guild_realm_slug, server_type, raid_name, raid_instance, raid_date, start_time, finish_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid,
    guildName,
    realmSlug.replace(/-/g, " "),
    realmSlug,
    serverType,
    raidName,
    typeof raid_instance === "string" ? raid_instance.trim() || null : null,
    raidDate,
    typeof start_time === "string" ? start_time.trim() || null : null,
    typeof finish_time === "string" ? finish_time.trim() || null : null
  );
  res.status(201).json({ ok: true });
});

adminRoutes.put("/guild/:realmSlug/:guildName/raids/:raidId", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const raidId = parseInt(req.params.raidId as string, 10);
  const serverType = (req.body.server_type as string) || "Retail";
  const { raid_name, raid_instance, raid_date, start_time, finish_time } = req.body;
  if (!realmSlug || !guildName || !Number.isFinite(raidId)) {
    res.status(400).json({ error: "realm, guild_name, and raidId required" });
    return;
  }
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM saved_raids WHERE id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).get(raidId, realmSlug, guildName, serverType);
  if (!existing) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof raid_name === "string" && raid_name.trim()) {
    updates.push("raid_name = ?");
    values.push(raid_name.trim());
  }
  if (typeof raid_instance === "string") {
    updates.push("raid_instance = ?");
    values.push(raid_instance.trim() || null);
  }
  if (typeof raid_date === "string" && raid_date.trim()) {
    updates.push("raid_date = ?");
    values.push(raid_date.trim());
  }
  if (typeof start_time === "string") {
    updates.push("start_time = ?");
    values.push(start_time?.trim() || null);
  }
  if (typeof finish_time === "string") {
    updates.push("finish_time = ?");
    values.push(finish_time?.trim() || null);
  }
  if (updates.length === 0) {
    res.json({ ok: true });
    return;
  }
  values.push(raidId);
  db.prepare(`UPDATE saved_raids SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

adminRoutes.delete("/guild/:realmSlug/:guildName/raids/:raidId", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const raidId = parseInt(req.params.raidId as string, 10);
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realmSlug || !guildName || !Number.isFinite(raidId)) {
    res.status(400).json({ error: "realm, guild_name, and raidId required" });
    return;
  }
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM saved_raids WHERE id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).get(raidId, realmSlug, guildName, serverType);
  if (!existing) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  db.prepare("DELETE FROM saved_raids WHERE id = ?").run(raidId);
  res.json({ ok: true });
});

const PROFESSION_TYPES = [
  "Alchemy",
  "Blacksmithing",
  "Enchanting",
  "Engineering",
  "Herbalism",
  "Inscription",
  "Jewelcrafting",
  "Leatherworking",
  "Mining",
  "Skinning",
  "Tailoring",
] as const;

adminRoutes.get("/guild/:realmSlug/:guildName/roster", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realmSlug || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const roster = db
    .prepare(
      `SELECT * FROM raider_roster
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
       ORDER BY character_name`
    )
    .all(realmSlug, guildName, serverType);
  const stars = db
    .prepare(
      `SELECT character_name, profession_type FROM guild_profession_stars
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?`
    )
    .all(realmSlug, guildName, serverType) as Array<{ character_name: string; profession_type: string }>;
  const starsByChar = new Map<string, string[]>();
  for (const s of stars) {
    const key = s.character_name.toLowerCase();
    if (!starsByChar.has(key)) starsByChar.set(key, []);
    starsByChar.get(key)!.push(s.profession_type);
  }
  const rosterWithStars = (roster as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    guild_profession_stars: starsByChar.get((r.character_name as string).toLowerCase()) ?? [],
  }));
  res.json({ roster: rosterWithStars, profession_types: [...PROFESSION_TYPES] });
});

adminRoutes.post("/guild/:realmSlug/:guildName/roster/sync", requireAdmin, async (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.query.server_type as string) || "Retail";
  const region = (req.query.region as string) || process.env.ADMIN_BLIZZARD_REGION || "us";
  if (!realmSlug || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  try {
    const roster = await fetchGuildRoster(region, realmSlug, guildName, serverType);
    const db = getDb();
    const uid = getOrCreateUserIdForGuild(db, realmSlug, guildName, serverType);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO raider_roster (user_id, guild_name, guild_realm_slug, server_type, character_name, character_class, primary_spec, off_spec, notes, officer_notes, raid_role, raid_lead, raid_assist, availability)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT primary_spec FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)), NULL),
         COALESCE((SELECT off_spec FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)), NULL),
         COALESCE((SELECT notes FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)), NULL),
         COALESCE((SELECT officer_notes FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)), NULL),
         COALESCE((SELECT raid_role FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)), NULL),
         COALESCE((SELECT raid_lead FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)), 0),
         COALESCE((SELECT raid_assist FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)), 0),
         COALESCE((SELECT availability FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)), '0000000')
       )`
    );
    // Simpler: use upsert with INSERT ... ON CONFLICT or check-then-insert/update
    let added = 0;
    let updated = 0;
    for (const m of roster.members) {
      const existing = db.prepare(
        "SELECT id FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)"
      ).get(realmSlug, guildName, serverType, m.name);
      if (existing) {
        db.prepare(
          `UPDATE raider_roster SET character_class = ? WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
        ).run(m.class || "Unknown", realmSlug, guildName, serverType, m.name);
        updated++;
      } else {
        db.prepare(
          `INSERT INTO raider_roster (user_id, guild_name, guild_realm_slug, server_type, character_name, character_class, primary_spec, off_spec, notes, officer_notes, raid_role, raid_lead, raid_assist, availability)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(uid, guildName, realmSlug, serverType, m.name, m.class || "Unknown", null, null, null, null, null, 0, 0, "0000000");
        added++;
      }
    }
    res.json({ ok: true, added, updated, total: roster.members.length });
  } catch (err) {
    console.error("[admin roster sync]", err);
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to sync roster from Blizzard",
    });
  }
});

adminRoutes.post("/guild/:realmSlug/:guildName/roster", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.body.server_type as string) || "Retail";
  const { character_name, character_class, primary_spec, off_spec, notes, officer_notes, raid_role, raid_lead, raid_assist } = req.body;
  if (!realmSlug || !guildName || !character_name || typeof character_name !== "string") {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const db = getDb();
  const charName = String(character_name).trim();
  const existing = db.prepare(
    "SELECT id FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)"
  ).get(realmSlug, guildName, serverType, charName);
  if (existing) {
    res.status(400).json({ error: "Character already in roster" });
    return;
  }
  const uid = getOrCreateUserIdForGuild(db, realmSlug, guildName, serverType);
  const availability = typeof (req.body as { availability?: string }).availability === "string"
    ? String((req.body as { availability: string }).availability).slice(0, 7).padEnd(7, "0").replace(/[^01]/g, "0")
    : "0000000";
  db.prepare(
    `INSERT INTO raider_roster (user_id, guild_name, guild_realm_slug, server_type, character_name, character_class, primary_spec, off_spec, notes, officer_notes, raid_role, raid_lead, raid_assist, availability)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid,
    guildName,
    realmSlug,
    serverType,
    charName,
    typeof character_class === "string" ? character_class.trim() || "Unknown" : "Unknown",
    typeof primary_spec === "string" ? primary_spec.trim() || null : null,
    typeof off_spec === "string" ? off_spec.trim() || null : null,
    typeof notes === "string" ? notes.trim() || null : null,
    typeof officer_notes === "string" ? officer_notes.trim() || null : null,
    typeof raid_role === "string" ? raid_role.trim() || null : null,
    raid_lead ? 1 : 0,
    raid_assist ? 1 : 0,
    availability
  );
  res.json({ ok: true });
});

adminRoutes.put("/guild/:realmSlug/:guildName/profession-stars/:charName", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const charName = decodeURIComponent((req.params.charName as string) || "");
  const serverType = (req.body.server_type as string) || "Retail";
  const { profession_type, starred } = req.body;
  if (!realmSlug || !guildName || !charName || !profession_type || typeof profession_type !== "string") {
    res.status(400).json({ error: "realm, guild_name, character_name, and profession_type required" });
    return;
  }
  if (!(PROFESSION_TYPES as readonly string[]).includes(profession_type)) {
    res.status(400).json({ error: "Invalid profession_type" });
    return;
  }
  const db = getDb();
  if (starred) {
    db.prepare(
      `INSERT OR IGNORE INTO guild_profession_stars (guild_realm_slug, guild_name, server_type, character_name, profession_type)
       VALUES (?, ?, ?, ?, ?)`
    ).run(realmSlug, guildName, serverType, charName, profession_type);
  } else {
    db.prepare(
      `DELETE FROM guild_profession_stars
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?) AND profession_type = ?`
    ).run(realmSlug, guildName, serverType, charName, profession_type);
  }
  res.json({ ok: true });
});

adminRoutes.get("/guild/:realmSlug/:guildName/recipes", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.query.server_type as string) || "Retail";
  const recipeFilter = (req.query.recipe as string)?.trim();
  if (!realmSlug || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  let rows = db
    .prepare(
      `SELECT character_name, recipe_name, profession FROM character_recipes
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
       ORDER BY recipe_name, character_name`
    )
    .all(realmSlug, guildName, serverType) as Array<{ character_name: string; recipe_name: string; profession: string | null }>;
  if (recipeFilter) {
    const q = recipeFilter.toLowerCase();
    rows = rows.filter((r) => r.recipe_name.toLowerCase().includes(q));
  }
  res.json({ recipes: rows });
});

adminRoutes.put("/guild/:realmSlug/:guildName/recipes", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.body.server_type as string) || "Retail";
  const { character_name, recipe_name, profession, add } = req.body;
  if (!realmSlug || !guildName || !character_name || !recipe_name || typeof character_name !== "string" || typeof recipe_name !== "string") {
    res.status(400).json({ error: "realm, guild_name, character_name, and recipe_name required" });
    return;
  }
  const db = getDb();
  const charName = String(character_name).trim();
  const recipeName = String(recipe_name).trim();
  const prof = typeof profession === "string" ? profession.trim() || null : null;
  if (add) {
    db.prepare(
      `INSERT OR REPLACE INTO character_recipes (guild_realm_slug, guild_name, server_type, character_name, recipe_name, profession)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(realmSlug, guildName, serverType, charName, recipeName, prof);
  } else {
    db.prepare(
      `DELETE FROM character_recipes
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?) AND LOWER(recipe_name) = LOWER(?)`
    ).run(realmSlug, guildName, serverType, charName, recipeName);
  }
  res.json({ ok: true });
});

adminRoutes.put("/guild/:realmSlug/:guildName/roster/:charName", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const charName = decodeURIComponent((req.params.charName as string) || "");
  const serverType = (req.body.server_type as string) || "Retail";
  const { character_class, primary_spec, off_spec, notes, officer_notes, raid_role, raid_lead, raid_assist, availability, professions } = req.body;
  if (!realmSlug || !guildName || !charName) {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)"
  ).get(realmSlug, guildName, serverType, charName);
  if (!existing) {
    res.status(404).json({ error: "Roster entry not found" });
    return;
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof character_class === "string") {
    updates.push("character_class = ?");
    values.push(character_class.trim() || "Unknown");
  }
  if (typeof primary_spec === "string") {
    updates.push("primary_spec = ?");
    values.push(primary_spec.trim() || null);
  }
  if (typeof off_spec === "string") {
    updates.push("off_spec = ?");
    values.push(off_spec.trim() || null);
  }
  if (typeof notes === "string") {
    updates.push("notes = ?");
    values.push(notes.trim() || null);
  }
  if (typeof officer_notes === "string") {
    updates.push("officer_notes = ?");
    values.push(officer_notes.trim() || null);
  }
  if (typeof raid_role === "string") {
    updates.push("raid_role = ?");
    values.push(raid_role.trim() || null);
  }
  if (typeof raid_lead === "boolean" || typeof raid_lead === "number") {
    updates.push("raid_lead = ?");
    values.push(raid_lead ? 1 : 0);
  }
  if (typeof raid_assist === "boolean" || typeof raid_assist === "number") {
    updates.push("raid_assist = ?");
    values.push(raid_assist ? 1 : 0);
  }
  if (typeof availability === "string") {
    const a = availability.slice(0, 7).padEnd(7, "0").replace(/[^01]/g, "0");
    updates.push("availability = ?");
    values.push(a);
  }
  if (professions !== undefined) {
    const val = Array.isArray(professions)
      ? JSON.stringify(professions.filter((p: unknown) => typeof p === "string"))
      : null;
    updates.push("professions = ?");
    values.push(val);
  }
  if (updates.length > 0) {
    values.push(realmSlug, guildName, serverType, charName);
    db.prepare(
      `UPDATE raider_roster SET ${updates.join(", ")} WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
    ).run(...values);
  }
  res.json({ ok: true });
});

adminRoutes.delete("/guild/:realmSlug/:guildName/roster/:charName", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const charName = decodeURIComponent((req.params.charName as string) || "");
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realmSlug || !guildName || !charName) {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const db = getDb();
  db.prepare(
    "DELETE FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)"
  ).run(realmSlug, guildName, serverType, charName);
  res.json({ ok: true });
});

adminRoutes.get("/guild/:realmSlug/:guildName/teams", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realmSlug || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const teams = db
    .prepare(
      `SELECT rt.* FROM raid_teams rt
       WHERE rt.guild_realm_slug = ? AND rt.guild_name = ? AND rt.server_type = ?
       ORDER BY rt.team_name`
    )
    .all(realmSlug, guildName, serverType) as Array<Record<string, unknown>>;
  const teamsWithMembers = teams.map((t) => {
    const members = db.prepare("SELECT * FROM raid_team_members WHERE team_id = ? ORDER BY position, character_name").all(t.id as number);
    return { ...t, members };
  });
  res.json({ teams: teamsWithMembers });
});

adminRoutes.post("/guild/:realmSlug/:guildName/teams", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.body.server_type as string) || "Retail";
  const { team_name } = req.body;
  if (!realmSlug || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const teamName = typeof team_name === "string" && team_name.trim() ? team_name.trim() : "New Team";
  const db = getDb();
  const uid = getOrCreateUserIdForGuild(db, realmSlug, guildName, serverType);
  const result = db.prepare(
    `INSERT INTO raid_teams (user_id, guild_name, guild_realm_slug, server_type, team_name)
     VALUES (?, ?, ?, ?, ?)`
  ).run(uid, guildName, realmSlug, serverType, teamName);
  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

adminRoutes.put("/guild/:realmSlug/:guildName/teams/:teamId", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const teamId = parseInt(req.params.teamId as string, 10);
  const serverType = (req.body.server_type as string) || "Retail";
  const { team_name, members } = req.body;
  if (!realmSlug || !guildName || !Number.isFinite(teamId)) {
    res.status(400).json({ error: "realm, guild_name, and teamId required" });
    return;
  }
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM raid_teams WHERE id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).get(teamId, realmSlug, guildName, serverType);
  if (!existing) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (typeof team_name === "string" && team_name.trim()) {
    db.prepare("UPDATE raid_teams SET team_name = ? WHERE id = ?").run(team_name.trim(), teamId);
  }
  if (Array.isArray(members)) {
    db.prepare("DELETE FROM raid_team_members WHERE team_id = ?").run(teamId);
    const insertMember = db.prepare(
      "INSERT INTO raid_team_members (team_id, character_name, character_class, position) VALUES (?, ?, ?, ?)"
    );
    members.forEach((m: { character_name?: string; character_class?: string }, i: number) => {
      const name = typeof m?.character_name === "string" ? m.character_name.trim() : "";
      if (!name) return;
      const cls = typeof m?.character_class === "string" ? m.character_class.trim() || "Unknown" : "Unknown";
      insertMember.run(teamId, name, cls, i);
    });
  }
  res.json({ ok: true });
});

adminRoutes.delete("/guild/:realmSlug/:guildName/teams/:teamId", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const teamId = parseInt(req.params.teamId as string, 10);
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realmSlug || !guildName || !Number.isFinite(teamId)) {
    res.status(400).json({ error: "realm, guild_name, and teamId required" });
    return;
  }
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM raid_teams WHERE id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).get(teamId, realmSlug, guildName, serverType);
  if (!existing) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  db.prepare("DELETE FROM raid_teams WHERE id = ?").run(teamId);
  res.json({ ok: true });
});

adminRoutes.delete("/guild/:realmSlug/:guildName", requireAdmin, (req, res) => {
  const realmSlug = (req.params.realmSlug as string)?.toLowerCase().replace(/\s+/g, "-");
  const guildName = decodeURIComponent((req.params.guildName as string) || "");
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realmSlug || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const guildRows = db.prepare("SELECT id FROM guilds WHERE name = ? AND server = ? AND server_type = ?")
    .all(guildName, realmSlug, serverType) as Array<{ id: number }>;
  for (const g of guildRows) {
    db.prepare("DELETE FROM guilds WHERE id = ?").run(g.id);
  }
  db.prepare(
    "DELETE FROM raider_roster WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).run(realmSlug, guildName, serverType);
  const teamIds = db.prepare(
    "SELECT id FROM raid_teams WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).all(realmSlug, guildName, serverType) as Array<{ id: number }>;
  for (const t of teamIds) {
    db.prepare("DELETE FROM raid_teams WHERE id = ?").run(t.id);
  }
  db.prepare(
    "DELETE FROM saved_raids WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).run(realmSlug, guildName, serverType);
  db.prepare(
    "DELETE FROM guild_permission_config WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).run(realmSlug, guildName, serverType);
  db.prepare(
    "DELETE FROM guild_character_overrides WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).run(realmSlug, guildName, serverType);
  res.json({ ok: true });
});
