import { describe, it, expect } from "vitest";
import { extractCharactersFromProfile, type WoWProfileResponse } from "./blizzard.js";

describe("extractCharactersFromProfile", () => {
  it("extracts characters from wow_accounts with nested character object", () => {
    const profile = {
      wow_accounts: [
        {
          id: 1,
          characters: [
            {
              character: {
                name: "Testchar",
                realm: { slug: "stormrage" },
                playable_class: { id: 1 },
                level: 60,
                playable_race: { id: 4 },
              },
            },
          ],
        },
      ],
    } as unknown as WoWProfileResponse;

    const result = extractCharactersFromProfile(profile);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "Testchar",
      realmSlug: "stormrage",
      class: "Warrior",
      level: 60,
      race: "Night Elf",
    });
  });

  it("extracts characters from accounts alias (alternate API shape)", () => {
    const profile = {
      accounts: [
        {
          id: 1,
          characters: [
            {
              character: {
                name: "Altchar",
                realm: { slug: "illidan" },
                playable_class: { id: 8 },
                level: 25,
                playable_race: { id: 10 },
              },
            },
          ],
        },
      ],
    };

    const result = extractCharactersFromProfile(profile as WoWProfileResponse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Altchar");
    expect(result[0].realmSlug).toBe("illidan");
    expect(result[0].class).toBe("Mage");
    expect(result[0].race).toBe("Blood Elf");
  });

  it("handles flat character object (no nested .character)", () => {
    const profile = {
      wow_accounts: [
        {
          id: 1,
          characters: [
            {
              name: "Flatchar",
              realm: { slug: "dreamscythe" },
              playable_class: { id: 5 },
              level: 70,
              playable_race: { id: 11 },
            },
          ],
        },
      ],
    };

    const result = extractCharactersFromProfile(profile as WoWProfileResponse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Flatchar");
    expect(result[0].class).toBe("Priest");
  });

  it("handles realm as string", () => {
    const profile = {
      wow_accounts: [
        {
          id: 1,
          characters: [
            {
              character: {
                name: "StrRealm",
                realm: "whitemane",
                playable_class: { id: 11 },
                level: 1,
                playable_race: { id: 4 },
              },
            },
          ],
        },
      ],
    };

    const result = extractCharactersFromProfile(profile as WoWProfileResponse);
    expect(result[0].realmSlug).toBe("whitemane");
  });

  it("skips characters with missing name or realm", () => {
    const profile = {
      wow_accounts: [
        {
          id: 1,
          characters: [
            { character: { name: "Good", realm: { slug: "x" }, playable_class: {}, playable_race: {} } },
            { character: { realm: { slug: "y" }, playable_class: {}, playable_race: {} } },
            { character: { name: "NoRealm", playable_class: {}, playable_race: {} } },
          ],
        },
      ],
    };

    const result = extractCharactersFromProfile(profile as WoWProfileResponse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Good");
  });

  it("returns empty array for empty profile", () => {
    expect(extractCharactersFromProfile({})).toEqual([]);
    expect(extractCharactersFromProfile({ wow_accounts: [] })).toEqual([]);
  });

  it("uses Unknown for missing class/race", () => {
    const profile = {
      wow_accounts: [
        {
          id: 1,
          characters: [
            {
              character: {
                name: "Minimal",
                realm: { slug: "x" },
              },
            },
          ],
        },
      ],
    };

    const result = extractCharactersFromProfile(profile as WoWProfileResponse);
    expect(result[0].class).toBe("Unknown");
    expect(result[0].race).toBe("Unknown");
    expect(result[0].level).toBe(1);
  });

  it("parses multiple accounts with multiple characters", () => {
    const profile = {
      wow_accounts: [
        {
          id: 1,
          characters: [
            {
              character: {
                name: "Char1",
                realm: { slug: "r1" },
                playable_class: { id: 4 },
                level: 60,
                playable_race: { id: 2 },
              },
            },
          ],
        },
        {
          id: 2,
          characters: [
            {
              character: {
                name: "Char2",
                realm: { slug: "r2" },
                playable_class: { id: 9 },
                level: 70,
                playable_race: { id: 10 },
              },
            },
            {
              character: {
                name: "Char3",
                realm: { slug: "r2" },
                playable_class: { id: 2 },
                level: 25,
                playable_race: { id: 11 },
              },
            },
          ],
        },
      ],
    };

    const result = extractCharactersFromProfile(profile as WoWProfileResponse);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.name)).toEqual(["Char1", "Char2", "Char3"]);
    expect(result[0].class).toBe("Rogue");
    expect(result[1].class).toBe("Warlock");
    expect(result[2].class).toBe("Paladin");
  });
});
