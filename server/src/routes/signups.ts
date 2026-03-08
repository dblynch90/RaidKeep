import { Router } from "express";
import { getDb } from "../db/init.js";
import { requireAuth } from "../middleware/auth.js";

export const signUpRoutes = Router();

function isMember(db: ReturnType<typeof import("better-sqlite3")>, guildId: number, userId: number) {
  const m = db.prepare("SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  return !!m;
}

// Sign up / update sign up (any guild member)
signUpRoutes.post("/", requireAuth, (req, res) => {
  const { raid_id, character_id, status = "interested", note } = req.body;
  if (!raid_id || !character_id) {
    res.status(400).json({ error: "raid_id and character_id required" });
    return;
  }
  if (!["interested", "tentative", "cannot"].includes(status)) {
    res.status(400).json({ error: "status must be interested, tentative, or cannot" });
    return;
  }

  const db = getDb();
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raid_id) as { guild_id: number } | undefined;
  if (!raid || !isMember(db, raid.guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }
  const char = db.prepare("SELECT * FROM characters WHERE id = ? AND guild_id = ?").get(character_id, raid.guild_id);
  if (!char) {
    res.status(400).json({ error: "Character not in guild" });
    return;
  }
  // User must own the character (or be leader - for simplicity we allow any member to sign up any roster char)
  // For MVP: any guild member can sign up any character. Could restrict to own chars later.

  db.prepare(
    `INSERT INTO sign_ups (raid_id, character_id, status, note) 
     VALUES (?, ?, ?, ?)
     ON CONFLICT(raid_id, character_id) DO UPDATE SET status = excluded.status, note = excluded.note`
  ).run(raid_id, character_id, status, note || null);

  const signup = db.prepare(
    "SELECT * FROM sign_ups WHERE raid_id = ? AND character_id = ?"
  ).get(raid_id, character_id);
  res.json({ signup });
});

// Remove sign up
signUpRoutes.delete("/", requireAuth, (req, res) => {
  const { raid_id, character_id } = req.body;
  if (!raid_id || !character_id) {
    res.status(400).json({ error: "raid_id and character_id required" });
    return;
  }

  const db = getDb();
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raid_id) as { guild_id: number } | undefined;
  if (!raid || !isMember(db, raid.guild_id, req.session!.user!.id)) {
    res.status(404).json({ error: "Raid not found" });
    return;
  }

  db.prepare("DELETE FROM sign_ups WHERE raid_id = ? AND character_id = ?").run(raid_id, character_id);
  res.json({ ok: true });
});
