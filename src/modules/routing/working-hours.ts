export interface DayWindow {
  start: string; // "HH:MM", 24-hour, in the user's timezone
  end: string; // "HH:MM"
}

export type WorkingHoursConfig = Partial<
  Record<
    "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday",
    DayWindow
  >
>;

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function minutesSinceMidnight(hhmm: string): number {
  const parts = hhmm.split(":").map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  return hours * 60 + minutes;
}

/**
 * Timezone-aware working-hours check using the native `Intl` API (no new
 * dependency) — converts `evaluatedAt` (a UTC instant) into the user's
 * local day-of-week and time-of-day, then checks it against that day's
 * configured window. A day with no configured window means unavailable
 * that day (per spec §12, working hours are opt-in per day).
 */
export function isWithinWorkingHours(
  evaluatedAt: Date,
  timezone: string,
  workingHours: WorkingHoursConfig,
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(evaluatedAt);

  const weekday = parts.find((p) => p.type === "weekday")?.value.toLowerCase();
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";

  const dayKey = DAY_KEYS.find((key) => key === weekday);
  if (!dayKey) {
    return false;
  }

  const window = workingHours[dayKey];
  if (!window) {
    return false;
  }

  const nowMinutes = Number(hour) * 60 + Number(minute);
  const startMinutes = minutesSinceMidnight(window.start);
  const endMinutes = minutesSinceMidnight(window.end);

  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}
