import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeActivityRetention,
  retainNewestActivity,
} from '../src/activity/retention.js'
import type { ActivityEntry } from '../src/workspaces/types.js'

function entry(id: string, at: string): ActivityEntry {
  return {
    id,
    at,
    source: 'user',
    kind: 'test',
    summary: id,
    status: 'info',
  }
}

test('activity retention keeps the newest configured number deterministically', () => {
  const retained = retainNewestActivity([
    entry('older', '2026-08-30T10:00:00.000Z'),
    entry('newer-b', '2026-08-30T12:00:00.000Z'),
    entry('middle', '2026-08-30T11:00:00.000Z'),
    entry('newer-a', '2026-08-30T12:00:00.000Z'),
  ], 3)

  assert.deepEqual(retained.map((item) => item.id), ['newer-b', 'newer-a', 'middle'])
})

test('activity retention rejects unusable limits', () => {
  for (const limit of [0, -1, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeActivityRetention(limit), /positive safe integer/i)
  }
})
