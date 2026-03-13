/** Format date with weekday: "Saturday, Mar 7" */
export function formatRaidDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/** Short format for cards: "SUN 15" */
export function formatRaidDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const day = d.getDate();
  return `${weekday} ${day}`;
}

/** Compact time slot: "Fri 7pm" from date + military time */
export function formatRaidSlot(dateStr: string, militaryTime?: string | null): string {
  const d = new Date(dateStr + "T12:00:00");
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const time = militaryTo12Hour(militaryTime ?? "19:00");
  const compact = time.replace(/:00 /, " ").replace(/\s*AM$/, "am").replace(/\s*PM$/, "pm");
  return `${weekday} ${compact}`;
}

/** Convert military time (HH:mm or HH:mm:ss) to 12-hour: "5:00 PM" */
export function militaryTo12Hour(military: string): string {
  if (!military) return "";
  const parts = military.split(":");
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parts[1] ? parseInt(parts[1], 10) : 0;
  const hour = h % 12 || 12;
  const ampm = h < 12 ? "AM" : "PM";
  const minStr = m.toString().padStart(2, "0");
  return `${hour}:${minStr} ${ampm}`;
}

/** Format time range in 12-hour, returns empty string if neither provided */
export function formatTimeRange(start?: string | null, finish?: string | null): string {
  if (!start && !finish) return "";
  if (start && finish) return `${militaryTo12Hour(start)} – ${militaryTo12Hour(finish)}`;
  return militaryTo12Hour(start ?? finish ?? "");
}

/** Full raid date/time string with "server time" suffix */
export function formatRaidDateTime(
  dateStr: string,
  start?: string | null,
  finish?: string | null
): string {
  const datePart = formatRaidDate(dateStr);
  const timePart = formatTimeRange(start, finish);
  const combined = timePart ? `${datePart} • ${timePart}` : datePart;
  return `${combined} (server time)`;
}
