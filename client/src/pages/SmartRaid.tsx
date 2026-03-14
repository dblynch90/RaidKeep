import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";
import { DEFAULT_PERMISSIONS } from "./GuildPermissions";
import { getClassColor } from "../utils/classColors";
import { formatRaidSlot } from "../utils/raidDateTime";
import { useGuildParams } from "../hooks/useGuildParams";
import { guildRealmQueryString, guildQueryStringFromSlug } from "../utils/guildApi";
import { RAID_ROLES } from "../constants/raid";
import { getRaidsForVersion } from "../constants/raids";
import { getSpecsForRole, getSpecsForClass, getClassesForVersion } from "../constants/specs";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Add hours to HH:MM, return HH:MM (handles overnight) */
function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

interface RaiderEntry {
  character_name: string;
  character_class: string;
  raid_role?: string;
  raid_lead?: boolean;
  raid_assist?: boolean;
  primary_spec?: string;
  secondary_spec?: string;
  off_spec?: string;
  level?: number;
}

interface RaiderAvailability {
  character_name: string;
  character_class: string;
  raid_role?: string;
  primary_spec?: string;
  secondary_spec?: string;
  level?: number;
  slots: Array<{
    raidId: string;
    available: boolean;
    startTime: string;
    endTime: string;
  }>;
}

interface RaidEntry {
  id: string;
  date: string;
  instance: string;
  startTime: string;
  durationHours: number;
}

interface FormedParty {
  party_index: number;
  raid_instance?: string;
  raid_date?: string;
  raid_start_time?: string;
  slots: Array<{
    character_name: string;
    character_class: string;
    role: string;
    slot_index: number;
  }>;
}

export function SmartRaid() {
  const { realm, guildName, serverType, realmSlug, isValid } = useGuildParams();

  const [raiders, setRaiders] = useState<RaiderEntry[]>([]);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [raids, setRaids] = useState<RaidEntry[]>([]);
  const [availability, setAvailability] = useState<RaiderAvailability[]>([]);
  const [forming, setForming] = useState(false);
  const [formedParties, setFormedParties] = useState<FormedParty[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [orderBy, setOrderBy] = useState<"name" | "class" | "role">("name");
  const [dragOverPartyIndex, setDragOverPartyIndex] = useState<number | null>(null);
  const [compositions, setCompositions] = useState<Record<string, Array<{ role: string; spec: string; character_class: string }>>>({});
  const [savingComp, setSavingComp] = useState<string | null>(null);

  const perms = permissions ?? DEFAULT_PERMISSIONS;
  const canManage = perms.manage_raids ?? false;

  const addRaid = () => {
    setRaids((prev) => [...prev, { id: crypto.randomUUID(), date: "", instance: "", startTime: "19:00", durationHours: 4 }]);
  };
  const removeRaid = (id: string) => {
    setRaids((prev) => prev.filter((r) => r.id !== id));
  };
  const updateRaid = (id: string, updates: Partial<Pick<RaidEntry, "date" | "instance" | "startTime" | "durationHours">>) => {
    setRaids((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };
  const getRaidEndTime = (raid: RaidEntry) => addHours(raid.startTime || "19:00", raid.durationHours ?? 4);

  useEffect(() => {
    if (!isValid) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    const rosterQs = guildRealmQueryString({ realm, guildName, serverType });
    const permsQs = guildQueryStringFromSlug({ realmSlug, guildName, serverType });
    const guildRosterQs = guildQueryStringFromSlug({ realmSlug, guildName, serverType });
    Promise.all([
      api.get<{ raiders: RaiderEntry[] }>(`/auth/me/raider-roster?${rosterQs}`).then((r) => r.raiders ?? []),
      api.get<{ permissions: GuildPermissions }>(`/auth/me/guild-permissions?${permsQs}`).then((r) => r.permissions ?? DEFAULT_PERMISSIONS),
      api.get<{ members?: Array<{ name: string; class: string; level: number }> }>(`/auth/me/guild-roster?${guildRosterQs}`).then((r) => r.members ?? []).catch(() => []),
    ])
      .then(([raidersList, permsData, guildMembers]) => {
        const levelByName = new Map(guildMembers.map((m) => [m.name.toLowerCase(), m.level]));
        // Deduplicate by character name (API can return same char from multiple users in fallback)
        const seen = new Set<string>();
        const unique = raidersList.filter((r) => {
          const key = r.character_name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map((r) => ({
          ...r,
          level: r.level ?? levelByName.get(r.character_name.toLowerCase()),
        }));
        setRaiders(unique);
        setPermissions(permsData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType, realmSlug, isValid]);

  useEffect(() => {
    if (!isValid || !realm || !guildName || !canManage) return;
    const qs = new URLSearchParams({ realm, guild_name: guildName, server_type: serverType });
    api.get<{ compositions: Array<{ raid_instance: string; slots: Array<{ slot_index: number; role: string; spec: string | null }> }> }>(`/auth/me/smart-raid/compositions?${qs}`)
      .then((r) => {
        const map: Record<string, Array<{ role: string; spec: string; character_class: string }>> = {};
        for (const c of r.compositions ?? []) {
          map[c.raid_instance] = (c.slots ?? [])
            .sort((a, b) => a.slot_index - b.slot_index)
            .map((s) => ({ role: s.role || "dps", spec: s.spec || "", character_class: (s as { character_class?: string }).character_class || "" }));
        }
        setCompositions(map);
      })
      .catch(() => setCompositions({}));
  }, [realm, guildName, serverType, isValid, canManage]);

  /** Initialize/update availability when raiders or raids change */
  useEffect(() => {
    if (raiders.length === 0 || raids.length === 0) {
      setAvailability([]);
      return;
    }
    setAvailability((prev) => {
      const next: RaiderAvailability[] = raiders.map((r) => {
        const existing = prev.find((a) => a.character_name.toLowerCase() === r.character_name.toLowerCase());
        const slots = raids.map((raid) => {
          const ex = existing?.slots.find((s) => s.raidId === raid.id);
          return {
            raidId: raid.id,
            available: ex?.available ?? false,
            startTime: ex?.startTime ?? raid.startTime ?? "19:00",
            endTime: ex?.endTime ?? getRaidEndTime(raid),
          };
        });
        return {
          character_name: r.character_name,
          character_class: r.character_class,
          raid_role: r.raid_role,
          primary_spec: r.primary_spec,
          secondary_spec: r.secondary_spec ?? r.off_spec,
          level: r.level,
          slots,
        };
      });
      return next;
    });
  }, [raiders, raids.map((r) => r.id).join(",")]);

  const setRaiderSlot = (characterName: string, raidId: string, updates: Partial<{ available: boolean; startTime: string; endTime: string }>) => {
    setAvailability((prev) =>
      prev.map((a) => {
        if (a.character_name.toLowerCase() !== characterName.toLowerCase()) return a;
        return {
          ...a,
          slots: a.slots.map((s) => (s.raidId === raidId ? { ...s, ...updates } : s)),
        };
      })
    );
  };

  const validRaids = raids.filter((r) => r.date && r.instance.trim());

  const sortedAvailability = useMemo(() => {
    const arr = [...availability];
    if (orderBy === "name") {
      arr.sort((a, b) => a.character_name.localeCompare(b.character_name, undefined, { sensitivity: "base" }));
    } else if (orderBy === "class") {
      arr.sort((a, b) => {
        const c = (a.character_class || "").localeCompare(b.character_class || "", undefined, { sensitivity: "base" });
        return c !== 0 ? c : a.character_name.localeCompare(b.character_name, undefined, { sensitivity: "base" });
      });
    } else {
      const roleOrder = { tank: 0, healer: 1, dps: 2 };
      arr.sort((a, b) => {
        const ra = roleOrder[(a.raid_role || "dps").toLowerCase() as keyof typeof roleOrder] ?? 2;
        const rb = roleOrder[(b.raid_role || "dps").toLowerCase() as keyof typeof roleOrder] ?? 2;
        if (ra !== rb) return ra - rb;
        return a.character_name.localeCompare(b.character_name, undefined, { sensitivity: "base" });
      });
    }
    return arr;
  }, [availability, orderBy]);

  const handleParseAvailability = async () => {
    if (!realm || !guildName || pasteText.trim().length === 0 || validRaids.length === 0 || availability.length === 0) {
      setParseError("Add raids first, then paste availability text.");
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      const res = await api.post<{
        availability: Array<{
          character_name: string;
          slots: Array<{ date: string; start_time: string; end_time: string }>;
        }>;
      }>("/auth/me/smart-raid/parse-availability", {
        guild_realm: realm,
        guild_name: guildName,
        server_type: serverType,
        raids: validRaids.map((r) => ({
          id: r.id,
          date: r.date,
          instance: r.instance.trim(),
          start_time: r.startTime || "19:00",
          end_time: getRaidEndTime(r),
        })),
        raiders: raiders.map((r) => ({ character_name: r.character_name })),
        text: pasteText.trim(),
      });
      const parsed = res.availability ?? [];
      const dateToRaidId = new Map(validRaids.map((r) => [r.date, r.id]));
      const raiderNames = new Map(availability.map((a) => [a.character_name.toLowerCase(), a.character_name]));
      const parsedByChar = new Map<string, Map<string, { startTime: string; endTime: string }>>();
      for (const p of parsed) {
        const canonName = raiderNames.get(p.character_name.toLowerCase());
        if (!canonName) continue;
        const key = canonName.toLowerCase();
        const slotMap = parsedByChar.get(key) ?? new Map();
        for (const slot of p.slots) {
          const raidId = dateToRaidId.get(slot.date);
          if (raidId) {
            slotMap.set(raidId, {
              startTime: slot.start_time || "19:00",
              endTime: slot.end_time || "23:00",
            });
          }
        }
        parsedByChar.set(key, slotMap);
      }
      setAvailability((prev) =>
        prev.map((a) => {
          const slotMap = parsedByChar.get(a.character_name.toLowerCase());
          if (!slotMap || slotMap.size === 0) return a;
          return {
            ...a,
            slots: a.slots.map((s) => {
              const parsedSlot = slotMap.get(s.raidId);
              if (!parsedSlot) return s;
              return { ...s, available: true, ...parsedSlot };
            }),
          };
        })
      );
      setPasteText("");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to parse availability");
    } finally {
      setParsing(false);
    }
  };

  const movePlayerBetweenTeams = useCallback(
    (sourcePartyIndex: number, slotIndex: number, targetPartyIndex: number) => {
      if (sourcePartyIndex === targetPartyIndex) return;
      setFormedParties((prev) => {
        if (!prev) return prev;
        const sourceParty = prev[sourcePartyIndex];
        const targetParty = prev[targetPartyIndex];
        if (!sourceParty || !targetParty) return prev;
        const slot = sourceParty.slots.find((s) => s.slot_index === slotIndex);
        if (!slot) return prev;
        const next = prev.map((p, i) => {
          if (i === sourcePartyIndex) {
            const newSlots = sourceParty.slots
              .filter((s) => s.slot_index !== slotIndex)
              .map((s, idx) => ({ ...s, slot_index: idx }));
            return { ...p, slots: newSlots };
          }
          if (i === targetPartyIndex) {
            const maxIdx = Math.max(-1, ...targetParty.slots.map((s) => s.slot_index));
            const newSlot = { ...slot, slot_index: maxIdx + 1 };
            return { ...p, slots: [...targetParty.slots, newSlot] };
          }
          return p;
        });
        return next;
      });
    },
    []
  );

  const updateCompositionSlot = useCallback(
    (instance: string, slotIndex: number, updates: Partial<{ role: string; spec: string; character_class: string }>) => {
      setCompositions((prev) => {
        const slots = [...(prev[instance] ?? [])];
        if (!slots[slotIndex]) return prev;
        slots[slotIndex] = { ...slots[slotIndex], ...updates };
        return { ...prev, [instance]: slots };
      });
    },
    []
  );
  const addCompositionSlot = useCallback((instance: string) => {
    setCompositions((prev) => {
      const slots = [...(prev[instance] ?? []), { role: "dps", spec: "", character_class: "" }];
      return { ...prev, [instance]: slots };
    });
  }, []);
  const removeCompositionSlot = useCallback((instance: string, slotIndex: number) => {
    setCompositions((prev) => {
      const slots = (prev[instance] ?? []).filter((_, i) => i !== slotIndex);
      return { ...prev, [instance]: slots };
    });
  }, []);
  const saveComposition = useCallback(
    async (instance: string) => {
      if (!realm || !guildName) return;
      setSavingComp(instance);
      try {
        await api.put("/auth/me/smart-raid/compositions", {
          guild_realm: realm,
          guild_name: guildName,
          server_type: serverType,
          raid_instance: instance,
          slots: compositions[instance] ?? [],
        });
      } finally {
        setSavingComp(null);
      }
    },
    [realm, guildName, serverType, compositions]
  );

  const handleFormRaids = async () => {
    if (!realm || !guildName || availability.length === 0 || validRaids.length === 0) {
      setFormError("Add at least one raid (date + instance) and ensure you have raiders.");
      return;
    }
    setForming(true);
    setFormError(null);
    setFormedParties(null);
    try {
      const raidMap = new Map(raids.map((r) => [r.id, r]));
      const payload = {
        guild_realm: realm,
        guild_name: guildName,
        server_type: serverType,
        raids: validRaids.map((r) => ({
          date: r.date,
          instance: r.instance.trim(),
          start_time: r.startTime || "19:00",
          end_time: getRaidEndTime(r),
        })),
        compositions: Object.fromEntries(
          [...new Set(validRaids.map((r) => r.instance.trim()))]
            .filter((inst) => (compositions[inst]?.length ?? 0) > 0)
            .map((inst) => [inst, compositions[inst] ?? []])
        ),
        availability: availability.map((a) => ({
          character_name: a.character_name,
          character_class: a.character_class,
          raid_role: a.raid_role ?? "dps",
          primary_spec: a.primary_spec,
          secondary_spec: a.secondary_spec,
          level: a.level,
          slots: a.slots
            .filter((s) => s.available) // only include availability entries
            .map((s) => {
              const raid = raidMap.get(s.raidId);
              if (!raid || !validRaids.some((vr) => vr.id === s.raidId)) return null;
              return { date: raid.date, instance: raid.instance.trim(), start_time: s.startTime, end_time: s.endTime };
            })
            .filter(Boolean),
        })),
      };
      const res = await api.post<{ parties: FormedParty[] }>("/auth/me/smart-raid/form", payload);
      setFormedParties(res.parties ?? []);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to form raids");
    } finally {
      setForming(false);
    }
  };

  if (error) {
    return (
      <div className="rk-page-bg text-slate-100">
        <main className="rk-page-main">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  if (!loading && !canManage) {
    const scheduleUrl = `/raid-schedule?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
    return (
      <div className="rk-page-bg text-slate-100">
        <main className="rk-page-main">
          <p className="text-amber-500 mb-4">You do not have permission to use Smart Raid.</p>
          <Link to={scheduleUrl} className="text-sky-400 hover:text-sky-300">← Back to Raid Schedule</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="rk-page-bg text-slate-100">
      <main className="rk-page-main">
        {realm && guildName && (
          <GuildBreadcrumbs
            guildName={guildName}
            realm={realm}
            serverType={serverType}
            currentPage="Smart Raid"
            extraItems={[
              { label: "Raid Schedule", href: `/raid-schedule?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}` },
              { label: "Guild Dashboard", href: `/guild-dashboard?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}` },
            ]}
          />
        )}

        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-sky-400">Smart Raid</h1>
          <p className="text-slate-400 text-sm mt-1">
            Add raids (date + instance), set raider availability, then use AI to form parties.
          </p>
        </header>

        {loading ? (
          <p className="text-slate-500">Loading roster...</p>
        ) : (
          <div className="space-y-6">
            <Card className="p-5">
              <h2 className="text-slate-300 font-medium text-sm uppercase tracking-wider mb-4">Raids</h2>
              <p className="text-slate-500 text-sm mb-3">
                Add each raid with a date and instance. Choose from raids for {serverType}.
              </p>
              <div className="space-y-3">
                {raids.map((raid) => (
                  <div key={raid.id} className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Date</label>
                      <input
                        type="date"
                        value={raid.date}
                        onChange={(e) => updateRaid(raid.id, { date: e.target.value })}
                        className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Instance</label>
                      <div className="flex gap-2">
                        <select
                          value={getRaidsForVersion(serverType).includes(raid.instance) ? raid.instance : "Other"}
                          onChange={(e) => updateRaid(raid.id, { instance: e.target.value === "Other" ? "" : e.target.value })}
                          className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 min-w-[180px] [color-scheme:dark]"
                        >
                          {getRaidsForVersion(serverType).map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                        {(!raid.instance || !getRaidsForVersion(serverType).includes(raid.instance)) && (
                          <input
                            type="text"
                            value={raid.instance}
                            onChange={(e) => updateRaid(raid.id, { instance: e.target.value })}
                            placeholder="Custom raid"
                            className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 min-w-[120px] placeholder-slate-500"
                          />
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Start</label>
                      <input
                        type="time"
                        value={raid.startTime || "19:00"}
                        onChange={(e) => updateRaid(raid.id, { startTime: e.target.value })}
                        className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Duration (hrs)</label>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={raid.durationHours ?? 4}
                        onChange={(e) => updateRaid(raid.id, { durationHours: Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)) })}
                        className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 w-16 [color-scheme:dark]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRaid(raid.id)}
                      className="px-2 py-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700/50"
                      title="Remove raid"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addRaid}
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm"
                >
                  + Add raid
                </button>
              </div>
            </Card>

            {validRaids.length > 0 && (
              <Card className="p-5">
                <h2 className="text-slate-300 font-medium text-sm uppercase tracking-wider mb-2">Preferred Compositions</h2>
                <p className="text-slate-500 text-sm mb-4">
                  Define class, role, and spec for each slot. The AI will use this when forming raids. Leave empty for any.
                </p>
                {[...new Set(validRaids.map((r) => r.instance.trim()))].map((instance) => {
                  const slots = compositions[instance] ?? [];
                  return (
                    <div key={instance} className="mb-6 last:mb-0">
                      <h3 className="text-sky-400 font-medium text-sm mb-2">{instance}</h3>
                      <div className="space-y-2">
                        {slots.map((slot, idx) => (
                          <div key={idx} className="flex flex-wrap gap-2 items-center">
                            <span className="text-slate-500 text-xs w-8">#{idx + 1}</span>
                            <select
                              value={slot.character_class}
                              onChange={(e) => updateCompositionSlot(instance, idx, { character_class: e.target.value, spec: "" })}
                              className="px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm [color-scheme:dark] min-w-[120px]"
                            >
                              <option value="">Any class</option>
                              {getClassesForVersion(serverType).map((cls) => (
                                <option key={cls} value={cls}>{cls}</option>
                              ))}
                            </select>
                            <select
                              value={slot.role}
                              onChange={(e) => updateCompositionSlot(instance, idx, { role: e.target.value })}
                              className="px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm [color-scheme:dark] min-w-[80px]"
                            >
                              {RAID_ROLES.filter((r) => r.value).map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <select
                              value={slot.spec}
                              onChange={(e) => updateCompositionSlot(instance, idx, { spec: e.target.value })}
                              className="px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm [color-scheme:dark] min-w-[140px]"
                            >
                              <option value="">Any spec</option>
                              {(slot.character_class
                                ? getSpecsForClass(slot.character_class, slot.spec, serverType)
                                : getSpecsForRole(slot.role || "dps", serverType)
                              ).map((s) => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeCompositionSlot(instance, idx)}
                              className="px-2 py-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700/50 text-sm"
                              title="Remove slot"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2 items-center">
                          <button
                            type="button"
                            onClick={() => addCompositionSlot(instance)}
                            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm"
                          >
                            + Add slot
                          </button>
                          {slots.length > 0 && (
                            <button
                              type="button"
                              onClick={() => saveComposition(instance)}
                              disabled={savingComp === instance}
                              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm"
                            >
                              {savingComp === instance ? "Saving..." : "Save"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}

            {raids.length > 0 && raiders.length > 0 && (
              <Card className="p-5 overflow-x-auto">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-slate-300 font-medium text-sm uppercase tracking-wider">Raider Availability</h2>
                    <p className="text-slate-500 text-sm mt-1">
                      For each raider and each raid, set whether they are available and their time window.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-slate-400 text-sm">Order by</label>
                    <select
                      value={orderBy}
                      onChange={(e) => setOrderBy(e.target.value as "name" | "class" | "role")}
                      className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm [color-scheme:dark]"
                    >
                      <option value="name">Name</option>
                      <option value="class">Class</option>
                      <option value="role">Primary Role</option>
                    </select>
                  </div>
                </div>
                {validRaids.length > 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <label className="block text-slate-400 text-xs font-medium mb-1">Paste availability to auto-fill</label>
                    <p className="text-slate-500 text-xs mb-2">
                      Paste a list like &quot;Aeloryx: Fri 7-11pm, Sat 7-11pm&quot; or similar. AI will parse and fill the table.
                    </p>
                    <textarea
                      value={pasteText}
                      onChange={(e) => { setPasteText(e.target.value); setParseError(null); }}
                      placeholder={"Aeloryx: Fri 7-11pm, Sat 7-11pm\nBeefygeek: Fri 7-11pm only\nCelestellar: Sat 8pm-midnight"}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 text-sm placeholder-slate-500 focus:ring-1 focus:ring-sky-500/50 resize-y"
                    />
                    <button
                      type="button"
                      onClick={handleParseAvailability}
                      disabled={parsing || !pasteText.trim()}
                      className="mt-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
                    >
                      {parsing ? "Parsing..." : "Parse & fill"}
                    </button>
                    {parseError && <p className="text-amber-500 text-sm mt-2">{parseError}</p>}
                  </div>
                )}
                <table className="w-full border-collapse text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b border-slate-600">
                      <th className="text-left py-2 px-3 text-slate-400 font-medium">Raider</th>
                      {raids.map((raid) => {
                        const date = raid.date ? new Date(raid.date + "T12:00:00") : null;
                        const start = raid.startTime || "19:00";
                        const end = getRaidEndTime(raid);
                        return (
                          <th key={raid.id} className="text-left py-2 px-2 text-slate-400 font-medium text-xs">
                            {date ? `${DAY_NAMES[date.getDay()]} ${raid.date.slice(5)}` : "—"} {raid.instance ? `· ${raid.instance}` : ""}
                            {date && <span className="block text-slate-500 font-normal">{start}–{end}</span>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAvailability.map((a) => (
                      <tr key={a.character_name} className="border-b border-slate-700/60">
                        <td className="py-2 px-3">
                          <span className="font-medium" style={{ color: getClassColor(a.character_class) }}>
                            {a.character_name}
                          </span>
                          <span className="text-slate-500 text-xs ml-1">
                            {RAID_ROLES.find((r) => r.value === (a.raid_role ?? "").toLowerCase())?.label ?? a.raid_role ?? "—"}
                          </span>
                        </td>
                        {a.slots.map((s) => (
                          <td key={s.raidId} className="py-1 px-2">
                            <div className="flex flex-col gap-1">
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={s.available}
                                  onChange={(e) => setRaiderSlot(a.character_name, s.raidId, { available: e.target.checked })}
                                  className="rounded border-slate-600 bg-slate-700 text-sky-500"
                                />
                                <span className="text-xs text-slate-400">Available</span>
                              </label>
                              {s.available && (
                                <div className="flex gap-1 items-center">
                                  <input
                                    type="time"
                                    value={s.startTime}
                                    onChange={(e) => setRaiderSlot(a.character_name, s.raidId, { startTime: e.target.value })}
                                    className="w-20 px-1 py-0.5 rounded text-xs bg-slate-700 border border-slate-600 [color-scheme:dark]"
                                  />
                                  <span className="text-slate-600">–</span>
                                  <input
                                    type="time"
                                    value={s.endTime}
                                    onChange={(e) => setRaiderSlot(a.character_name, s.raidId, { endTime: e.target.value })}
                                    className="w-20 px-1 py-0.5 rounded text-xs bg-slate-700 border border-slate-600 [color-scheme:dark]"
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}

            {validRaids.length > 0 && raiders.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={handleFormRaids}
                  disabled={forming}
                  className="px-6 py-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium"
                >
                  {forming ? "Forming raids..." : "Form raids"}
                </button>
                {formError && <p className="text-amber-500 text-sm mt-2">{formError}</p>}
              </div>
            )}

            {formedParties && formedParties.length > 0 && (
              <Card className="p-5">
                <h2 className="text-slate-300 font-medium text-sm uppercase tracking-wider mb-4">Formed Teams</h2>
                <p className="text-slate-500 text-sm mb-4">Drag players between teams to adjust.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {formedParties.map((p) => {
                    const teamName = p.raid_instance && p.raid_date
                      ? `${p.raid_instance} – ${formatRaidSlot(p.raid_date, p.raid_start_time)}`
                      : `Team ${p.party_index + 1}`;
                    const isDropTarget = dragOverPartyIndex === p.party_index;
                    return (
                    <div
                      key={p.party_index}
                      className={`rounded-lg border p-4 transition-colors ${
                        isDropTarget
                          ? "border-sky-500 bg-sky-900/20"
                          : "border-slate-700 bg-slate-800/50"
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverPartyIndex(p.party_index);
                      }}
                      onDragLeave={() => setDragOverPartyIndex(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverPartyIndex(null);
                        const raw = e.dataTransfer.getData("application/json");
                        if (!raw) return;
                        try {
                          const { sourcePartyIndex, slotIndex } = JSON.parse(raw);
                          movePlayerBetweenTeams(sourcePartyIndex, slotIndex, p.party_index);
                        } catch {
                          // ignore invalid drop data
                        }
                      }}
                    >
                      <h3 className="text-sky-400 font-medium mb-3">{teamName}</h3>
                      <div className="space-y-1 min-h-[2rem]">
                        {p.slots
                          .sort((a, b) => a.slot_index - b.slot_index)
                          .map((s) => (
                            <div
                              key={`${s.character_name}-${s.slot_index}-${p.party_index}`}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData(
                                  "application/json",
                                  JSON.stringify({
                                    sourcePartyIndex: p.party_index,
                                    slotIndex: s.slot_index,
                                  })
                                );
                                e.dataTransfer.setData("text/plain", s.character_name);
                              }}
                              className="flex items-center gap-2 text-sm cursor-grab active:cursor-grabbing rounded px-1 -mx-1 hover:bg-slate-700/50"
                              style={{ borderLeft: `3px solid ${getClassColor(s.character_class)}`, paddingLeft: 8 }}
                            >
                              <span className="font-medium" style={{ color: getClassColor(s.character_class) }}>
                                {s.character_name}
                              </span>
                              <span className="text-slate-500 text-xs">{s.role}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                  })}
                </div>
              </Card>
            )}

            {raids.length === 0 && !loading && (
              <p className="text-slate-500">Add raids (date + instance) to set availability and form parties.</p>
            )}
            {raids.length > 0 && raiders.length === 0 && (
              <p className="text-amber-500">No raiders in roster. Add raiders in Raid Roster first.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
