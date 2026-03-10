/**
 * Raw API test - fetches professions endpoint and logs full response.
 */
import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "server", ".env") });
import { wow } from "blizzard.js";

const realm = process.argv[2] ?? "dreamscythe";
const charName = "kapnhoof";
const region = "us";
const namespaces = ["profile-classicann", "profile-classic-tbc", "profile-classic"];

const client = await wow.classic.createInstance({
  key: process.env.BLIZZARD_CLIENT_ID!,
  secret: process.env.BLIZZARD_CLIENT_SECRET!,
});
const tokenRes = await client.getApplicationToken({ origin: "us" });
const token = tokenRes.data.access_token as string;

const host = "https://us.api.blizzard.com";
const realmSlug = realm.toLowerCase();
const nameSlug = charName.toLowerCase();

// First try base character profile (no professions) to verify character exists
console.log("\n--- Base character profile (profile-classicann) ---");
const baseUrl = `${host}/profile/wow/character/${realmSlug}/${nameSlug}?namespace=profile-classicann-us&locale=en_US`;
const baseRes = await fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` } });
console.log("Status:", baseRes.status);
if (baseRes.ok) {
  const data = await baseRes.json();
  console.log("Name:", data.name, "| Level:", data.level, "| Class:", data.playable_class?.name);
} else {
  console.log("Body:", await baseRes.text());
}

for (const ns of namespaces) {
  const fullNs = `${ns}-us`;
  const url = `${host}/profile/wow/character/${realmSlug}/${nameSlug}/professions?namespace=${fullNs}&locale=en_US`;
  console.log(`\n--- Professions: ${ns} ---`);
  console.log("URL:", url);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("Status:", res.status, res.statusText);
  const body = await res.text();
  if (body.length < 500) {
    console.log("Body:", body);
  } else {
    console.log("Body (truncated):", body.slice(0, 500) + "...");
  }
}
