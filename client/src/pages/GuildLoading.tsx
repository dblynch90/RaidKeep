import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api } from "../api";
import type { GuildPermissions } from "./GuildPermissions";

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function GuildLoading() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "TBC Anniversary";

  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [guildDataLoaded, setGuildDataLoaded] = useState(false);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const guildDashboardUrl = `/guild-dashboard?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;

  const permissionsUrl = `/auth/me/guild-permissions?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;

  useEffect(() => {
    if (!realm || !guildName) {
      setError("Missing realm or guild name");
      return;
    }
    setError(null);
    setPermissionsLoaded(false);
    setGuildDataLoaded(false);
    setRetryCount(0);
  }, [realm, realmSlug, guildName, serverType]);

  // Step 1: Load permissions (with retries for post-login sync race)
  useEffect(() => {
    if (!realm || !guildName) return;

    const maxRetries = 3;
    const retryDelayMs = 1500;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const fetchPerms = (attempt: number) => {
      if (cancelled) return;
      api
        .get<{ permissions: GuildPermissions }>(permissionsUrl)
        .then((r) => {
          if (cancelled) return;
          const perms = r.permissions;
          if (perms.view_guild_dashboard || attempt >= maxRetries) {
            setPermissions(perms);
            setPermissionsLoaded(true);
          } else {
            // No access yet - may be sync race; retry after delay
            setRetryCount((c) => c + 1);
            timeoutId = setTimeout(() => fetchPerms(attempt + 1), retryDelayMs);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load permissions");
        });
    };

    fetchPerms(0);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [realm, realmSlug, guildName, serverType, permissionsUrl]);

  // Step 2: Load guild data (saved raids - lightweight check that guild is accessible)
  useEffect(() => {
    if (!permissionsLoaded || !realm || !guildName) return;

    api
      .get<{ raids: unknown[] }>(
        `/auth/me/saved-raids?guild_realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then(() => {
        setGuildDataLoaded(true);
      })
      .catch(() => {
        // Saved-raids can fail for new guilds; still allow access if we have permissions
        setGuildDataLoaded(true);
      });
  }, [permissionsLoaded, realm, realmSlug, guildName, serverType]);

  // Navigate when both conditions are met
  useEffect(() => {
    if (!permissionsLoaded || !guildDataLoaded || !permissions) return;
    if (permissions.view_guild_dashboard) {
      navigate(guildDashboardUrl, { replace: true });
    }
  }, [permissionsLoaded, guildDataLoaded, permissions, navigate, guildDashboardUrl]);

  if (error) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500 mb-4">{error}</p>
          <Link to="/" className="text-sky-400 hover:text-sky-300">
            ← Back to Dashboard
          </Link>
        </main>
      </div>
    );
  }

  if (permissionsLoaded && guildDataLoaded && permissions && !permissions.view_guild_dashboard) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500 mb-4">You do not have permission to view this guild dashboard.</p>
          <Link to="/" className="text-sky-400 hover:text-sky-300">
            ← Back to Dashboard
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="max-w-md mx-auto mt-16 text-center">
          <h1 className="text-xl font-semibold text-sky-400 mb-2">
            {guildName}
          </h1>
          <p className="text-slate-400 text-sm mb-8">
            {capitalizeRealm(realm)} · {serverType}
          </p>

          <div className="space-y-4 text-left">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
              {permissionsLoaded ? (
                <span className="text-emerald-400 text-lg" aria-hidden>✓</span>
              ) : (
                <div className="h-5 w-5 rounded-full border-2 border-slate-500 border-t-sky-500 animate-spin" aria-hidden />
              )}
              <span className={permissionsLoaded ? "text-slate-300" : "text-slate-400"}>
                Loading Permissions
                {retryCount > 0 && (
                  <span className="ml-2 text-slate-500 text-sm">(syncing characters…)</span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
              {guildDataLoaded ? (
                <span className="text-emerald-400 text-lg" aria-hidden>✓</span>
              ) : (
                <div className="h-5 w-5 rounded-full border-2 border-slate-500 border-t-sky-500 animate-spin" aria-hidden />
              )}
              <span className={guildDataLoaded ? "text-slate-300" : "text-slate-400"}>
                Loading Guild Data
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
