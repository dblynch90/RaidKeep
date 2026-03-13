import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env from server dir and project root (whichever exists)
const __dirnameServer = path.dirname(fileURLToPath(import.meta.url));
const serverEnv = path.resolve(__dirnameServer, "..", ".env");
const rootEnv = path.resolve(__dirnameServer, "..", "..", ".env");
config({ path: serverEnv });
config({ path: rootEnv });

import express from "express";
import cors from "cors";
import session from "express-session";

import { initDb } from "./db/init.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { blizzardRoutes } from "./routes/blizzard.js";
import { guildRoutes } from "./routes/guilds.js";
import { characterRoutes } from "./routes/characters.js";
import { raidRoutes } from "./routes/raids.js";
import { signUpRoutes } from "./routes/signups.js";

// Ensure DB is initialized
initDb();

const app = express();
const PORT = process.env.PORT || 3001;

// Required when behind reverse proxy (Vercel -> Render) so secure cookies and X-Forwarded-* are trusted
app.set("trust proxy", 1);

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://raidkeep.com",
      "https://www.raidkeep.com",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "raidkeep-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    proxy: process.env.NODE_ENV === "production", // Trust X-Forwarded-Proto for secure cookie when behind proxy
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      // In prod, frontend is on raidkeep.com; API is proxied via Vercel. Cookie must work for raidkeep.com.
      ...(process.env.NODE_ENV === "production" && { domain: ".raidkeep.com" }),
    },
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
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not set — Smart Raid will be unavailable. Add it to server/.env");
  }
});
