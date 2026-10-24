// Composer targets span environments, so ids are paired with their
// environment id in one string key: "<environmentId>::<id>".

import { RUNTIME_MODES, type RuntimeMode } from "./t3";

export type TargetMode = "new" | "existing";

export function scopedKey(environmentId: string, id: string): string {
  return `${environmentId}::${id}`;
}

export function parseScopedKey(key: string | undefined | null): { environmentId: string; id: string } | null {
  if (!key) return null;
  const separator = key.indexOf("::");
  return separator > 0 ? { environmentId: key.slice(0, separator), id: key.slice(separator + 2) } : null;
}

/** A remembered site target: "new:<scoped project key>" or "existing:<scoped thread key>". */
export function siteTarget(mode: TargetMode, key: string): string {
  return `${mode}:${key}`;
}

export function parseSiteTarget(value: string | undefined): { mode: TargetMode; key: string } | null {
  const match = value ? /^(new|existing):(.+)$/.exec(value) : null;
  return match ? { mode: match[1] as TargetMode, key: match[2] as string } : null;
}

/** T3 refuses sends to threads that run with broader access than the connection. */
export function exceedsCeiling(mode: RuntimeMode, ceiling: RuntimeMode): boolean {
  return RUNTIME_MODES.indexOf(mode) > RUNTIME_MODES.indexOf(ceiling);
}

/** Environment names for display. Machines often share a name, so clashes get their address. */
export function environmentLabels(connections: { environmentId: string; label: string; origin: string }[]): Record<string, string> {
  const counts = new Map<string, number>();
  for (const connection of connections) counts.set(connection.label, (counts.get(connection.label) ?? 0) + 1);
  return Object.fromEntries(
    connections.map((connection) => [
      connection.environmentId,
      (counts.get(connection.label) ?? 0) > 1 ? `${connection.label} (${new URL(connection.origin).host})` : connection.label,
    ]),
  );
}
