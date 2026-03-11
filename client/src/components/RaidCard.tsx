import { Link } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { formatRaidDateShort, formatTimeRange } from "../utils/raidDateTime";
import { getClassColor } from "../utils/classColors";

export type RaidStatus = "forming" | "formed" | "in-progress" | "complete";

export interface RaidCardData {
  id: number;
  raid_name: string;
  raid_instance?: string | null;
  raid_date: string;
  start_time?: string | null;
  finish_time?: string | null;
  guild_name?: string;
  guild_realm_slug?: string;
  server_type?: string;
  slot_counts?: {
    total: number;
    filled: number;
    tanks: number;
    healers: number;
    dps: number;
    confirmed?: number;
    signed_up?: number;
  };
  raid_status?: RaidStatus | string;
  /** Your character(s) assigned to this raid (for My Raids cards) */
  my_characters?: Array<{ character_name: string; character_class: string; role?: string }>;
}

function StatusBadge({ status }: { status?: RaidStatus }) {
  const labels: Record<string, { label: string; className: string }> = {
    forming: { label: "Forming", className: "bg-sky-500/20 text-sky-400" },
    formed: { label: "Formed", className: "bg-emerald-500/20 text-emerald-400" },
    "in-progress": { label: "In-Progress", className: "bg-blue-500/20 text-blue-400" },
    complete: { label: "Complete", className: "bg-slate-500/20 text-slate-400" },
  };
  const cfg = status ? labels[status] ?? labels.forming : labels.formed;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

export function RaidCard({
  raid,
  showSignUp = false,
  isAssigned = false,
  baseUrl = "/raid",
  editUrl,
  onDelete,
  deleting = false,
}: {
  raid: RaidCardData;
  showSignUp?: boolean;
  isAssigned?: boolean;
  baseUrl?: string;
  editUrl?: string;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const toast = useToast();
  const dateShort = formatRaidDateShort(raid.raid_date);
  const timeRange = formatTimeRange(raid.start_time, raid.finish_time);
  const instanceShort = raid.raid_instance || "Raid";
  const sc = raid.slot_counts;
  const status = raid.raid_status as RaidStatus | undefined;

  const copyRaidLink = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const link = `${window.location.origin}${baseUrl}/${raid.id}`;
    navigator.clipboard.writeText(link).then(() => toast.showSuccess("Raid link copied")).catch(() => toast.showError("Failed to copy link"));
  };

  return (
    <div className="rk-card-panel rounded-xl border border-white/[0.05] p-4 sm:p-5 transition-all duration-200 hover:-translate-y-0.5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-medium text-sm tabular-nums">{dateShort}</span>
            <span className="text-slate-100 font-semibold truncate">
              {raid.raid_name}
              {instanceShort !== "Raid" && ` (${instanceShort})`}
            </span>
            <StatusBadge status={status} />
          </div>
          {timeRange && (
            <p className="text-slate-500 text-sm mt-1">
              {timeRange} (Server Time)
            </p>
          )}
          {isAssigned && raid.my_characters && raid.my_characters.length > 0 && (
            <p className="text-slate-400 text-sm mt-1">
              {raid.my_characters.map((c, i) => (
                <span key={c.character_name}>
                  {i > 0 && ", "}
                  <span style={{ color: getClassColor(c.character_class) }} className="font-medium">{c.character_name}</span>
                  {c.role && (
                    <span className="text-slate-500">
                      {" · "}
                      {(c.role || "").toLowerCase() === "dps" ? "DPS" : c.role}
                    </span>
                  )}
                </span>
              ))}
            </p>
          )}
          {!isAssigned && sc && (
            <p className="text-slate-400 text-sm mt-1">
              Assigned: {sc.filled} · Confirmed: {sc.confirmed ?? 0} · Signed Up: {sc.signed_up ?? 0}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2 flex-wrap sm:flex-nowrap">
          <button
            type="button"
            onClick={copyRaidLink}
            className="h-11 min-h-[44px] sm:h-9 flex-1 sm:flex-none px-3.5 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-sm font-medium flex items-center justify-center"
            title="Copy raid link"
          >
            Copy Link
          </button>
          <Link
            to={showSignUp && !isAssigned ? `${baseUrl}/${raid.id}#signup` : `${baseUrl}/${raid.id}`}
            className="h-11 min-h-[44px] sm:h-9 flex-1 sm:flex-none px-3.5 rounded-lg bg-slate-600 hover:bg-slate-500 border border-slate-500 text-slate-100 text-sm font-medium flex items-center justify-center"
          >
            {showSignUp && !isAssigned ? "View/Sign Up" : "View"}
          </Link>
          {editUrl && (
            <Link
              to={editUrl}
              className="h-11 min-h-[44px] sm:h-9 flex-1 sm:flex-none px-3.5 rounded-lg bg-slate-600 hover:bg-slate-500 border border-slate-500 text-slate-100 text-sm font-medium flex items-center justify-center"
            >
              Edit
            </Link>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="h-11 min-h-[44px] sm:h-9 flex-1 sm:flex-none px-3.5 rounded-lg bg-red-900/30 hover:bg-red-800/40 border border-red-800/50 text-red-400 text-sm font-medium disabled:opacity-50 flex items-center justify-center"
            >
              {deleting ? "..." : "Delete"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
