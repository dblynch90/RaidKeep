import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";

const PROFESSION_TYPES = [
  "Alchemy", "Blacksmithing", "Cooking", "Enchanting", "Engineering", "First Aid",
  "Herbalism", "Inscription", "Jewelcrafting", "Leatherworking", "Mining", "Skinning", "Tailoring",
];

interface MemberProfession {
  profession_type: string;
  notes: string;
  is_guild_crafter: boolean;
}

interface Member {
  name: string;
  class: string;
  level: number;
  professions: MemberProfession[];
}

interface GuildCraftersFullResponse {
  members: Member[];
  guild_roster: Array<{ name: string; class: string; level: number }>;
  permissions: GuildPermissions;
  my_character_names: string[];
  my_characters?: Array<{ name: string; class: string; level: number }>;
}

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function GuildCrafters() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "Retail";

  const [members, setMembers] = useState<Member[]>([]);
  const [guildRoster, setGuildRoster] = useState<Array<{ name: string; class: string; level: number }>>([]);
  const [myCharacters, setMyCharacters] = useState<Array<{ name: string; class: string; level: number }>>([]);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [myCharacterNames, setMyCharacterNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [professionFilter, setProfessionFilter] = useState("");
  const [addMemberChar, setAddMemberChar] = useState<string | null>(null);
  const [editProfession, setEditProfession] = useState<{ member: string; profession: string; notes: string; is_guild_crafter: boolean } | null>(null);

  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");

  const canManage = permissions?.manage_guild_crafters ?? false;

  const isOwnChar = (charName: string) => myCharacterNames.has(charName.toLowerCase());
  const canEditMember = (charName: string) => canManage || isOwnChar(charName);

  const fetchData = () => {
    if (!realm || !guildName) return;
    api
      .get<GuildCraftersFullResponse>(
        `/auth/me/guild-crafters-full?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) => {
        setMembers(r.members ?? []);
        setGuildRoster(r.guild_roster ?? []);
        setMyCharacters(r.my_characters ?? []);
        setPermissions(r.permissions ?? null);
        setMyCharacterNames(new Set((r.my_character_names ?? []).map((n) => n.toLowerCase())));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!realm || !guildName) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    fetchData();
  }, [realm, guildName, serverType, realmSlug]);

  const filteredMembers = useMemo(() => {
    return members
      .filter((m) => {
        const q = searchQuery.trim().toLowerCase();
        if (q && !m.name.toLowerCase().includes(q)) return false;
        if (professionFilter) {
          const hasProf = m.professions.some((p) => p.profession_type === professionFilter);
          if (!hasProf) return false;
        }
        return true;
      })
      .map((m) => ({
        ...m,
        professions: professionFilter
          ? m.professions.filter((p) => p.profession_type === professionFilter)
          : m.professions,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [members, searchQuery, professionFilter]);

  const addProfession = (charName: string, prof: string) => {
    api
      .post("/auth/me/guild-member-profession", {
        realm: realmSlug,
        guild_name: guildName,
        server_type: serverType,
        character_name: charName,
        profession_type: prof,
      })
      .then(() => {
        fetchData();
        setAddMemberChar(null);
      })
      .catch(() => {});
  };

  const updateProfession = (charName: string, prof: string, updates: { notes?: string; is_guild_crafter?: boolean }) => {
    api
      .put("/auth/me/guild-member-profession", {
        realm: realmSlug,
        guild_name: guildName,
        server_type: serverType,
        character_name: charName,
        profession_type: prof,
        ...updates,
      })
      .then(() => {
        fetchData();
        setEditProfession(null);
      })
      .catch(() => {});
  };

  const deleteProfession = (charName: string, prof: string) => {
    if (!confirm(`Remove ${prof} from ${charName}?`)) return;
    api
      .delete(
        `/auth/me/guild-member-profession?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}&character_name=${encodeURIComponent(charName)}&profession_type=${encodeURIComponent(prof)}`
      )
      .then(() => {
        fetchData();
        setEditProfession(null);
      })
      .catch(() => {});
  };

  const rosterNotInMembers = useMemo(() => {
    const memberSet = new Set(members.map((m) => m.name.toLowerCase()));
    return guildRoster.filter((r) => !memberSet.has(r.name.toLowerCase()));
  }, [guildRoster, members]);

  const myCharsNotInMembers = useMemo(() => {
    const memberSet = new Set(members.map((m) => m.name.toLowerCase()));
    return myCharacters.filter((r) => !memberSet.has(r.name.toLowerCase()));
  }, [myCharacters, members]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100">
        <main className="max-w-4xl mx-auto px-4 py-8">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <main className="max-w-4xl mx-auto px-4 py-8">
        <GuildBreadcrumbs
          guildName={guildName}
          realm={realm}
          serverType={serverType}
          currentPage="Guild Crafters"
        />

        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-sky-400">Guild Crafters</h1>
          <p className="text-slate-400 text-sm mt-1">
            {canManage
              ? "Add guild members as crafters, set professions and notes. Officers star crafters; members edit their own."
              : "View guild crafters by profession. Add or edit your own character's professions."}
            {" · "}
            {capitalizeRealm(realm)} · {serverType}
          </p>
        </header>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <div
            className="rounded-xl border border-slate-700 overflow-hidden"
            style={{
              background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <div className="p-4 border-b border-slate-700/60">
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  placeholder="Search by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 text-sm min-w-[180px] focus:ring-2 focus:ring-sky-500"
                />
                <select
                  value={professionFilter}
                  onChange={(e) => setProfessionFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 [color-scheme:dark]"
                >
                  <option value="">All professions</option>
                  {PROFESSION_TYPES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                {(canManage ? rosterNotInMembers.length > 0 : myCharsNotInMembers.length > 0) && (
                  <select
                    value={addMemberChar ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAddMemberChar(v || null);
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 text-sm"
                  >
                    <option value="">
                      {canManage ? "+ Add guild member..." : "+ Add my character..."}
                    </option>
                    {(canManage ? rosterNotInMembers : myCharsNotInMembers).map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.name} ({r.class} {r.level ? `Lv${r.level}` : ""})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {addMemberChar && (
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <span className="text-slate-400 text-sm">Add profession for {addMemberChar}:</span>
                  {PROFESSION_TYPES.filter((p) => {
                    const m = members.find((x) => x.name.toLowerCase() === addMemberChar!.toLowerCase());
                    return !m || !m.professions.some((pr) => pr.profession_type === p);
                  }).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => addProfession(addMemberChar!, p)}
                      className="px-2 py-1 rounded bg-sky-600/80 hover:bg-sky-500 text-white text-xs"
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAddMemberChar(null)}
                    className="text-slate-400 hover:text-slate-200 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            <div className="divide-y divide-slate-700/50">
              {filteredMembers.length === 0 ? (
                <div className="p-8 text-slate-500 text-center">
                  {members.length === 0
                    ? "No guild crafters yet. Officers can add guild members and set professions. Members can add their own characters."
                    : "No members match the current filters."}
                </div>
              ) : (
                filteredMembers.map((m) => (
                  <div key={m.name} className="p-4">
                    <div className="font-semibold text-slate-200 mb-2">
                      {m.name}
                      {(m.class || m.level) && (
                        <span className="text-slate-500 font-normal text-sm ml-2">
                          {m.class} {m.level ? `· Lv${m.level}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="pl-4 space-y-1">
                      {m.professions.length === 0 ? (
                        <p className="text-slate-500 text-sm py-1">No professions assigned.</p>
                      ) : (
                        m.professions.map((p) => (
                          <div
                            key={p.profession_type}
                            className="flex items-center justify-between py-1.5 px-2 rounded bg-slate-800/40 border border-slate-700/40 group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-slate-200 font-medium shrink-0">{p.profession_type}</span>
                              {p.is_guild_crafter && (
                                <span className="text-amber-400 shrink-0" title="Guild Crafter">⭐</span>
                              )}
                              <span className="text-slate-500 text-sm truncate">
                                {p.notes || "—"}
                              </span>
                            </div>
                            {canEditMember(m.name) && (
                              <button
                                type="button"
                                onClick={() =>
                                  setEditProfession({
                                    member: m.name,
                                    profession: p.profession_type,
                                    notes: p.notes,
                                    is_guild_crafter: p.is_guild_crafter,
                                  })
                                }
                                className="text-sky-400 hover:text-sky-300 text-xs shrink-0 opacity-0 group-hover:opacity-100 transition"
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        ))
                      )}
                      {canEditMember(m.name) && (
                        <AddProfessionRow
                          existingProfs={m.professions.map((p) => p.profession_type)}
                          onAdd={(prof) => addProfession(m.name, prof)}
                        />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {editProfession && (
          <EditProfessionModal
            member={editProfession.member}
            profession={editProfession.profession}
            notes={editProfession.notes}
            isGuildCrafter={editProfession.is_guild_crafter}
            canSetGuildCrafter={canManage}
            onSave={(updates) => updateProfession(editProfession.member, editProfession.profession, updates)}
            onDelete={() => deleteProfession(editProfession.member, editProfession.profession)}
            onClose={() => setEditProfession(null)}
          />
        )}
      </main>
    </div>
  );
}

function AddProfessionRow({
  existingProfs,
  onAdd,
}: {
  existingProfs: string[];
  onAdd: (prof: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const available = PROFESSION_TYPES.filter((p) => !existingProfs.includes(p));
  if (available.length === 0) return null;
  return (
    <div className="py-1">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sky-400 hover:text-sky-300 text-sm"
        >
          + Add profession
        </button>
      ) : (
        <div className="flex flex-wrap gap-1">
          {available.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { onAdd(p); setOpen(false); }}
              className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs"
            >
              {p}
            </button>
          ))}
          <button type="button" onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300 text-xs">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function EditProfessionModal({
  member,
  profession,
  notes,
  isGuildCrafter,
  canSetGuildCrafter,
  onSave,
  onDelete,
  onClose,
}: {
  member: string;
  profession: string;
  notes: string;
  isGuildCrafter: boolean;
  canSetGuildCrafter: boolean;
  onSave: (updates: { notes?: string; is_guild_crafter?: boolean }) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [notesVal, setNotesVal] = useState(notes);
  const [starVal, setStarVal] = useState(isGuildCrafter);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="rounded-xl border border-slate-600 p-6 w-full max-w-md bg-slate-800 shadow-xl"
        style={{ background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-200 mb-4">
          Edit {profession} · {member}
        </h3>
        <div className="space-y-4">
          {canSetGuildCrafter && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={starVal}
                onChange={(e) => setStarVal(e.target.checked)}
                className="rounded"
              />
              <span className="text-slate-300">Guild Crafter (starred)</span>
            </label>
          )}
          <div>
            <label className="block text-slate-400 text-sm mb-1">Notes</label>
            <textarea
              value={notesVal}
              onChange={(e) => setNotesVal(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 text-sm"
              placeholder="e.g. Ring enchants, bag crafting"
            />
          </div>
        </div>
        <div className="flex justify-between mt-6">
          <button
            type="button"
            onClick={onDelete}
            className="text-red-400 hover:text-red-300 text-sm"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-slate-600 text-slate-300 text-sm hover:bg-slate-500"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave({ notes: notesVal, ...(canSetGuildCrafter ? { is_guild_crafter: starVal } : {}) })}
              className="px-3 py-1.5 rounded bg-sky-600 text-white text-sm hover:bg-sky-500"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
