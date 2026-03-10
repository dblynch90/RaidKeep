import { wow } from "blizzard.js";

const API_HOSTS: Record<string, string> = {
  us: "https://us.api.blizzard.com",
  eu: "https://eu.api.blizzard.com",
  kr: "https://kr.api.blizzard.com",
  tw: "https://tw.api.blizzard.com",
};

const CLASS_IDS: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  10: "Monk",
  11: "Druid",
  12: "Demon Hunter",
  13: "Evoker",
};

const RACE_IDS: Record<number, string> = {
  1: "Human",
  2: "Orc",
  3: "Dwarf",
  4: "Night Elf",
  5: "Undead",
  6: "Tauren",
  7: "Gnome",
  8: "Troll",
  9: "Goblin",
  10: "Blood Elf",
  11: "Draenei",
  22: "Worgen",
  24: "Pandaren",
  25: "Pandaren",
  26: "Pandaren",
  27: "Nightborne",
  28: "Highmountain Tauren",
  29: "Void Elf",
  30: "Lightforged Draenei",
  31: "Zandalari Troll",
  32: "Kul Tiran",
  34: "Dark Iron Dwarf",
  35: "Vulpera",
  36: "Mag'har Orc",
  37: "Mechagnome",
  52: "Dracthyr",
  70: "Dracthyr",
  71: "Dracthyr",
};

function nameToClassId(name: string): number {
  const n = name.toLowerCase();
  for (const [id, label] of Object.entries(CLASS_IDS)) {
    if (label.toLowerCase() === n) return parseInt(id, 10);
  }
  return 0;
}

function nameToRaceId(name: string): number {
  const n = name.toLowerCase();
  for (const [id, label] of Object.entries(RACE_IDS)) {
    if (label.toLowerCase() === n) return parseInt(id, 10);
  }
  return 0;
}

function getClassIdFromResponse(playableClass: { id?: number } | undefined): number {
  return playableClass?.id ?? 0;
}

export interface BlizzardGuildMember {
  name: string;
  class: string;
  level: number;
  role: "tank" | "healer" | "dps";
  rank?: string;
  /** Numeric rank index (0 = GM, 1 = Officer, etc.) when available from API */
  rank_index?: number;
  race?: string;
}

function inferRole(classId: number): "tank" | "healer" | "dps" {
  const healers = [5, 7, 10, 11];
  const tanks = [1, 2, 6, 10, 11, 12];
  if (healers.includes(classId) && !tanks.includes(classId)) return "healer";
  if (tanks.includes(classId)) return "tank";
  return "dps";
}

export interface BlizzardGuildRoster {
  name: string;
  realm: string;
  members: BlizzardGuildMember[];
}

let wowClient: Awaited<ReturnType<typeof wow.createInstance>> | null = null;
let wowClassicClient: Awaited<ReturnType<typeof wow.classic.createInstance>> | null = null;
let wowClassicEraClient: Awaited<ReturnType<typeof wow.classic.createEraInstance>> | null = null;

async function getWowClient() {
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET must be set");
  }
  if (!wowClient) {
    wowClient = await wow.createInstance({ key: id, secret });
  }
  return wowClient;
}

async function getWowClassicClient() {
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET must be set");
  }
  if (!wowClassicClient) {
    wowClassicClient = await wow.classic.createInstance({ key: id, secret });
  }
  return wowClassicClient;
}

async function getWowClassicEraClient() {
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET must be set");
  }
  if (!wowClassicEraClient) {
    wowClassicEraClient = await wow.classic.createEraInstance({ key: id, secret });
  }
  return wowClassicEraClient;
}

async function fetchGuildRosterWithClient(
  client: Awaited<ReturnType<typeof getWowClient>> | Awaited<ReturnType<typeof getWowClassicClient>> | Awaited<ReturnType<typeof getWowClassicEraClient>>,
  realmSlugLower: string,
  guildName: string,
  origin: "us" | "eu" | "kr" | "tw"
): Promise<{ data: unknown }> {
  return client.guild({
    realm: realmSlugLower,
    name: guildName,
    resource: "roster",
    origin,
  });
}

/**
 * Fetch guild roster using a custom Blizzard API namespace (e.g. profile-classicann for TBC Anniversary).
 * blizzard.js does not support profile-classicann, so we make a direct HTTP call.
 * See: https://us.forums.blizzard.com/en/blizzard/t/wow-classic-tbc-anniversary-realms-api-issues/57076
 */
/**
 * Fetch guild profile (without roster) to get rank names. May 404 for some namespaces (e.g. TBC Anniversary).
 */
async function fetchGuildProfileWithNamespace(
  realmSlugLower: string,
  guildSlug: string,
  origin: "us" | "eu" | "kr" | "tw",
  namespace: string
): Promise<Record<number, string> | null> {
  const client = await getWowClassicClient();
  const tokenRes = await client.getApplicationToken({ origin });
  const token = tokenRes.data.access_token as string;
  const host = API_HOSTS[origin] ?? API_HOSTS.us;
  const url = `${host}/data/wow/guild/${encodeURIComponent(realmSlugLower)}/${encodeURIComponent(guildSlug)}`;
  const fullNamespace = `${namespace}-${origin}`;
  const res = await fetch(`${url}?namespace=${fullNamespace}&locale=en_US`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    ranks?: Array<{ rank?: number; name?: string; id?: number }>;
    crest?: { ranks?: Array<{ name?: string; id?: number; rank?: number }> };
  };
  const ranks = data.ranks ?? data.crest?.ranks;
  if (!Array.isArray(ranks) || ranks.length === 0) return null;
  const map: Record<number, string> = {};
  for (let i = 0; i < ranks.length; i++) {
    const r = ranks[i] as { rank?: number; name?: string; id?: number };
    const name = r.name;
    const id = r.id ?? r.rank ?? i;
    if (name && typeof name === "string") map[id] = name;
  }
  return Object.keys(map).length > 0 ? map : null;
}

async function fetchGuildRosterWithNamespace(
  realmSlugLower: string,
  guildName: string,
  origin: "us" | "eu" | "kr" | "tw",
  namespace: string
): Promise<{ data: unknown }> {
  const client = await getWowClassicClient();
  const tokenRes = await client.getApplicationToken({ origin });
  const token = tokenRes.data.access_token as string;
  const host = API_HOSTS[origin] ?? API_HOSTS.us;
  const url = `${host}/data/wow/guild/${encodeURIComponent(realmSlugLower)}/${encodeURIComponent(guildName)}/roster`;
  const fullNamespace = `${namespace}-${origin}`;
  const res = await fetch(`${url}?namespace=${fullNamespace}&locale=en_US`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = new Error(`Blizzard API error: ${res.status}`);
    (err as { response?: { status?: number } }).response = { status: res.status };
    throw err;
  }
  const data = (await res.json()) as unknown;
  return { data };
}

/** Convert guild display name to Blizzard API slug (lowercase, spaces to hyphens). */
function guildNameToSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export async function fetchGuildRoster(
  region: string,
  realmSlug: string,
  guildName: string,
  serverType: string
): Promise<BlizzardGuildRoster> {
  const realmSlugLower = realmSlug.toLowerCase().replace(/\s+/g, "-");
  const guildSlug = guildNameToSlug(guildName) || guildName.toLowerCase().replace(/\s+/g, "-");
  const origin = region.toLowerCase() as "us" | "eu" | "kr" | "tw";

  const is404 = (err: unknown): boolean =>
    (err as { response?: { status?: number } })?.response?.status === 404;

  // TBC Anniversary realms (Dreamscythe, Nightslayer, Maladath) use profile-classicann-us.
  // Try profile-classicann first for Classic TBC before profile-classic.
  const TBC_NAMESPACES = ["profile-classicann", "profile-classic-tbc", "profile-classic"];

  let response: { data: unknown } | undefined;
  try {
    if (serverType === "Classic Era" || serverType === "Classic Hardcore") {
      response = await fetchGuildRosterWithClient(
        await getWowClassicEraClient(),
        realmSlugLower,
        guildSlug,
        origin
      );
    } else if (serverType === "TBC Anniversary") {
      for (const ns of TBC_NAMESPACES) {
        try {
          response = await fetchGuildRosterWithNamespace(
            realmSlugLower,
            guildSlug,
            origin,
            ns
          );
          break;
        } catch {
          continue;
        }
      }
      if (!response) {
        response = await fetchGuildRosterWithClient(
          await getWowClassicClient(),
          realmSlugLower,
          guildSlug,
          origin
        );
      }
    } else if (
      serverType === "MOP Classic" ||
      serverType === "Seasons of Discovery"
    ) {
      response = await fetchGuildRosterWithClient(
        await getWowClassicClient(),
        realmSlugLower,
        guildSlug,
        origin
      );
    } else {
      response = await fetchGuildRosterWithClient(
        await getWowClient(),
        realmSlugLower,
        guildSlug,
        origin
      );
    }
  } catch (err) {
    if (is404(err) && serverType !== "Retail" && serverType !== "TBC Anniversary") {
      // For Era/Hardcore/SoD/MOP: try alternate namespace
      try {
        if (serverType === "Classic Era" || serverType === "Classic Hardcore") {
          response = await fetchGuildRosterWithClient(
            await getWowClassicClient(),
            realmSlugLower,
            guildSlug,
            origin
          );
        } else {
          response = await fetchGuildRosterWithClient(
            await getWowClassicEraClient(),
            realmSlugLower,
            guildSlug,
            origin
          );
        }
      } catch {
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (!response) {
    throw new Error("No roster data from Blizzard API");
  }

  const data = response.data as {
    guild?: { name?: string };
    members?: Array<{
      character?: {
        name?: string;
        level?: number;
        playable_class?: { id?: number };
        playable_race?: { id?: number; name?: string };
      };
      rank?: number | { name?: string };
    }>;
    member?: Array<{
      character?: {
        name?: string;
        level?: number;
        playable_class?: { id?: number };
        playable_race?: { id?: number; name?: string };
      };
      rank?: number | { name?: string };
    }>;
  };

  if (!data) {
    throw new Error("No data returned from Blizzard API");
  }

  // Try to fetch guild profile for rank names (approach 2). May 404 for TBC Anniversary.
  let rankNames: Record<number, string> | null = null;
  const namespacesToTry = serverType === "TBC Anniversary"
    ? ["profile-classicann", "profile-classic-tbc", "profile-classic"]
    : serverType === "Classic Era" || serverType === "Classic Hardcore"
    ? ["profile-classic1x", "profile-classic"]
    : ["profile"];
  for (const ns of namespacesToTry) {
    try {
      rankNames = await fetchGuildProfileWithNamespace(realmSlugLower, guildSlug, origin, ns);
      if (rankNames) break;
    } catch {
      continue;
    }
  }

  const guildNameFromApi = data.guild?.name ?? guildName;
  const members: BlizzardGuildMember[] = [];
  const rosterList = data.members ?? data.member ?? [];

  for (const m of rosterList) {
    const char = m.character;
    if (!char?.name) continue;
    const classId = getClassIdFromResponse(char.playable_class);
    const className = CLASS_IDS[classId] ?? "Unknown";
    const raceObj = char.playable_race as { id?: number; name?: string } | undefined;
    const race = raceObj?.id && RACE_IDS[raceObj.id]
      ? RACE_IDS[raceObj.id]
      : typeof raceObj?.name === "string"
      ? raceObj.name
      : undefined;
    const rawRank = (m as { rank?: number | { name?: string } }).rank;
    let rank: string | undefined;
    let rank_index: number | undefined;
    if (typeof rawRank === "object" && rawRank?.name) {
      rank = rawRank.name;
    } else if (typeof rawRank === "number") {
      rank_index = rawRank;
      rank = rankNames?.[rawRank] ?? String(rawRank);
    }
    members.push({
      name: char.name,
      class: className,
      level: char.level ?? 1,
      role: inferRole(classId),
      ...(rank ? { rank } : {}),
      ...(rank_index !== undefined ? { rank_index } : {}),
      ...(race ? { race } : {}),
    });
  }

  return {
    name: guildNameFromApi,
    realm: realmSlugLower,
    members,
  };
}

export interface BlizzardRealm {
  slug: string;
  name: string;
}

export async function fetchRealms(
  region: string,
  serverType: string
): Promise<BlizzardRealm[]> {
  const origin = region.toLowerCase() as "us" | "eu" | "kr" | "tw";

  let response: { data: unknown };
  if (serverType === "Classic Era" || serverType === "Classic Hardcore") {
    const client = await getWowClassicEraClient();
    response = await client.realm({ origin });
  } else if (
    serverType === "TBC Anniversary" ||
    serverType === "MOP Classic" ||
    serverType === "Seasons of Discovery"
  ) {
    const client = await getWowClassicClient();
    response = await client.realm({ origin });
  } else {
    const client = await getWowClient();
    response = await client.realm({ origin });
  }

  const data = response.data as {
    realms?: Array<{
      slug?: string;
      name?: string | Record<string, string>;
    }>;
  };

  const realms = data?.realms ?? [];
  return realms
    .filter((r) => r.slug)
    .map((r) => ({
      slug: r.slug!,
      name: typeof r.name === "string" ? r.name : (r.name?.en_US ?? r.slug ?? ""),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface WoWAccountCharacter {
  name: string;
  realm: string;
  realm_slug?: string;
  character?: { id: number };
  id?: number;
}

export interface WoWAccount {
  id: number;
  characters?: Array<{ character: { name: string; realm: { slug: string }; id: number }; protected_character?: { id: number } }>;
  wow_accounts?: Array<{ id: number; characters?: Array<{ character: { name: string; realm: { slug: string }; id: number }; protected_character?: { id: number } }> }>;
}

export interface WoWProfileResponse {
  id?: number;
  wow_accounts?: Array<{
    id: number;
    characters?: Array<{
      character?: { name: string; realm?: { slug?: string }; id?: number; playable_class?: { id?: number } };
      protected_character?: { id: number };
    }>;
  }>;
}

const NAMESPACES: Record<string, string> = {
  retail: "profile",
  "classic-era": "profile-classic1x",
  classic: "profile-classic",
  classicann: "profile-classicann",
};

/**
 * Fetch profile via direct HTTP. Requests _pageSize=100 to maximize characters per response.
 * Blizzard may limit to ~50 chars per response; we paginate when we get 50+ to avoid missing chars.
 */
async function fetchProfilePage(
  accessToken: string,
  region: string,
  apiNamespace: "retail" | "classic-era" | "classic" | "classicann",
  page: number
): Promise<WoWProfileResponse> {
  const origin = region.toLowerCase() as "us" | "eu" | "kr" | "tw";
  const host = API_HOSTS[origin] ?? API_HOSTS.us;
  const ns = `${NAMESPACES[apiNamespace] ?? "profile"}-${origin}`;
  const url = new URL(`${host}/profile/user/wow`);
  url.searchParams.set("namespace", ns);
  url.searchParams.set("locale", "en_US");
  // Request max page size on every request; Blizzard may ignore but it doesn't hurt
  url.searchParams.set("_pageSize", "100");
  if (page > 1) {
    url.searchParams.set("_page", String(page));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  return (await res.json()) as WoWProfileResponse;
}

/**
 * Fetch the user's WoW account profile using their OAuth access token.
 * Fetches multiple pages when the API returns 100+ characters to avoid limits.
 * apiNamespace: which Blizzard API namespace to use (retail, classic-era, or classic).
 */
export async function fetchWoWProfile(
  accessToken: string,
  region: string,
  apiNamespace: "retail" | "classic-era" | "classic" | "classicann" = "retail"
): Promise<WoWProfileResponse> {
  const allChars: Array<{ name: string; realmSlug: string; class: string; level: number; race: string }> = [];
  const seen = new Set<string>();
  let page = 1;

  while (true) {
    const profile = await fetchProfilePage(accessToken, region, apiNamespace, page);
    const chars = extractCharactersFromProfile(profile);

    if (chars.length === 0 && page > 1) break;

    let newCount = 0;
    for (const c of chars) {
      const key = `${c.realmSlug}:${c.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        allChars.push(c);
        newCount++;
      }
    }

    // Stop if: no new chars (duplicate page), or got fewer than common limits (50/100) suggesting no more pages
    if (newCount === 0) break;
    if (chars.length < 50) break;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    wow_accounts: [
      {
        id: 1,
        characters: allChars.map((c) => ({
          character: {
            name: c.name,
            realm: { slug: c.realmSlug },
            playable_class: { id: nameToClassId(c.class) },
            playable_race: { id: nameToRaceId(c.race) },
            level: c.level,
          },
        })),
      },
    ],
  } as WoWProfileResponse;
}

/**
 * Extract character list from profile response.
 * Handles various Blizzard API response structures.
 */
export function extractCharactersFromProfile(profile: WoWProfileResponse): Array<{ name: string; realmSlug: string; class: string; level: number; race: string }> {
  const chars: Array<{ name: string; realmSlug: string; class: string; level: number; race: string }> = [];
  const accounts = profile.wow_accounts ?? (profile as Record<string, unknown>).accounts ?? [];
  for (const acc of Array.isArray(accounts) ? accounts : []) {
    const list = (acc as Record<string, unknown>).characters ?? [];
    for (const c of Array.isArray(list) ? list : []) {
      const item = c as Record<string, unknown>;
      const char = (item.character && typeof item.character === "object" && (item.character as Record<string, unknown>).name)
        ? (item.character as Record<string, unknown>)
        : item;
      const name = char.name;
      if (!name || typeof name !== "string") continue;
      const realm = char.realm;
      const realmSlug = typeof realm === "string" ? realm : (realm as Record<string, unknown>)?.slug as string;
      if (!realmSlug || typeof realmSlug !== "string") continue;
      const classObj = char.playable_class as { id?: number; name?: string } | undefined;
      let className = "Unknown";
      if (classObj?.id && CLASS_IDS[classObj.id]) className = CLASS_IDS[classObj.id];
      else if (typeof classObj?.name === "string") className = classObj.name;

      const level = typeof char.level === "number" ? char.level : 1;

      const raceObj = char.playable_race as { id?: number; name?: string } | undefined;
      let race = "Unknown";
      if (raceObj?.id && RACE_IDS[raceObj.id]) race = RACE_IDS[raceObj.id];
      else if (typeof raceObj?.name === "string") race = raceObj.name;
      chars.push({ name: String(name), realmSlug: String(realmSlug), class: className, level, race });
    }
  }
  return chars;
}

/**
 * Fetch character media (portrait/avatar) from Blizzard API.
 * Returns avatar URL or null if not available (e.g. character never logged out to generate render).
 */
export async function fetchCharacterMedia(
  realmSlug: string,
  characterName: string,
  region: string,
  serverType: string = "Retail"
): Promise<string | null> {
  const origin = region.toLowerCase() as "us" | "eu" | "kr" | "tw";
  let client: Awaited<ReturnType<typeof getWowClient>> | Awaited<ReturnType<typeof getWowClassicClient>> | Awaited<ReturnType<typeof getWowClassicEraClient>>;
  if (serverType === "Classic Era" || serverType === "Classic Hardcore") {
    client = await getWowClassicEraClient();
  } else if (["TBC Anniversary", "MOP Classic", "Seasons of Discovery"].includes(serverType)) {
    client = await getWowClassicClient();
  } else {
    client = await getWowClient();
  }
  try {
    const response = await client.characterMedia({
      realm: realmSlug.toLowerCase(),
      name: characterName.toLowerCase(),
      origin,
    });
    const data = response.data as { assets?: Array<{ key?: string; value?: string }> };
    const assets = data?.assets ?? [];
    const avatar = assets.find((a) => a.key === "avatar" || a.key === "main");
    return avatar?.value ?? assets[0]?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch character profile with a specific namespace (e.g. profile-classicann for TBC Anniversary).
 * blizzard.js does not support profile-classicann, so we make a direct HTTP call.
 */
async function fetchCharacterProfileWithNamespace(
  realmSlug: string,
  characterName: string,
  origin: "us" | "eu" | "kr" | "tw",
  namespace: string
): Promise<{ guild?: { name?: string; realm?: { slug?: string } } } | null> {
  const client = await getWowClassicClient();
  const tokenRes = await client.getApplicationToken({ origin });
  const token = tokenRes.data.access_token as string;
  const host = API_HOSTS[origin] ?? API_HOSTS.us;
  const realm = realmSlug.toLowerCase().replace(/\s+/g, "-");
  const name = characterName.toLowerCase().replace(/\s+/g, "-");
  const fullNamespace = `${namespace}-${origin}`;
  const url = `${host}/profile/wow/character/${realm}/${name}`;
  const res = await fetch(`${url}?namespace=${fullNamespace}&locale=en_US`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { guild?: { name?: string; realm?: { slug?: string } } };
  return data;
}

// Cache for character guild lookups (5 min TTL, max 500 entries) - avoids redundant API calls on repeat syncs
const characterGuildCache = new Map<
  string,
  { value: { guildName: string; realmSlug: string }; expiresAt: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 500;

function getCachedCharacterGuild(
  key: string
): { guildName: string; realmSlug: string } | null {
  const entry = characterGuildCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.value;
}

function setCachedCharacterGuild(
  key: string,
  value: { guildName: string; realmSlug: string }
): void {
  if (characterGuildCache.size >= CACHE_MAX_SIZE) {
    const oldest = [...characterGuildCache.entries()].sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt
    )[0];
    if (oldest) characterGuildCache.delete(oldest[0]);
  }
  characterGuildCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Fetch character profile to get guild. Uses app token (public data).
 * serverType determines which API (Retail vs Classic) to use.
 * For Classic TBC, tries profile-classicann first (TBC Anniversary realms).
 * Results are cached for 5 min to speed up repeat syncs.
 */
export async function fetchCharacterGuild(
  realmSlug: string,
  characterName: string,
  region: string,
  serverType: string = "Retail"
): Promise<{ guildName: string; realmSlug: string } | null> {
  const cacheKey = `${region}:${realmSlug.toLowerCase()}:${characterName.toLowerCase()}:${serverType}`;
  const cached = getCachedCharacterGuild(cacheKey);
  if (cached) return cached;
  const origin = region.toLowerCase() as "us" | "eu" | "kr" | "tw";
  const realmLower = realmSlug.toLowerCase().replace(/\s+/g, "-");
  const nameLower = characterName.toLowerCase().replace(/\s+/g, "-");

  if (serverType === "TBC Anniversary") {
    for (const ns of ["profile-classicann", "profile-classic-tbc", "profile-classic"]) {
      try {
        const data = await fetchCharacterProfileWithNamespace(realmLower, nameLower, origin, ns);
        const guild = data?.guild;
        if (guild?.name) {
          const result = {
            guildName: guild.name,
            realmSlug: guild.realm?.slug ?? realmLower,
          };
          setCachedCharacterGuild(cacheKey, result);
          return result;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  let client: Awaited<ReturnType<typeof getWowClient>> | Awaited<ReturnType<typeof getWowClassicClient>> | Awaited<ReturnType<typeof getWowClassicEraClient>>;
  if (serverType === "Classic Era" || serverType === "Classic Hardcore") {
    client = await getWowClassicEraClient();
  } else if (["MOP Classic", "Seasons of Discovery"].includes(serverType)) {
    client = await getWowClassicClient();
  } else {
    client = await getWowClient();
  }
  try {
    const response = await client.characterProfile({
      realm: realmLower,
      name: nameLower,
      origin,
    });
    const data = response.data as { guild?: { name?: string; realm?: { slug?: string } } };
    const guild = data?.guild;
    if (!guild?.name) return null;
    const result = {
      guildName: guild.name,
      realmSlug: guild.realm?.slug ?? realmLower,
    };
    setCachedCharacterGuild(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

export interface CharacterProfession {
  name: string;
  skill_points?: number;
  max_skill_points?: number;
}

// Cache for character professions (10 min TTL, max 500 entries)
const characterProfessionsCache = new Map<
  string,
  { value: CharacterProfession[]; expiresAt: number }
>();
const PROFESSIONS_CACHE_TTL_MS = 10 * 60 * 1000;
const PROFESSIONS_CACHE_MAX = 500;

function getCachedProfessions(key: string): CharacterProfession[] | null {
  const entry = characterProfessionsCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.value;
}

function setCachedProfessions(key: string, value: CharacterProfession[]) {
  if (characterProfessionsCache.size >= PROFESSIONS_CACHE_MAX) {
    const oldest = [...characterProfessionsCache.entries()].sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt
    )[0];
    if (oldest) characterProfessionsCache.delete(oldest[0]);
  }
  characterProfessionsCache.set(key, {
    value,
    expiresAt: Date.now() + PROFESSIONS_CACHE_TTL_MS,
  });
}

async function fetchCharacterProfessionsWithNamespace(
  realmSlug: string,
  characterName: string,
  origin: "us" | "eu" | "kr" | "tw",
  namespace: string
): Promise<CharacterProfession[]> {
  const client =
    namespace === "profile"
      ? await getWowClient()
      : await getWowClassicClient();
  const tokenRes = await client.getApplicationToken({ origin });
  const token = tokenRes.data.access_token as string;
  const host = API_HOSTS[origin] ?? API_HOSTS.us;
  const realm = realmSlug.toLowerCase().replace(/\s+/g, "-");
  const name = characterName.toLowerCase().replace(/\s+/g, "-");
  const fullNs = `${namespace}-${origin}`;
  const url = `${host}/profile/wow/character/${realm}/${name}/professions`;
  const res = await fetch(`${url}?namespace=${fullNs}&locale=en_US`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    primaries?: Array<{
      profession?: { name?: string };
      tiers?: Array<{ skill_points?: number; max_skill_points?: number }>;
    }>;
    secondaries?: Array<{
      profession?: { name?: string };
      tiers?: Array<{ skill_points?: number; max_skill_points?: number }>;
    }>;
  };
  const out: CharacterProfession[] = [];
  const add = (arr: typeof data.primaries) => {
    if (!Array.isArray(arr)) return;
    for (const p of arr) {
      const name = p?.profession?.name;
      if (!name || typeof name !== "string") continue;
      const tier = Array.isArray(p.tiers) && p.tiers.length > 0 ? p.tiers[0] : undefined;
      out.push({
        name,
        skill_points: tier?.skill_points,
        max_skill_points: tier?.max_skill_points,
      });
    }
  };
  add(data.primaries);
  add(data.secondaries);
  return out;
}

/**
 * Fetch character professions from Blizzard API.
 * Endpoint: /profile/wow/character/{realm}/{name}/professions
 * Returns profession names and skill levels. Uses app token (public data).
 */
export async function fetchCharacterProfessions(
  realmSlug: string,
  characterName: string,
  region: string,
  serverType: string = "Retail"
): Promise<CharacterProfession[]> {
  const cacheKey = `${region}:${realmSlug.toLowerCase()}:${characterName.toLowerCase()}:${serverType}`;
  const cached = getCachedProfessions(cacheKey);
  if (cached) return cached;

  const origin = region.toLowerCase() as "us" | "eu" | "kr" | "tw";
  const realmLower = realmSlug.toLowerCase().replace(/\s+/g, "-");
  const nameLower = characterName.toLowerCase().replace(/\s+/g, "-");

  const TBC_NAMESPACES = ["profile-classicann", "profile-classic-tbc", "profile-classic"];

  if (serverType === "TBC Anniversary") {
    for (const ns of TBC_NAMESPACES) {
      try {
        const profs = await fetchCharacterProfessionsWithNamespace(
          realmLower,
          nameLower,
          origin,
          ns
        );
        if (profs.length > 0) {
          setCachedProfessions(cacheKey, profs);
          return profs;
        }
      } catch {
        continue;
      }
    }
    return [];
  }

  let namespace: string;
  if (serverType === "Classic Era" || serverType === "Classic Hardcore") {
    namespace = "profile-classic1x";
  } else if (["MOP Classic", "Seasons of Discovery"].includes(serverType)) {
    namespace = "profile-classic";
  } else {
    namespace = "profile";
  }

  try {
    const profs = await fetchCharacterProfessionsWithNamespace(
      realmLower,
      nameLower,
      origin,
      namespace
    );
    if (profs.length > 0) setCachedProfessions(cacheKey, profs);
    return profs;
  } catch {
    return [];
  }
}
