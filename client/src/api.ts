const API = "/api";

async function fetchApi(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

export const api = {
  async get<T>(path: string): Promise<T> {
    const res = await fetchApi(path);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetchApi(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || res.statusText || "Request failed");
    }
    return res.json();
  },
  async patch<T>(path: string, body: unknown): Promise<T> {
    const res = await fetchApi(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  },
  async put<T>(path: string, body: unknown): Promise<T> {
    const res = await fetchApi(path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  },
  async delete<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetchApi(path, {
      method: "DELETE",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  },
};

export interface User {
  id: number;
  username: string;
  role: string;
  battlenet_id?: string;
  /** BattleTag for Battle.net users, otherwise username */
  display_name?: string;
}

export interface MyCharacter {
  id: number;
  name: string;
  class: string;
  role: string;
  spec?: string;
  guild_name: string;
  realm: string;
  /** Realm slug for API (e.g. stormrage) */
  realm_slug?: string;
  guild_id: number;
  guild_rank?: string;
  guild_rank_index?: number;
  is_guild_leader?: boolean;
  server_type?: string;
  portrait_url?: string;
  level?: number;
  race?: string;
}

export interface Guild {
  id: number;
  name: string;
  server: string;
  server_type?: string;
  join_code?: string;
  is_leader?: number;
}

export const SERVER_TYPES = [
  "Retail",
  "Classic Era",
  "Classic Hardcore",
  "TBC Anniversary",
  "MOP Classic",
  "Seasons of Discovery",
] as const;

export interface Character {
  id: number;
  guild_id: number;
  name: string;
  class: string;
  spec?: string;
  off_spec?: string;
  professions?: string;
  role: string;
  user_id?: number;
  owner_username?: string;
}

export interface GuildMember {
  user_id: number;
  username: string;
  is_leader: number;
  character_count: number;
}

export interface Raid {
  id: number;
  guild_id: number;
  name: string;
  instance?: string;
  raid_date: string;
  raid_time: string;
  is_published: number;
  slot_count?: number;
  signup_count?: number;
}

export interface RaidSlot {
  id: number;
  raid_id: number;
  position: number;
  role: string;
  character_id?: number;
  character_name?: string;
  class?: string;
  spec?: string;
  character_role?: string;
}

export interface SignUp {
  id: number;
  raid_id: number;
  character_id: number;
  status: "interested" | "tentative" | "cannot";
  note?: string;
  character_name?: string;
  class?: string;
  role?: string;
}

export interface RaidNote {
  id: number;
  raid_id: number;
  character_id: number;
  note: string;
  character_name?: string;
}

export interface BlizzardRealm {
  slug: string;
  name: string;
}
