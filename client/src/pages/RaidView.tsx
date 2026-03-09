import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";
import { api } from "../api";
import type { MyCharacter } from "../api";
import { useToast } from "../context/ToastContext";
import { formatRaidDateTime } from "../utils/raidDateTime";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";

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

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

interface RaidSlotRow {
  id: number;
  raid_id: number;
  party_index: number;
  slot_index: number;
  character_name: string;
  character_class: string;
  role: string;
  is_raid_lead: number;
  is_raid_assist: number;
  availability_status?: "pending" | "confirmed" | "unavailable";
}

interface Raid {
  id: number;
  guild_name: string;
  guild_realm: string;
  guild_realm_slug: string;
  server_type: string;
  raid_name: string;
  raid_instance: string | null;
  raid_date: string;
  start_time: string | null;
  finish_time: string | null;
}

export function RaidView() {
  const { id } = useParams();
  const location = useLocation();
  const toast = useToast();
  const scrollToSignup = useRef(location.hash === "#signup");
  const [raid, setRaid] = useState<Raid | null>(null);
  const [slots, setSlots] = useState<RaidSlotRow[]>([]);
  const [backups, setBackups] = useState<Array<{ character_name: string; character_class: string }>>([]);
  const [available, setAvailable] = useState<Array<{ character_name: string; character_class: string }>>([]);
  const [myCharacters, setMyCharacters] = useState<MyCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const refreshRaid = () => {
    if (!id) return;
    api.get<{
      raid: Raid;
      slots: RaidSlotRow[];
      backups?: Array<{ character_name: string; character_class: string }>;
      available?: Array<{ character_name: string; character_class: string }>;
    }>(`/auth/me/saved-raids/${id}`).then((res) => {
      setRaid(res.raid);
      setSlots(res.slots);
      setBackups(res.backups ?? []);
      setAvailable(res.available ?? []);
    });
  };

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError("Invalid raid");
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<{
        raid: Raid;
        slots: RaidSlotRow[];
        backups?: Array<{ character_name: string; character_class: string }>;
        available?: Array<{ character_name: string; character_class: string }>;
      }>(`/auth/me/saved-raids/${id}`),
      api.get<{ characters: MyCharacter[] }>("/auth/me/characters"),
    ])
      .then(([raidRes, charsRes]) => {
        setRaid(raidRes.raid);
        setSlots(raidRes.slots);
        setBackups(raidRes.backups ?? []);
        setAvailable(raidRes.available ?? []);
        setMyCharacters(charsRes.characters ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load raid"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (scrollToSignup.current && !loading) {
      document.getElementById("signup-section")?.scrollIntoView({ behavior: "smooth" });
      scrollToSignup.current = false;
    }
  }, [loading]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100">
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  if (loading || !raid) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100">
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-slate-500">Loading raid...</p>
        </main>
      </div>
    );
  }

  const unavailableSlots = slots.filter((s) => (s.availability_status || "pending") === "unavailable");
  const partySlotsOnly = slots.filter((s) => (s.availability_status || "pending") !== "unavailable");
  const partiesMap = new Map<number, RaidSlotRow[]>();
  for (const s of partySlotsOnly) {
    const list = partiesMap.get(s.party_index) ?? [];
    list.push(s);
    partiesMap.set(s.party_index, list);
  }
  const partyIndices = [...partiesMap.keys()].sort((a, b) => a - b);

  const raidRealmSlug = (raid.guild_realm_slug ?? "").toLowerCase().replace(/\s+/g, "-");
  const raidServerType = raid.server_type ?? "Retail";
  const myCharNames = new Set(myCharacters.map((c) => c.name.toLowerCase()));
  const inParty = new Set(slots.map((s) => s.character_name.toLowerCase()));
  const inBackup = new Set(backups.map((b) => b.character_name.toLowerCase()));
  const inAvailable = new Set(available.map((a) => a.character_name.toLowerCase()));
  const canSignUp = myCharacters.filter((c) => {
    const charRealm = (c.realm_slug ?? (c.realm ?? "").toLowerCase().replace(/\s+/g, "-")).toLowerCase();
    const charServerType = c.server_type ?? "Retail";
    const sameRealm = charRealm === raidRealmSlug;
    const sameVersion = charServerType === raidServerType;
    const notAssigned =
      !inParty.has(c.name.toLowerCase()) &&
      !inBackup.has(c.name.toLowerCase()) &&
      !inAvailable.has(c.name.toLowerCase());
    return sameRealm && sameVersion && notAssigned;
  });

  const handleConfirm = async (slotId: number, status: "confirmed" | "unavailable") => {
    setConfirming(slotId);
    try {
      await api.post(`/auth/me/saved-raids/${id}/confirm-availability`, { slot_id: slotId, status });
      refreshRaid();
      toast.showSuccess(status === "confirmed" ? "Availability confirmed" : "Marked as unavailable");
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : "Failed to update availability");
    } finally {
      setConfirming(null);
    }
  };

  const handleSignUp = async (characterName: string, characterClass: string) => {
    try {
      await api.post(`/auth/me/saved-raids/${id}/sign-up`, { character_name: characterName, character_class: characterClass });
      refreshRaid();
      toast.showSuccess(`Signed up as ${characterName}`);
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : "Failed to sign up");
    }
  };

  const handleRemoveSignUp = async (characterName: string) => {
    try {
      await api.delete(`/auth/me/saved-raids/${id}/sign-up?character_name=${encodeURIComponent(characterName)}`);
      refreshRaid();
      toast.showSuccess(`Removed sign-up for ${characterName}`);
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : "Failed to remove sign-up");
    }
  };

  const realmSlug = raid.guild_realm_slug ?? raid.guild_realm?.toLowerCase().replace(/\s+/g, "-") ?? "";
  const raidScheduleUrl = `/raid-schedule?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(raid.guild_name)}&server_type=${encodeURIComponent(raid.server_type ?? "Retail")}`;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <main className="max-w-6xl mx-auto px-4 py-8">
        <GuildBreadcrumbs
          guildName={raid.guild_name}
          realm={realmSlug}
          serverType={raid.server_type ?? "Retail"}
          extraItems={[{ label: "Raid Schedule", href: raidScheduleUrl }]}
          currentPage={raid.raid_name}
        />
        <div className="mb-6">
          <h1 className="text-xl font-bold text-sky-400">{raid.raid_name}</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {raid.raid_instance || "Raid"} · {raid.guild_name} · {capitalizeRealm(raid.guild_realm)} · {raid.server_type}
          </p>
          <p className="text-slate-500 text-sm mt-1">
            {formatRaidDateTime(raid.raid_date, raid.start_time, raid.finish_time)}
          </p>
        </div>

        <div className="space-y-4">
          {partyIndices.map((pi) => {
            const partySlots = (partiesMap.get(pi) ?? []).sort((a, b) => a.slot_index - b.slot_index);
            return (
              <div
                key={pi}
                className="rounded-lg border border-slate-600 bg-slate-800/50 p-3"
              >
                <h3 className="text-slate-400 font-medium text-sm mb-3 uppercase tracking-wider">
                  Party {pi + 1}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {partySlots.map((s) => {
                    const classColor = getClassColor(s.character_class);
                    const isMySlot = myCharNames.has(s.character_name.toLowerCase());
                    const status = s.availability_status || "pending";
                    return (
                      <div
                        key={s.id}
                        className="rounded border border-slate-600 p-2 min-w-[100px]"
                        style={{
                          borderLeftWidth: 4,
                          borderLeftColor: classColor,
                          backgroundColor: `${classColor}18`,
                        }}
                      >
                        <div className="font-medium text-slate-100 text-sm truncate" title={s.character_name}>
                          {s.character_name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span
                            className="text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: `${classColor}30`,
                              color: classColor,
                            }}
                          >
                            {s.character_class}
                          </span>
                          {!(s.role || "").toLowerCase().includes("raid lead") && !(s.role || "").toLowerCase().includes("raid assist") && (
                            <span className="text-slate-500 text-xs">
                              {(s.role || "").toLowerCase() === "dps" ? "DPS" : s.role || "—"}
                            </span>
                          )}
                          {s.is_raid_lead && (
                            <span className="text-sky-400 text-xs" title="Raid Lead">★ RL</span>
                          )}
                          {s.is_raid_assist && (
                            <span className="text-sky-400 text-xs ml-0.5" title="Raid Assist">🛡 RA</span>
                          )}
                          {isMySlot && (
                            <span className="ml-auto flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => handleConfirm(s.id, "confirmed")}
                                disabled={confirming === s.id}
                                className={`w-5 h-5 rounded flex items-center justify-center text-xs ${status === "confirmed" ? "bg-emerald-500/30 text-emerald-400" : "text-slate-500 hover:bg-slate-600 hover:text-emerald-400"}`}
                                title="Confirm available"
                                aria-label={`Confirm available for ${s.character_name}`}
                              >
                                ✓
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConfirm(s.id, "unavailable")}
                                disabled={confirming === s.id}
                                className={`w-5 h-5 rounded flex items-center justify-center text-xs ${status === "unavailable" ? "bg-red-500/30 text-red-400" : "text-slate-500 hover:bg-slate-600 hover:text-red-400"}`}
                                title="Not available"
                                aria-label={`Decline availability for ${s.character_name}`}
                              >
                                ✗
                              </button>
                            </span>
                          )}
                          {!isMySlot && status === "confirmed" && (
                            <span className="text-emerald-400 text-xs ml-auto" title="Confirmed">✓</span>
                          )}
                          {!isMySlot && status === "unavailable" && (
                            <span className="text-red-400 text-xs ml-auto" title="Unavailable">✗</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {backups.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-600">
            <h3 className="text-slate-400 font-medium text-sm mb-3 uppercase tracking-wider">
              Backups
            </h3>
            <div className="flex flex-wrap gap-2">
              {backups.map((b) => {
                const classColor = getClassColor(b.character_class);
                return (
                  <div
                    key={b.character_name}
                    className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 border border-slate-600"
                    style={{
                      borderLeftWidth: 4,
                      borderLeftColor: classColor,
                      backgroundColor: `${classColor}18`,
                    }}
                  >
                    <span className="font-medium text-slate-200 text-sm">{b.character_name}</span>
                    <span
                      className="text-xs font-medium px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${classColor}30`,
                        color: classColor,
                      }}
                    >
                      {b.character_class}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {available.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-600">
            <h3 className="text-slate-400 font-medium text-sm mb-3 uppercase tracking-wider">
              Signed Up (awaiting assignment)
            </h3>
            <div className="flex flex-wrap gap-2">
              {available.map((a) => {
                const classColor = getClassColor(a.character_class);
                const isMine = myCharNames.has(a.character_name.toLowerCase());
                return (
                  <div
                    key={a.character_name}
                    className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 border border-slate-600"
                    style={{
                      borderLeftWidth: 4,
                      borderLeftColor: classColor,
                      backgroundColor: `${classColor}18`,
                    }}
                  >
                    <span className="font-medium text-slate-200 text-sm">{a.character_name}</span>
                    <span
                      className="text-xs font-medium px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${classColor}30`,
                        color: classColor,
                      }}
                    >
                      {a.character_class}
                    </span>
                    {isMine && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSignUp(a.character_name)}
                        className="text-slate-500 hover:text-red-400 text-xs"
                        title="Remove sign-up"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {unavailableSlots.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-600">
            <h3 className="text-slate-400 font-medium text-sm mb-3 uppercase tracking-wider">
              Unavailable
            </h3>
            <p className="text-slate-500 text-sm mb-3">
              Assigned players who have declined their raid spot.
            </p>
            <div className="flex flex-wrap gap-2">
              {unavailableSlots.map((s) => {
                const classColor = getClassColor(s.character_class);
                return (
                  <div
                    key={s.id}
                    className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 border border-slate-600 opacity-75"
                    style={{
                      borderLeftWidth: 4,
                      borderLeftColor: classColor,
                      backgroundColor: `${classColor}18`,
                    }}
                  >
                    <span className="font-medium text-slate-400 text-sm">{s.character_name}</span>
                    <span
                      className="text-xs font-medium px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${classColor}30`,
                        color: classColor,
                      }}
                    >
                      {s.character_class}
                    </span>
                    <span className="text-slate-500 text-xs">
                      {(s.role || "").toLowerCase() === "dps" ? "DPS" : s.role || "—"}
                    </span>
                    {s.is_raid_lead && <span className="text-sky-400 text-xs" title="Raid Lead">★ RL</span>}
                    {s.is_raid_assist && <span className="text-sky-400 text-xs" title="Raid Assist">🛡 RA</span>}
                    <span className="text-red-400 text-xs">Party {s.party_index + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div id="signup-section" className="mt-6 pt-4 border-t border-slate-600">
          <h3 className="text-slate-400 font-medium text-sm mb-3 uppercase tracking-wider">
            Sign Up
          </h3>
          <p className="text-slate-500 text-sm mb-3">
            Sign up as available if you are not assigned. A raid manager can move you to a party or backup slot.
          </p>
          {canSignUp.length === 0 ? (
            <p className="text-slate-500 text-sm">
              {myCharacters.length === 0
                ? "Add characters from Battle.net to sign up."
                : "All your characters are already assigned or signed up."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canSignUp.map((c) => {
                const classColor = getClassColor(c.class);
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => handleSignUp(c.name, c.class)}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 border border-slate-600 text-sm font-medium transition hover:opacity-90"
                    style={{
                      borderLeftWidth: 4,
                      borderLeftColor: classColor,
                      backgroundColor: `${classColor}18`,
                    }}
                  >
                    <span className="font-medium text-slate-200">{c.name}</span>
                    <span
                      className="text-xs font-medium px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${classColor}30`,
                        color: classColor,
                      }}
                    >
                      {c.class}
                    </span>
                    <span className="text-slate-400 text-xs">Sign Up</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
