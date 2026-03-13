import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";
import { DEFAULT_PERMISSIONS } from "./GuildPermissions";
import { getClassColor } from "../utils/classColors";
import { useGuildParams } from "../hooks/useGuildParams";
import { guildRealmQueryString, guildQueryStringFromSlug } from "../utils/guildApi";
import { RAID_ROLES } from "../constants/raid";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface RaiderEntry {
  character_name: string;
  character_class: string;
  raid_role?: string;
  raid_lead?: boolean;
  raid_assist?: boolean;
}

interface RaiderAvailability {
  character_name: string;
  character_class: string;
  raid_role?: string;
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
}

interface FormedParty {
  party_index: number;
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

  const perms = permissions ?? DEFAULT_PERMISSIONS;
  const canManage = perms.manage_raids ?? false;

  const addRaid = () => {
    setRaids((prev) => [...prev, { id: crypto.randomUUID(), date: "", instance: "" }]);
  };
  const removeRaid = (id: string) => {
    setRaids((prev) => prev.filter((r) => r.id !== id));
  };
  const updateRaid = (id: string, updates: Partial<Pick<RaidEntry, "date" | "instance">>) => {
    setRaids((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  useEffect(() => {
    if (!isValid) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    const rosterQs = guildRealmQueryString({ realm, guildName, serverType });
    const permsQs = guildQueryStringFromSlug({ realmSlug, guildName, serverType });
    Promise.all([
      api.get<{ raiders: RaiderEntry[] }>(`/auth/me/raider-roster?${rosterQs}`).then((r) => r.raiders ?? []),
      api.get<{ permissions: GuildPermissions }>(`/auth/me/guild-permissions?${permsQs}`).then((r) => r.permissions ?? DEFAULT_PERMISSIONS),
    ])
      .then(([raidersList, permsData]) => {
        // Deduplicate by character name (API can return same char from multiple users in fallback)
        const seen = new Set<string>();
        const unique = raidersList.filter((r) => {
          const key = r.character_name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setRaiders(unique);
        setPermissions(permsData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType, realmSlug, isValid]);

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
            available: ex?.available ?? true,
            startTime: ex?.startTime ?? "19:00",
            endTime: ex?.endTime ?? "23:00",
          };
        });
        return {
          character_name: r.character_name,
          character_class: r.character_class,
          raid_role: r.raid_role,
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
        raids: validRaids.map((r) => ({ date: r.date, instance: r.instance.trim() })),
        availability: availability.map((a) => ({
          character_name: a.character_name,
          character_class: a.character_class,
          raid_role: a.raid_role ?? "dps",
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
                Add each raid with a date and instance (e.g. Kara 10, SSC, TK).
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
                      <input
                        type="text"
                        value={raid.instance}
                        onChange={(e) => updateRaid(raid.id, { instance: e.target.value })}
                        placeholder="e.g. Kara 10"
                        className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 min-w-[140px]"
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

            {raids.length > 0 && raiders.length > 0 && (
              <Card className="p-5 overflow-x-auto">
                <h2 className="text-slate-300 font-medium text-sm uppercase tracking-wider mb-4">Raider Availability</h2>
                <p className="text-slate-500 text-sm mb-4">
                  For each raider and each raid, set whether they are available and their time window.
                </p>
                <table className="w-full border-collapse text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b border-slate-600">
                      <th className="text-left py-2 px-3 text-slate-400 font-medium">Raider</th>
                      {raids.map((raid) => {
                        const date = raid.date ? new Date(raid.date) : null;
                        return (
                          <th key={raid.id} className="text-left py-2 px-2 text-slate-400 font-medium text-xs">
                            {date ? `${DAY_NAMES[date.getDay()]} ${raid.date.slice(5)}` : "—"} {raid.instance ? `· ${raid.instance}` : ""}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {availability.map((a) => (
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
                <h2 className="text-slate-300 font-medium text-sm uppercase tracking-wider mb-4">Formed Parties</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {formedParties.map((p) => (
                    <div key={p.party_index} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                      <h3 className="text-sky-400 font-medium mb-3">Party {p.party_index + 1}</h3>
                      <div className="space-y-1">
                        {p.slots
                          .sort((a, b) => a.slot_index - b.slot_index)
                          .map((s) => (
                            <div
                              key={`${s.character_name}-${s.slot_index}`}
                              className="flex items-center gap-2 text-sm"
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
                  ))}
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
