import { Router } from "express";
import { getDb } from "../db/init.js";
import { requireAuth } from "../middleware/auth.js";
import { paramStr } from "../utils.js";

export const characterRoutes = Router();

function isMember(db: ReturnType<typeof import("better-sqlite3")>, guildId: number, userId: number) {
  const m = db.prepare("SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  return !!m;
}

function isLeader(db: ReturnType<typeof import("better-sqlite3")>, guildId: number, userId: number) {
  const m = db.prepare("SELECT is_leader FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId) as { is_leader: number } | undefined;
  return m?.is_leader === 1;
}

// List characters in guild
characterRoutes.get("/guild/:guildId", requireAuth, (req, res) => {
  const guildId = parseInt(paramStr(req.params.guildId), 10);
  const db = getDb();
  if (!isMember(db, guildId, req.session!.user!.id)) {
    res.status(404).json({ error: "Guild not found" });
    return;
  }
  const characters = db
    .prepare(
      `SELECT c.*, u.username as owner_username
       FROM characters c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.guild_id = ?
       ORDER BY c.role, c.name`
    )
    .all(guildId);
  res.json({ characters });
});

// Add character: members add for themselves (user_id = self), leaders can add for anyone
characterRoutes.post("/", requireAuth, (req, res) => {
  const { guild_id, name, class: charClass, spec, off_spec, professions, role } = req.body;
  if (!guild_id || !name || !charClass || !role) {
    res.status(400).json({ error: "guild_id, name, class, and role required" });
    return;
  }
  if (!["tank", "healer", "dps"].includes(role)) {
    res.status(400).json({ error: "role must be tank, healer, or dps" });
    return;
  }

  const db = getDb();
  if (!isMember(db, guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Guild not found" });
    return;
  }
  // Members add for themselves; leaders can add for anyone (default self)
  const userId = isLeader(db, guild_id, req.session!.user!.id)
    ? (req.body.user_id ?? req.session!.user!.id)
    : req.session!.user!.id;

  try {
    const result = db
      .prepare(
        "INSERT INTO characters (guild_id, name, class, spec, off_spec, professions, role, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(guild_id, name, charClass, spec || null, off_spec || null, professions || null, role, userId || null);
    const char = db.prepare("SELECT * FROM characters WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ character: char });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(400).json({ error: "Character already exists in this guild" });
      return;
    }
    throw e;
  }
});

// Update character: members can update own characters, leaders can update any
characterRoutes.patch("/:id", requireAuth, (req, res) => {
  const { name, class: charClass, spec, off_spec, professions, role } = req.body;
  const db = getDb();
  const char = db.prepare("SELECT * FROM characters WHERE id = ?").get(parseInt(paramStr(req.params.id), 10)) as { guild_id: number; user_id: number | null } | undefined;
  if (!char || !isMember(db, char.guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  const canEdit = isLeader(db, char.guild_id, req.session!.user!.id) || char.user_id === req.session!.user!.id;
  if (!canEdit) {
    res.status(403).json({ error: "You can only edit your own characters" });
    return;
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  if (name !== undefined) {
    updates.push("name = ?");
    values.push(name);
  }
  if (charClass !== undefined) {
    updates.push("class = ?");
    values.push(charClass);
  }
  if (spec !== undefined) {
    updates.push("spec = ?");
    values.push(spec);
  }
  if (off_spec !== undefined) {
    updates.push("off_spec = ?");
    values.push(off_spec);
  }
  if (professions !== undefined) {
    updates.push("professions = ?");
    values.push(professions);
  }
  if (role !== undefined) {
    if (!["tank", "healer", "dps"].includes(role)) {
      res.status(400).json({ error: "role must be tank, healer, or dps" });
      return;
    }
    updates.push("role = ?");
    values.push(role);
  }
  if (updates.length === 0) {
    res.status(400).json({ error: "No updates provided" });
    return;
  }
  values.push(parseInt(paramStr(req.params.id), 10));
  db.prepare(`UPDATE characters SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const updated = db.prepare("SELECT * FROM characters WHERE id = ?").get(parseInt(paramStr(req.params.id), 10));
  res.json({ character: updated });
});

// Delete character: members can delete own characters, leaders can delete any
characterRoutes.delete("/:id", requireAuth, (req, res) => {
  const db = getDb();
  const char = db.prepare("SELECT * FROM characters WHERE id = ?").get(parseInt(paramStr(req.params.id), 10)) as { guild_id: number; user_id: number | null } | undefined;
  if (!char || !isMember(db, char.guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  const canDelete = isLeader(db, char.guild_id, req.session!.user!.id) || char.user_id === req.session!.user!.id;
  if (!canDelete) {
    res.status(403).json({ error: "You can only delete your own characters" });
    return;
  }
  db.prepare("DELETE FROM characters WHERE id = ?").run(parseInt(paramStr(req.params.id), 10));
  res.json({ ok: true });
});
