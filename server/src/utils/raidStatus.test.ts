import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRaidStatus, type SlotCounts } from "./raidStatus.js";

describe("getRaidStatus", () => {
  const baseSlotCounts: SlotCounts = {
    total: 20,
    filled: 10,
    tanks: 2,
    healers: 4,
    dps: 4,
    confirmed: 5,
    pending: 3,
    unavailable: 2,
  };

  beforeEach(() => {
    process.env.SERVER_TIMEZONE = "UTC";
  });

  afterEach(() => {
    delete process.env.SERVER_TIMEZONE;
  });

  it("returns 'complete' when server time is after finish time", () => {
    const raidDate = "2020-01-15";
    const startTime = "19:00";
    const finishTime = "22:00";
    // Mock: we can't easily mock Date in getServerNow, but we can test the logic
    // by using a date in the past - serverNow would be after finishDt
    const result = getRaidStatus(raidDate, startTime, finishTime, baseSlotCounts);
    // 2020-01-15 22:00 UTC is in the past; serverNow > finishDt
    expect(result).toBe("complete");
  });

  it("returns 'forming' when not all slots filled", () => {
    const raidDate = "2030-06-15"; // future date
    const startTime = "19:00";
    const finishTime = "22:00";
    const slots: SlotCounts = { ...baseSlotCounts, total: 20, filled: 8, confirmed: 5 };
    const result = getRaidStatus(raidDate, startTime, finishTime, slots);
    // Future raid, not all filled -> forming
    expect(result).toBe("forming");
  });

  it("returns 'formed' when all slots filled and confirmed", () => {
    const raidDate = "2030-06-15";
    const startTime = "19:00";
    const finishTime = "22:00";
    const slots: SlotCounts = {
      total: 10,
      filled: 10,
      tanks: 2,
      healers: 2,
      dps: 6,
      confirmed: 10,
      pending: 0,
      unavailable: 0,
    };
    const result = getRaidStatus(raidDate, startTime, finishTime, slots);
    expect(result).toBe("formed");
  });
});
