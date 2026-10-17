import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  getInstituteSettings,
  getCachedInstituteSettings,
  setCachedInstituteSettings,
  clearInstituteSettingsCache,
  startInstituteSettingsBackgroundRefresh,
  stopInstituteSettingsBackgroundRefresh
} from "./instituteSettingsService.js";
import { instituteTimezone, instituteNow, instituteToday } from "./instituteTime.js";

describe("instituteSettingsService and instituteTime", () => {
  after(() => {
    stopInstituteSettingsBackgroundRefresh();
    clearInstituteSettingsCache();
  });

  it("loads institute settings and caches them with a non-empty timezone", async () => {
    const settings = await getInstituteSettings();
    assert.ok(settings, "Settings should be defined");
    assert.ok(settings.timezone, "Timezone must not be empty");
    assert.equal(typeof settings.timezone, "string");
  });

  it("instituteTimezone() is never empty or stale and returns valid IANA string", () => {
    const tz = instituteTimezone();
    assert.ok(tz && tz.length > 0, "instituteTimezone must not be empty");
    // Verify Intl accepts the timezone without throwing
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz });
    assert.ok(dtf, "Intl must successfully format using the institute timezone");
  });

  it("instituteToday() returns a valid YYYY-MM-DD date in the institute timezone", () => {
    const today = instituteToday();
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/, "instituteToday must match YYYY-MM-DD");
    const now = instituteNow();
    assert.equal(now.dateStr, today);
    assert.ok(now.year >= 2026, "Year should be 2026 or later");
  });

  it("allows setting cache directly and immediate synchronous read", () => {
    setCachedInstituteSettings({ timezone: "America/Chicago" });
    assert.equal(instituteTimezone(), "America/Chicago");
    const cached = getCachedInstituteSettings();
    assert.equal(cached.timezone, "America/Chicago");
  });

  it("background refresh starts and stops without leaving timezone empty", () => {
    startInstituteSettingsBackgroundRefresh();
    const tz = instituteTimezone();
    assert.ok(tz && tz.length > 0, "Timezone remains active during background refresh");
    stopInstituteSettingsBackgroundRefresh();
  });
});
