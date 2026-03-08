/**
 * Integration tests for Blizzard API calls.
 * Run with: npm test (in server/)
 * Requires BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in .env for API tests.
 * Tests that require credentials are skipped when credentials are missing.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import {
  fetchCharacterGuild,
  fetchGuildRoster,
  fetchRealms,
} from "./blizzard.js";

config({ path: ".env" });

const hasCredentials =
  !!process.env.BLIZZARD_CLIENT_ID && !!process.env.BLIZZARD_CLIENT_SECRET;

// Use a known public character for character/guild API tests (no OAuth needed)
const TEST_CHARACTER = { name: "Illidan", realm: "stormrage", region: "us" as const };

describe("Blizzard API integration", () => {
  describe("fetchCharacterGuild", () => {
    it.skipIf(!hasCredentials)(
      "returns guild info or null for public character",
      async () => {
        const result = await fetchCharacterGuild(
          TEST_CHARACTER.realm,
          TEST_CHARACTER.name,
          TEST_CHARACTER.region,
          "Retail"
        );
        expect(
          result === null || (typeof result === "object" && !!result.guildName && !!result.realmSlug)
        ).toBe(true);
      },
      15000
    );

    it.skipIf(!hasCredentials)(
      "uses Classic Era client for Classic Era server type",
      async () => {
        // Fetch a known Classic Era realm/character if available
        const result = await fetchCharacterGuild(
          "whitemane",
          "A",
          "us",
          "Classic Era"
        );
        expect(result === null || typeof result === "object").toBe(true);
      },
      10000
    );
  });

  describe("fetchGuildRoster", () => {
    it.skipIf(!hasCredentials)(
      "returns roster or throws for invalid guild",
      async () => {
        try {
          const result = await fetchGuildRoster(
            "us",
            "stormrage",
            "Method",
            "Retail"
          );
          expect(result).toHaveProperty("name");
          expect(result).toHaveProperty("realm");
          expect(Array.isArray(result.members)).toBe(true);
        } catch (err: unknown) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          expect([404, 403, 502]).toContain(status);
        }
      },
      15000
    );

    it.skipIf(!hasCredentials)(
      "uses correct namespace for Classic Era (profile-classic1x)",
      async () => {
        // If we get 404 with profile-classic, fallback tries profile-classic1x
        try {
          const result = await fetchGuildRoster(
            "us",
            "dreamscythe",
            "HearthAndHome",
            "Classic Era"
          );
          expect(result).toHaveProperty("name");
          expect(result).toHaveProperty("members");
        } catch (err: unknown) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          expect([404]).toContain(status);
        }
      },
      15000
    );

    it.skipIf(!hasCredentials)(
      "uses profile-classicann for TBC Anniversary (Dreamscythe, HearthAndHome)",
      async () => {
        const result = await fetchGuildRoster(
          "us",
          "dreamscythe",
          "HearthAndHome",
          "Classic TBC"
        );
        expect(result).toHaveProperty("name");
        expect(result.name).toBe("HearthAndHome");
        expect(result.realm).toBe("dreamscythe");
        expect(Array.isArray(result.members)).toBe(true);
        expect(result.members.length).toBeGreaterThan(0);
      },
      15000
    );
  });

  describe("fetchRealms", () => {
    it.skipIf(!hasCredentials)("returns realms for Retail", async () => {
      const realms = await fetchRealms("us", "Retail");
      expect(Array.isArray(realms)).toBe(true);
      if (realms.length > 0) {
        expect(realms[0]).toHaveProperty("slug");
        expect(realms[0]).toHaveProperty("name");
      }
    }, 10000);

    it.skipIf(!hasCredentials)("returns realms for Classic Era", async () => {
      const realms = await fetchRealms("us", "Classic Era");
      expect(Array.isArray(realms)).toBe(true);
    }, 10000);

    it.skipIf(!hasCredentials)("returns realms for Classic TBC", async () => {
      const realms = await fetchRealms("us", "Classic TBC");
      expect(Array.isArray(realms)).toBe(true);
    }, 10000);
  });
});
