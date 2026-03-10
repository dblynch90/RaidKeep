/**
 * Quick test: fetch character professions from Blizzard API for TBC Classic.
 * Usage: npx tsx server/scripts/test-professions.ts [realm]
 * Default realm: dreamscythe
 */
import "dotenv/config";
import { fetchCharacterProfessions } from "../src/services/blizzard.js";

const realm = process.argv[2] ?? "dreamscythe";
const charName = "kapnhoof";
const region = "us";
const serverType = "TBC Anniversary";

console.log(`Testing professions for ${charName} on ${realm} (${serverType})...`);

try {
  const profs = await fetchCharacterProfessions(realm, charName, region, serverType);
  console.log("Result:", profs.length > 0 ? profs : "(empty array)");
  if (profs.length > 0) {
    profs.forEach((p) => {
      const level = p.skill_points != null ? " (" + p.skill_points + "/" + (p.max_skill_points ?? "?") + ")" : "";
      console.log("  -", p.name + level);
    });
  }
} catch (err) {
  console.error("Error:", err);
}
