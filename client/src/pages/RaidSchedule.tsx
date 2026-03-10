import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import { RaidCard, type RaidCardData } from "../components/RaidCard";

interface SavedRaid extends RaidCardData {
  guild_name: string;
  guild_realm: string;
  guild_realm_slug: string;
  server_type: string;
}

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const prevDefaultOpen = useRef(defaultOpen);
  useEffect(() => {
    if (defaultOpen && !prevDefaultOpen.current) setOpen(true);
    prevDefaultOpen.current = defaultOpen;
  }, [defaultOpen]);
  return (
    <div
      className="rounded-xl border border-white/[0.05] overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left bg-transparent hover:bg-slate-700/30 transition"
      >
        <span className="font-medium text-slate-200">{title}</span>
        <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          ▼
        </span>
      </button>
      {open && <div className="border-t border-slate-700/60">{children}</div>}
    </div>
  );
}

export function RaidSchedule() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "TBC Anniversary";

  const [raids, setRaids] = useState<SavedRaid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!realm || !guildName) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<{ raids: SavedRaid[] }>(
        `/auth/me/saved-raids?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) => setRaids(r.raids))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load raids"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType]);

  const today = new Date().toISOString().slice(0, 10);
  const upcomingRaids = raids
    .filter((r) => r.raid_date >= today)
    .sort((a, b) => a.raid_date.localeCompare(b.raid_date) || (a.start_time || "").localeCompare(b.start_time || ""));
  const pastRaids = raids
    .filter((r) => r.raid_date < today)
    .sort((a, b) => b.raid_date.localeCompare(a.raid_date) || (b.start_time || "").localeCompare(a.start_time || ""));

  if (error) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Raid Schedule" />

        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-sky-400">{guildName}</h1>
          <p className="text-slate-400 text-sm mt-1">
            Raid Schedule · {capitalizeRealm(realm)} · {serverType}
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        {loading ? (
          <p className="text-slate-500">Loading raids...</p>
        ) : (
          <div className="space-y-6">
            <section>
              <h2 className="text-slate-400 font-medium text-sm uppercase tracking-wider mb-4">
                Upcoming Raids
              </h2>
              {upcomingRaids.length === 0 ? (
                <p className="text-slate-500 text-sm py-4">No upcoming raids scheduled.</p>
              ) : (
                <div className="space-y-4">
                  {upcomingRaids.map((r) => (
                    <RaidCard key={r.id} raid={r} showSignUp baseUrl="/raid" />
                  ))}
                </div>
              )}
            </section>

            {pastRaids.length > 0 && (
              <CollapsibleSection title={`Past Raids (${pastRaids.length})`} defaultOpen={false}>
                <div className="p-4 space-y-4">
                  {pastRaids.map((r) => (
                    <RaidCard key={r.id} raid={r} baseUrl="/raid" />
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
