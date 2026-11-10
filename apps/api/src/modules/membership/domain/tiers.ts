export interface TierDef {
  code: string;
  position: number;
  minSalesMinor: bigint;
  advisorShareBps: number;
}

/** The highest tier whose threshold the calendar-year sales have reached. */
export function tierFor(salesMinor: bigint, tiers: readonly TierDef[]): TierDef {
  const ordered = [...tiers].sort((a, b) => a.position - b.position);
  let current = ordered[0]!;
  for (const t of ordered) if (salesMinor >= t.minSalesMinor) current = t;
  return current;
}

export function nextTier(current: TierDef, tiers: readonly TierDef[]): TierDef | null {
  return (
    [...tiers].sort((a, b) => a.position - b.position).find((t) => t.position > current.position) ??
    null
  );
}
