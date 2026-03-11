import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../context/ToastContext";

export function RaidOfficerNotesPopout() {
  const [searchParams] = useSearchParams();
  const raidId = searchParams.get("raidId") ?? "";
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [originalNotes, setOriginalNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raidName, setRaidName] = useState("");

  useEffect(() => {
    const id = parseInt(raidId, 10);
    if (!raidId || isNaN(id)) {
      setLoading(false);
      setError("Missing or invalid raid ID");
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<{ raid: { officer_notes?: string | null; raid_name?: string } }>(`/auth/me/saved-raids/${id}`)
      .then((r) => {
        const raw = r.raid?.officer_notes;
        const value = typeof raw === "string" ? raw : "";
        setNotes(value);
        setOriginalNotes(value);
        setRaidName(r.raid?.raid_name ?? "Raid");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load raid"))
      .finally(() => setLoading(false));
  }, [raidId]);

  const handleSave = () => {
    const id = parseInt(raidId, 10);
    if (isNaN(id)) return;
    setSaving(true);
    api
      .patch(`/auth/me/saved-raids/${id}`, { officer_notes: notes })
      .then(() => {
        setOriginalNotes(notes);
        toast.showSuccess("Officer notes saved");
      })
      .catch((err) => {
        toast.showError(err instanceof Error ? err.message : "Failed to save notes");
      })
      .finally(() => setSaving(false));
  };

  if (error) {
    return (
      <div className="rk-page-bg text-slate-100 flex items-center justify-center p-8" >
        <p className="text-amber-500">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rk-page-bg text-slate-100 flex items-center justify-center p-8" >
        <p className="text-slate-500">Loading raid...</p>
      </div>
    );
  }

  const hasChanges = notes !== originalNotes;

  return (
    <div className="rk-page-bg text-slate-100 flex flex-col" >
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-700/60 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-sky-400 truncate" title={raidName}>
            Officer Notes · {raidName}
          </h1>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div className="flex-1 p-4">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Enter officer notes for this raid (visible only to officers)…"
          className="w-full h-full min-h-[calc(100vh-120px)] px-4 py-3 rounded-lg bg-slate-800/80 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 resize-none font-mono text-sm"
          spellCheck={true}
        />
      </div>
    </div>
  );
}
