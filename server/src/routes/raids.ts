import { Router } from "express";
import { getDb } from "../db/init.js";
import { requireAuth } from "../middleware/auth.js";
import { paramStr } from "../utils.js";

export const raidRoutes = Router();

function isMember(db: ReturnType<typeof import("better-sqlite3")>, guildId: number, userId: number) {
  const m = db.prepare("SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  return !!m;
}

function isLeader(db: ReturnType<typeof import("better-sqlite3")>, guildId: number, userId: number) {
  const m = db.prepare("SELECT is_leader FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId) as { is_leader: number } | undefined;
  return m?.is_leader === 1;
}

// List raids for guild
raidRoutes.get("/guild/:guildId", requireAuth, (req, res) => {
  const guildId = parseInt(paramStr(req.params.guildId), 10);
  const db = getDb();
  if (!isMember(db, guildId, req.session!.user!.id)) {
    res.status(404).json({ error: "Guild not found" });
    return;
  }
  const raids = db
    .prepare(
      `SELECT r.*, 
        (SELECT COUNT(*) FROM raid_slots rs WHERE rs.raid_id = r.id) as slot_count,
        (SELECT COUNT(*) FROM sign_ups su WHERE su.raid_id = r.id) as signup_count
       FROM raids r
       WHERE r.guild_id = ?
       ORDER BY r.raid_date ASC, r.raid_time ASC`
    )
    .all(guildId);
  res.json({ raids });
});

// Create raid (leader only)
raidRoutes.post("/", requireAuth, (req, res) => {
  const { guild_id, name, instance, raid_date, raid_time } = req.body;
  if (!guild_id || !name || !raid_date || !raid_time) {
    res.status(400).json({ error: "guild_id, name, raid_date, raid_time required" });
    return;
  }

  const db = getDb();
  if (!isLeader(db, guild_id, req.session!.user!.id)) {
    res.status(403).json({ error: "Leader access required" });
    return;
  }

  const result = db
    .prepare(
      "INSERT INTO raids (guild_id, name, instance, raid_date, raid_time, created_by) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(guild_id, name, instance || null, raid_date, raid_time, req.session!.user!.id);
  const raidId = result.lastInsertRowid as number;

  // Create default slots: 2 tanks, 4 healers, 14 dps (20-man)
  const defaultSlots = [
    ...Array(2).fill("tank"),
    ...Array(4).fill("healer"),
    ...Array(14).fill("dps"),
  ];
  const insertSlot = db.prepare(
    "INSERT INTO raid_slots (raid_id, position, role, character_id) VALUES (?, ?, ?, NULL)"
  );
  defaultSlots.forEach((role, i) => insertSlot.run(raidId, i + 1, role));

  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  const slots = db.prepare("SELECT * FROM raid_slots WHERE raid_id = ? ORDER BY position").all(raidId);
  res.status(201).json({ raid, slots });
});

// Get single raid with slots and signups
raidRoutes.get("/:id", requireAuth, (req, res) => {
  const raidId = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId) as { guild_id: number } | undefined;
  if (!raid || !isMember(db, raid.guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }

  const slots = db
    .prepare(
      `SELECT rs.*, c.name as character_name, c.class, c.spec, c.role as character_role
       FROM raid_slots rs
       LEFT JOIN characters c ON rs.character_id = c.id
       WHERE rs.raid_id = ?
       ORDER BY rs.position`
    )
    .all(raidId);
  const signups = db
    .prepare(
      `SELECT su.*, c.name as character_name, c.class, c.role
       FROM sign_ups su
       JOIN characters c ON su.character_id = c.id
       WHERE su.raid_id = ?
       ORDER BY su.status, c.name`
    )
    .all(raidId);
  const notes = db
    .prepare(
      `SELECT rn.*, c.name as character_name
       FROM raid_notes rn
       JOIN characters c ON rn.character_id = c.id
       WHERE rn.raid_id = ?`
    )
    .all(raidId);

  res.json({ raid, slots, signups, notes });
});

// Update raid (leader only)
raidRoutes.patch("/:id", requireAuth, (req, res) => {
  const { name, instance, raid_date, raid_time, is_published } = req.body;
  const db = getDb();
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(parseInt(paramStr(req.params.id), 10)) as { guild_id: number } | undefined;
  if (!raid || !isLeader(db, raid.guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  if (name !== undefined) {
    updates.push("name = ?");
    values.push(name);
  }
  if (instance !== undefined) {
    updates.push("instance = ?");
    values.push(instance);
  }
  if (raid_date !== undefined) {
    updates.push("raid_date = ?");
    values.push(raid_date);
  }
  if (raid_time !== undefined) {
    updates.push("raid_time = ?");
    values.push(raid_time);
  }
  if (is_published !== undefined) {
    updates.push("is_published = ?");
    values.push(is_published ? 1 : 0);
  }
  if (updates.length === 0) {
    res.status(400).json({ error: "No updates provided" });
    return;
  }
  values.push(parseInt(paramStr(req.params.id), 10));
  db.prepare(`UPDATE raids SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const updated = db.prepare("SELECT * FROM raids WHERE id = ?").get(parseInt(paramStr(req.params.id), 10));
  res.json({ raid: updated });
});

// Assign character to raid slot (leader only)
raidRoutes.put("/:id/slots/:slotId", requireAuth, (req, res) => {
  const { character_id } = req.body;
  const raidId = parseInt(paramStr(req.params.id), 10);
  const slotId = parseInt(paramStr(req.params.slotId), 10);
  const db = getDb();
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId) as { guild_id: number } | undefined;
  if (!raid || !isLeader(db, raid.guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }

  const slot = db.prepare("SELECT * FROM raid_slots WHERE id = ? AND raid_id = ?").get(slotId, raidId);
  if (!slot) {
    res.status(404).json({ error: "Slot not found" });
    return;
  }

  if (character_id === null || character_id === undefined) {
    db.prepare("UPDATE raid_slots SET character_id = NULL WHERE id = ?").run(slotId);
  } else {
    const char = db.prepare("SELECT * FROM characters WHERE id = ? AND guild_id = ?").get(character_id, raid.guild_id);
    if (!char) {
      res.status(400).json({ error: "Character not in guild" });
      return;
    }
    db.prepare("UPDATE raid_slots SET character_id = ? WHERE id = ?").run(character_id, slotId);
  }

  const updated = db.prepare("SELECT * FROM raid_slots WHERE id = ?").get(slotId);
  res.json({ slot: updated });
});

// Delete raid (leader only)
raidRoutes.delete("/:id", requireAuth, (req, res) => {
  const raidId = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId) as { guild_id: number } | undefined;
  if (!raid || !isLeader(db, raid.guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  db.prepare("DELETE FROM raids WHERE id = ?").run(raidId);
  res.json({ ok: true });
});

// Add raid note (leader only)
raidRoutes.post("/:id/notes", requireAuth, (req, res) => {
  const { character_id, note } = req.body;
  const raidId = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId) as { guild_id: number } | undefined;
  if (!raid || !isLeader(db, raid.guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  if (!character_id || !note) {
    res.status(400).json({ error: "character_id and note required" });
    return;
  }
  const char = db.prepare("SELECT * FROM characters WHERE id = ? AND guild_id = ?").get(character_id, raid.guild_id);
  if (!char) {
    res.status(400).json({ error: "Character not in guild" });
    return;
  }

  db.prepare(
    `INSERT INTO raid_notes (raid_id, character_id, note, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(raid_id, character_id) DO UPDATE SET note = excluded.note, created_by = excluded.created_by`
  ).run(raidId, character_id, note, req.session!.user!.id);
  const rn = db.prepare(
    "SELECT * FROM raid_notes WHERE raid_id = ? AND character_id = ?"
  ).get(raidId, character_id);
  res.json({ note: rn });
});
