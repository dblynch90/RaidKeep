import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

const API = "/api";

type GuildPermissionKey =
  | "view_guild_dashboard"
  | "view_guild_roster"
  | "view_raid_roster"
  | "view_raid_schedule"
  | "manage_raids"
  | "manage_raid_roster"
  | "manage_permissions";

const GUILD_PERMISSION_LABELS: Record<GuildPermissionKey, string> = {
  view_guild_dashboard: "View Guild Dashboard",
  view_guild_roster: "View Guild Roster",
  view_raid_roster: "View Raid Roster",
  view_raid_schedule: "View Raid Schedule",
  manage_raids: "Manage Raids",
  manage_raid_roster: "Manage Raid Roster",
  manage_permissions: "Manage Permissions",
};

const RANK_LABELS: Record<string, string> = {
  rank_0: "Rank 0 (GM)",
  rank_1: "Rank 1",
  rank_2: "Rank 2",
  rank_3: "Rank 3",
  rank_4: "Rank 4",
  rank_5: "Rank 5",
  rank_6: "Rank 6",
  rank_7: "Rank 7",
  rank_8: "Rank 8",
  rank_9: "Rank 9",
};

const permKeys = Object.keys(GUILD_PERMISSION_LABELS) as GuildPermissionKey[];
const rankKeys = ["rank_0", "rank_1", "rank_2", "rank_3", "rank_4", "rank_5", "rank_6", "rank_7", "rank_8", "rank_9"];

function capitalizeRealm(s: string): string {
  if (!s) return "";
  return s.split(/[- ]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

type SavedRaid = { id: number; raid_name: string; raid_date: string; raid_instance?: string; start_time?: string; finish_time?: string };
type TeamMember = { character_name: string; character_class?: string };
type RaidTeam = { id: number; team_name: string; members: TeamMember[] };
type RosterEntry = { character_name: string; character_class: string; primary_spec?: string; off_spec?: string; notes?: string; raid_role?: string; raid_lead?: number; raid_assist?: number };

export function AdminGuildDetail() {
  const { realmSlug, guildName } = useParams<{ realmSlug: string; guildName: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const serverType = searchParams.get("server_type") || "Retail";

  const [tab, setTab] = useState<"permissions" | "raids" | "teams" | "roster">("permissions");
  const [config, setConfig] = useState<Record<string, Record<string, boolean>> | null>(null);
  const [characterOverrides, setCharacterOverrides] = useState<Array<{ character_name: string; permissions: Record<string, boolean> }>>([]);
  const [raids, setRaids] = useState<SavedRaid[]>([]);
  const [teams, setTeams] = useState<RaidTeam[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [overrideForm, setOverrideForm] = useState<{ characterName: string; permissions: Record<string, boolean>; isNew: boolean } | null>(null);
  const [editingRaid, setEditingRaid] = useState<SavedRaid | null>(null);
  const [addingRaid, setAddingRaid] = useState(false);
  const [newRaid, setNewRaid] = useState<Partial<SavedRaid>>({ raid_name: "", raid_date: new Date().toISOString().slice(0, 10) });
  const [editingTeam, setEditingTeam] = useState<RaidTeam | null>(null);
  const [addingTeam, setAddingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [editingRoster, setEditingRoster] = useState<RosterEntry | null>(null);
  const [addingRoster, setAddingRoster] = useState(false);
  const [newRosterEntry, setNewRosterEntry] = useState<Partial<RosterEntry>>({ character_name: "", character_class: "Unknown" });
  const [deleteGuildConfirm, setDeleteGuildConfirm] = useState(false);

  const guildDisplay = guildName ? decodeURIComponent(guildName) : "";
  const realmDisplay = realmSlug ? capitalizeRealm(realmSlug.replace(/-/g, " ")) : "";

  const fetchData = useCallback(() => {
    if (!realmSlug || !guildName) return;
    setLoading(true);
    Promise.all([
      fetch(`${API}/admin/guild/${realmSlug}/${guildName}/permissions?server_type=${encodeURIComponent(serverType)}`, { credentials: "include" }).then((r) => r.json()),
      fetch(`${API}/admin/guild/${realmSlug}/${guildName}/raids?server_type=${encodeURIComponent(serverType)}`, { credentials: "include" }).then((r) => r.json()),
      fetch(`${API}/admin/guild/${realmSlug}/${guildName}/teams?server_type=${encodeURIComponent(serverType)}`, { credentials: "include" }).then((r) => r.json()),
      fetch(`${API}/admin/guild/${realmSlug}/${guildName}/roster?server_type=${encodeURIComponent(serverType)}`, { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([permRes, raidsRes, teamsRes, rosterRes]) => {
        setConfig(permRes.config || null);
        setCharacterOverrides(permRes.character_overrides || []);
        setRaids(raidsRes.raids || []);
        setTeams(teamsRes.teams || []);
        setRoster(rosterRes.roster || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [realmSlug, guildName, serverType]);

  useEffect(() => {
    fetch(`${API}/admin/me`, { credentials: "include" }).then((r) => {
      if (!r.ok) navigate("/admin/login", { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleConfigToggle = (rankKey: string, permKey: string, value: boolean) => {
    if (!config) return;
    const next = { ...config };
    if (!next[rankKey]) next[rankKey] = {};
    next[rankKey] = { ...next[rankKey], [permKey]: value };
    setConfig(next);
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/permissions`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_type: serverType, config: next }),
    }).catch(() => {});
  };

  const saveCharacterOverride = (charName: string, perms: Record<string, boolean>) => {
    const name = charName.trim();
    if (!name) return;
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/character-overrides`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_type: serverType, character_name: name, permissions: perms }),
    })
      .then((r) => r.ok && fetchData())
      .then(() => setOverrideForm(null));
  };

  const deleteCharacterOverride = (charName: string) => {
    if (!confirm(`Remove override for ${charName}?`)) return;
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/character-overrides/${encodeURIComponent(charName)}?server_type=${encodeURIComponent(serverType)}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => r.ok && fetchData());
  };

  const updateRaid = (raid: SavedRaid, fields: Partial<SavedRaid>) => {
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/raids/${raid.id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_type: serverType, ...fields }),
    }).then((r) => r.ok && (fetchData(), setEditingRaid(null)));
  };

  const deleteRaid = (raid: SavedRaid) => {
    if (!confirm(`Delete raid "${raid.raid_name}"?`)) return;
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/raids/${raid.id}?server_type=${encodeURIComponent(serverType)}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => r.ok && fetchData());
  };

  const addRaid = () => {
    const name = newRaid.raid_name?.trim() || "New Raid";
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/raids`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_type: serverType, raid_name: name, raid_date: newRaid.raid_date || new Date().toISOString().slice(0, 10), raid_instance: newRaid.raid_instance }),
    }).then((r) => r.ok && (fetchData(), setAddingRaid(false), setNewRaid({ raid_name: "", raid_date: new Date().toISOString().slice(0, 10) })));
  };

  const addTeam = () => {
    const name = newTeamName.trim() || "New Team";
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/teams`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_type: serverType, team_name: name }),
    }).then((r) => r.ok && (fetchData(), setAddingTeam(false), setNewTeamName("")));
  };

  const updateTeam = (team: RaidTeam, fields: { team_name?: string; members?: TeamMember[] }) => {
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/teams/${team.id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_type: serverType, ...fields }),
    }).then((r) => r.ok && (fetchData(), setEditingTeam(null)));
  };

  const deleteTeam = (team: RaidTeam) => {
    if (!confirm(`Delete team "${team.team_name}"?`)) return;
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/teams/${team.id}?server_type=${encodeURIComponent(serverType)}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => r.ok && fetchData());
  };

  const updateRosterEntry = (entry: RosterEntry, fields: Partial<RosterEntry>) => {
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/roster/${encodeURIComponent(entry.character_name)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_type: serverType, ...fields }),
    }).then((r) => r.ok && (fetchData(), setEditingRoster(null)));
  };

  const deleteRosterEntry = (entry: RosterEntry) => {
    if (!confirm(`Remove ${entry.character_name} from roster?`)) return;
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/roster/${encodeURIComponent(entry.character_name)}?server_type=${encodeURIComponent(serverType)}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => r.ok && fetchData());
  };

  const addRosterEntry = () => {
    const name = newRosterEntry.character_name?.trim();
    if (!name) return;
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}/roster`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_type: serverType, character_name: name, character_class: newRosterEntry.character_class || "Unknown", primary_spec: newRosterEntry.primary_spec, off_spec: newRosterEntry.off_spec, notes: newRosterEntry.notes, raid_role: newRosterEntry.raid_role }),
    }).then((r) => r.ok && (fetchData(), setAddingRoster(false), setNewRosterEntry({ character_name: "", character_class: "Unknown" })));
  };

  const deleteGuild = () => {
    if (!deleteGuildConfirm) return;
    fetch(`${API}/admin/guild/${realmSlug}/${guildName}?server_type=${encodeURIComponent(serverType)}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => {
      if (r.ok) navigate("/admin", { replace: true });
    });
  };

  if (!realmSlug || !guildName) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-4">
        <p className="text-amber-500 mt-4">Invalid guild.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-700 bg-slate-800/50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-sky-400">{guildDisplay}</h1>
            <p className="text-slate-500 text-sm">{realmDisplay} · {serverType}</p>
          </div>
          <div>
            {!deleteGuildConfirm ? (
              <button onClick={() => setDeleteGuildConfirm(true)} className="px-3 py-1.5 rounded-lg text-sm bg-red-900/60 text-red-300 hover:bg-red-800/60">
                Delete Guild
              </button>
            ) : (
              <div className="flex gap-2">
                <span className="text-slate-400 text-sm">Sure?</span>
                <button onClick={deleteGuild} className="px-3 py-1.5 rounded-lg text-sm bg-red-600 text-white">Yes, delete</button>
                <button onClick={() => setDeleteGuildConfirm(false)} className="px-3 py-1.5 rounded-lg text-sm bg-slate-600 text-slate-200">Cancel</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <nav className="flex gap-2 mb-6 flex-wrap">
          {(["permissions", "raids", "teams", "roster"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
                tab === t ? "bg-sky-600 text-white border border-sky-500/50" : "bg-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : tab === "permissions" && config ? (
          <div className="rounded-xl border border-slate-700 overflow-hidden" style={{ background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)" }}>
            <div className="p-6 overflow-x-auto">
              <h3 className="font-semibold text-sky-400 mb-4">Rank Permissions</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-600/80">
                    <th className="text-left text-slate-400 font-medium py-3 pr-6">Rank</th>
                    {permKeys.map((pk) => (
                      <th key={pk} className="text-left text-slate-400 font-medium py-3 px-2 min-w-[100px]">{GUILD_PERMISSION_LABELS[pk]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rankKeys.map((rk) => (
                    <tr key={rk} className="border-b border-slate-700/50">
                      <td className="py-3 pr-6 font-medium text-slate-200">{RANK_LABELS[rk] ?? rk}</td>
                      {permKeys.map((pk) => (
                        <td key={pk} className="py-3 px-2">
                          <input
                            type="checkbox"
                            checked={!!config[rk]?.[pk]}
                            onChange={(e) => handleConfigToggle(rk, pk, e.target.checked)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-amber-500"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-6 border-t border-slate-700">
              <h3 className="font-semibold text-sky-400 mb-3">Character Overrides</h3>
              {overrideForm === null ? (
                <>
                  <div className="space-y-2 mb-4">
                    {characterOverrides.map((o) => (
                      <div key={o.character_name} className="flex items-center justify-between gap-4 py-2 border-b border-slate-700/50">
                        <div className="flex items-center gap-4">
                          <span className="font-medium text-slate-200 w-32">{o.character_name}</span>
                          <span className="text-slate-500 text-sm">
                            {Object.entries(o.permissions)
                              .filter(([, v]) => v)
                              .map(([k]) => GUILD_PERMISSION_LABELS[k as GuildPermissionKey] || k)
                              .join(", ") || "—"}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setOverrideForm({ characterName: o.character_name, permissions: { ...o.permissions }, isNew: false })} className="text-sky-400 hover:text-sky-300 text-xs">Edit</button>
                          <button onClick={() => deleteCharacterOverride(o.character_name)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setOverrideForm({ characterName: "", permissions: {}, isNew: true })} className="text-sky-400 hover:text-sky-300 text-sm">+ Add override</button>
                </>
              ) : (
                <div className="space-y-3 p-4 rounded-lg bg-slate-800/50">
                  <input
                    type="text"
                    placeholder="Character name"
                    value={overrideForm.characterName}
                    onChange={(e) => setOverrideForm((f) => f ? { ...f, characterName: e.target.value } : null)}
                    disabled={!overrideForm.isNew}
                    className="px-3 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm w-48"
                  />
                  <div className="flex flex-wrap gap-4">
                    {permKeys.map((pk) => (
                      <label key={pk} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!overrideForm.permissions[pk]}
                          onChange={(e) => setOverrideForm((f) => f ? { ...f, permissions: { ...f.permissions, [pk]: e.target.checked } } : null)}
                          className="w-3.5 h-3.5 rounded"
                        />
                        <span className="text-slate-400">{GUILD_PERMISSION_LABELS[pk]}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveCharacterOverride(overrideForm.characterName, overrideForm.permissions)} className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm border border-sky-500/50">Save</button>
                    <button onClick={() => setOverrideForm(null)} className="px-3 py-1 rounded bg-slate-600 text-slate-300 text-sm">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : tab === "raids" ? (
          <div className="rounded-xl border border-slate-700 p-6" style={{ background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sky-400">Saved Raids</h3>
              {!addingRaid && <button onClick={() => setAddingRaid(true)} className="text-sky-400 hover:text-sky-300 text-sm">+ Add</button>}
            </div>
            {addingRaid && (
              <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-slate-800/50 mb-4">
                <input value={newRaid.raid_name} onChange={(e) => setNewRaid((x) => ({ ...x, raid_name: e.target.value }))} placeholder="Raid name" className="px-2 py-1 rounded bg-slate-700 text-sm w-40" />
                <input value={newRaid.raid_date} onChange={(e) => setNewRaid((x) => ({ ...x, raid_date: e.target.value }))} type="date" className="px-2 py-1 rounded bg-slate-700 text-sm" />
                <input value={newRaid.raid_instance || ""} onChange={(e) => setNewRaid((x) => ({ ...x, raid_instance: e.target.value }))} placeholder="Instance" className="px-2 py-1 rounded bg-slate-700 text-sm w-32" />
                <button onClick={addRaid} className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm border border-sky-500/50">Add</button>
                <button onClick={() => { setAddingRaid(false); setNewRaid({ raid_name: "", raid_date: new Date().toISOString().slice(0, 10) }); }} className="px-2 py-1 rounded bg-slate-600 text-slate-300 text-sm">Cancel</button>
              </div>
            )}
            {raids.length === 0 && !addingRaid ? (
              <p className="text-slate-500">No raids.</p>
            ) : (
              <div className="space-y-2">
                {raids.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-2 border-b border-slate-700/50">
                    {editingRaid?.id === r.id ? (
                      <div className="flex flex-wrap gap-2 items-center">
                        <input value={editingRaid.raid_name} onChange={(e) => setEditingRaid((x) => x ? { ...x, raid_name: e.target.value } : null)} className="px-2 py-1 rounded bg-slate-700 text-sm w-40" />
                        <input value={editingRaid.raid_date} onChange={(e) => setEditingRaid((x) => x ? { ...x, raid_date: e.target.value } : null)} className="px-2 py-1 rounded bg-slate-700 text-sm w-32" placeholder="YYYY-MM-DD" />
                        <input value={editingRaid.raid_instance || ""} onChange={(e) => setEditingRaid((x) => x ? { ...x, raid_instance: e.target.value } : null)} className="px-2 py-1 rounded bg-slate-700 text-sm w-32" placeholder="Instance" />
                        <button onClick={() => updateRaid(r, editingRaid)} className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs border border-sky-500/50">Save</button>
                        <button onClick={() => setEditingRaid(null)} className="px-2 py-1 rounded bg-slate-600 text-slate-300 text-xs">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <span className="text-slate-200">{r.raid_name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 text-sm">{r.raid_date} {r.raid_instance && `· ${r.raid_instance}`}</span>
                          <button onClick={() => setEditingRaid(r)} className="text-sky-400 hover:text-sky-300 text-xs">Edit</button>
                          <button onClick={() => deleteRaid(r)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === "teams" ? (
          <div className="rounded-xl border border-slate-700 p-6" style={{ background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sky-400">Raid Teams</h3>
              {!addingTeam && <button onClick={() => setAddingTeam(true)} className="text-sky-400 hover:text-sky-300 text-sm">+ Add</button>}
            </div>
            {addingTeam && (
              <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-slate-800/50 mb-4">
                <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team name" className="px-2 py-1 rounded bg-slate-700 text-sm w-40" />
                <button onClick={addTeam} className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm border border-sky-500/50">Add</button>
                <button onClick={() => { setAddingTeam(false); setNewTeamName(""); }} className="px-2 py-1 rounded bg-slate-600 text-slate-300 text-sm">Cancel</button>
              </div>
            )}
            {teams.length === 0 && !addingTeam ? (
              <p className="text-slate-500">No teams.</p>
            ) : (
              <div className="space-y-4">
                {teams.map((t) => (
                  <div key={t.id} className="border border-slate-700 rounded-lg p-4">
                    {editingTeam?.id === t.id ? (
                      <div className="space-y-3">
                        <input value={editingTeam.team_name} onChange={(e) => setEditingTeam((x) => x ? { ...x, team_name: e.target.value } : null)} className="px-2 py-1 rounded bg-slate-700 text-sm w-48" />
                        <textarea
                          value={(editingTeam.members || []).map((m) => `${m.character_name} (${m.character_class || "Unknown"})`).join("\n")}
                          onChange={(e) => setEditingTeam((x) => x ? { ...x, members: e.target.value.split("\n").filter(Boolean).map((line) => { const [name, rest] = line.split(" ("); return { character_name: name.trim(), character_class: rest?.replace(")", "") || "Unknown" }; }) } : null)}
                          placeholder="One per line: CharName (Class)"
                          className="w-full px-2 py-1 rounded bg-slate-700 text-sm min-h-[80px]"
                          rows={4}
                        />
                        <div className="flex gap-2">
                          <button onClick={() => updateTeam(t, { team_name: editingTeam.team_name, members: editingTeam.members })} className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm border border-sky-500/50">Save</button>
                          <button onClick={() => setEditingTeam(null)} className="px-3 py-1 rounded bg-slate-600 text-slate-300 text-sm">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-medium text-slate-200 mb-1">{t.team_name}</div>
                          <div className="text-slate-500 text-sm">
                            {(t.members || []).map((m: TeamMember) => m.character_name).join(", ") || "No members"}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => setEditingTeam(t)} className="text-sky-400 hover:text-sky-300 text-xs">Edit</button>
                          <button onClick={() => deleteTeam(t)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === "roster" ? (
          <div className="rounded-xl border border-slate-700 p-6" style={{ background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sky-400">Raider Roster</h3>
              {!addingRoster && <button onClick={() => setAddingRoster(true)} className="text-sky-400 hover:text-sky-300 text-sm">+ Add</button>}
            </div>
            {addingRoster && (
              <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-slate-800/50 mb-4">
                <input value={newRosterEntry.character_name} onChange={(e) => setNewRosterEntry((x) => ({ ...x, character_name: e.target.value }))} placeholder="Name" className="px-2 py-1 rounded bg-slate-700 text-sm w-32" />
                <input value={newRosterEntry.character_class} onChange={(e) => setNewRosterEntry((x) => ({ ...x, character_class: e.target.value }))} placeholder="Class" className="px-2 py-1 rounded bg-slate-700 text-sm w-24" />
                <input value={newRosterEntry.primary_spec || ""} onChange={(e) => setNewRosterEntry((x) => ({ ...x, primary_spec: e.target.value }))} placeholder="Main spec" className="px-2 py-1 rounded bg-slate-700 text-sm w-24" />
                <button onClick={addRosterEntry} className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm border border-sky-500/50">Add</button>
                <button onClick={() => { setAddingRoster(false); setNewRosterEntry({ character_name: "", character_class: "Unknown" }); }} className="px-2 py-1 rounded bg-slate-600 text-slate-300 text-sm">Cancel</button>
              </div>
            )}
            {roster.length === 0 && !addingRoster ? (
              <p className="text-slate-500">No roster entries.</p>
            ) : (
              <div className="space-y-2">
                {roster.map((e) => (
                  <div key={e.character_name} className="flex items-center justify-between py-2 border-b border-slate-700/50">
                    {editingRoster?.character_name === e.character_name ? (
                      <div className="flex flex-wrap gap-2 items-center">
                        <input value={editingRoster.character_class} onChange={(ev) => setEditingRoster((x) => x ? { ...x, character_class: ev.target.value } : null)} className="px-2 py-1 rounded bg-slate-700 text-sm w-24" placeholder="Class" />
                        <input value={editingRoster.primary_spec || ""} onChange={(ev) => setEditingRoster((x) => x ? { ...x, primary_spec: ev.target.value } : null)} className="px-2 py-1 rounded bg-slate-700 text-sm w-24" placeholder="Main spec" />
                        <input value={editingRoster.off_spec || ""} onChange={(ev) => setEditingRoster((x) => x ? { ...x, off_spec: ev.target.value } : null)} className="px-2 py-1 rounded bg-slate-700 text-sm w-24" placeholder="Off spec" />
                        <input value={editingRoster.notes || ""} onChange={(ev) => setEditingRoster((x) => x ? { ...x, notes: ev.target.value } : null)} className="px-2 py-1 rounded bg-slate-700 text-sm w-32" placeholder="Notes" />
                        <input value={editingRoster.raid_role || ""} onChange={(ev) => setEditingRoster((x) => x ? { ...x, raid_role: ev.target.value } : null)} className="px-2 py-1 rounded bg-slate-700 text-sm w-20" placeholder="Role" />
                        <button onClick={() => updateRosterEntry(e, editingRoster)} className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs border border-sky-500/50">Save</button>
                        <button onClick={() => setEditingRoster(null)} className="px-2 py-1 rounded bg-slate-600 text-slate-300 text-xs">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <span className="font-medium text-slate-200">{e.character_name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 text-sm">{e.character_class} {e.primary_spec && `· ${e.primary_spec}`}</span>
                          <button onClick={() => setEditingRoster(e)} className="text-sky-400 hover:text-sky-300 text-xs">Edit</button>
                          <button onClick={() => deleteRosterEntry(e)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
