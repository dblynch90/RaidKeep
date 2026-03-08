import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

const API = "/api";

interface Guild {
  guild_name: string;
  realm_slug: string;
  realm_display: string;
  server_type: string;
}

export function AdminDashboard() {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState<{ username: string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API}/admin/me`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) {
          navigate("/admin/login", { replace: true });
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) setAdmin(data);
      });
  }, [navigate]);

  useEffect(() => {
    if (!admin) return;
    fetch(`${API}/admin/guilds`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setGuilds(data.guilds || []))
      .catch(() => setGuilds([]))
      .finally(() => setLoading(false));
  }, [admin]);

  const handleLogout = async () => {
    await fetch(`${API}/admin/logout`, { method: "POST", credentials: "include" });
    navigate("/admin/login", { replace: true });
  };

  const deleteGuild = async (e: React.MouseEvent, g: Guild) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete all data for ${g.guild_name} (${g.realm_display})?`)) return;
    const r = await fetch(
      `${API}/admin/guild/${g.realm_slug}/${encodeURIComponent(g.guild_name)}?server_type=${encodeURIComponent(g.server_type)}`,
      { method: "DELETE", credentials: "include" }
    );
    if (r.ok) setGuilds((prev) => prev.filter((x) => x.realm_slug !== g.realm_slug || x.guild_name !== g.guild_name || x.server_type !== g.server_type));
  };

  if (!admin) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-700 bg-slate-800/50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-sky-400">Admin · RaidKeep</h1>
          <div className="flex items-center gap-4">
            <span className="text-slate-400 text-sm">{admin.username}</span>
            <button
              onClick={handleLogout}
              className="text-slate-500 hover:text-slate-300 text-sm"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="text-xl font-semibold text-slate-200 mb-6">Active Guilds</h2>
        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : guilds.length === 0 ? (
          <p className="text-slate-500">No active guilds found.</p>
        ) : (
          <div className="grid gap-3">
            {guilds.map((g) => (
              <div
                key={`${g.realm_slug}-${g.guild_name}-${g.server_type}`}
                className="flex items-center justify-between gap-4 p-4 rounded-xl border border-slate-700 hover:border-sky-600/50 transition"
                style={{
                  background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
                }}
              >
                <Link
                  to={`/admin/guild/${g.realm_slug}/${encodeURIComponent(g.guild_name)}?server_type=${encodeURIComponent(g.server_type)}`}
                  className="flex-1 min-w-0"
                >
                  <div className="font-medium text-sky-400">{g.guild_name}</div>
                  <div className="text-slate-500 text-sm mt-0.5">
                    {g.realm_display} · {g.server_type}
                  </div>
                </Link>
                <button
                  onClick={(e) => deleteGuild(e, g)}
                  className="shrink-0 px-2 py-1 rounded text-red-400 hover:bg-red-900/30 text-xs"
                  title="Delete guild"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
