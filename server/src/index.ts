import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

import { initDb } from "./db/init.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { blizzardRoutes } from "./routes/blizzard.js";
import { guildRoutes } from "./routes/guilds.js";
import { characterRoutes } from "./routes/characters.js";
import { raidRoutes } from "./routes/raids.js";
import { signUpRoutes } from "./routes/signups.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure DB is initialized
initDb();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "raidkeep-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/blizzard", blizzardRoutes);
app.use("/api/guilds", guildRoutes);
app.use("/api/characters", characterRoutes);
app.use("/api/raids", raidRoutes);
app.use("/api/signups", signUpRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`RaidKeep API running at http://localhost:${PORT}`);
});
