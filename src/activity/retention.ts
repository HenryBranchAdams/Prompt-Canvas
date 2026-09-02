import type { ActivityEntry } from '../workspaces/types.js'

export const DEFAULT_ACTIVITY_RETENTION = 300

export function normalizeActivityRetention(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('Activity retention must be a positive safe integer.')
  }
  return limit
}

export function retainNewestActivity(
  entries: Iterable<ActivityEntry>,
  limit = DEFAULT_ACTIVITY_RETENTION,
): ActivityEntry[] {
  const boundedLimit = normalizeActivityRetention(limit)
  return [...entries]
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
    .slice(0, boundedLimit)
}
