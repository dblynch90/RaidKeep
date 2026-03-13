import { useState, useEffect, useMemo } from "react";
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
    date: string;
    available: boolean;
    startTime: string;
    endTime: string;
  }>;
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

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [availability, setAvailability] = useState<RaiderAvailability[]>([]);
  const [forming, setForming] = useState(false);
  const [formedParties, setFormedParties] = useState<FormedParty[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const perms = permissions ?? DEFAULT_PERMISSIONS;
  const canManage = perms.manage_raids ?? false;

  /** Get all Fri/Sat/Sun dates in range */
  const raidDates = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start > end) return [];
    const dates: string[] = [];
    const d = new Date(start);
    while (d <= end) {
      const day = d.getDay();
      if (day === 5 || day === 6 || day === 0) {
        dates.push(d.toISOString().slice(0, 10));
      }
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }, [startDate, endDate]);

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
        setRaiders(raidersList);
        setPermissions(permsData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType, realmSlug, isValid]);

  /** Initialize/update availability when raiders or raidDates change */
  useEffect(() => {
    if (raiders.length === 0 || raidDates.length === 0) {
      setAvailability([]);
      return;
    }
    setAvailability((prev) => {
      const next: RaiderAvailability[] = raiders.map((r) => {
        const existing = prev.find((a) => a.character_name.toLowerCase() === r.character_name.toLowerCase());
        const slots = raidDates.map((date) => {
          const ex = existing?.slots.find((s) => s.date === date);
          return {
            date,
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
  }, [raiders, raidDates.join(",")]);

  const setRaiderSlot = (characterName: string, date: string, updates: Partial<{ available: boolean; startTime: string; endTime: string }>) => {
    setAvailability((prev) =>
      prev.map((a) => {
        if (a.character_name.toLowerCase() !== characterName.toLowerCase()) return a;
        return {
          ...a,
          slots: a.slots.map((s) => (s.date === date ? { ...s, ...updates } : s)),
        };
      })
    );
  };

  const handleFormRaids = async () => {
    if (!realm || !guildName || availability.length === 0 || raidDates.length === 0) {
      setFormError("Set date range and ensure you have raiders.");
      return;
    }
    setForming(true);
    setFormError(null);
    setFormedParties(null);
    try {
      const payload = {
        guild_realm: realm,
        guild_name: guildName,
        server_type: serverType,
        raid_dates: raidDates,
        availability: availability.map((a) => ({
          character_name: a.character_name,
          character_class: a.character_class,
          raid_role: a.raid_role ?? "dps",
          slots: a.slots.filter((s) => s.available).map((s) => ({ date: s.date, start_time: s.startTime, end_time: s.endTime })),
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
            Set a date range and raider availability, then use AI to form optimal parties.
          </p>
        </header>

        {loading ? (
          <p className="text-slate-500">Loading roster...</p>
        ) : (
          <div className="space-y-6">
            <Card className="p-5">
              <h2 className="text-slate-300 font-medium text-sm uppercase tracking-wider mb-4">Date Range</h2>
              <p className="text-slate-500 text-sm mb-3">
                Select a date range. Raid dates will include all Fridays, Saturdays, and Sundays in that range.
              </p>
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-slate-400 text-sm mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-sm mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 [color-scheme:dark]"
                  />
                </div>
              </div>
              {raidDates.length > 0 && (
                <p className="text-slate-400 text-sm mt-3">
                  {raidDates.length} raid date{raidDates.length !== 1 ? "s" : ""}:{" "}
                  {raidDates.map((d) => {
                    const date = new Date(d);
                    return `${DAY_NAMES[date.getDay()]} ${d}`;
                  }).join(", ")}
                </p>
              )}
            </Card>

            {raidDates.length > 0 && raiders.length > 0 && (
              <Card className="p-5 overflow-x-auto">
                <h2 className="text-slate-300 font-medium text-sm uppercase tracking-wider mb-4">Raider Availability</h2>
                <p className="text-slate-500 text-sm mb-4">
                  For each raider and each date, set whether they are available and their time window.
                </p>
                <table className="w-full border-collapse text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b border-slate-600">
                      <th className="text-left py-2 px-3 text-slate-400 font-medium">Raider</th>
                      {raidDates.map((d) => {
                        const date = new Date(d);
                        return (
                          <th key={d} className="text-left py-2 px-2 text-slate-400 font-medium text-xs">
                            {DAY_NAMES[date.getDay()]} {d.slice(5)}
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
                          <td key={s.date} className="py-1 px-2">
                            <div className="flex flex-col gap-1">
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={s.available}
                                  onChange={(e) => setRaiderSlot(a.character_name, s.date, { available: e.target.checked })}
                                  className="rounded border-slate-600 bg-slate-700 text-sky-500"
                                />
                                <span className="text-xs text-slate-400">Available</span>
                              </label>
                              {s.available && (
                                <div className="flex gap-1 items-center">
                                  <input
                                    type="time"
                                    value={s.startTime}
                                    onChange={(e) => setRaiderSlot(a.character_name, s.date, { startTime: e.target.value })}
                                    className="w-20 px-1 py-0.5 rounded text-xs bg-slate-700 border border-slate-600 [color-scheme:dark]"
                                  />
                                  <span className="text-slate-600">–</span>
                                  <input
                                    type="time"
                                    value={s.endTime}
                                    onChange={(e) => setRaiderSlot(a.character_name, s.date, { endTime: e.target.value })}
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

            {raidDates.length > 0 && raiders.length > 0 && (
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

            {raidDates.length === 0 && !loading && (
              <p className="text-slate-500">Set a start and end date to see raid dates and set availability.</p>
            )}
            {raidDates.length > 0 && raiders.length === 0 && (
              <p className="text-amber-500">No raiders in roster. Add raiders in Raid Roster first.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
