import { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "../components/Card";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import { formatRaidDateShort } from "../utils/raidDateTime";
import type { GuildPermissions } from "./GuildPermissions";

/** Raid instances available in each game version */
const RAID_INSTANCES_BY_VERSION: Record<string, string[]> = {
  "Classic Era": [
    "Molten Core",
    "Onyxia's Lair",
    "Blackwing Lair",
    "Temple of Ahn'Qiraj",
    "Ruins of Ahn'Qiraj",
    "Naxxramas",
    "Zul'Gurub",
  ],
  "Classic Hardcore": [
    "Molten Core",
    "Onyxia's Lair",
    "Blackwing Lair",
    "Temple of Ahn'Qiraj",
    "Ruins of Ahn'Qiraj",
    "Naxxramas",
    "Zul'Gurub",
  ],
  "TBC Anniversary": [
    "Karazhan",
    "Gruul's Lair",
    "Magtheridon's Lair",
    "Serpentshrine Cavern",
    "Tempest Keep",
    "Battle for Mount Hyjal",
    "Black Temple",
    "Sunwell Plateau",
  ],
  "Seasons of Discovery": [
    "Molten Core",
    "Onyxia's Lair",
    "Blackwing Lair",
    "Temple of Ahn'Qiraj",
    "Ruins of Ahn'Qiraj",
    "Naxxramas",
    "Zul'Gurub",
  ],
  "MOP Classic": [
    "Mogu'shan Vaults",
    "Heart of Fear",
    "Terrace of Endless Spring",
    "Siege of Orgrimmar",
  ],
  Retail: [
    "Baradin Hold",
    "Dragon Soul",
    "Throne of Thunder",
    "Siege of Orgrimmar",
    "Blackrock Foundry",
    "Highmaul",
    "Hellfire Citadel",
    "Emerald Nightmare",
    "Trial of Valor",
    "Nighthold",
    "Tomb of Sargeras",
    "Antorus",
    "Uldir",
    "Battle of Dazar'alor",
    "Crucible of Storms",
    "Eternal Palace",
    "Ny'alotha",
    "Castle Nathria",
    "Sanctum of Domination",
    "Sepulcher of the First Ones",
    "Vault of the Incarnates",
    "Aberrus",
    "Amirdrassil",
    "The War Within Raids",
  ],
};

const MAIN_ROLES = ["Tank", "Heal", "DPS"] as const;
type MainRole = (typeof MAIN_ROLES)[number];

const RAID_ROLES = [...MAIN_ROLES, "Raid Lead", "Raid Assist"] as const;
type RaidRole = (typeof RAID_ROLES)[number];

const CLASS_COLORS: Record<string, string> = {
  Warrior: "#C69B6D",
  Paladin: "#F58CBA",
  Hunter: "#AAD372",
  Rogue: "#FFF569",
  Priest: "#FFFFFF",
  "Death Knight": "#C41E3A",
  Shaman: "#0070DD",
  Mage: "#3FC7EB",
  Warlock: "#8788EE",
  Monk: "#00FF98",
  Druid: "#FF7D0A",
  "Demon Hunter": "#A330C9",
  Evoker: "#33937F",
};

function getClassColor(className: string): string {
  return CLASS_COLORS[className] ?? "#6B7280";
}

interface RosterMember {
  name: string;
  class: string;
  level: number;
  role: string;
  rank?: string;
  race?: string;
}

interface RaidSlot {
  characterName: string;
  characterClass: string;
  role: MainRole;
  isRaidLead?: boolean;
  isRaidAssist?: boolean;
}

interface GuildRosterData {
  guild: { name: string; realm: string; server_type: string };
  members: RosterMember[];
}

const SLOTS_PER_PARTY = 5;

const DEFAULT_PERMISSIONS: GuildPermissions = {
  view_guild_dashboard: true,
  view_guild_roster: true,
  view_raid_roster: true,
  view_raid_schedule: true,
  manage_raids: true,
  manage_raid_roster: true,
  manage_permissions: true,
};

export function PlanRaid() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "Retail";
  const raidIdParam = searchParams.get("raidId");
  const raidId = raidIdParam ? parseInt(raidIdParam, 10) : null;
  const isEdit = !!raidId && !isNaN(raidId);

  const [data, setData] = useState<GuildRosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [raidName, setRaidName] = useState("");
  const [raidInstance, setRaidInstance] = useState("");
  const [raidDate, setRaidDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [finishTime, setFinishTime] = useState("");
  const [minLevel, setMinLevel] = useState<string>("");
  const [maxLevel, setMaxLevel] = useState<string>("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [rosterSource, setRosterSource] = useState<"guild" | "raiders">("guild");
  const [raiders, setRaiders] = useState<
    Array<{ character_name: string; character_class: string; raid_role?: string; raid_lead?: boolean; raid_assist?: boolean }>
  >([]);
  const [teams, setTeams] = useState<Array<{ id: number; team_name: string; members: Array<{ character_name: string; character_class: string }> }>>([]);
  const [savedRaids, setSavedRaids] = useState<Array<{ id: number; raid_name: string; raid_date: string; raid_instance?: string | null }>>([]);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [parties, setParties] = useState<(RaidSlot | null)[][]>([
    Array(SLOTS_PER_PARTY).fill(null),
    Array(SLOTS_PER_PARTY).fill(null),
  ]);
  const [backups, setBackups] = useState<Array<{ characterName: string; characterClass: string }>>([]);
  const [signedUp, setSignedUp] = useState<Array<{ character_name: string; character_class: string }>>([]);
  const [unavailableSlots, setUnavailableSlots] = useState<RaidSlot[]>([]);

  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");

  useEffect(() => {
    if (!realm || !guildName) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<GuildRosterData>(
        `/auth/me/guild-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ),
      api.get<{ permissions: GuildPermissions }>(
        `/auth/me/guild-permissions?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => r.permissions).catch(() => DEFAULT_PERMISSIONS),
    ])
      .then(([rosterData, perms]) => {
        setData(rosterData);
        setPermissions(perms);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch roster"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType]);

  useEffect(() => {
    if (!isEdit || !raidId) {
      setUnavailableSlots([]);
      return;
    }
    api
      .get<{
        raid: { raid_name: string; raid_instance?: string; raid_date: string; start_time?: string; finish_time?: string };
        slots: Array<{ party_index: number; slot_index: number; character_name: string; character_class: string; role: string; is_raid_lead: number; is_raid_assist: number; availability_status?: string }>;
        backups?: Array<{ character_name: string; character_class: string }>;
        available?: Array<{ character_name: string; character_class: string }>;
      }>(`/auth/me/saved-raids/${raidId}`)
      .then((res) => {
        setRaidName(res.raid.raid_name);
        setRaidInstance(res.raid.raid_instance ?? "");
        setRaidDate(res.raid.raid_date);
        setStartTime(res.raid.start_time ?? "");
        setFinishTime(res.raid.finish_time ?? "");
        const backupsList = res.backups ?? [];
        setBackups(backupsList.map((b) => ({ characterName: b.character_name, characterClass: b.character_class })));
        const availableList = res.available ?? [];
        setSignedUp(availableList);
        const unavailable = res.slots.filter((s) => (s.availability_status || "pending") === "unavailable");
        const partySlotsOnly = res.slots.filter((s) => (s.availability_status || "pending") !== "unavailable");
        setUnavailableSlots(
          unavailable.map((s) => ({
            characterName: s.character_name,
            characterClass: s.character_class,
            role: normalizeLoadedRole(s.role),
            isRaidLead: s.is_raid_lead === 1,
            isRaidAssist: s.is_raid_assist === 1,
          }))
        );
        const byPartyForAvailable = new Map<number, (RaidSlot | null)[]>();
        for (const s of partySlotsOnly) {
          if (!byPartyForAvailable.has(s.party_index)) {
            byPartyForAvailable.set(s.party_index, Array(SLOTS_PER_PARTY).fill(null));
          }
          const arr = byPartyForAvailable.get(s.party_index)!;
          if (s.slot_index < arr.length) {
            const copy = [...arr];
            copy[s.slot_index] = {
              characterName: s.character_name,
              characterClass: s.character_class,
              role: normalizeLoadedRole(s.role),
              isRaidLead: s.is_raid_lead === 1,
              isRaidAssist: s.is_raid_assist === 1,
            };
            byPartyForAvailable.set(s.party_index, copy);
          }
        }
        const partyIndicesAvailable = [...byPartyForAvailable.keys()].sort((a, b) => a - b);
        const newPartiesAvailable: (RaidSlot | null)[][] = [];
        for (const pi of partyIndicesAvailable) {
          const list = byPartyForAvailable.get(pi) ?? Array(SLOTS_PER_PARTY).fill(null);
          newPartiesAvailable.push(list.map((s) => s ?? null));
        }
        if (newPartiesAvailable.length === 0) {
          newPartiesAvailable.push(Array(SLOTS_PER_PARTY).fill(null));
          newPartiesAvailable.push(Array(SLOTS_PER_PARTY).fill(null));
        }
        setParties(newPartiesAvailable);
      })
      .catch(() => setError("Failed to load raid"));
  }, [isEdit, raidId]);

  const raidInstancesForVersion = useMemo(() => {
    const list = RAID_INSTANCES_BY_VERSION[serverType] ?? RAID_INSTANCES_BY_VERSION.Retail;
    return [...list].sort((a, b) => a.localeCompare(b));
  }, [serverType]);

  const pastRaidsForLoad = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return savedRaids
      .filter((r) => r.raid_date < today && r.id !== raidId)
      .slice(0, 20);
  }, [savedRaids, raidId]);

  const assignedNames = useMemo(() => {
    const names = new Set<string>();
    for (const party of parties) {
      for (const slot of party) {
        if (slot) names.add(slot.characterName);
      }
    }
    return names;
  }, [parties]);

  const rosterMaxLevel = useMemo(() => {
    const members = data?.members ?? [];
    if (members.length === 0) return 0;
    return Math.max(...members.map((m) => m.level));
  }, [data?.members]);

  useEffect(() => {
    if (rosterMaxLevel > 0) {
      const s = String(rosterMaxLevel);
      setMinLevel(s);
      setMaxLevel(s);
    }
  }, [rosterMaxLevel]);

  const availableMembers = useMemo(() => {
    let members = data?.members ?? [];
    if (rosterSource === "raiders" && raiders.length > 0) {
      const raiderNames = new Set(raiders.map((r) => r.character_name.toLowerCase()));
      members = members.filter((m) => raiderNames.has(m.name.toLowerCase()));
    }
    return members.filter((m) => !assignedNames.has(m.name));
  }, [data?.members, assignedNames, rosterSource, raiders]);

  const backupNames = useMemo(() => new Set(backups.map((b) => b.characterName.toLowerCase())), [backups]);

  useEffect(() => {
    if (!realm || !guildName) return;
    api
      .get<{
        raiders: Array<{
          character_name: string;
          character_class: string;
          raid_role?: string;
          raid_lead?: number | boolean;
          raid_assist?: number | boolean;
        }>;
      }>(
        `/auth/me/raider-roster?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) =>
        setRaiders(
          r.raiders.map((ra) => ({
            character_name: ra.character_name,
            character_class: ra.character_class,
            raid_role: ra.raid_role ?? "",
            raid_lead: Boolean(ra.raid_lead),
            raid_assist: Boolean(ra.raid_assist),
          }))
        )
      )
      .catch(() => setRaiders([]));
    api
      .get<{ teams: Array<{ id: number; team_name: string; members: Array<{ character_name: string; character_class: string }> }> }>(
        `/auth/me/raid-teams?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) => setTeams(r.teams))
      .catch(() => setTeams([]));
    api
      .get<{ raids: Array<{ id: number; raid_name: string; raid_date: string; raid_instance?: string | null }> }>(
        `/auth/me/saved-raids?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) => setSavedRaids((r.raids ?? []).slice(0, 30)))
      .catch(() => setSavedRaids([]));
  }, [realm, guildName, serverType]);

  const displayedRosterMembers = useMemo(() => {
    let members = availableMembers;
    const min = minLevel.trim() ? parseInt(minLevel, 10) : null;
    const max = maxLevel.trim() ? parseInt(maxLevel, 10) : null;
    if (min != null && !isNaN(min)) {
      members = members.filter((m) => m.level >= min);
    }
    if (max != null && !isNaN(max)) {
      members = members.filter((m) => m.level <= max);
    }
    const search = playerSearch.trim().toLowerCase();
    if (search) {
      members = members.filter((m) =>
        m.name.toLowerCase().includes(search)
      );
    }
    return [...members].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [availableMembers, minLevel, maxLevel, playerSearch]);

  const capitalizeRealm = (r: string) =>
    r
      .split(/[- ]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

  const setSlot = (partyIdx: number, slotIdx: number, slot: RaidSlot | null) => {
    setParties((prev) => {
      const next = prev.map((p, i) =>
        i === partyIdx
          ? p.map((s, j) => (j === slotIdx ? slot : s))
          : [...p]
      );
      return next;
    });
  };

  const addParty = () => {
    setParties((prev) => [...prev, Array(SLOTS_PER_PARTY).fill(null)]);
  };

  const loadFromPreviousRaid = async (raidIdToLoad: number) => {
    try {
      const res = await api.get<{
        slots: Array<{
          party_index: number;
          slot_index: number;
          character_name: string;
          character_class: string;
          role: string;
          is_raid_lead: number;
          is_raid_assist: number;
          availability_status?: string;
        }>;
        backups?: Array<{ character_name: string; character_class: string }>;
      }>(`/auth/me/saved-raids/${raidIdToLoad}`);
      const partySlots = (res.slots ?? []).filter((s) => (s.availability_status || "pending") !== "unavailable");
      const byParty = new Map<number, (RaidSlot | null)[]>();
      for (const s of partySlots) {
        if (!byParty.has(s.party_index)) {
          byParty.set(s.party_index, Array(SLOTS_PER_PARTY).fill(null));
        }
        const arr = byParty.get(s.party_index)!;
        if (s.slot_index < arr.length) {
          const copy = [...arr];
          copy[s.slot_index] = {
            characterName: s.character_name,
            characterClass: s.character_class,
            role: normalizeLoadedRole(s.role),
            isRaidLead: s.is_raid_lead === 1,
            isRaidAssist: s.is_raid_assist === 1,
          };
          byParty.set(s.party_index, copy);
        }
      }
      const indices = [...byParty.keys()].sort((a, b) => a - b);
      let newParties: (RaidSlot | null)[][];
      if (indices.length > 0) {
        newParties = indices.map((pi) => (byParty.get(pi) ?? Array(SLOTS_PER_PARTY).fill(null)).map((s) => s ?? null));
      } else {
        newParties = [Array(SLOTS_PER_PARTY).fill(null), Array(SLOTS_PER_PARTY).fill(null)];
      }
      setParties(newParties);
      const backupList = res.backups ?? [];
      setBackups(backupList.map((b) => ({ characterName: b.character_name, characterClass: b.character_class })));
    } catch {
      // ignore
    }
  };

  const raidRoleToMainRole = (raidRole: string): MainRole => {
    const r = (raidRole || "").toLowerCase();
    if (r === "tank") return "Tank";
    if (r === "healer") return "Heal";
    return "DPS";
  };

  const normalizeLoadedRole = (role: string): MainRole => {
    const r = (role || "").toLowerCase();
    if (r.includes("tank")) return "Tank";
    if (r.includes("heal")) return "Heal";
    return "DPS";
  };

  const toRaidSlot = (
    member: RosterMember,
    role: RaidRole,
    raiderData?: { raid_role?: string; raid_lead?: boolean; raid_assist?: boolean }
  ): RaidSlot => {
    if (raiderData) {
      return {
        characterName: member.name,
        characterClass: member.class,
        role: raidRoleToMainRole(raiderData.raid_role ?? ""),
        isRaidLead: raiderData.raid_lead ?? false,
        isRaidAssist: raiderData.raid_assist ?? false,
      };
    }
    const mainRole: MainRole = role === "Raid Lead" || role === "Raid Assist" ? "DPS" : role;
    return {
      characterName: member.name,
      characterClass: member.class,
      role: mainRole,
      isRaidLead: role === "Raid Lead",
      isRaidAssist: role === "Raid Assist",
    };
  };

  const getRaiderData = (characterName: string) =>
    raiders.find((r) => r.character_name.toLowerCase() === characterName.toLowerCase());

  const addBackup = (member: RosterMember) => {
    setBackups((prev) => {
      if (prev.some((b) => b.characterName.toLowerCase() === member.name.toLowerCase())) return prev;
      return [...prev, { characterName: member.name, characterClass: member.class }].sort((a, b) =>
        a.characterName.localeCompare(b.characterName, undefined, { sensitivity: "base" })
      );
    });
  };

  const removeBackup = (characterName: string) => {
    setBackups((prev) =>
      prev.filter((b) => b.characterName.toLowerCase() !== characterName.toLowerCase())
    );
  };

  const handleRosterAdd = (member: RosterMember, role: RaidRole) => {
    const raiderData = getRaiderData(member.name);
    const slot = toRaidSlot(member, role, raiderData);
    setBackups((prev) => prev.filter((b) => b.characterName.toLowerCase() !== member.name.toLowerCase()));
    setParties((prev) => {
      for (let pi = 0; pi < prev.length; pi++) {
        for (let si = 0; si < prev[pi].length; si++) {
          if (!prev[pi][si]) {
            return prev.map((p, i) =>
              i === pi
                ? p.map((s, j) => (j === si ? slot : s))
                : [...p]
            );
          }
        }
      }
      return [...prev, [slot, null, null, null, null]];
    });
  };

  const removeParty = (partyIdx: number) => {
    if (parties.length <= 1) return;
    setParties((prev) => prev.filter((_, i) => i !== partyIdx));
  };

  const moveToSlot = (partyIdx: number, slotIdx: number, member: RosterMember, role?: RaidRole) => {
    const raiderData = getRaiderData(member.name);
    setBackups((prev) => prev.filter((b) => b.characterName.toLowerCase() !== member.name.toLowerCase()));
    setSlot(partyIdx, slotIdx, toRaidSlot(member, role ?? "DPS", raiderData));
  };

  const updateSlot = (
    partyIdx: number,
    slotIdx: number,
    updates: Partial<Pick<RaidSlot, "role" | "isRaidLead" | "isRaidAssist">>
  ) => {
    setParties((prev) =>
      prev.map((p, i) =>
        i === partyIdx
          ? p.map((s, j) =>
              j === slotIdx && s
                ? { ...s, ...updates }
                : s
            )
          : [...p]
      )
    );
  };

  const clearSlot = (partyIdx: number, slotIdx: number) => {
    setSlot(partyIdx, slotIdx, null);
  };

  const handleSave = async () => {
    if (saving || !raidName.trim() || !realm || !guildName) return;
    setSaving(true);
    setSaveMessage(null);
    const payload = {
      guild_name: guildName,
      guild_realm: realm,
      guild_realm_slug: realm,
      server_type: serverType,
      raid_name: raidName.trim(),
      raid_instance: raidInstance || null,
      raid_date: raidDate,
      start_time: startTime || null,
      finish_time: finishTime || null,
      parties: parties.map((p) =>
        p.map((s) =>
          s
            ? {
                characterName: s.characterName,
                characterClass: s.characterClass,
                role: s.role,
                isRaidLead: s.isRaidLead,
                isRaidAssist: s.isRaidAssist,
              }
            : null
        )
      ),
      backups: backups.map((b) => ({
        characterName: b.characterName,
        characterClass: b.characterClass,
      })),
      unavailable_slots: unavailableSlots.map((s) => ({
        characterName: s.characterName,
        characterClass: s.characterClass,
        role: s.role,
        isRaidLead: s.isRaidLead,
        isRaidAssist: s.isRaidAssist,
      })),
    };
    try {
      if (isEdit && raidId) {
        await api.patch<{ raid: { id: number } }>(`/auth/me/saved-raids/${raidId}`, payload);
        setSaveMessage({ ok: true, text: "Raid updated successfully." });
      } else {
        await api.post<{ raid: { id: number } }>("/auth/me/saved-raids", payload);
        setSaveMessage({ ok: true, text: "Raid saved successfully." });
      }
    } catch (err) {
      setSaveMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to save raid",
      });
    } finally {
      setSaving(false);
    }
  };

  const moveSlotToBackup = (slotData: RaidSlot, fromPartyIdx: number, fromSlotIdx: number) => {
    setBackups((prev) => {
      const name = slotData.characterName.toLowerCase();
      if (prev.some((b) => b.characterName.toLowerCase() === name)) return prev;
      return [...prev, { characterName: slotData.characterName, characterClass: slotData.characterClass }].sort(
        (a, b) => a.characterName.localeCompare(b.characterName, undefined, { sensitivity: "base" })
      );
    });
    setSlot(fromPartyIdx, fromSlotIdx, null);
  };

  const addBackupToSlot = (
    partyIdx: number,
    slotIdx: number,
    backup: { characterName: string; characterClass: string }
  ) => {
    const raiderData = getRaiderData(backup.characterName);
    const slot: RaidSlot = {
      characterName: backup.characterName,
      characterClass: backup.characterClass,
      role: raidRoleToMainRole(raiderData?.raid_role ?? ""),
      isRaidLead: raiderData?.raid_lead ?? false,
      isRaidAssist: raiderData?.raid_assist ?? false,
    };
    setBackups((prev) =>
      prev.filter((b) => b.characterName.toLowerCase() !== backup.characterName.toLowerCase())
    );
    setSlot(partyIdx, slotIdx, slot);
  };

  const moveSlot = (
    slotData: RaidSlot,
    fromPartyIdx: number,
    fromSlotIdx: number,
    toPartyIdx: number,
    toSlotIdx: number
  ) => {
    if (fromPartyIdx === toPartyIdx && fromSlotIdx === toSlotIdx) return;
    setParties((prev) => {
      const cleared = prev.map((p, i) =>
        i === fromPartyIdx
          ? p.map((s, j) => (j === fromSlotIdx ? null : s))
          : [...p]
      );
      return cleared.map((p, i) =>
        i === toPartyIdx
          ? p.map((s, j) => (j === toSlotIdx ? slotData : s))
          : [...p]
      );
    });
  };

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100">
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  const perms = permissions ?? DEFAULT_PERMISSIONS;
  if (!loading && !perms.manage_raids) {
    const manageRaidsUrl = realm && guildName
      ? `/manage-raids?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      : "/";
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100">
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500 mb-4">You do not have permission to create or edit raids.</p>
          <Link to={manageRaidsUrl} className="text-sky-400 hover:text-sky-300">← Back to Raid Schedule</Link>
        </main>
      </div>
    );
  }

  const sectionGap = "space-y-8";

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <main className="max-w-5xl mx-auto px-4 py-8">
        {realm && guildName && (
          <GuildBreadcrumbs
            guildName={guildName}
            realm={realm}
            serverType={serverType}
            currentPage={isEdit ? "Edit Raid" : "Plan Raid"}
            extraItems={[{ label: "Raid Management", href: `/manage-raids?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}` }]}
          />
        )}

        <header className="mb-10">
          <h1 className="text-3xl font-semibold text-sky-400">{isEdit ? "Edit Raid" : "Plan Raid"}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {guildName ? (
              `${guildName} · ${capitalizeRealm(realm)} · ${serverType}`
            ) : (
              "Select a guild from Dashboard"
            )}
          </p>
        </header>

        {loading ? (
          <p className="text-slate-500">Loading roster...</p>
        ) : (
          <div className={sectionGap}>
            <Card className="rounded-xl shadow-lg bg-slate-800/95 border-slate-700/80">
              <div className="p-5">
                <h2 className="text-slate-400 font-normal text-sm uppercase tracking-wider mb-4">Raid Details</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-slate-400 text-sm mb-1.5 font-medium">Raid Name</label>
                    <input
                      type="text"
                      value={raidName}
                      onChange={(e) => setRaidName(e.target.value)}
                      placeholder="e.g. Friday Farm Run"
                      className="w-full px-3 py-2 rounded-lg bg-slate-700/80 border border-slate-600 text-slate-100 placeholder-slate-600 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 text-sm mb-1.5 font-medium">Raid Instance</label>
                    <select
                      value={raidInstance}
                      onChange={(e) => setRaidInstance(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-700/80 border border-slate-600 text-slate-100 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 [color-scheme:dark]"
                    >
                      <option value="">Select raid...</option>
                      {raidInstancesForVersion.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 text-sm mb-1.5 font-medium">Raid Date</label>
                    <input
                      type="date"
                      value={raidDate}
                      onChange={(e) => setRaidDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-700/80 border border-slate-600 text-slate-100 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 [color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 text-sm mb-1.5 font-medium">Start Time (server)</label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-700/80 border border-slate-600 text-slate-100 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 [color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 text-sm mb-1.5 font-medium">Finish Time (server)</label>
                    <input
                      type="time"
                      value={finishTime}
                      onChange={(e) => setFinishTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-700/80 border border-slate-600 text-slate-100 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 [color-scheme:dark]"
                    />
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
              <div>
                <Card className="rounded-xl shadow-md bg-slate-800/70 border-slate-700/60">
                  <div className="p-5">
                    <h3 className="text-slate-400 font-normal text-sm uppercase tracking-wider mb-3">Guild Roster</h3>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => setRosterSource("guild")}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition ${rosterSource === "guild" ? "bg-sky-600 text-white border border-sky-500/50" : "bg-slate-700/80 text-slate-400 border border-slate-600 hover:border-slate-500 hover:text-slate-300"}`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setRosterSource("raiders")}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition ${rosterSource === "raiders" ? "bg-sky-600 text-white border border-sky-500/50" : "bg-slate-700/80 text-slate-400 border border-slate-600 hover:border-slate-500 hover:text-slate-300"}`}
                      >
                        Raiders only
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Search player..."
                      value={playerSearch}
                      onChange={(e) => setPlayerSearch(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 placeholder-slate-600 text-sm mb-3 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50"
                    />
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-slate-500 text-xs">Level:</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        placeholder="Min"
                        value={minLevel}
                        onChange={(e) => setMinLevel(e.target.value)}
                        className="w-14 px-2 py-1 rounded-md bg-slate-700/60 border border-slate-600 text-slate-100 text-xs placeholder-slate-600"
                      />
                      <span className="text-slate-600">–</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        placeholder="Max"
                        value={maxLevel}
                        onChange={(e) => setMaxLevel(e.target.value)}
                        className="w-14 px-2 py-1 rounded-md bg-slate-700/60 border border-slate-600 text-slate-100 text-xs placeholder-slate-600"
                      />
                      {(minLevel || maxLevel) && (
                        <button
                          type="button"
                          onClick={() => {
                            setMinLevel("");
                            setMaxLevel("");
                          }}
                          className="text-slate-500 hover:text-slate-300 text-xs"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-slate-500 text-xs mb-2">Click a character to add to raid</p>
                    <div className="max-h-72 overflow-y-auto rounded-lg overflow-hidden">
                      {displayedRosterMembers.length === 0 ? (
                        <p className="text-slate-500 text-sm py-4 px-2">
                          {data?.members?.length
                            ? "No players match your search or level filter"
                            : "No roster loaded"}
                        </p>
                      ) : (
                        displayedRosterMembers.map((m, idx) => (
                          <div
                            key={m.name}
                            className={`border-b border-slate-700/40 last:border-0 ${idx % 2 === 1 ? "bg-slate-700/15" : ""}`}
                          >
                            <RosterAddButton
                              member={m}
                              onAdd={handleRosterAdd}
                              onAddBackup={addBackup}
                              canAddAsBackup={!backupNames.has(m.name.toLowerCase())}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </Card>
              </div>

              <div>
                <Card className="rounded-xl shadow-lg bg-slate-800/95 border-slate-700/80">
                  <div className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                      <h3 className="text-slate-400 font-normal text-sm uppercase tracking-wider">Raid Composition</h3>
                      <div className="flex items-center gap-2">
                        {(teams.length > 0 || pastRaidsForLoad.length > 0) && (
                          <select
                            className="px-2.5 py-1.5 rounded-md bg-slate-800/50 border border-slate-600 text-slate-300 text-sm hover:border-slate-500 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 [color-scheme:dark]"
                            defaultValue=""
                            onChange={(e) => {
                              const val = e.target.value;
                              e.target.value = "";
                              if (!val) return;
                              const [type, idStr] = val.split(":");
                              const id = parseInt(idStr ?? "0", 10);
                              if (type === "team" && id) {
                                const team = teams.find((t) => t.id === id);
                                if (!team?.members.length) return;
                                const slots: RaidSlot[] = team.members.map((m) => {
                                  const raiderData = getRaiderData(m.character_name);
                                  return {
                                    characterName: m.character_name,
                                    characterClass: m.character_class,
                                    role: raidRoleToMainRole(raiderData?.raid_role ?? ""),
                                    isRaidLead: raiderData?.raid_lead ?? false,
                                    isRaidAssist: raiderData?.raid_assist ?? false,
                                  };
                                });
                                const newParties: (RaidSlot | null)[][] = [];
                                for (let i = 0; i < slots.length; i += SLOTS_PER_PARTY) {
                                  const party: (RaidSlot | null)[] = [];
                                  for (let j = 0; j < SLOTS_PER_PARTY; j++) {
                                    party.push(slots[i + j] ?? null);
                                  }
                                  newParties.push(party);
                                }
                                if (newParties.length === 0) newParties.push(Array(SLOTS_PER_PARTY).fill(null));
                                setParties(newParties);
                              } else if (type === "raid" && id) {
                                loadFromPreviousRaid(id);
                              }
                            }}
                          >
                            <option value="">Load from...</option>
                            {teams.length > 0 && (
                              <optgroup label="Raid Team">
                                {teams.map((t) => (
                                  <option key={`team-${t.id}`} value={`team:${t.id}`}>
                                    {t.team_name} ({t.members.length})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {pastRaidsForLoad.length > 0 && (
                              <optgroup label="Previous Raid">
                                {pastRaidsForLoad.map((r) => (
                                  <option key={`raid-${r.id}`} value={`raid:${r.id}`}>
                                    {r.raid_name} — {formatRaidDateShort(r.raid_date)}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        )}
                        <button
                          type="button"
                          onClick={addParty}
                          className="text-sm px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium border border-sky-500/50"
                        >
                          + Add Party
                        </button>
                      </div>
                    </div>
                    <div className="space-y-6">
                      {parties.map((party, partyIdx) => (
                        <div
                          key={partyIdx}
                          className="rounded-xl border border-slate-700/80 bg-slate-800/50 p-4"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-slate-300 font-semibold text-sm">
                              Party {partyIdx + 1}
                            </span>
                            {parties.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeParty(partyIdx)}
                                className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition"
                                title="Remove party"
                                aria-label="Remove party"
                              >
                                ×
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            {party.map((slot, slotIdx) => (
                              <RaidSlotCard
                                key={slotIdx}
                                slot={slot}
                                partyIdx={partyIdx}
                                slotIdx={slotIdx}
                                availableMembers={displayedRosterMembers}
                                assignedNames={assignedNames}
                                onAssign={(member, role) =>
                                  moveToSlot(partyIdx, slotIdx, member, role)
                                }
                                onAssignBackup={(backup) => addBackupToSlot(partyIdx, slotIdx, backup)}
                                onMoveSlot={(slotData, fromPartyIdx, fromSlotIdx) =>
                                  moveSlot(slotData, fromPartyIdx, fromSlotIdx, partyIdx, slotIdx)
                                }
                                onUpdateSlot={(updates) =>
                                  updateSlot(partyIdx, slotIdx, updates)
                                }
                                onClear={() => clearSlot(partyIdx, slotIdx)}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <BackupDropZone
                      backups={backups}
                      onDropFromParty={moveSlotToBackup}
                      onRemoveBackup={removeBackup}
                      getClassColor={getClassColor}
                    />
                    {isEdit && (
                      <div className="mt-6 pt-6 border-t border-slate-700/80 rounded-xl p-4 bg-slate-800/30">
                        <h4 className="text-slate-300 font-semibold text-sm mb-2">Signed Up</h4>
                        <p className="text-slate-500 text-xs mb-2">
                          Characters who have signed up but are not yet assigned to slots or backups
                        </p>
                        <div className="flex flex-wrap gap-2.5">
                          {signedUp
                            .filter(
                              (s) =>
                                !assignedNames.has(s.character_name) &&
                                !backupNames.has(s.character_name.toLowerCase())
                            )
                            .map((s) => (
                              <div
                                key={s.character_name}
                                className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 min-h-[36px] border border-slate-600/80 bg-slate-800/80"
                                style={{
                                  borderLeftWidth: 4,
                                  borderLeftColor: getClassColor(s.character_class),
                                }}
                              >
                                <span className="font-medium text-slate-200 text-sm">{s.character_name}</span>
                                <span
                                  className="text-xs font-medium px-1.5 py-0.5 rounded border"
                                  style={{
                                    borderColor: `${getClassColor(s.character_class)}60`,
                                    color: getClassColor(s.character_class),
                                  }}
                                >
                                  {s.character_class}
                                </span>
                              </div>
                            ))}
                          {signedUp.filter(
                            (s) =>
                              !assignedNames.has(s.character_name) &&
                              !backupNames.has(s.character_name.toLowerCase())
                          ).length === 0 && (
                            <p className="text-slate-500 text-sm">
                              {signedUp.length === 0
                                ? "No signups yet."
                                : "All signed-up characters have been assigned to slots or backups."}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {isEdit && unavailableSlots.length > 0 && (
                      <div className="mt-6 pt-6 border-t border-slate-700/80 rounded-xl p-4 bg-slate-800/30">
                        <h4 className="text-slate-300 font-semibold text-sm mb-2">Unavailable</h4>
                        <p className="text-slate-500 text-xs mb-2">
                          Assigned players who have declined their raid spot. They have been removed from the party.
                        </p>
                        <div className="flex flex-wrap gap-2.5">
                          {unavailableSlots.map((slot, idx) => (
                            <div
                              key={`${slot.characterName}-${idx}`}
                              className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 min-h-[36px] border border-slate-600/80 bg-slate-800/80 opacity-80"
                              style={{
                                borderLeftWidth: 4,
                                borderLeftColor: getClassColor(slot.characterClass),
                              }}
                            >
                              <span className="font-medium text-slate-400 text-sm">{slot.characterName}</span>
                              <span
                                className="text-xs font-medium px-1.5 py-0.5 rounded border"
                                style={{
                                  borderColor: `${getClassColor(slot.characterClass)}60`,
                                  color: getClassColor(slot.characterClass),
                                }}
                              >
                                {slot.characterClass}
                              </span>
                              <span className="text-slate-500 text-xs">{slot.role}</span>
                              <span className="text-red-400 text-xs">— Declined</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </div>

            <div className="pt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={saving || !raidName.trim() || !realm || !guildName}
                onClick={handleSave}
                className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium border border-sky-500/50"
              >
                {saving ? "Saving..." : isEdit ? "Update Raid" : "Save Raid"}
              </button>
              {saveMessage && (
                <span className={`text-sm ${saveMessage.ok ? "text-emerald-400" : "text-red-400"}`}>
                  {saveMessage.text}
                </span>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const DRAG_TYPE_ROSTER = "application/x-raidkeep-roster-member";
const DRAG_TYPE_PARTY_SLOT = "application/x-raidkeep-party-slot";
const DRAG_TYPE_BACKUP = "application/x-raidkeep-backup";

function BackupDropZone({
  backups,
  onDropFromParty,
  onRemoveBackup,
  getClassColor,
}: {
  backups: Array<{ characterName: string; characterClass: string }>;
  onDropFromParty: (slotData: RaidSlot, fromPartyIdx: number, fromSlotIdx: number) => void;
  onRemoveBackup: (characterName: string) => void;
  getClassColor: (className: string) => string;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes(DRAG_TYPE_PARTY_SLOT)) {
      e.dataTransfer.dropEffect = "move";
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const partyRaw = e.dataTransfer.getData(DRAG_TYPE_PARTY_SLOT);
    if (!partyRaw) return;
    try {
      const { slotData, fromPartyIdx, fromSlotIdx } = JSON.parse(partyRaw) as {
        slotData: RaidSlot;
        fromPartyIdx: number;
        fromSlotIdx: number;
      };
      onDropFromParty(slotData, fromPartyIdx, fromSlotIdx);
    } catch {
      // ignore invalid drag data
    }
  };

  return (
    <div
      className={`mt-6 pt-6 border-t border-slate-700/80 rounded-xl p-4 bg-slate-800/30 transition-colors ${
        dragOver ? "bg-sky-500/10 border-sky-500/50 ring-1 ring-inset ring-sky-500/30" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <h4 className="text-slate-300 font-semibold text-sm mb-2">Backups</h4>
      <p className="text-slate-500 text-xs mb-2">
        Standby raiders. Drag to/from parties, or click roster → &quot;Add as backup&quot;
      </p>
      {backups.length === 0 ? (
        <p className="text-slate-500 text-sm">
          {dragOver ? "Drop here to add as backup" : "No backups. Drag from parties or add from roster."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {backups.map((b) => (
            <div
              key={b.characterName}
              draggable
              onDragStart={(e) => {
                if ((e.target as HTMLElement).closest("button")) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData(
                  DRAG_TYPE_BACKUP,
                  JSON.stringify({ characterName: b.characterName, characterClass: b.characterClass })
                );
                e.dataTransfer.effectAllowed = "move";
              }}
              className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 min-h-[36px] border border-slate-600/80 bg-slate-800/80 cursor-grab active:cursor-grabbing hover:border-slate-500 hover:shadow-md hover:ring-1 hover:ring-slate-500/50 transition-all duration-150"
              style={{
                borderLeftWidth: 4,
                borderLeftColor: getClassColor(b.characterClass),
              }}
            >
              <span className="font-medium text-slate-200 text-sm">{b.characterName}</span>
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded border"
                style={{
                  borderColor: `${getClassColor(b.characterClass)}60`,
                  color: getClassColor(b.characterClass),
                }}
              >
                {b.characterClass}
              </span>
              <button
                type="button"
                onClick={() => onRemoveBackup(b.characterName)}
                className="ml-1 w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/20 text-xs"
                title="Remove from backups"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RosterAddButton({
  member,
  onAdd,
  onAddBackup,
  canAddAsBackup,
}: {
  member: RosterMember;
  onAdd: (member: RosterMember, role: RaidRole) => void;
  onAddBackup?: (member: RosterMember) => void;
  canAddAsBackup?: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);

  const classColor = getClassColor(member.class);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE_ROSTER, JSON.stringify({ name: member.name, class: member.class }));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={handleDragStart}
        onClick={() => setShowMenu((s) => !s)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setShowMenu((s) => !s);
        }}
        className="w-full text-left rounded-lg px-3 py-2.5 min-h-[44px] border border-slate-600/80 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-700/40 hover:shadow-sm transition-all duration-150 flex items-center gap-3 cursor-grab active:cursor-grabbing"
        style={{
          borderLeftWidth: 4,
          borderLeftColor: classColor,
        }}
      >
        <div className="flex-1 min-w-0">
          <span className="font-medium text-slate-100 block truncate">{member.name}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-slate-500 text-xs">Lv{member.level}</span>
            <span
              className="text-xs font-medium px-1.5 py-0.5 rounded border"
              style={{
                borderColor: `${classColor}60`,
                color: classColor,
              }}
            >
              {member.class}
            </span>
          </div>
        </div>
      </div>
      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMenu(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-full mt-1 z-20 bg-slate-800 border border-slate-600 rounded shadow-xl py-2 min-w-[180px]">
            <div className="px-3 py-1 text-slate-500 text-xs">Assign as:</div>
            {RAID_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => {
                  onAdd(member, role);
                  setShowMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-700 text-slate-200 text-sm"
              >
                {role}
              </button>
            ))}
            {onAddBackup && canAddAsBackup && (
              <>
                <div className="border-t border-slate-600 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    onAddBackup(member);
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-700 text-slate-400 text-sm"
                >
                  Add as backup
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RaidSlotCard({
  slot,
  partyIdx,
  slotIdx,
  availableMembers,
  assignedNames,
  onAssign,
  onAssignBackup,
  onMoveSlot,
  onUpdateSlot,
  onClear,
}: {
  slot: RaidSlot | null;
  partyIdx: number;
  slotIdx: number;
  availableMembers: RosterMember[];
  assignedNames: Set<string>;
  onAssign: (member: RosterMember, role?: RaidRole) => void;
  onAssignBackup?: (backup: { characterName: string; characterClass: string }) => void;
  onMoveSlot: (slotData: RaidSlot, fromPartyIdx: number, fromSlotIdx: number) => void;
  onUpdateSlot: (updates: Partial<Pick<RaidSlot, "role" | "isRaidLead" | "isRaidAssist">>) => void;
  onClear: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [showRoleHover, setShowRoleHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const membersToShow = availableMembers;
  const classColor = slot ? getClassColor(slot.characterClass) : undefined;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const partyRaw = e.dataTransfer.getData(DRAG_TYPE_PARTY_SLOT);
    if (partyRaw) {
      try {
        const { slotData, fromPartyIdx, fromSlotIdx } = JSON.parse(partyRaw) as {
          slotData: RaidSlot;
          fromPartyIdx: number;
          fromSlotIdx: number;
        };
        if (fromPartyIdx === partyIdx && fromSlotIdx === slotIdx) return;
        if (slot) onClear();
        onMoveSlot(slotData, fromPartyIdx, fromSlotIdx);
      } catch {
        // ignore invalid drag data
      }
      return;
    }
    const backupRaw = e.dataTransfer.getData(DRAG_TYPE_BACKUP);
    if (backupRaw && onAssignBackup) {
      try {
        const backup = JSON.parse(backupRaw) as { characterName: string; characterClass: string };
        if (backup.characterName) {
          if (slot) onClear();
          onAssignBackup(backup);
        }
      } catch {
        // ignore invalid drag data
      }
      return;
    }
    const rosterRaw = e.dataTransfer.getData(DRAG_TYPE_ROSTER);
    if (!rosterRaw) return;
    try {
      const { name } = JSON.parse(rosterRaw) as { name: string };
      const member = availableMembers.find((m) => m.name === name);
      if (member) {
        if (slot) onClear();
        onAssign(member);
      }
    } catch {
      // ignore invalid drag data
    }
  };

  return (
    <div
      className={`rounded-lg border min-h-[76px] min-w-[120px] flex flex-col transition-all duration-150 ${
        slot
          ? `border-slate-600/80 ${dragOver ? "ring-2 ring-sky-500 ring-inset bg-sky-500/10" : "hover:shadow-md hover:border-slate-500 hover:ring-1 hover:ring-slate-500/50"}`
          : dragOver
            ? "border-sky-500 bg-sky-500/10 border-2"
            : "border-dashed border-slate-600 hover:border-slate-500"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {slot ? (
        <div
          className="relative flex-1 p-2.5 flex flex-col rounded-r-md cursor-grab active:cursor-grabbing bg-slate-800/80"
          style={{
            borderLeftWidth: 4,
            borderLeftColor: classColor,
          }}
          draggable
          onDragStart={(e) => {
            if ((e.target as HTMLElement).closest("button, [data-no-drag]")) {
              e.preventDefault();
              return;
            }
            e.dataTransfer.setData(
              DRAG_TYPE_PARTY_SLOT,
              JSON.stringify({ slotData: slot, fromPartyIdx: partyIdx, fromSlotIdx: slotIdx })
            );
            e.dataTransfer.effectAllowed = "move";
          }}
          onMouseEnter={() => setShowRoleHover(true)}
          onMouseLeave={(e) => {
            const related = e.relatedTarget as HTMLElement | null;
            if (related?.closest("[data-role-popover]")) return;
            setShowRoleHover(false);
          }}
        >
          <div className="flex justify-between items-start gap-2">
            <div className="flex-1 min-w-0 overflow-hidden">
              <span
                className="font-medium text-slate-100 text-sm block truncate"
                title={slot.characterName}
              >
                {slot.characterName}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded border"
                  style={{
                    borderColor: `${classColor}60`,
                    color: classColor,
                  }}
                >
                  {slot.characterClass}
                </span>
                <span className="text-slate-500 text-xs">{slot.role}</span>
                {(slot.isRaidLead || slot.isRaidAssist) && (
                  <span className="text-sky-400 text-xs">
                    {slot.isRaidLead && "RL"}
                    {slot.isRaidLead && slot.isRaidAssist && " · "}
                    {slot.isRaidAssist && "A"}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/20 transition text-xs leading-none"
              title="Remove"
            >
              ×
            </button>
          </div>
          {showRoleHover && (
            <div
              data-no-drag
              data-role-popover
              className="absolute left-0 top-full pt-1 z-30 min-w-[200px]"
              onMouseEnter={() => setShowRoleHover(true)}
              onMouseLeave={() => setShowRoleHover(false)}
            >
              <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3">
                <div className="text-slate-400 text-xs font-medium mb-2 uppercase tracking-wider">
                  Role
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {MAIN_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => onUpdateSlot({ role: r })}
                      className={`px-2.5 py-1.5 rounded text-xs font-medium transition ${
                        slot.role === r
                          ? "bg-sky-500 text-white ring-1 ring-sky-400"
                          : "bg-slate-700 text-slate-200 hover:bg-slate-600 border border-slate-600"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div className="flex gap-4 pt-3 border-t border-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer group/label">
                    <input
                      type="checkbox"
                      checked={!!slot.isRaidLead}
                      onChange={(e) => onUpdateSlot({ isRaidLead: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-800"
                    />
                    <span className="text-slate-300 text-sm group-hover/label:text-slate-100">
                      Raid Lead
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group/label">
                    <input
                      type="checkbox"
                      checked={!!slot.isRaidAssist}
                      onChange={(e) => onUpdateSlot({ isRaidAssist: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-800"
                    />
                    <span className="text-slate-300 text-sm group-hover/label:text-slate-100">
                      Raid Assist
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          className="relative flex-1 p-2 flex flex-col justify-center cursor-pointer"
          onClick={() => setShowPicker(true)}
        >
          <span className="text-slate-600 hover:text-slate-500 text-sm">
            + Add (or drag player here)
          </span>
          {showPicker && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowPicker(false)}
                aria-hidden
              />
              <div className="absolute left-0 top-full mt-1 z-20 bg-slate-800 border border-slate-600 rounded shadow-xl py-2 max-h-48 overflow-y-auto min-w-[200px]">
                {membersToShow.length === 0 ? (
                  <div className="px-3 py-2 text-slate-500 text-sm">No one available</div>
                ) : (
                  membersToShow.map((m) => (
                    <div key={m.name} className="border-b border-slate-700 last:border-0">
                      <div className="px-3 py-1 text-slate-400 text-xs">
                        {m.name} · Lv{m.level} {m.class}
                      </div>
                      <div className="flex flex-wrap gap-1 px-3 pb-2">
                        {RAID_ROLES.map((role) => (
                          <button
                            key={role}
                            type="button"
                            onClick={() => {
                              onAssign(m, role);
                              setShowPicker(false);
                            }}
                            disabled={assignedNames.has(m.name) && !slot}
                            className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
