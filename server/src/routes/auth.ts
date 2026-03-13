import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type Database from "better-sqlite3";
import OpenAI from "openai";
import { getDb } from "../db/init.js";
import { requireAuth } from "../middleware/auth.js";
import { paramStr } from "../utils.js";
import { getAuthorizeUrl, exchangeCodeForToken, decodeIdToken, fetchBattleNetUserInfo } from "../services/battlenet-oauth.js";
import { syncGuildsFromBattleNet, syncCharacterGuild } from "../services/battlenet-sync.js";
import { fetchCharacterProfessions, fetchCharacterProfileSummary, fetchGuildRoster } from "../services/blizzard.js";
import { getRaidStatus, type RaidStatus } from "../utils/raidStatus.js";
import { qaMockMiddleware } from "../qa-mock.js";

export const authRoutes = Router();

/** Create a signed OAuth state (survives server restart / no session needed) */
function createSignedState(region: string): string {
  const state = crypto.randomBytes(16).toString("hex");
  const payload = JSON.stringify({ state, region, exp: Date.now() + 10 * 60 * 1000 });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET || "fallback").update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

/** Verify and parse signed state; returns { state, region } or null */
function verifySignedState(signed: string): { state: string; region: string } | null {
  const parts = signed.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET || "fallback").update(encoded).digest("base64url");
  if (sig !== expected) return null;
  let payload: { state: string; region: string; exp: number };
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (Date.now() > payload.exp) return null;
  return { state: payload.state, region: payload.region };
}

function computeSlotCountsAndStatus(
  slots: Array<{ role: string; availability_status: string; party_index?: number }>,
  raid: Record<string, unknown>
): { slot_counts: Record<string, number>; raid_status: RaidStatus } {
  const filled = slots.length;
  const partyCountFromSlots =
    slots.length > 0 ? Math.max(0, ...slots.map((s) => s.party_index ?? -1)) + 1 : 0;
  const storedPartyCount = typeof raid.party_count === "number" ? raid.party_count : null;
  const partyCount = storedPartyCount ?? Math.max(partyCountFromSlots, 2);
  const total = partyCount * 5;
  let tanks = 0,
    healers = 0,
    dps = 0,
    confirmed = 0,
    pending = 0,
    unavailable = 0;
  for (const s of slots) {
    const r = (s.role || "").toLowerCase();
    if (r.includes("tank")) tanks++;
    else if (r.includes("heal")) healers++;
    else dps++;
    const a = s.availability_status || "pending";
    if (a === "confirmed") confirmed++;
    else if (a === "unavailable") unavailable++;
    else pending++;
  }
  const slot_counts = { total, filled, tanks, healers, dps, confirmed, pending, unavailable };
  const raid_status = getRaidStatus(
    raid.raid_date as string,
    raid.start_time as string | null,
    raid.finish_time as string | null,
    slot_counts
  );
  return { slot_counts, raid_status };
}

function enrichRaidWithSlotCounts(
  db: Database.Database,
  raid: Record<string, unknown>
): Record<string, unknown> & { slot_counts?: Record<string, number>; raid_status?: RaidStatus } {
  const raidId = raid.id as number;
  const slots = db
    .prepare(
      "SELECT role, availability_status, party_index FROM saved_raid_slots WHERE raid_id = ?"
    )
    .all(raidId) as Array<{ role: string; availability_status: string; party_index?: number }>;
  const { slot_counts, raid_status } = computeSlotCountsAndStatus(slots, raid);
  return { ...raid, slot_counts, raid_status };
}

/** Batch-enrich raids to fix N+1: 1 query for all slots + signed_up counts. */
function enrichRaidsBatch(
  db: Database.Database,
  raids: Array<Record<string, unknown>>
): Array<Record<string, unknown> & { slot_counts?: Record<string, number>; raid_status?: RaidStatus }> {
  if (raids.length === 0) return [];
  const ids = raids.map((r) => r.id as number);
  const placeholders = ids.map(() => "?").join(",");
  const allSlots = db
    .prepare(
      `SELECT raid_id, role, availability_status, party_index FROM saved_raid_slots WHERE raid_id IN (${placeholders})`
    )
    .all(...ids) as Array<{
    raid_id: number;
    role: string;
    availability_status: string;
    party_index?: number;
  }>;
  const signedUpByRaid = db
    .prepare(
      `SELECT raid_id, COUNT(*) as cnt FROM saved_raid_available WHERE raid_id IN (${placeholders}) GROUP BY raid_id`
    )
    .all(...ids) as Array<{ raid_id: number; cnt: number }>;
  const signedUpMap = new Map<number, number>();
  for (const row of signedUpByRaid) {
    signedUpMap.set(row.raid_id, row.cnt);
  }
  const slotsByRaid = new Map<number, Array<{ role: string; availability_status: string; party_index?: number }>>();
  for (const s of allSlots) {
    let arr = slotsByRaid.get(s.raid_id);
    if (!arr) {
      arr = [];
      slotsByRaid.set(s.raid_id, arr);
    }
    arr.push({ role: s.role, availability_status: s.availability_status, party_index: s.party_index });
  }
  return raids.map((raid) => {
    const raidId = raid.id as number;
    const slots = slotsByRaid.get(raidId) ?? [];
    const { slot_counts, raid_status } = computeSlotCountsAndStatus(slots, raid);
    const signed_up = signedUpMap.get(raidId) ?? 0;
    const slot_counts_with_signed_up = { ...slot_counts, signed_up };
    return { ...raid, slot_counts: slot_counts_with_signed_up, raid_status };
  });
}

const BATTLE_NET_REGIONS = ["us", "eu", "kr", "tw"] as const;

authRoutes.post("/register", (req, res) => {
  const { username, password, role = "member" } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  if (!["leader", "member"].includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run(username, hash, role);
    req.session!.user = {
      id: result.lastInsertRowid as number,
      username,
      role,
    };
    res.json({ user: req.session!.user });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(400).json({ error: "Username already taken" });
      return;
    }
    throw e;
  }
});

authRoutes.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const db = getDb();
  const user = db
    .prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?")
    .get(username) as
    | { id: number; username: string; password_hash: string; role: string }
    | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  req.session!.user = {
    id: user.id,
    username: user.username,
    role: user.role,
  };
  res.json({ user: req.session!.user });
});

authRoutes.post("/logout", (req, res) => {
  req.session?.destroy(() => {});
  res.json({ ok: true });
});

authRoutes.get("/me/characters", requireAuth, qaMockMiddleware("characters"), (req, res) => {
  const db = getDb();
  const userId = req.session!.user!.id;
  const serverType = (req.query.server_type as string)?.trim();
  const userRow = db.prepare(
    "SELECT last_sync_at, last_sync_characters, last_sync_error, last_sync_debug FROM users WHERE id = ?"
  ).get(userId) as { last_sync_at: string | null; last_sync_characters: number | null; last_sync_error: string | null; last_sync_debug: string | null } | undefined;
  const syncStatus = userRow ? {
    lastSyncAt: userRow.last_sync_at ?? null,
    charactersFound: userRow.last_sync_characters ?? null,
    error: userRow.last_sync_error ?? null,
  } : null;
  const syncDebug = userRow?.last_sync_debug ?? null;
  const baseSql = `SELECT bnc.id, bnc.name, bnc.class, bnc.realm_slug as realm, bnc.server_type, bnc.guild_id, bnc.guild_name, bnc.guild_rank, bnc.guild_rank_index, bnc.portrait_url, bnc.level, bnc.race,
              g.name as guild_name_from_guilds, g.server as realm_display,
              gm.is_leader as is_guild_leader
       FROM battle_net_characters bnc
       LEFT JOIN guilds g ON bnc.guild_id = g.id
       LEFT JOIN guild_members gm ON gm.guild_id = bnc.guild_id AND gm.user_id = ?
       WHERE bnc.user_id = ?`;
  const rows = db
    .prepare(
      serverType ? `${baseSql} AND bnc.server_type = ? ORDER BY bnc.name` : `${baseSql} ORDER BY bnc.server_type, bnc.name`
    )
    .all(serverType ? [userId, userId, serverType] : [userId, userId]) as Array<{
    id: number;
    name: string;
    class: string;
    realm: string;
    server_type: string;
    guild_id: number | null;
    guild_name: string | null;
    guild_rank: string | null;
    guild_rank_index: number | null;
    guild_name_from_guilds: string | null;
    realm_display: string | null;
    portrait_url: string | null;
    level: number | null;
    race: string | null;
    is_guild_leader: number | null;
  }>;
  const characters = rows.map((r) => ({
    id: r.id,
    name: r.name,
    class: r.class,
    role: "dps" as const,
    guild_name: r.guild_name_from_guilds ?? r.guild_name ?? "",
    realm: r.realm_display ?? r.realm,
    realm_slug: r.realm,
    guild_id: r.guild_id ?? 0,
    guild_rank: r.guild_rank ?? undefined,
    guild_rank_index: r.guild_rank_index ?? undefined,
    is_guild_leader: r.is_guild_leader === 1,
    server_type: r.server_type,
    portrait_url: r.portrait_url ?? undefined,
    level: r.level ?? 1,
    race: r.race ?? undefined,
  }));

  res.json({
    characters,
    syncStatus,
    syncDebug,
  });
});

// Get single character (for character detail page)
authRoutes.get("/me/characters/:id", requireAuth, (req, res) => {
  const characterId = parseInt(paramStr(req.params.id), 10);
  if (!characterId || isNaN(characterId)) {
    res.status(400).json({ error: "Invalid character ID" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const row = db.prepare(
    `SELECT bnc.id, bnc.name, bnc.class, bnc.realm_slug as realm_slug, bnc.server_type, bnc.guild_id, bnc.guild_name, bnc.guild_rank, bnc.guild_rank_index, bnc.portrait_url, bnc.level, bnc.race,
            g.name as guild_name_from_guilds, g.server as realm_display,
            gm.is_leader as is_guild_leader
     FROM battle_net_characters bnc
     LEFT JOIN guilds g ON bnc.guild_id = g.id
     LEFT JOIN guild_members gm ON gm.guild_id = bnc.guild_id AND gm.user_id = ?
     WHERE bnc.id = ? AND bnc.user_id = ?`
  ).get(userId, characterId, userId) as {
    id: number; name: string; class: string; realm_slug: string; server_type: string;
    guild_id: number | null; guild_name: string | null; guild_rank: string | null; guild_rank_index: number | null; guild_name_from_guilds: string | null; realm_display: string | null; portrait_url: string | null; level: number | null; race: string | null; is_guild_leader: number | null;
  } | undefined;

  if (!row) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  res.json({
    id: row.id,
    name: row.name,
    class: row.class,
    realm: row.realm_display ?? row.realm_slug,
    realm_slug: row.realm_slug,
    server_type: row.server_type,
    guild_id: row.guild_id ?? 0,
    guild_name: row.guild_name_from_guilds ?? row.guild_name ?? "",
    guild_rank: row.guild_rank ?? undefined,
    guild_rank_index: row.guild_rank_index ?? undefined,
    is_guild_leader: row.is_guild_leader === 1,
    portrait_url: row.portrait_url ?? undefined,
    level: row.level ?? 1,
    race: row.race ?? undefined,
  });
});

// Fetch guild roster from Blizzard (when guild not in our DB - e.g. import failed)
authRoutes.get("/me/guild-roster", requireAuth, qaMockMiddleware("guild-roster"), async (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realm || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  if (!perms?.view_guild_roster) {
    res.status(403).json({ error: "You do not have permission to view the guild roster" });
    return;
  }
  const userRow = db.prepare("SELECT battlenet_region FROM users WHERE id = ?").get(userId) as { battlenet_region: string | null } | undefined;
  const region = userRow?.battlenet_region ?? "us";
  try {
    const roster = await fetchGuildRoster(region, realm, guildName, serverType);
    res.json({
      guild: { name: roster.name, realm: roster.realm, server_type: serverType },
      members: roster.members,
    });
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg =
      status === 404
        ? "Guild roster is not available from Blizzard for this game version (TBC Anniversary and some Classic realms may not support the roster API yet)"
        : err instanceof Error
        ? err.message
        : "Failed to fetch guild roster";
    if (status !== 404) {
      console.error("[guild-roster]", err);
    }
    res.status(status === 404 ? 404 : 502).json({ error: msg });
  }
});

// Saved raids (Plan Raid flow)
authRoutes.post("/me/saved-raids", requireAuth, (req, res) => {
  const {
    guild_name,
    guild_realm,
    guild_realm_slug,
    server_type,
    raid_name,
    raid_instance,
    raid_date,
    start_time,
    finish_time,
    parties,
    backups,
  } = req.body;
  if (!raid_name?.trim()) {
    res.status(400).json({ error: "raid_name required" });
    return;
  }
  if (!guild_name || (!guild_realm && !guild_realm_slug)) {
    res.status(400).json({ error: "guild_name and guild_realm (or guild_realm_slug) required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = guild_realm_slug ?? String(guild_realm || "").toLowerCase().replace(/\s+/g, "-");
  const guildRealm = guild_realm ?? realmSlug.replace(/-/g, " ");
  const resolvedRaidDate = raid_date && String(raid_date).trim() ? raid_date : new Date().toISOString().slice(0, 10);
  const resolvedParties = Array.isArray(parties) && parties.length > 0 ? parties : [
    Array(5).fill(null),
    Array(5).fill(null),
  ];
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, server_type || "Retail");
  if (!perms?.manage_raids) {
    res.status(403).json({ error: "You do not have permission to create raids" });
    return;
  }
  const partyCount = Math.max(resolvedParties.length, 1);
  const result = db
    .prepare(
      `INSERT INTO saved_raids (user_id, guild_name, guild_realm, guild_realm_slug, server_type, raid_name, raid_instance, raid_date, start_time, finish_time, party_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      guild_name,
      guildRealm,
      realmSlug,
      server_type || "Retail",
      raid_name.trim(),
      raid_instance || null,
      resolvedRaidDate,
      start_time || null,
      finish_time || null,
      partyCount
    );
  const raidId = result.lastInsertRowid as number;
  const insertSlot = db.prepare(
    `INSERT INTO saved_raid_slots (raid_id, party_index, slot_index, character_name, character_class, role, is_raid_lead, is_raid_assist)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let pi = 0; pi < resolvedParties.length; pi++) {
    const party = resolvedParties[pi] as Array<{ characterName: string; characterClass: string; role: string; isRaidLead?: boolean; isRaidAssist?: boolean } | null>;
    for (let si = 0; si < (party?.length ?? 0); si++) {
      const slot = party?.[si];
      if (slot) {
        insertSlot.run(
          raidId,
          pi,
          si,
          slot.characterName,
          slot.characterClass,
          slot.role,
          slot.isRaidLead ? 1 : 0,
          slot.isRaidAssist ? 1 : 0
        );
      }
    }
  }
  const insertBackup = db.prepare(
    `INSERT INTO saved_raid_backups (raid_id, character_name, character_class, position) VALUES (?, ?, ?, ?)`
  );
  const backupList = Array.isArray(backups) ? backups : [];
  for (let i = 0; i < backupList.length; i++) {
    const b = backupList[i] as { characterName: string; characterClass: string };
    if (b?.characterName && b?.characterClass) {
      insertBackup.run(raidId, b.characterName, b.characterClass, i);
    }
  }
  const raid = db.prepare("SELECT * FROM saved_raids WHERE id = ?").get(raidId);
  const slots = db.prepare("SELECT * FROM saved_raid_slots WHERE raid_id = ? ORDER BY party_index, slot_index").all(raidId);
  const savedBackups = db.prepare("SELECT * FROM saved_raid_backups WHERE raid_id = ? ORDER BY position, character_name").all(raidId);
  res.status(201).json({ raid, slots, backups: savedBackups });
});

authRoutes.get("/me/saved-raids/my-assignments", requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session!.user!.id;
  const serverType = (req.query.server_type as string)?.trim();
  const charQuery = serverType
    ? db.prepare("SELECT DISTINCT LOWER(name) as name FROM battle_net_characters WHERE user_id = ? AND server_type = ?")
    : db.prepare("SELECT DISTINCT LOWER(name) as name FROM battle_net_characters WHERE user_id = ?");
  const charNames = (serverType ? charQuery.all(userId, serverType) : charQuery.all(userId)) as Array<{ name: string }>;
  const names = charNames.map((c) => c.name);
  if (names.length === 0) {
    res.json({ raids: [] });
    return;
  }
  const placeholders = names.map(() => "?").join(",");
  const baseSql = `SELECT DISTINCT sr.* FROM saved_raids sr
       JOIN saved_raid_slots srs ON srs.raid_id = sr.id
       WHERE LOWER(srs.character_name) IN (${placeholders})`;
  const raids = db
    .prepare(
      serverType ? `${baseSql} AND sr.server_type = ? ORDER BY sr.raid_date DESC, sr.start_time DESC` : `${baseSql} ORDER BY sr.raid_date DESC, sr.start_time DESC`
    )
    .all(...(serverType ? [...names, serverType] : names)) as Array<Record<string, unknown>>;
  const namesSet = new Set(names);
  const baseEnriched = enrichRaidsBatch(db, raids);
  if (raids.length === 0) {
    res.json({ raids: [] });
    return;
  }
  const raidIds = raids.map((r) => r.id as number);
  const slotPlaceholders = raidIds.map(() => "?").join(",");
  const backupPlaceholders = raidIds.map(() => "?").join(",");
  const slotCharsAll = db
    .prepare(
      `SELECT raid_id, character_name, character_class, role, is_raid_lead, is_raid_assist FROM saved_raid_slots WHERE raid_id IN (${slotPlaceholders})`
    )
    .all(...raidIds) as Array<{ raid_id: number; character_name: string; character_class: string; role: string; is_raid_lead: number; is_raid_assist: number }>;
  const backupCharsAll = db
    .prepare(
      `SELECT raid_id, character_name, character_class FROM saved_raid_backups WHERE raid_id IN (${backupPlaceholders})`
    )
    .all(...raidIds) as Array<{ raid_id: number; character_name: string; character_class: string }>;
  const slotCharsByRaid = new Map<number, typeof slotCharsAll>();
  for (const row of slotCharsAll) {
    let arr = slotCharsByRaid.get(row.raid_id);
    if (!arr) {
      arr = [];
      slotCharsByRaid.set(row.raid_id, arr);
    }
    arr.push(row);
  }
  const backupCharsByRaid = new Map<number, typeof backupCharsAll>();
  for (const row of backupCharsAll) {
    let arr = backupCharsByRaid.get(row.raid_id);
    if (!arr) {
      arr = [];
      backupCharsByRaid.set(row.raid_id, arr);
    }
    arr.push(row);
  }
  const enriched = baseEnriched.map((base) => {
    const raidId = base.id as number;
    const myChars = new Map<string, { character_name: string; character_class: string; role?: string }>();
    const slotChars = slotCharsByRaid.get(raidId) ?? [];
    const backupChars = backupCharsByRaid.get(raidId) ?? [];
    for (const row of slotChars) {
      if (namesSet.has(row.character_name.toLowerCase())) {
        const parts: string[] = [];
        if (row.is_raid_lead) parts.push("Raid Lead");
        if (row.is_raid_assist) parts.push("Raid Assist");
        if (parts.length === 0 && row.role) parts.push((row.role || "").toLowerCase() === "dps" ? "DPS" : row.role);
        if (parts.length === 0) parts.push("DPS");
        myChars.set(row.character_name.toLowerCase(), { character_name: row.character_name, character_class: row.character_class, role: parts.join(", ") });
      }
    }
    for (const row of backupChars) {
      if (namesSet.has(row.character_name.toLowerCase()) && !myChars.has(row.character_name.toLowerCase())) {
        myChars.set(row.character_name.toLowerCase(), { character_name: row.character_name, character_class: row.character_class, role: "Backup" });
      }
    }
    const my_characters = [...myChars.values()];
    return { ...base, my_characters };
  });
  res.json({ raids: enriched });
});

authRoutes.get("/me/saved-raids", requireAuth, qaMockMiddleware("saved-raids"), (req, res) => {
  const guildRealm = (req.query.guild_realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  const db = getDb();
  const userId = req.session!.user!.id;
  if (guildRealm && guildName) {
    const realmSlug = guildRealm.toLowerCase().replace(/\s+/g, "-");
    const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
    if (!perms?.view_raid_schedule) {
      res.status(403).json({ error: "You do not have permission to view the raid schedule" });
      return;
    }
  }
  let raids: Array<Record<string, unknown>>;
  if (guildRealm && guildName) {
    const realmSlug = guildRealm.toLowerCase().replace(/\s+/g, "-");
    raids = db
      .prepare(
        `SELECT * FROM saved_raids
         WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
         ORDER BY raid_date DESC, start_time DESC`
      )
      .all(realmSlug, guildName, serverType) as Array<Record<string, unknown>>;
  } else {
    raids = db
      .prepare(
        `SELECT * FROM saved_raids WHERE user_id = ? ORDER BY raid_date DESC, start_time DESC`
      )
      .all(userId) as Array<Record<string, unknown>>;
  }
  const enriched = enrichRaidsBatch(db, raids);
  res.json({ raids: enriched });
});

authRoutes.get("/me/saved-raids/:id", requireAuth, (req, res) => {
  const raidId = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  const userId = req.session!.user!.id;
  let raid = db.prepare("SELECT * FROM saved_raids WHERE id = ? AND user_id = ?").get(raidId, userId);
  if (!raid) {
    const charNames = db.prepare("SELECT DISTINCT LOWER(name) as name FROM battle_net_characters WHERE user_id = ?").all(userId) as Array<{ name: string }>;
    const names = charNames.map((c) => c.name);
    if (names.length > 0) {
      const placeholders = names.map(() => "?").join(",");
      raid = db.prepare(
        `SELECT sr.* FROM saved_raids sr
         JOIN saved_raid_slots srs ON srs.raid_id = sr.id
         WHERE sr.id = ? AND LOWER(srs.character_name) IN (${placeholders})`
      ).get(raidId, ...names);
    }
  }
  if (!raid) {
    const anyRaid = db.prepare("SELECT * FROM saved_raids WHERE id = ?").get(raidId);
    if (anyRaid) {
      const r = anyRaid as { guild_realm_slug: string; guild_name: string; server_type?: string };
      const perms = getEffectiveGuildPermissions(db, userId, r.guild_realm_slug ?? "", r.guild_name ?? "", r.server_type ?? "Retail");
      if (perms?.view_raid_schedule) {
        raid = anyRaid;
      }
    }
  }
  if (!raid) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  const slots = db.prepare("SELECT * FROM saved_raid_slots WHERE raid_id = ? ORDER BY party_index, slot_index").all(raidId);
  const backups = db.prepare("SELECT * FROM saved_raid_backups WHERE raid_id = ? ORDER BY position, character_name").all(raidId);
  const available = db.prepare("SELECT character_name, character_class FROM saved_raid_available WHERE raid_id = ? ORDER BY character_name").all(raidId);
  const perms = getEffectiveGuildPermissions(db, userId, (raid as { guild_realm_slug: string }).guild_realm_slug, (raid as { guild_name: string }).guild_name, (raid as { server_type?: string }).server_type || "Retail");
  const enrichedRaid = enrichRaidWithSlotCounts(db, raid as Record<string, unknown>);
  if (!perms?.manage_raids && "officer_notes" in enrichedRaid) {
    delete enrichedRaid.officer_notes;
  }
  res.json({ raid: enrichedRaid, slots, backups, available });
});

authRoutes.post("/me/saved-raids/:id/confirm-availability", requireAuth, (req, res) => {
  const raidId = parseInt(paramStr(req.params.id), 10);
  const { slot_id, status } = req.body as { slot_id?: number; status?: "confirmed" | "unavailable" };
  if (!slot_id || !status || !["confirmed", "unavailable"].includes(status)) {
    res.status(400).json({ error: "slot_id and status (confirmed|unavailable) required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const raid = db.prepare("SELECT guild_realm_slug, guild_name, server_type FROM saved_raids WHERE id = ?").get(raidId) as
    | { guild_realm_slug: string; guild_name: string; server_type: string }
    | undefined;
  if (!raid) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  const perms = getEffectiveGuildPermissions(
    db,
    userId,
    raid.guild_realm_slug ?? "",
    raid.guild_name ?? "",
    raid.server_type ?? "Retail"
  );
  const canEditForOthers = perms?.manage_raid_roster || perms?.manage_raids;
  const slot = db.prepare("SELECT character_name FROM saved_raid_slots WHERE id = ? AND raid_id = ?").get(slot_id, raidId) as
    | { character_name: string }
    | undefined;
  if (!slot || !slot.character_name) {
    res.status(404).json({ error: "Slot not found" });
    return;
  }
  if (!canEditForOthers) {
    const charNames = db.prepare("SELECT DISTINCT LOWER(name) as name FROM battle_net_characters WHERE user_id = ?").all(userId) as Array<{
      name: string;
    }>;
    const names = charNames.map((c) => c.name);
    if (names.length === 0 || !names.includes(String(slot.character_name).toLowerCase())) {
      res.status(403).json({ error: "Not your slot" });
      return;
    }
  }
  db.prepare("UPDATE saved_raid_slots SET availability_status = ? WHERE id = ?").run(status, slot_id);
  const updated = db.prepare("SELECT * FROM saved_raid_slots WHERE id = ?").get(slot_id);
  res.json({ slot: updated });
});

authRoutes.post("/me/saved-raids/:id/sign-up", requireAuth, (req, res) => {
  const raidId = parseInt(paramStr(req.params.id), 10);
  const { character_name, character_class } = req.body as { character_name?: string; character_class?: string };
  if (!character_name?.trim() || !character_class?.trim()) {
    res.status(400).json({ error: "character_name and character_class required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const charNames = db.prepare("SELECT DISTINCT LOWER(name) as name FROM battle_net_characters WHERE user_id = ?").all(userId) as Array<{ name: string }>;
  if (!charNames.some((c) => c.name === character_name.trim().toLowerCase())) {
    res.status(403).json({ error: "Character must be one of your Battle.net characters" });
    return;
  }
  let raid = db.prepare("SELECT * FROM saved_raids WHERE id = ?").get(raidId);
  if (!raid) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  const inSlot = db.prepare("SELECT 1 FROM saved_raid_slots WHERE raid_id = ? AND LOWER(character_name) = ?").get(raidId, character_name.trim().toLowerCase());
  const inBackup = db.prepare("SELECT 1 FROM saved_raid_backups WHERE raid_id = ? AND LOWER(character_name) = ?").get(raidId, character_name.trim().toLowerCase());
  if (inSlot || inBackup) {
    res.status(400).json({ error: "Already assigned to this raid" });
    return;
  }
  try {
    db.prepare(
      "INSERT INTO saved_raid_available (raid_id, character_name, character_class, user_id) VALUES (?, ?, ?, ?)"
    ).run(raidId, character_name.trim(), character_class.trim(), userId);
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(400).json({ error: "Already signed up as available" });
      return;
    }
    throw e;
  }
  const available = db.prepare("SELECT character_name, character_class FROM saved_raid_available WHERE raid_id = ? ORDER BY character_name").all(raidId);
  res.json({ available });
});

authRoutes.delete("/me/saved-raids/:id/sign-up", requireAuth, (req, res) => {
  const raidId = parseInt(paramStr(req.params.id), 10);
  const body = req.body as { character_name?: string } | undefined;
  const charFromQuery = (req.query.character_name as string)?.trim();
  const name = body?.character_name?.trim() || charFromQuery;
  if (!name) {
    res.status(400).json({ error: "character_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const row = db.prepare("SELECT user_id FROM saved_raid_available WHERE raid_id = ? AND LOWER(character_name) = ?").get(raidId, name.toLowerCase()) as { user_id: number } | undefined;
  if (!row) {
    res.status(404).json({ error: "Not in available list" });
    return;
  }
  if (row.user_id !== userId) {
    res.status(403).json({ error: "Can only remove your own sign-up" });
    return;
  }
  db.prepare("DELETE FROM saved_raid_available WHERE raid_id = ? AND LOWER(character_name) = ?").run(raidId, name.toLowerCase());
  res.json({ ok: true });
});

authRoutes.patch("/me/saved-raids/:id", requireAuth, (req, res) => {
  const raidId = parseInt(paramStr(req.params.id), 10);
  const {
    raid_name,
    raid_instance,
    raid_date,
    start_time,
    finish_time,
    officer_notes,
    parties,
    backups,
    unavailable_slots,
  } = req.body;
  const db = getDb();
  const userId = req.session!.user!.id;
  const raid = db.prepare("SELECT * FROM saved_raids WHERE id = ?").get(raidId) as { user_id: number; guild_realm_slug: string; guild_name: string; server_type: string } | undefined;
  if (!raid) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  const perms = getEffectiveGuildPermissions(db, userId, raid.guild_realm_slug, raid.guild_name, raid.server_type || "Retail");
  if (!perms?.manage_raids) {
    res.status(403).json({ error: "You do not have permission to edit raids" });
    return;
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  if (raid_name !== undefined) {
    updates.push("raid_name = ?");
    values.push(raid_name);
  }
  if (raid_instance !== undefined) {
    updates.push("raid_instance = ?");
    values.push(raid_instance);
  }
  if (raid_date !== undefined) {
    updates.push("raid_date = ?");
    values.push(raid_date);
  }
  if (start_time !== undefined) {
    updates.push("start_time = ?");
    values.push(start_time);
  }
  if (finish_time !== undefined) {
    updates.push("finish_time = ?");
    values.push(finish_time);
  }
  if (officer_notes !== undefined) {
    updates.push("officer_notes = ?");
    values.push(officer_notes ?? null);
  }
  if (parties !== undefined) {
    updates.push("party_count = ?");
    values.push(Math.max(Array.isArray(parties) ? parties.length : 1, 1));
  }
  if (updates.length > 0) {
    values.push(raidId);
    db.prepare(`UPDATE saved_raids SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }
  if (parties !== undefined) {
    db.prepare("DELETE FROM saved_raid_slots WHERE raid_id = ?").run(raidId);
    const insertSlot = db.prepare(
      `INSERT INTO saved_raid_slots (raid_id, party_index, slot_index, character_name, character_class, role, is_raid_lead, is_raid_assist, availability_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (let pi = 0; pi < parties.length; pi++) {
      const party = parties[pi] as Array<{ characterName: string; characterClass: string; role: string; isRaidLead?: boolean; isRaidAssist?: boolean } | null>;
      for (let si = 0; si < (party?.length ?? 0); si++) {
        const slot = party?.[si];
        if (slot) {
          insertSlot.run(
            raidId,
            pi,
            si,
            slot.characterName,
            slot.characterClass,
            slot.role,
            slot.isRaidLead ? 1 : 0,
            slot.isRaidAssist ? 1 : 0,
            "pending"
          );
        }
      }
    }
    const unavailList = Array.isArray(unavailable_slots) ? unavailable_slots : [];
    for (let i = 0; i < unavailList.length; i++) {
      const s = unavailList[i] as { characterName?: string; characterClass?: string; role?: string; isRaidLead?: boolean; isRaidAssist?: boolean };
      if (s?.characterName && s?.characterClass) {
        insertSlot.run(
          raidId,
          0,
          1000 + i,
          s.characterName,
          s.characterClass,
          s.role ?? "DPS",
          s.isRaidLead ? 1 : 0,
          s.isRaidAssist ? 1 : 0,
          "unavailable"
        );
      }
    }
  }
  if (backups !== undefined) {
    db.prepare("DELETE FROM saved_raid_backups WHERE raid_id = ?").run(raidId);
    const insertBackup = db.prepare(
      `INSERT INTO saved_raid_backups (raid_id, character_name, character_class, position) VALUES (?, ?, ?, ?)`
    );
    const backupList = Array.isArray(backups) ? backups : [];
    for (let i = 0; i < backupList.length; i++) {
      const b = backupList[i] as { characterName: string; characterClass: string };
      if (b?.characterName && b?.characterClass) {
        insertBackup.run(raidId, b.characterName, b.characterClass, i);
      }
    }
  }
  const updated = db.prepare("SELECT * FROM saved_raids WHERE id = ?").get(raidId);
  const slots = db.prepare("SELECT * FROM saved_raid_slots WHERE raid_id = ? ORDER BY party_index, slot_index").all(raidId);
  const savedBackups = db.prepare("SELECT * FROM saved_raid_backups WHERE raid_id = ? ORDER BY position, character_name").all(raidId);
  res.json({ raid: updated, slots, backups: savedBackups });
});

// User preferences (game version, favorite guilds)
authRoutes.get("/me/preferences", requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session!.user!.id;
  const rows = db.prepare("SELECT pref_key, pref_value FROM user_preferences WHERE user_id = ?").all(userId) as Array<{ pref_key: string; pref_value: string | null }>;
  const prefs: Record<string, string> = {};
  for (const r of rows) {
    prefs[r.pref_key] = r.pref_value ?? "";
  }
  res.json({ preferences: prefs });
});

authRoutes.put("/me/preferences", requireAuth, (req, res) => {
  const { preferences } = req.body;
  if (!preferences || typeof preferences !== "object") {
    res.status(400).json({ error: "preferences object required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO user_preferences (user_id, pref_key, pref_value) VALUES (?, ?, ?)"
  );
  for (const [key, value] of Object.entries(preferences)) {
    if (typeof key === "string" && (typeof value === "string" || value === null || value === undefined)) {
      upsert.run(userId, key, value == null ? "" : String(value));
    }
  }
  const rows = db.prepare("SELECT pref_key, pref_value FROM user_preferences WHERE user_id = ?").all(userId) as Array<{ pref_key: string; pref_value: string | null }>;
  const prefs: Record<string, string> = {};
  for (const r of rows) {
    prefs[r.pref_key] = r.pref_value ?? "";
  }
  res.json({ preferences: prefs });
});

// Guild permissions (rank-based access control)
type PermissionKey = "view_guild_dashboard" | "view_guild_roster" | "view_raid_roster" | "view_raid_schedule" | "manage_raids" | "manage_raid_roster" | "manage_permissions" | "manage_guild_crafters";

const PERMISSION_KEYS: PermissionKey[] = [
  "view_guild_dashboard", "view_guild_roster", "view_raid_roster", "view_raid_schedule",
  "manage_raids", "manage_raid_roster", "manage_permissions", "manage_guild_crafters",
];

const DEFAULT_PERMISSIONS: Record<PermissionKey, boolean> = {
  view_guild_dashboard: true,
  view_guild_roster: true,
  view_raid_roster: true,
  view_raid_schedule: true,
  manage_raids: true,
  manage_raid_roster: true,
  manage_permissions: true,
  manage_guild_crafters: true,
};

const NO_PERMISSIONS: Record<PermissionKey, boolean> = {
  view_guild_dashboard: false,
  view_guild_roster: false,
  view_raid_roster: false,
  view_raid_schedule: false,
  manage_raids: false,
  manage_raid_roster: false,
  manage_permissions: false,
  manage_guild_crafters: false,
};

function defaultConfigForRank(rankIndex: number): Record<PermissionKey, boolean> {
  if (rankIndex === 0) return { ...DEFAULT_PERMISSIONS };
  if (rankIndex >= 1 && rankIndex <= 3) {
    return {
      view_guild_dashboard: true,
      view_guild_roster: true,
      view_raid_roster: true,
      view_raid_schedule: true,
      manage_raids: true,
      manage_raid_roster: true,
      manage_permissions: false,
      manage_guild_crafters: true,
    };
  }
  return {
    view_guild_dashboard: true,
    view_guild_roster: true,
    view_raid_roster: true,
    view_raid_schedule: true,
    manage_raids: false,
    manage_raid_roster: false,
    manage_permissions: false,
    manage_guild_crafters: false,
  };
}

function getDefaultRankConfig(): Record<string, Record<PermissionKey, boolean>> {
  const config: Record<string, Record<PermissionKey, boolean>> = {};
  for (let i = 0; i <= 9; i++) {
    config[`rank_${i}`] = defaultConfigForRank(i);
  }
  return config;
}

function getUserBestRankInGuild(db: ReturnType<typeof getDb>, userId: number, realmSlug: string, guildName: string, serverType: string): number | null {
  const rows = db.prepare(
    `SELECT bnc.guild_rank_index, bnc.guild_name, g.name as guild_name_from_guilds
     FROM battle_net_characters bnc
     LEFT JOIN guilds g ON bnc.guild_id = g.id
     WHERE bnc.user_id = ? AND bnc.realm_slug = ? AND (LOWER(COALESCE(g.name, bnc.guild_name, '')) = LOWER(?) OR LOWER(bnc.guild_name) = LOWER(?))
     AND (bnc.server_type = ? OR (bnc.server_type IS NULL AND ? = 'Retail'))`
  ).all(userId, realmSlug, guildName, guildName, serverType, serverType) as Array<{ guild_rank_index: number | null }>;
  let best: number | null = null;
  for (const r of rows) {
    const idx = r.guild_rank_index;
    if (idx !== null && idx !== undefined) {
      if (best === null || idx < best) best = idx;
    }
  }
  return best;
}

authRoutes.get("/me/guild-permissions", requireAuth, qaMockMiddleware("guild-permissions"), (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realm || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const bestRank = getUserBestRankInGuild(db, userId, realmSlug, guildName, serverType);

  if (bestRank === null) {
    return res.json({ permissions: NO_PERMISSIONS, rank_index: null, rank_name: null });
  }

  const row = db.prepare(
    "SELECT config_json FROM guild_permission_config WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).get(realmSlug, guildName, serverType) as { config_json: string } | undefined;

  const defaultConfig = getDefaultRankConfig();
  let config = defaultConfig;
  if (row?.config_json) {
    try {
      const stored = JSON.parse(row.config_json) as Record<string, Record<string, boolean>>;
      for (const key of Object.keys(stored)) {
        if (defaultConfig[key]) {
          config[key] = { ...defaultConfig[key], ...stored[key] };
        }
      }
    } catch {
      /* use defaults */
    }
  }

  const rankKey = `rank_${bestRank}`;
  let perms = config[rankKey] ?? defaultConfigForRank(bestRank);

  // Merge character overrides: if user has characters with overrides, OR those permissions in
  const charRows = db.prepare(
    `SELECT bnc.name
     FROM battle_net_characters bnc
     LEFT JOIN guilds g ON bnc.guild_id = g.id
     WHERE bnc.user_id = ? AND bnc.realm_slug = ? AND (LOWER(COALESCE(g.name, bnc.guild_name, '')) = LOWER(?) OR LOWER(bnc.guild_name) = LOWER(?))
     AND (bnc.server_type = ? OR (bnc.server_type IS NULL AND ? = 'Retail'))`
  ).all(userId, realmSlug, guildName, guildName, serverType, serverType) as Array<{ name: string }>;
  const charOverrides = db.prepare(
    `SELECT character_name, permissions_json FROM guild_character_overrides
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?`
  ).all(realmSlug, guildName, serverType) as Array<{ character_name: string; permissions_json: string }>;
  const overrideMap = new Map<string, Record<PermissionKey, boolean>>();
  for (const o of charOverrides) {
    try {
      const p = JSON.parse(o.permissions_json) as Record<string, boolean>;
      const permsObj: Record<PermissionKey, boolean> = { ...NO_PERMISSIONS };
      for (const pk of PERMISSION_KEYS) {
        if (typeof p[pk] === "boolean") permsObj[pk] = p[pk];
      }
      overrideMap.set(o.character_name.toLowerCase(), permsObj);
    } catch {
      /* skip */
    }
  }
  for (const c of charRows) {
    const override = overrideMap.get(c.name.toLowerCase());
    if (override) {
      perms = {
        view_guild_dashboard: perms.view_guild_dashboard || override.view_guild_dashboard,
        view_guild_roster: perms.view_guild_roster || override.view_guild_roster,
        view_raid_roster: perms.view_raid_roster || override.view_raid_roster,
        view_raid_schedule: perms.view_raid_schedule || override.view_raid_schedule,
        manage_raids: perms.manage_raids || override.manage_raids,
        manage_raid_roster: perms.manage_raid_roster || override.manage_raid_roster,
        manage_permissions: perms.manage_permissions || override.manage_permissions,
        manage_guild_crafters: perms.manage_guild_crafters || override.manage_guild_crafters,
      };
    }
  }

  res.json({ permissions: perms, rank_index: bestRank, rank_name: null });
});

authRoutes.get("/me/guild-permissions-config", requireAuth, (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realm || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const effectivePerms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  if (effectivePerms === null) {
    return res.status(403).json({ error: "You have no character in this guild" });
  }
  if (!effectivePerms.manage_permissions) {
    return res.status(403).json({ error: "You do not have permission to manage guild permissions" });
  }
  {
    const row = db.prepare(
      "SELECT config_json FROM guild_permission_config WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
    ).get(realmSlug, guildName, serverType) as { config_json: string } | undefined;
    const defaultCfg = getDefaultRankConfig();
    let config = { ...defaultCfg };
    if (row?.config_json) {
      try {
        const stored = JSON.parse(row.config_json) as Record<string, Record<string, boolean>>;
        for (const k of Object.keys(stored)) {
          if (config[k]) config[k] = { ...config[k], ...stored[k] };
        }
      } catch {
        /* use defaults */
      }
    }
    const charOverrides = db.prepare(
      `SELECT character_name, permissions_json FROM guild_character_overrides
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? ORDER BY character_name`
    ).all(realmSlug, guildName, serverType) as Array<{ character_name: string; permissions_json: string }>;
    const character_overrides = charOverrides.map((o) => {
      let perms: Record<string, boolean> = {};
      try {
        perms = JSON.parse(o.permissions_json) as Record<string, boolean>;
      } catch {
        /* ignore */
      }
      return { character_name: o.character_name, permissions: perms };
    });
    return res.json({ config, rank_names: {}, character_overrides });
  }
});

authRoutes.put("/me/guild-permissions-config", requireAuth, (req, res) => {
  const { realm, guild_name, server_type, config } = req.body;
  if (!realm || !guild_name || !config || typeof config !== "object") {
    res.status(400).json({ error: "realm, guild_name, and config object required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = String(realm).toLowerCase().replace(/\s+/g, "-");
  const serverType = server_type || "Retail";

  const effectivePerms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, serverType);
  if (effectivePerms === null) {
    return res.status(403).json({ error: "You have no character in this guild" });
  }
  if (!effectivePerms.manage_permissions) {
    return res.status(403).json({ error: "You do not have permission to manage guild permissions" });
  }

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
  ).run(realmSlug, guild_name, serverType, JSON.stringify(sanitized));

  const defaultCfg = getDefaultRankConfig();
  const merged: Record<string, Record<PermissionKey, boolean>> = {};
  for (const k of Object.keys(defaultCfg)) {
    merged[k] = { ...defaultCfg[k], ...(sanitized[k] || {}) };
  }
  res.json({ config: merged });
});

/** Get user's effective guild permissions (rank config merged with character overrides). */
function getEffectiveGuildPermissions(
  db: ReturnType<typeof getDb>,
  userId: number,
  realmSlug: string,
  guildName: string,
  serverType: string
): Record<PermissionKey, boolean> | null {
  const bestRank = getUserBestRankInGuild(db, userId, realmSlug, guildName, serverType);
  if (bestRank === null) return null;
  const defaultConfig = getDefaultRankConfig();
  const row = db.prepare(
    "SELECT config_json FROM guild_permission_config WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).get(realmSlug, guildName, serverType) as { config_json: string } | undefined;
  let config = { ...defaultConfig };
  if (row?.config_json) {
    try {
      const stored = JSON.parse(row.config_json) as Record<string, Record<string, boolean>>;
      for (const k of Object.keys(stored)) {
        if (config[k]) config[k] = { ...config[k], ...stored[k] };
      }
    } catch {
      /* use defaults */
    }
  }
  const rankKey = `rank_${bestRank}`;
  let perms = config[rankKey] ?? defaultConfigForRank(bestRank);
  const charRows = db.prepare(
    `SELECT bnc.name
     FROM battle_net_characters bnc
     LEFT JOIN guilds g ON bnc.guild_id = g.id
     WHERE bnc.user_id = ? AND bnc.realm_slug = ? AND (LOWER(COALESCE(g.name, bnc.guild_name, '')) = LOWER(?) OR LOWER(bnc.guild_name) = LOWER(?))
     AND (bnc.server_type = ? OR (bnc.server_type IS NULL AND ? = 'Retail'))`
  ).all(userId, realmSlug, guildName, guildName, serverType, serverType) as Array<{ name: string }>;
  const charOverrides = db.prepare(
    `SELECT character_name, permissions_json FROM guild_character_overrides
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?`
  ).all(realmSlug, guildName, serverType) as Array<{ character_name: string; permissions_json: string }>;
  const overrideMap = new Map<string, Record<PermissionKey, boolean>>();
  for (const o of charOverrides) {
    try {
      const p = JSON.parse(o.permissions_json) as Record<string, boolean>;
      const permsObj: Record<PermissionKey, boolean> = { ...NO_PERMISSIONS };
      for (const pk of PERMISSION_KEYS) {
        if (typeof p[pk] === "boolean") permsObj[pk] = p[pk];
      }
      overrideMap.set(o.character_name.toLowerCase(), permsObj);
    } catch {
      /* skip */
    }
  }
  for (const c of charRows) {
    const override = overrideMap.get(c.name.toLowerCase());
    if (override) {
      perms = {
        view_guild_dashboard: perms.view_guild_dashboard || override.view_guild_dashboard,
        view_guild_roster: perms.view_guild_roster || override.view_guild_roster,
        view_raid_roster: perms.view_raid_roster || override.view_raid_roster,
        view_raid_schedule: perms.view_raid_schedule || override.view_raid_schedule,
        manage_raids: perms.manage_raids || override.manage_raids,
        manage_raid_roster: perms.manage_raid_roster || override.manage_raid_roster,
        manage_permissions: perms.manage_permissions || override.manage_permissions,
        manage_guild_crafters: perms.manage_guild_crafters || override.manage_guild_crafters,
      };
    }
  }
  return perms;
}

function canManageGuildPermissions(db: ReturnType<typeof getDb>, userId: number, realmSlug: string, guildName: string, serverType: string): boolean {
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  return perms ? !!perms.manage_permissions : false;
}

authRoutes.put("/me/guild-character-overrides", requireAuth, async (req, res) => {
  const { realm, guild_name, server_type, character_name, permissions } = req.body;
  if (!realm || !guild_name || !character_name || typeof character_name !== "string") {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = String(realm).toLowerCase().replace(/\s+/g, "-");
  const serverType = server_type || "Retail";
  const charName = String(character_name).trim();
  if (!charName) {
    res.status(400).json({ error: "character_name cannot be empty" });
    return;
  }
  if (!canManageGuildPermissions(db, userId, realmSlug, guild_name, serverType)) {
    res.status(403).json({ error: "You do not have permission to manage guild permissions" });
    return;
  }
  const userRow = db.prepare("SELECT battlenet_region FROM users WHERE id = ?").get(userId) as { battlenet_region: string | null } | undefined;
  const region = userRow?.battlenet_region ?? "us";
  try {
    const roster = await fetchGuildRoster(region, realmSlug, guild_name, serverType);
    const isInGuild = roster.members.some((m) => m.name.toLowerCase() === charName.toLowerCase());
    if (!isInGuild) {
      res.status(400).json({ error: "Character is not in this guild" });
      return;
    }
  } catch {
    res.status(400).json({ error: "Could not verify guild roster. Ensure the guild exists and try again." });
    return;
  }
  const sanitized: Record<string, boolean> = {};
  const permsObj = permissions && typeof permissions === "object" ? permissions : {};
  for (const pk of PERMISSION_KEYS) {
    if (typeof permsObj[pk] === "boolean") sanitized[pk] = permsObj[pk];
  }
  db.prepare(
    `INSERT OR REPLACE INTO guild_character_overrides (guild_realm_slug, guild_name, server_type, character_name, permissions_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(realmSlug, guild_name, serverType, charName, JSON.stringify(sanitized));
  const rows = db.prepare(
    `SELECT character_name, permissions_json FROM guild_character_overrides
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? ORDER BY character_name`
  ).all(realmSlug, guild_name, serverType) as Array<{ character_name: string; permissions_json: string }>;
  const character_overrides = rows.map((o) => {
    let p: Record<string, boolean> = {};
    try {
      p = JSON.parse(o.permissions_json) as Record<string, boolean>;
    } catch {
      /* ignore */
    }
    return { character_name: o.character_name, permissions: p };
  });
  res.json({ character_overrides });
});

authRoutes.delete("/me/guild-character-overrides", requireAuth, (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  const characterName = (req.query.character_name as string)?.trim();
  if (!realm || !guildName || !characterName) {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  if (!canManageGuildPermissions(db, userId, realmSlug, guildName, serverType)) {
    return res.status(403).json({ error: "You do not have permission to manage guild permissions" });
  }
  db.prepare(
    `DELETE FROM guild_character_overrides
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).run(realmSlug, guildName, serverType, characterName);
  const rows = db.prepare(
    `SELECT character_name, permissions_json FROM guild_character_overrides
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? ORDER BY character_name`
  ).all(realmSlug, guildName, serverType) as Array<{ character_name: string; permissions_json: string }>;
  const character_overrides = rows.map((o) => {
    let p: Record<string, boolean> = {};
    try {
      p = JSON.parse(o.permissions_json) as Record<string, boolean>;
    } catch {
      /* ignore */
    }
    return { character_name: o.character_name, permissions: p };
  });
  res.json({ character_overrides });
});

const PROFESSION_TYPES = [
  "Alchemy", "Blacksmithing", "Cooking", "Enchanting", "Engineering", "First Aid",
  "Fishing", "Herbalism", "Inscription", "Jewelcrafting", "Leatherworking", "Mining", "Skinning", "Tailoring",
] as const;

authRoutes.get("/me/guild-crafters-management", requireAuth, async (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realm || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  if (!perms?.manage_guild_crafters) {
    res.status(403).json({ error: "You do not have permission to manage guild crafters" });
    return;
  }

  // TBC Anniversary: merge with legacy guild_crafter_roster (manual crafter list)
  if (serverType === "TBC Anniversary") {
    const crafters = db
      .prepare(
        `SELECT character_name, professions, profession_notes FROM guild_crafter_roster
         WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
         ORDER BY character_name`
      )
      .all(realmSlug, guildName, serverType) as Array<{
        character_name: string;
        professions: string | null;
        profession_notes: string | null;
      }>;
    const members = crafters.map((c) => {
      let profs: string[] = [];
      try {
        if (c.professions) profs = JSON.parse(c.professions) as string[];
      } catch {
        /* ignore */
      }
      return {
        name: c.character_name,
        class: "",
        level: 0,
        professions: profs,
        profession_notes: c.profession_notes || "",
        guild_profession_stars: [],
      };
    });
    res.json({ members, tbc_manual: true });
    return;
  }

  const userRow = db.prepare("SELECT battlenet_region FROM users WHERE id = ?").get(userId) as { battlenet_region: string | null } | undefined;
  const region = userRow?.battlenet_region ?? "us";
  let roster: { name: string; realm: string; members: Array<{ name: string; class: string; level: number }> };
  try {
    roster = await fetchGuildRoster(region, realmSlug, guildName, serverType);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg = status === 404 ? "Guild roster is not available from Blizzard" : err instanceof Error ? err.message : "Failed to fetch guild roster";
    res.status(status === 404 ? 404 : 502).json({ error: msg });
    return;
  }
  const professionsByChar = new Map<string, string[]>();

  // Load DB fallback first (raider_roster + character_recipes) for fast display
  const rrRows = db
    .prepare(
      `SELECT character_name, professions FROM raider_roster
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?`
    )
    .all(realmSlug, guildName, serverType) as Array<{ character_name: string; professions: string | null }>;
  for (const r of rrRows) {
    let list: string[] = [];
    try {
      if (r.professions) list = JSON.parse(r.professions) as string[];
    } catch {
      /* ignore */
    }
    if (list.length > 0) professionsByChar.set(r.character_name.toLowerCase(), list);
  }
  const recipeProfs = db
    .prepare(
      `SELECT DISTINCT character_name, profession FROM character_recipes
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND profession IS NOT NULL`
    )
    .all(realmSlug, guildName, serverType) as Array<{ character_name: string; profession: string | null }>;
  for (const r of recipeProfs) {
    if (!r.profession) continue;
    const key = r.character_name.toLowerCase();
    const existing = professionsByChar.get(key) ?? [];
    if (!existing.includes(r.profession)) {
      professionsByChar.set(key, [...existing, r.profession]);
    }
  }

  // Enhance with Blizzard API (8s timeout so response stays fast)
  const realmForProf = roster.realm ?? realmSlug;
  const BATCH = 8;
  const PROF_TIMEOUT_MS = 8000;
  const startProf = Date.now();
  for (let i = 0; i < roster.members.length && Date.now() - startProf < PROF_TIMEOUT_MS - 500; i += BATCH) {
    const batch = roster.members.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((m) =>
        fetchCharacterProfessions(realmForProf, m.name, region, serverType)
      )
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r?.status === "fulfilled" && r.value.length > 0) {
        const formatted = r.value.map((p) =>
          p.skill_points != null && p.max_skill_points != null
            ? `${p.name} (${p.skill_points}/${p.max_skill_points})`
            : p.name
        );
        professionsByChar.set(batch[j].name.toLowerCase(), formatted);
      }
    }
    if (i + BATCH < roster.members.length) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
  const members = roster.members.map((m) => {
    const profs = professionsByChar.get(m.name.toLowerCase()) ?? [];
    return {
      name: m.name,
      class: m.class,
      level: m.level,
      professions: profs,
      guild_profession_stars: [] as string[],
    };
  });
  res.json({ members });
});

authRoutes.put("/me/guild-profession-star", requireAuth, async (req, res) => {
  const { realm, guild_name, server_type, character_name, profession_type, starred } = req.body;
  if (!realm || !guild_name || !character_name || typeof character_name !== "string" || !profession_type || typeof profession_type !== "string") {
    res.status(400).json({ error: "realm, guild_name, character_name, and profession_type required" });
    return;
  }
  if (!(PROFESSION_TYPES as readonly string[]).includes(profession_type)) {
    res.status(400).json({ error: "Invalid profession_type" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = String(realm).toLowerCase().replace(/\s+/g, "-");
  const serverType = server_type || "Retail";
  const charName = String(character_name).trim();
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, serverType);
  if (!perms?.manage_guild_crafters) {
    res.status(403).json({ error: "You do not have permission to manage guild crafters" });
    return;
  }
  if (serverType === "TBC Anniversary") {
    const exists = db.prepare(
      `SELECT 1 FROM guild_crafter_roster
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
    ).get(realmSlug, guild_name, serverType, charName);
    if (!exists) {
      res.status(400).json({ error: "Character must be added to the crafter roster before starring" });
      return;
    }
  } else {
    const userRow = db.prepare("SELECT battlenet_region FROM users WHERE id = ?").get(userId) as { battlenet_region: string | null } | undefined;
    const region = userRow?.battlenet_region ?? "us";
    try {
      const roster = await fetchGuildRoster(region, realmSlug, guild_name, serverType);
      const isInGuild = roster.members.some((m) => m.name.toLowerCase() === charName.toLowerCase());
      if (!isInGuild) {
        res.status(400).json({ error: "Character is not in this guild" });
        return;
      }
    } catch {
      res.status(400).json({ error: "Could not verify guild roster. Ensure the guild exists and try again." });
      return;
    }
  }
  // Guild Crafter starring removed; endpoint kept for backwards compatibility
  res.json({ ok: true });
});

// TBC Anniversary: add/update/remove manual crafter
authRoutes.post("/me/guild-crafter", requireAuth, (req, res) => {
  const { realm, guild_name, server_type, character_name, professions, profession_notes } = req.body;
  if (!realm || !guild_name || !character_name || typeof character_name !== "string") {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const serverType = server_type || "Retail";
  if (serverType !== "TBC Anniversary") {
    res.status(400).json({ error: "Manual crafter add is only for TBC Anniversary" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = String(realm).toLowerCase().replace(/\s+/g, "-");
  const charName = String(character_name).trim();
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, serverType);
  if (!perms?.manage_guild_crafters) {
    res.status(403).json({ error: "You do not have permission to manage guild crafters" });
    return;
  }
  const profsJson = Array.isArray(professions)
    ? JSON.stringify(professions.filter((p: unknown) => typeof p === "string"))
    : "[]";
  const notes = typeof profession_notes === "string" ? profession_notes.trim() : "";
  db.prepare(
    `INSERT OR REPLACE INTO guild_crafter_roster (guild_realm_slug, guild_name, server_type, character_name, professions, profession_notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(realmSlug, guild_name, serverType, charName, profsJson, notes || null);
  res.json({ ok: true });
});

authRoutes.put("/me/guild-crafter", requireAuth, (req, res) => {
  const { realm, guild_name, server_type, character_name, professions, profession_notes } = req.body;
  if (!realm || !guild_name || !character_name || typeof character_name !== "string") {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const serverType = server_type || "Retail";
  if (serverType !== "TBC Anniversary") {
    res.status(400).json({ error: "Manual crafter update is only for TBC Anniversary" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = String(realm).toLowerCase().replace(/\s+/g, "-");
  const charName = String(character_name).trim();
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, serverType);
  if (!perms?.manage_guild_crafters) {
    res.status(403).json({ error: "You do not have permission to manage guild crafters" });
    return;
  }
  const exists = db.prepare(
    `SELECT 1 FROM guild_crafter_roster
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).get(realmSlug, guild_name, serverType, charName);
  if (!exists) {
    res.status(404).json({ error: "Crafter not found" });
    return;
  }
  const profsJson = Array.isArray(professions)
    ? JSON.stringify(professions.filter((p: unknown) => typeof p === "string"))
    : null;
  const notes = typeof profession_notes === "string" ? profession_notes.trim() : null;
  const updates: string[] = [];
  const values: unknown[] = [];
  if (professions !== undefined) {
    updates.push("professions = ?");
    values.push(profsJson ?? "[]");
  }
  if (profession_notes !== undefined) {
    updates.push("profession_notes = ?");
    values.push(notes);
  }
  if (updates.length > 0) {
    values.push(realmSlug, guild_name, serverType, charName);
    db.prepare(
      `UPDATE guild_crafter_roster SET ${updates.join(", ")}
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
    ).run(...values);
  }
  res.json({ ok: true });
});

authRoutes.delete("/me/guild-crafter", requireAuth, (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  const characterName = (req.query.character_name as string)?.trim();
  if (!realm || !guildName || !characterName) {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  if (serverType !== "TBC Anniversary") {
    res.status(400).json({ error: "Manual crafter delete is only for TBC Anniversary" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  if (!perms?.manage_guild_crafters) {
    res.status(403).json({ error: "You do not have permission to manage guild crafters" });
    return;
  }
  db.prepare(
    `DELETE FROM guild_crafter_roster
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).run(realmSlug, guildName, serverType, characterName);
  db.prepare(
    `DELETE FROM guild_profession_stars
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).run(realmSlug, guildName, serverType, characterName);
  res.json({ ok: true });
});

function normalizeAvailability(s: string | undefined): string {
  if (!s || typeof s !== "string") return "0000000";
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const c = s[i]?.toLowerCase();
    out.push(c === "0" || c === "n" || c === "f" ? "0" : "1");
  }
  return out.join("").padEnd(7, "0").slice(0, 7);
}

// Raider roster
authRoutes.get("/me/raider-roster", requireAuth, qaMockMiddleware("raider-roster"), (req, res) => {
  const guildRealm = (req.query.guild_realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  if (!guildRealm || !guildName) {
    res.status(400).json({ error: "guild_realm and guild_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = guildRealm.toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  if (!perms?.view_raid_roster) {
    res.status(403).json({ error: "You do not have permission to view the raid roster" });
    return;
  }
  let raiders = db
    .prepare(
      `SELECT * FROM raider_roster
       WHERE user_id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?
       ORDER BY character_name`
    )
    .all(userId, realmSlug, guildName, serverType);
  if (raiders.length === 0) {
    const guildOwner = db.prepare(
      `SELECT user_id FROM raider_roster
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND user_id IS NOT NULL
       GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1`
    ).get(realmSlug, guildName, serverType) as { user_id: number } | undefined;
    if (guildOwner) {
      raiders = db
        .prepare(
          `SELECT * FROM raider_roster
           WHERE user_id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?
           ORDER BY character_name`
        )
        .all(guildOwner.user_id, realmSlug, guildName, serverType);
    } else {
      raiders = db
        .prepare(
          `SELECT * FROM raider_roster
           WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
           ORDER BY character_name`
        )
        .all(realmSlug, guildName, serverType);
    }
  }
  raiders = (raiders as Array<Record<string, unknown> & { character_name?: string }>).map((r) => ({
    ...r,
    guild_profession_stars: [] as string[],
    professions: (() => {
      try {
        const p = (r as { professions?: string | null }).professions;
        return p ? (JSON.parse(p) as string[]) : [];
      } catch {
        return [];
      }
    })(),
  }));
  // Hide officer_notes and optionally player notes from view-only users
  if (!perms?.manage_raid_roster) {
    const myCharRows = db.prepare(
      `SELECT LOWER(bnc.name) as name FROM battle_net_characters bnc
       LEFT JOIN guilds g ON bnc.guild_id = g.id
       WHERE bnc.user_id = ? AND bnc.realm_slug = ? AND (LOWER(COALESCE(g.name, bnc.guild_name, '')) = LOWER(?) OR LOWER(bnc.guild_name) = LOWER(?))
       AND (bnc.server_type = ? OR (bnc.server_type IS NULL AND ? = 'Retail'))`
    ).all(userId, realmSlug, guildName, guildName, serverType, serverType) as Array<{ name: string }>;
    const myCharSet = new Set(myCharRows.map((row) => row.name));
    raiders = (raiders as Array<Record<string, unknown> & { character_name?: string; notes_public?: number }>).map((r) => {
      const copy = { ...r };
      delete copy.officer_notes;
      const isOwn = myCharSet.has((r.character_name || "").toLowerCase());
      const isPublic = r.notes_public === 1;
      if (!isOwn && !isPublic) {
        copy.notes = null;
      }
      return copy;
    });
  }
  res.json({ raiders });
});

// Guild crafters (member-facing: starred guild crafters by profession)
authRoutes.get("/me/guild-recipes", requireAuth, (req, res) => {
  const guildRealm = (req.query.guild_realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  if (!guildRealm || !guildName) {
    res.status(400).json({ error: "guild_realm and guild_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = guildRealm.toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  if (!perms?.view_guild_roster) {
    res.status(403).json({ error: "You do not have permission to view guild crafters" });
    return;
  }
  const rows = db
    .prepare(
      `SELECT character_name, profession_type, notes
       FROM guild_member_professions
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
       ORDER BY profession_type, character_name`
    )
    .all(realmSlug, guildName, serverType) as Array<{ character_name: string; profession_type: string; notes: string | null }>;
  const crafters = rows.map((r) => ({ character_name: r.character_name, profession_type: r.profession_type }));
  const crafterNotes: Record<string, string> = {};
  for (const r of rows) {
    if (r.notes) crafterNotes[`${r.character_name.toLowerCase()}:${r.profession_type}`] = r.notes;
  }
  res.json({ crafters, crafter_notes: crafterNotes });
});

// Full guild crafters UI: members with professions (hierarchical), guild roster for add, permissions, my characters
authRoutes.get("/me/guild-crafters-full", requireAuth, async (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realm || !guildName) {
    res.status(400).json({ error: "realm and guild_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  if (!perms?.view_guild_roster) {
    res.status(403).json({ error: "You do not have permission to view guild crafters" });
    return;
  }
  const crafterList = db
    .prepare(
      `SELECT character_name FROM guild_crafter_list
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
       ORDER BY character_name`
    )
    .all(realmSlug, guildName, serverType) as Array<{ character_name: string }>;
  const rows = db
    .prepare(
      `SELECT character_name, profession_type, notes, profession_level
       FROM guild_member_professions
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
       ORDER BY character_name, profession_type`
    )
    .all(realmSlug, guildName, serverType) as Array<{
      character_name: string;
      profession_type: string;
      notes: string | null;
      profession_level: number | null;
    }>;
  const membersByChar = new Map<
    string,
    { name: string; class: string; level: number; professions: Array<{ profession_type: string; notes: string; profession_level: number | null }> }
  >();
  for (const c of crafterList) {
    const key = c.character_name.toLowerCase();
    membersByChar.set(key, { name: c.character_name, class: "", level: 0, professions: [] });
  }
  for (const r of rows) {
    const key = r.character_name.toLowerCase();
    if (membersByChar.has(key)) {
      membersByChar.get(key)!.professions.push({
        profession_type: r.profession_type,
        notes: r.notes || "",
        profession_level: r.profession_level,
      });
    }
  }
  let guildRoster: Array<{ name: string; class: string; level: number }> = [];
  try {
    const userRow = db.prepare("SELECT battlenet_region FROM users WHERE id = ?").get(userId) as { battlenet_region: string | null } | undefined;
    const region = userRow?.battlenet_region ?? "us";
    const roster = await fetchGuildRoster(region, realmSlug, guildName, serverType);
    guildRoster = roster.members || [];
    const rosterByChar = new Map(guildRoster.map((m) => [m.name.toLowerCase(), m]));
    for (const m of membersByChar.values()) {
      const r = rosterByChar.get(m.name.toLowerCase());
      if (r) {
        m.class = r.class || "";
        m.level = r.level || 0;
      }
    }
  } catch {
    /* guild roster optional */
  }
  const members = [...membersByChar.values()];
  const myCharRows = db
    .prepare(
      `SELECT LOWER(bnc.name) as name FROM battle_net_characters bnc
       WHERE bnc.user_id = ? AND LOWER(bnc.realm_slug) = ? AND LOWER(TRIM(COALESCE(bnc.guild_name, ''))) = LOWER(TRIM(?)) AND bnc.server_type = ?`
    )
    .all(userId, realmSlug, guildName, serverType) as Array<{ name: string }>;
  const myCharacterNames = new Set(myCharRows.map((r) => r.name));
  const myCharsOnRealm = new Set(
    (db.prepare("SELECT LOWER(name) as name FROM battle_net_characters WHERE user_id = ? AND LOWER(realm_slug) = ? AND server_type = ?")
      .all(userId, realmSlug, serverType) as Array<{ name: string }>).map((r) => r.name)
  );
  const myCharsInGuild = guildRoster.filter((m) => myCharsOnRealm.has(m.name.toLowerCase())).map((m) => ({
    name: m.name,
    class: m.class || "",
    level: m.level || 0,
  }));
  res.json({
    members,
    guild_roster: guildRoster,
    permissions: perms,
    my_character_names: [...myCharacterNames],
    my_characters: myCharsInGuild,
  });
});

authRoutes.delete("/me/guild-crafter-list", requireAuth, (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  const characterName = (req.query.character_name as string)?.trim();
  if (!realm || !guildName || !characterName) {
    res.status(400).json({ error: "realm, guild_name, and character_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  const myCharRows = db
    .prepare(
      `SELECT LOWER(name) as name FROM battle_net_characters WHERE user_id = ? AND LOWER(realm_slug) = ? AND server_type = ?`
    )
    .all(userId, realmSlug, serverType) as Array<{ name: string }>;
  const myChars = new Set(myCharRows.map((r) => r.name));
  const isOwn = myChars.has(characterName.toLowerCase());
  const canRemove = perms?.manage_guild_crafters || (perms?.view_guild_roster && isOwn);
  if (!canRemove) {
    res.status(403).json({ error: "You can only remove your own character, or manage as officer" });
    return;
  }
  db.prepare(
    `DELETE FROM guild_member_professions
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).run(realmSlug, guildName, serverType, characterName);
  db.prepare(
    `DELETE FROM guild_profession_stars
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).run(realmSlug, guildName, serverType, characterName);
  db.prepare(
    `DELETE FROM guild_crafter_list
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).run(realmSlug, guildName, serverType, characterName);
  res.json({ ok: true });
});

authRoutes.post("/me/guild-crafter-list", requireAuth, (req, res) => {
  const { realm, guild_name, server_type, character_names } = req.body;
  if (!realm || !guild_name || !Array.isArray(character_names) || character_names.length === 0) {
    res.status(400).json({ error: "realm, guild_name, and character_names (array) required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = String(realm).toLowerCase().replace(/\s+/g, "-");
  const serverType = server_type || "Retail";
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, serverType);
  const myCharRows = db
    .prepare(
      `SELECT LOWER(name) as name FROM battle_net_characters WHERE user_id = ? AND LOWER(realm_slug) = ? AND server_type = ?`
    )
    .all(userId, realmSlug, serverType) as Array<{ name: string }>;
  const myChars = new Set(myCharRows.map((r) => r.name));
  const canManage = !!perms?.manage_guild_crafters;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO guild_crafter_list (guild_realm_slug, guild_name, server_type, character_name) VALUES (?, ?, ?, ?)`
  );
  let added = 0;
  for (const name of character_names) {
    const charName = String(name).trim();
    if (!charName) continue;
    const isOwn = myChars.has(charName.toLowerCase());
    const canAdd = canManage || (perms?.view_guild_roster && isOwn);
    if (!canAdd) continue;
    const r = insert.run(realmSlug, guild_name, serverType, charName);
    if (r.changes > 0) added++;
  }
  res.json({ ok: true, added });
});

authRoutes.post("/me/guild-member-profession", requireAuth, (req, res) => {
  const { realm, guild_name, server_type, character_name, profession_type } = req.body;
  if (!realm || !guild_name || !character_name || !profession_type || typeof character_name !== "string" || typeof profession_type !== "string") {
    res.status(400).json({ error: "realm, guild_name, character_name, and profession_type required" });
    return;
  }
  if (!(PROFESSION_TYPES as readonly string[]).includes(profession_type)) {
    res.status(400).json({ error: "Invalid profession_type" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = String(realm).toLowerCase().replace(/\s+/g, "-");
  const serverType = server_type || "Retail";
  const charName = String(character_name).trim();
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, serverType);
  const myCharRows = db
    .prepare(
      `SELECT LOWER(name) as name FROM battle_net_characters WHERE user_id = ? AND LOWER(realm_slug) = ? AND server_type = ?`
    )
    .all(userId, realmSlug, serverType) as Array<{ name: string }>;
  const myChars = new Set(myCharRows.map((r) => r.name));
  const isOwn = myChars.has(charName.toLowerCase());
  const canAdd = perms?.manage_guild_crafters || (perms?.view_guild_roster && isOwn);
  if (!canAdd) {
    res.status(403).json({ error: "You can only add professions for your own characters, or manage guild crafters as officer" });
    return;
  }
  db.prepare(
    `INSERT OR IGNORE INTO guild_crafter_list (guild_realm_slug, guild_name, server_type, character_name) VALUES (?, ?, ?, ?)`
  ).run(realmSlug, guild_name, serverType, charName);
  db.prepare(
    `INSERT OR IGNORE INTO guild_member_professions (guild_realm_slug, guild_name, server_type, character_name, profession_type, notes, profession_level)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`
  ).run(realmSlug, guild_name, serverType, charName, profession_type);
  res.json({ ok: true });
});

authRoutes.put("/me/guild-member-profession", requireAuth, (req, res) => {
  const { realm, guild_name, server_type, character_name, profession_type, notes, profession_level } = req.body;
  if (!realm || !guild_name || !character_name || !profession_type || typeof character_name !== "string" || typeof profession_type !== "string") {
    res.status(400).json({ error: "realm, guild_name, character_name, and profession_type required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = String(realm).toLowerCase().replace(/\s+/g, "-");
  const serverType = server_type || "Retail";
  const charName = String(character_name).trim();
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, serverType);
  const myCharRows = db
    .prepare(
      `SELECT LOWER(name) as name FROM battle_net_characters WHERE user_id = ? AND LOWER(realm_slug) = ? AND server_type = ?`
    )
    .all(userId, realmSlug, serverType) as Array<{ name: string }>;
  const myChars = new Set(myCharRows.map((r) => r.name));
  const isOwn = myChars.has(charName.toLowerCase());
  const canEditOwn = perms?.view_guild_roster && isOwn;
  const canManage = perms?.manage_guild_crafters;
  if (!canEditOwn && !canManage) {
    res.status(403).json({ error: "You can only edit your own character's professions, or manage as officer" });
    return;
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  if (notes !== undefined) {
    updates.push("notes = ?");
    values.push(typeof notes === "string" ? notes.trim() || null : null);
  }
  if (profession_level !== undefined) {
    updates.push("profession_level = ?");
    values.push(profession_level === null || profession_level === "" ? null : Math.min(525, Math.max(0, +profession_level)));
  }
  if (updates.length === 0) {
    res.json({ ok: true });
    return;
  }
  values.push(realmSlug, guild_name, serverType, charName, profession_type);
  db.prepare(
    `UPDATE guild_member_professions SET ${updates.join(", ")}
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?) AND profession_type = ?`
  ).run(...values);
  res.json({ ok: true });
});

authRoutes.delete("/me/guild-member-profession", requireAuth, (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  const characterName = (req.query.character_name as string)?.trim();
  const professionType = (req.query.profession_type as string)?.trim();
  if (!realm || !guildName || !characterName || !professionType) {
    res.status(400).json({ error: "realm, guild_name, character_name, profession_type required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  const myCharRows = db
    .prepare(
      `SELECT LOWER(name) as name FROM battle_net_characters WHERE user_id = ? AND LOWER(realm_slug) = ? AND server_type = ?`
    )
    .all(userId, realmSlug, serverType) as Array<{ name: string }>;
  const myChars = new Set(myCharRows.map((r) => r.name));
  const isOwn = myChars.has(characterName.toLowerCase());
  const canDelete = perms?.manage_guild_crafters || (perms?.view_guild_roster && isOwn);
  if (!canDelete) {
    res.status(403).json({ error: "You can only delete your own character's professions, or manage as officer" });
    return;
  }
  db.prepare(
    `DELETE FROM guild_member_professions
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?) AND profession_type = ?`
  ).run(realmSlug, guildName, serverType, characterName, professionType);
  res.json({ ok: true });
});

authRoutes.put("/me/raider-roster", requireAuth, (req, res) => {
  const { guild_name, guild_realm, guild_realm_slug, server_type, raiders } = req.body;
  if (!guild_name || !guild_realm || !raiders || !Array.isArray(raiders)) {
    res.status(400).json({ error: "guild_name, guild_realm, raiders (array) required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = guild_realm_slug ?? String(guild_realm).toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, server_type || "Retail");
  if (!perms?.manage_raid_roster) {
    res.status(403).json({ error: "You do not have permission to manage the raid roster" });
    return;
  }
  db.prepare(
    "DELETE FROM raider_roster WHERE user_id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?"
  ).run(userId, realmSlug, guild_name, server_type || "Retail");
  const insert = db.prepare(
    `INSERT INTO raider_roster (user_id, guild_name, guild_realm_slug, server_type, character_name, character_class, primary_spec, off_spec, secondary_spec, notes, officer_notes, raid_role, raid_lead, raid_assist, availability, notes_public)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of raiders as Array<{ character_name: string; character_class: string; primary_spec?: string; off_spec?: string; secondary_spec?: string; notes?: string; officer_notes?: string; raid_role?: string; raid_lead?: number; raid_assist?: number; availability?: string; notes_public?: number | boolean }>) {
    if (r.character_name && r.character_class) {
      const avail = normalizeAvailability(r.availability);
      const notesPublic = r.notes_public === true || r.notes_public === 1 ? 1 : 0;
      insert.run(
        userId,
        guild_name,
        realmSlug,
        server_type || "Retail",
        r.character_name,
        r.character_class,
        r.primary_spec || null,
        r.off_spec || null,
        r.secondary_spec || null,
        r.notes || null,
        r.officer_notes || null,
        r.raid_role || null,
        r.raid_lead ? 1 : 0,
        r.raid_assist ? 1 : 0,
        avail,
        notesPublic
      );
    }
  }
  const saved = db.prepare(
    `SELECT * FROM raider_roster WHERE user_id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ? ORDER BY character_name`
  ).all(userId, realmSlug, guild_name, server_type || "Retail");
  res.json({ raiders: saved });
});

authRoutes.get("/me/character-search", requireAuth, qaMockMiddleware("character-search"), async (req, res) => {
  const realm = (req.query.realm as string)?.trim();
  const characterName = (req.query.character_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  if (!realm || !characterName) {
    res.status(400).json({ error: "realm and character_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const userRow = db.prepare("SELECT battlenet_region FROM users WHERE id = ?").get(userId) as { battlenet_region: string | null } | undefined;
  const region = userRow?.battlenet_region ?? "us";
  try {
    const summary = await fetchCharacterProfileSummary(realm, characterName, region, serverType);
    if (!summary) {
      res.status(404).json({ error: "Character not found" });
      return;
    }
    res.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Search failed";
    res.status(502).json({ error: msg });
  }
});

authRoutes.post("/me/raider-roster-add-character", requireAuth, async (req, res) => {
  const { guild_name, guild_realm, guild_realm_slug, server_type, character_name } = req.body;
  if (!guild_name || !character_name || typeof character_name !== "string") {
    res.status(400).json({ error: "guild_name and character_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = guild_realm_slug ?? String(guild_realm || "").toLowerCase().replace(/\s+/g, "-");
  const serverType = server_type || "Retail";
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, serverType);
  if (!perms?.manage_raid_roster) {
    res.status(403).json({ error: "You do not have permission to manage the raid roster" });
    return;
  }
  const userRow = db.prepare("SELECT battlenet_region FROM users WHERE id = ?").get(userId) as { battlenet_region: string | null } | undefined;
  const region = userRow?.battlenet_region ?? "us";
  const charName = String(character_name).trim();
  const existing = db.prepare(
    `SELECT 1 FROM raider_roster WHERE user_id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).get(userId, realmSlug, guild_name, serverType, charName);
  if (existing) {
    res.status(400).json({ error: "Character is already on the raid roster" });
    return;
  }
  const summary = await fetchCharacterProfileSummary(realmSlug, charName, region, serverType);
  if (!summary) {
    res.status(404).json({ error: "Character not found on this realm" });
    return;
  }
  db.prepare(
    `INSERT INTO raider_roster (user_id, guild_name, guild_realm_slug, server_type, character_name, character_class, primary_spec, off_spec, secondary_spec, notes, officer_notes, raid_role, raid_lead, raid_assist, availability, notes_public)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, '0000000', 0)`
  ).run(userId, guild_name, realmSlug, serverType, summary.name, summary.class);
  const row = db.prepare(
    `SELECT * FROM raider_roster WHERE user_id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
  ).get(userId, realmSlug, guild_name, serverType, summary.name) as Record<string, unknown>;
  res.status(201).json({ raider: row });
});

// View-only users can update their own availability and notes only
authRoutes.patch("/me/raider-roster/self", requireAuth, (req, res) => {
  const { guild_name, guild_realm, guild_realm_slug, server_type, updates } = req.body;
  if (!guild_name || !guild_realm || !updates || !Array.isArray(updates)) {
    res.status(400).json({ error: "guild_name, guild_realm, updates (array) required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = guild_realm_slug ?? String(guild_realm).toLowerCase().replace(/\s+/g, "-");
  const serverType = server_type || "Retail";
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, serverType);
  if (!perms?.view_raid_roster || perms.manage_raid_roster) {
    res.status(403).json({ error: "Use PUT /me/raider-roster for full roster updates" });
    return;
  }
  const myCharRows = db.prepare(
    `SELECT LOWER(bnc.name) as name FROM battle_net_characters bnc
     LEFT JOIN guilds g ON bnc.guild_id = g.id
     WHERE bnc.user_id = ? AND bnc.realm_slug = ? AND (LOWER(COALESCE(g.name, bnc.guild_name, '')) = LOWER(?) OR LOWER(bnc.guild_name) = LOWER(?))
     AND (bnc.server_type = ? OR (bnc.server_type IS NULL AND ? = 'Retail'))`
  ).all(userId, realmSlug, guild_name, guild_name, serverType, serverType) as Array<{ name: string }>;
  const myCharSet = new Set(myCharRows.map((r) => r.name));
  for (const u of updates as Array<{ character_name: string; availability?: string; notes?: string; raid_role?: string; primary_spec?: string; off_spec?: string; secondary_spec?: string; notes_public?: number | boolean }>) {
    const charName = (u.character_name || "").trim();
    if (!charName || !myCharSet.has(charName.toLowerCase())) continue;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof u.availability === "string") {
      sets.push("availability = ?");
      vals.push(normalizeAvailability(u.availability));
    }
    if (typeof u.notes === "string") {
      sets.push("notes = ?");
      vals.push(u.notes.trim() || null);
    }
    if (typeof u.raid_role === "string") {
      sets.push("raid_role = ?");
      vals.push(u.raid_role.trim() || null);
    }
    if (typeof u.primary_spec === "string") {
      sets.push("primary_spec = ?");
      vals.push(u.primary_spec.trim() || null);
    }
    if (typeof u.off_spec === "string") {
      sets.push("off_spec = ?");
      vals.push(u.off_spec.trim() || null);
    }
    if (typeof u.secondary_spec === "string") {
      sets.push("secondary_spec = ?");
      vals.push(u.secondary_spec.trim() || null);
    }
    if (u.notes_public === true || u.notes_public === 1) {
      sets.push("notes_public = 1");
    } else if (u.notes_public === false || u.notes_public === 0) {
      sets.push("notes_public = 0");
    }
    if (sets.length > 0) {
      vals.push(realmSlug, guild_name, serverType, charName);
      db.prepare(
        `UPDATE raider_roster SET ${sets.join(", ")} WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND LOWER(character_name) = LOWER(?)`
      ).run(...vals);
    }
  }
  const guildOwner = db.prepare(
    `SELECT user_id FROM raider_roster
     WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
     GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1`
  ).get(realmSlug, guild_name, serverType) as { user_id: number } | undefined;
  const raiders = guildOwner
    ? db
        .prepare(
          `SELECT * FROM raider_roster
           WHERE user_id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?
           ORDER BY character_name`
        )
        .all(guildOwner.user_id, realmSlug, guild_name, serverType)
    : [];
  res.json({ raiders });
});

// Raid teams
authRoutes.get("/me/raid-teams", requireAuth, (req, res) => {
  const guildRealm = (req.query.guild_realm as string)?.trim();
  const guildName = (req.query.guild_name as string)?.trim();
  const serverType = (req.query.server_type as string) || "Retail";
  if (!guildRealm || !guildName) {
    res.status(400).json({ error: "guild_realm and guild_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = guildRealm.toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guildName, serverType);
  if (!perms?.view_raid_roster) {
    res.status(403).json({ error: "You do not have permission to view raid teams" });
    return;
  }
  let teams = db
    .prepare(
      `SELECT * FROM raid_teams
       WHERE user_id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?
       ORDER BY team_name`
    )
    .all(userId, realmSlug, guildName, serverType);
  if (teams.length === 0) {
    const guildOwner = db.prepare(
      `SELECT user_id FROM raid_teams
       WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ? AND user_id IS NOT NULL
       GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1`
    ).get(realmSlug, guildName, serverType) as { user_id: number } | undefined;
    if (guildOwner) {
      teams = db
        .prepare(
          `SELECT * FROM raid_teams
           WHERE user_id = ? AND guild_realm_slug = ? AND guild_name = ? AND server_type = ?
           ORDER BY team_name`
        )
        .all(guildOwner.user_id, realmSlug, guildName, serverType);
    } else {
      teams = db
        .prepare(
          `SELECT * FROM raid_teams
           WHERE guild_realm_slug = ? AND guild_name = ? AND server_type = ?
           ORDER BY team_name`
        )
        .all(realmSlug, guildName, serverType);
    }
  }
  const teamsWithMembers = teams.map((t) => {
    const row = t as Record<string, unknown>;
    const members = db.prepare(
      "SELECT * FROM raid_team_members WHERE team_id = ? ORDER BY position, character_name"
    ).all(row.id as number);
    return { ...row, members };
  });
  res.json({ teams: teamsWithMembers });
});

authRoutes.post("/me/raid-teams", requireAuth, (req, res) => {
  const { guild_name, guild_realm, guild_realm_slug, server_type, team_name } = req.body;
  if (!guild_name || !guild_realm || !team_name) {
    res.status(400).json({ error: "guild_name, guild_realm, team_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = guild_realm_slug ?? String(guild_realm).toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, server_type || "Retail");
  if (!perms?.manage_raid_roster) {
    res.status(403).json({ error: "You do not have permission to manage raid teams" });
    return;
  }
  const result = db
    .prepare(
      `INSERT INTO raid_teams (user_id, guild_name, guild_realm_slug, server_type, team_name)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, guild_name, realmSlug, server_type || "Retail", team_name);
  const team = db.prepare("SELECT * FROM raid_teams WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown> | undefined;
  if (!team) {
    res.status(500).json({ error: "Failed to create team" });
    return;
  }
  res.status(201).json({ team: { ...team, members: [] } });
});

authRoutes.patch("/me/raid-teams/:id", requireAuth, (req, res) => {
  const teamId = parseInt(paramStr(req.params.id), 10);
  const { team_name } = req.body as { team_name?: string };
  if (!team_name?.trim()) {
    res.status(400).json({ error: "team_name required" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const team = db.prepare("SELECT * FROM raid_teams WHERE id = ? AND user_id = ?").get(teamId, userId) as { guild_realm_slug: string; guild_name: string; server_type: string } | undefined;
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const perms = getEffectiveGuildPermissions(db, userId, team.guild_realm_slug, team.guild_name, team.server_type || "Retail");
  if (!perms?.manage_raid_roster) {
    res.status(403).json({ error: "You do not have permission to manage raid teams" });
    return;
  }
  db.prepare("UPDATE raid_teams SET team_name = ? WHERE id = ?").run(team_name.trim(), teamId);
  const updated = db.prepare("SELECT * FROM raid_teams WHERE id = ?").get(teamId);
  res.json({ team: updated });
});

authRoutes.put("/me/raid-teams/:id/members", requireAuth, (req, res) => {
  const teamId = parseInt(paramStr(req.params.id), 10);
  const { members } = req.body as { members: Array<{ character_name: string; character_class: string }> };
  const db = getDb();
  const userId = req.session!.user!.id;
  const team = db.prepare("SELECT * FROM raid_teams WHERE id = ? AND user_id = ?").get(teamId, userId) as { guild_realm_slug: string; guild_name: string; server_type: string } | undefined;
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const perms = getEffectiveGuildPermissions(db, userId, team.guild_realm_slug, team.guild_name, team.server_type || "Retail");
  if (!perms?.manage_raid_roster) {
    res.status(403).json({ error: "You do not have permission to manage raid teams" });
    return;
  }
  db.prepare("DELETE FROM raid_team_members WHERE team_id = ?").run(teamId);
  const insert = db.prepare(
    "INSERT INTO raid_team_members (team_id, character_name, character_class, position) VALUES (?, ?, ?, ?)"
  );
  (members || []).forEach((m, i) => {
    if (m.character_name && m.character_class) {
      insert.run(teamId, m.character_name, m.character_class, i);
    }
  });
  const updated = db.prepare("SELECT * FROM raid_team_members WHERE team_id = ? ORDER BY position").all(teamId);
  res.json({ members: updated });
});

authRoutes.delete("/me/raid-teams/:id", requireAuth, (req, res) => {
  const teamId = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  const userId = req.session!.user!.id;
  const team = db.prepare("SELECT * FROM raid_teams WHERE id = ? AND user_id = ?").get(teamId, userId) as { guild_realm_slug: string; guild_name: string; server_type: string } | undefined;
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const perms = getEffectiveGuildPermissions(db, userId, team.guild_realm_slug, team.guild_name, team.server_type || "Retail");
  if (!perms?.manage_raid_roster) {
    res.status(403).json({ error: "You do not have permission to manage raid teams" });
    return;
  }
  db.prepare("DELETE FROM raid_teams WHERE id = ?").run(teamId);
  res.json({ ok: true });
});

authRoutes.delete("/me/saved-raids/:id", requireAuth, (req, res) => {
  const raidId = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  const userId = req.session!.user!.id;
  const raid = db.prepare("SELECT * FROM saved_raids WHERE id = ?").get(raidId) as { guild_realm_slug: string; guild_name: string; server_type: string } | undefined;
  if (!raid) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  const perms = getEffectiveGuildPermissions(db, userId, raid.guild_realm_slug, raid.guild_name, raid.server_type || "Retail");
  if (!perms?.manage_raids) {
    res.status(403).json({ error: "You do not have permission to delete raids" });
    return;
  }
  db.prepare("DELETE FROM saved_raids WHERE id = ?").run(raidId);
  res.json({ ok: true });
});

// Smart Raid: AI-assisted party formation based on availability
authRoutes.post("/me/smart-raid/form", requireAuth, async (req, res) => {
  const { guild_realm, guild_name, server_type, raids, availability } = req.body;
  if (!guild_realm || !guild_name || !availability || !Array.isArray(availability) || !raids || !Array.isArray(raids)) {
    res.status(400).json({ error: "guild_realm, guild_name, raids (array), and availability (array) required" });
    return;
  }
  const raidList = raids as Array<{ date: string; instance: string }>;
  if (raidList.some((r) => !r.date || !r.instance?.trim())) {
    res.status(400).json({ error: "Each raid must have date and instance" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const realmSlug = (guild_realm as string).toLowerCase().replace(/\s+/g, "-");
  const perms = getEffectiveGuildPermissions(db, userId, realmSlug, guild_name, (server_type as string) || "Retail");
  if (!perms?.manage_raids) {
    res.status(403).json({ error: "You do not have permission to use Smart Raid" });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Smart Raid is not configured (OPENAI_API_KEY missing)" });
    return;
  }

  const raidersWithSlots = availability.filter((a: { slots?: unknown[] }) => a.slots && a.slots.length > 0);
  if (raidersWithSlots.length === 0) {
    res.status(400).json({ error: "No raiders with availability. Set at least one raider as available for at least one raid." });
    return;
  }

  const raidsStr = raidList.map((r) => `${r.date} ${r.instance}`).join("; ");
  const openai = new OpenAI({ apiKey });
  const prompt = `You are a raid composition assistant for World of Warcraft. Given raids (date + instance) and raiders with their roles and availability windows, form optimal raid parties.

Raids: ${raidsStr}

Raiders and their availability (character, class, role, available raid+time windows):
${raidersWithSlots
  .map(
    (a: {
      character_name: string;
      character_class: string;
      raid_role?: string;
      slots: Array<{ date: string; instance?: string; start_time: string; end_time: string }>;
    }) =>
      `- ${a.character_name} (${a.character_class}, ${(a.raid_role || "dps").toLowerCase()}): ${a.slots
        .map((s) => `${s.date} ${s.instance || ""} ${s.start_time}-${s.end_time}`.trim())
        .join("; ")}`
  )
  .join("\n")}

Infer raid size from instance name (e.g. "Kara 10" = 10-man, "SSC" or "TK" often 25-man). Form balanced parties: 10-man typically 2 tank, 2-3 heal, 5-6 dps; 25-man typically 2 tank, 4-6 heal, rest dps. Each raider can only be in one party. Prioritize:
1. Role balance (tank, healer, dps)
2. Overlapping availability - put raiders who can play at the same times together
3. Instance-appropriate party size

Respond with ONLY valid JSON, no other text. Format:
{"parties":[{"party_index":0,"slots":[{"slot_index":0,"character_name":"Name","character_class":"Class","role":"Tank"},...]},{"party_index":1,"slots":[...]},...]}
role is Tank, Heal, or DPS. slot_index 0-based within each party.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      res.status(502).json({ error: "AI returned empty response" });
      return;
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    const parties = Array.isArray(parsed.parties) ? parsed.parties : [];
    res.json({ parties });
  } catch (err) {
    console.error("Smart Raid AI error:", err);
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to form raids. Check OPENAI_API_KEY and try again.",
    });
  }
});

// On-demand sync when user selects a game version (e.g. new user, or adding another version)
authRoutes.post("/me/sync", requireAuth, qaMockMiddleware("sync"), async (req, res) => {
  const serverType = (req.body?.server_type ?? req.query?.server_type) as string | undefined;
  if (!serverType || !serverType.trim()) {
    res.status(400).json({ error: "server_type is required (TBC Anniversary)" });
    return;
  }
  const validTypes = ["TBC Anniversary"];
  if (!validTypes.includes(serverType)) {
    res.status(400).json({ error: "Invalid server_type" });
    return;
  }
  const userId = req.session!.user!.id;
  const accessToken = (req.session as unknown as Record<string, unknown>).battlenetAccessToken as string | undefined;
  const region = (req.session as unknown as Record<string, unknown>).battlenetRegion as string | undefined;
  const expiresAt = (req.session as unknown as Record<string, unknown>).battlenetTokenExpiresAt as number | undefined;
  if (!accessToken || !region || !expiresAt || Date.now() > expiresAt) {
    res.status(401).json({ error: "Battle.net session expired. Please log in again with Battle.net to sync." });
    return;
  }
  try {
    const result = await syncGuildsFromBattleNet(userId, accessToken, region, [serverType]);
    res.json({ ok: true, guildsImported: result.guildsImported, charactersImported: result.charactersImported });
  } catch (err) {
    console.error("On-demand sync error:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

// Sync a single character's guild from Blizzard (when viewing character)
authRoutes.post("/me/characters/:id/sync-guild", requireAuth, async (req, res) => {
  const characterId = parseInt(paramStr(req.params.id), 10);
  if (!characterId || isNaN(characterId)) {
    res.status(400).json({ error: "Invalid character ID" });
    return;
  }
  const db = getDb();
  const userId = req.session!.user!.id;
  const userRow = db.prepare("SELECT battlenet_region FROM users WHERE id = ?").get(userId) as { battlenet_region: string | null } | undefined;
  const region = userRow?.battlenet_region ?? "us";

  const result = await syncCharacterGuild(userId, characterId, region);
  if (result.error) {
    console.error(`[sync-guild] character ${characterId}: ${result.error}`);
    res.status(502).json({ error: result.error });
    return;
  }
  res.json({ guild: result.guild ?? null });
});

authRoutes.get("/me", (req, res) => {
  if (!req.session?.user) {
    return res.json({ user: null });
  }
  const db = getDb();
  const row = db.prepare("SELECT id, username, role, battlenet_id, battlenet_battletag FROM users WHERE id = ?")
    .get(req.session.user.id) as { id: number; username: string; role: string; battlenet_id: string | null; battlenet_battletag: string | null } | undefined;
  if (!row) return res.json({ user: null });
  res.json({
    user: {
      ...req.session.user,
      battlenet_id: row.battlenet_id ?? undefined,
      display_name: (row.battlenet_battletag || row.username) ?? undefined,
    },
  });
});

// Battle.net OAuth: initiate login (signed state survives server restarts / no session)
authRoutes.get("/battlenet", (req, res) => {
  const clientId = process.env.BLIZZARD_CLIENT_ID;
  const redirectUri = process.env.BATTLE_NET_REDIRECT_URI || "http://localhost:5173/auth/battlenet/callback";
  const region = (req.query.region as string) || "us";

  if (!clientId) {
    res.status(500).json({ error: "Battle.net login not configured" });
    return;
  }
  if (!BATTLE_NET_REGIONS.includes(region as (typeof BATTLE_NET_REGIONS)[number])) {
    res.status(400).json({ error: "Invalid region" });
    return;
  }

  const signedState = createSignedState(region);

  const url = getAuthorizeUrl(
    region as (typeof BATTLE_NET_REGIONS)[number],
    clientId,
    redirectUri,
    signedState
  );
  res.redirect(url);
});

// Battle.net OAuth: handle callback (uses signed state - no session needed, works across restarts)
authRoutes.post("/battlenet/callback", async (req, res) => {
  const { code, state: signedState } = req.body;
  const clientId = process.env.BLIZZARD_CLIENT_ID;
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  const redirectUri = process.env.BATTLE_NET_REDIRECT_URI || "http://localhost:5173/auth/battlenet/callback";

  if (!code || !clientId || !clientSecret) {
    res.status(400).json({ error: "Missing code or Battle.net not configured" });
    return;
  }
  const parsed = verifySignedState(signedState);
  if (!parsed) {
    res.status(400).json({ error: "Invalid or expired state. Please try logging in again." });
    return;
  }
  const region = parsed.region;

  try {
    const tokenRes = await exchangeCodeForToken(
      region as (typeof BATTLE_NET_REGIONS)[number],
      code,
      clientId,
      clientSecret,
      redirectUri
    );

    const sub = tokenRes.id_token
      ? decodeIdToken(tokenRes.id_token).sub
      : null;
    if (!sub) {
      res.status(400).json({ error: "Could not get Battle.net account ID" });
      return;
    }

    const db = getDb();
    let user = db
      .prepare("SELECT id, username, role FROM users WHERE battlenet_id = ?")
      .get(sub) as { id: number; username: string; role: string } | undefined;

    let battletag: string | null = null;
    try {
      const info = await fetchBattleNetUserInfo(tokenRes.access_token, region as (typeof BATTLE_NET_REGIONS)[number]);
      battletag = info.battletag ?? null;
    } catch {
      // BattleTag fetch is optional
    }

    if (!user) {
      const username = `battlenet_${sub.slice(0, 12)}`;
      const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);
      const result = db
        .prepare(
          "INSERT INTO users (username, password_hash, role, battlenet_id, battlenet_region, battlenet_battletag) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(username, passwordHash, "member", sub, region, battletag);
      user = {
        id: result.lastInsertRowid as number,
        username,
        role: "member",
      };
    } else if (battletag) {
      db.prepare("UPDATE users SET battlenet_battletag = ? WHERE id = ?").run(battletag, user.id);
    }

    req.session!.user = {
      id: user.id,
      username: user.username,
      role: user.role,
    };
    (req.session as unknown as Record<string, unknown>).battlenetAccessToken = tokenRes.access_token;
    (req.session as unknown as Record<string, unknown>).battlenetRegion = region;
    (req.session as unknown as Record<string, unknown>).battlenetTokenExpiresAt = Date.now() + (tokenRes.expires_in ?? 86400) * 1000;

    // Return immediately to avoid timeout (Vercel/Render ~30s). Sync runs in background.
    res.json({ user: req.session!.user });

    // Always sync TBC Anniversary for all users
    const serverTypesToFetch = ["TBC Anniversary"];

    syncGuildsFromBattleNet(user.id, tokenRes.access_token, region, serverTypesToFetch)
      .then((syncResult) => {
        if (syncResult.guildsImported > 0) {
          console.log(`Synced ${syncResult.guildsImported} guild(s) for user ${user.username}`);
        }
      })
      .catch((err) => console.error("Background sync failed:", err));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Battle.net login failed";
    console.error("Battle.net callback error:", err);
    res.status(502).json({ error: msg });
  }
});
