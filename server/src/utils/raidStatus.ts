/**
 * Raid status and server time utilities.
 * SERVER_TIMEZONE env (e.g. "America/Los_Angeles") for WoW server time.
 */

export type RaidStatus = "forming" | "formed" | "in-progress" | "complete";

export interface SlotCounts {
  total: number;
  filled: number;
  tanks: number;
  healers: number;
  dps: number;
  confirmed: number;
  pending?: number;
  unavailable?: number;
}

export function getServerNow(): Date {
  const tz = process.env.SERVER_TIMEZONE || "UTC";
  try {
    const str = new Date().toLocaleString("en-US", { timeZone: tz });
    return new Date(str);
  } catch {
    return new Date();
  }
}

export function getRaidStatus(
  raidDate: string,
  startTime: string | null,
  finishTime: string | null,
  slotCounts: SlotCounts
): RaidStatus {
  const tz = process.env.SERVER_TIMEZONE || "UTC";
  let serverNow: Date;
  try {
    const str = new Date().toLocaleString("en-US", { timeZone: tz });
    serverNow = new Date(str);
  } catch {
    serverNow = new Date();
  }

  const dateStr = raidDate; // YYYY-MM-DD
  const startStr = startTime ? `${dateStr}T${startTime}` : `${dateStr}T00:00`;
  const finishStr = finishTime ? `${dateStr}T${finishTime}` : `${dateStr}T23:59`;

  const startDt = new Date(startStr);
  const finishDt = new Date(finishStr);

  if (serverNow > finishDt) return "complete";
  if (serverNow >= startDt && serverNow <= finishDt) return "in-progress";

  const allFilled = slotCounts.filled >= slotCounts.total && slotCounts.total > 0;
  const allConfirmed = slotCounts.confirmed === slotCounts.filled && slotCounts.filled > 0;

  if (allFilled && allConfirmed) return "formed";
  return "forming";
}
