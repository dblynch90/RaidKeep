import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { fetchRealms } from "../services/blizzard.js";

export const blizzardRoutes = Router();

const VALID_SERVER_TYPES = ["TBC Anniversary"];

blizzardRoutes.get("/realms", requireAuth, async (req, res) => {
  const region = req.query.region as string;
  const serverType = req.query.server_type as string;

  if (!region || !serverType) {
    res.status(400).json({ error: "region and server_type query params required" });
    return;
  }
  if (!VALID_SERVER_TYPES.includes(serverType)) {
    res.status(400).json({ error: "Invalid server type" });
    return;
  }
  const validRegions = ["us", "eu", "kr", "tw"];
  if (!validRegions.includes(region.toLowerCase())) {
    res.status(400).json({ error: "region must be us, eu, kr, or tw" });
    return;
  }

  try {
    const realms = await fetchRealms(region, serverType);
    res.json({ realms });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Blizzard API error";
    res.status(502).json({ error: `Failed to fetch realms: ${message}` });
  }
});
