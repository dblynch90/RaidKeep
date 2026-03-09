import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";

interface Recipe {
  character_name: string;
  recipe_name: string;
  profession: string | null;
}

interface Crafter {
  character_name: string;
  profession_type: string;
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

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [crafters, setCrafters] = useState<Crafter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [professionFilter, setProfessionFilter] = useState("");

  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");

  useEffect(() => {
    if (!realm || !guildName) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<{ recipes: Recipe[]; crafters: Crafter[] }>(
        `/auth/me/guild-recipes?guild_realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) => {
        setRecipes(r.recipes ?? []);
        setCrafters(r.crafters ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType, realmSlug]);

  const filteredRecipes = useMemo(() => {
    let list = recipes;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => r.recipe_name.toLowerCase().includes(q));
    }
    if (professionFilter) {
      list = list.filter((r) => (r.profession || "").toLowerCase() === professionFilter.toLowerCase());
    }
    return list;
  }, [recipes, searchQuery, professionFilter]);

  const professionOptions = useMemo(() => {
    const set = new Set(recipes.map((r) => r.profession).filter(Boolean) as string[]);
    return [...set].sort();
  }, [recipes]);

  const byRecipe = useMemo(() => {
    const m = new Map<string, Recipe[]>();
    for (const r of filteredRecipes) {
      const key = r.recipe_name;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return m;
  }, [filteredRecipes]);

  const crafterByProfession = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of crafters) {
      if (!m.has(c.profession_type)) m.set(c.profession_type, []);
      m.get(c.profession_type)!.push(c.character_name);
    }
    return m;
  }, [crafters]);

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
            Search recipe books of starred guild crafters · {capitalizeRealm(realm)} · {serverType}
          </p>
        </header>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : crafters.length === 0 ? (
          <div
            className="rounded-xl border border-slate-700 p-8"
            style={{ background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)" }}
          >
            <p className="text-slate-400">
              No guild crafters have been designated yet. Officers can star members as Guild Enchanter, Guild Alchemist, etc. in the Admin area.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-700 p-4 mb-6" style={{ background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)" }}>
              <h2 className="text-slate-200 font-medium text-sm mb-3">Guild Crafters</h2>
              <div className="flex flex-wrap gap-2">
                {[...crafterByProfession.entries()].map(([prof, names]) => (
                  <span key={prof} className="px-2 py-1 rounded bg-amber-600/20 text-amber-300 text-sm">
                    {prof}: {names.join(", ")}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 p-4 mb-6" style={{ background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)" }}>
              <div className="flex flex-wrap gap-3 mb-4">
                <input
                  type="text"
                  placeholder="Search recipes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50"
                />
                <select
                  value={professionFilter}
                  onChange={(e) => setProfessionFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50"
                >
                  <option value="">All professions</option>
                  {professionOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {filteredRecipes.length === 0 ? (
                <p className="text-slate-500 text-sm py-4">No recipes match your search.</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {[...byRecipe.entries()]
                    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
                    .map(([recipeName, list]) => (
                      <div
                        key={recipeName}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-800/50 border border-slate-600/40"
                      >
                        <span className="font-medium text-slate-200">{recipeName}</span>
                        <span className="text-slate-400 text-sm">
                          {list.map((r) => r.character_name).join(", ")}
                          {list[0]?.profession && (
                            <span className="ml-2 text-slate-500">· {list[0].profession}</span>
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
