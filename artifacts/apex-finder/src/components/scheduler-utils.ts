export interface SchedulerSnapshot {
  enabled: boolean;
  active: boolean;
  nextTriggerAt?: string;
}

/**
 * Returns the remaining wait in milliseconds for the next serialized cycle.
 * A zero value means the scheduled time has arrived and the next poll should
 * observe the trigger; null means there is no usable scheduled cycle.
 */
export function schedulerWaitRemaining(
  scheduler: SchedulerSnapshot | null | undefined,
  now = Date.now(),
): number | null {
  if (!scheduler?.enabled || !scheduler.active || !scheduler.nextTriggerAt) return null;
  const timestamp = Date.parse(scheduler.nextTriggerAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - now);
}

export function formatSchedulerCountdown(remainingMs: number | null): string | null {
  if (remainingMs == null) return null;
  if (remainingMs <= 1_000) return "starting now";
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}