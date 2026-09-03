import test from 'node:test'
import assert from 'node:assert/strict'
import { handleOfficialLibraryRequest } from '../worker/official-library-routes.js'
import {
  OfficialPromptRepository,
  toFtsQuery,
  type D1Database,
  type D1PreparedStatement,
  type D1Result,
  type D1Value,
} from '../worker/official-prompt-repository.js'
import { parseOfficialPromptSearch } from '../worker/request-validation.js'

const row = {
  id: 'change-background',
  current_version: 1,
  content_hash: 'sha256:abc',
  title: 'Change the background',
  short_description: 'Keep the subject and replace only the environment.',
  user_promise: 'Keep the subject and replace only the environment.',
  collection: 'start-fast',
  category: 'start-fast',
  template_family: 'reference-transformation',
  default_operation: 'edit',
  input_mode: 'single-image',
  output_kind: 'image-edit',
  complexity: 'quick',
  required_input_summary: '["1 source photo","A background description"]',
  preservation_summary: '["identity","likeness"]',
  badges: '["Needs 1 photo","Keeps subject"]',
  aliases: '["swap background","replace room","put me somewhere else"]',
  thumbnail_path: '/recipe-thumbnails/change-background.webp',
  thumbnail_alt: 'The same portrait retained while the background changes.',
  featured_rank: 3,
  capabilities: '["image-edit"]',
  intents: '["edit"]',
  input_modes: '["single-image"]',
  subject_kinds: '["person"]',
  output_kinds: '["image-edit"]',
  preservation_needs: '["identity"]',
}

class FakeStatement implements D1PreparedStatement {
  values: D1Value[] = []

  constructor(private readonly database: FakeDatabase, readonly query: string) {}

  bind(...values: D1Value[]): D1PreparedStatement {
    this.values = values
    return this
  }

  async all<Row>(): Promise<D1Result<Row>> {
    this.database.calls.push(this)
    return { success: true, results: [row as Row] }
  }

  async first<Row>(): Promise<Row | null> {
    this.database.calls.push(this)
    if (this.query.includes('official_prompt_catalog_meta')) {
      return { catalog_version: 'catalog-test', build_hash: 'sha256:catalog', published_at: '2026-09-03T00:00:00Z' } as Row
    }
    if (this.query.includes('official_prompt_versions')) {
      return {
        prompt_id: 'change-background',
        version: 1,
        template_json: '{"schema":"prompt-canvas.prompt-workspace-template@2","id":"change-background"}',
        template_schema: 'prompt-canvas.prompt-workspace-template@2',
        content_hash: 'sha256:abc',
        source_json: '{"kind":"first-party","promptUsage":"original","title":"Change the background"}',
      } as Row
    }
    return null
  }
}

class FakeDatabase implements D1Database {
  calls: FakeStatement[] = []

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(this, query)
  }
}

test('FTS input is normalized into bounded tokens instead of executable SQL', () => {
  const query = toFtsQuery(`background'); DROP TABLE official_prompts; -- keep face`)
  assert.equal(query, '"background"* OR "drop"* OR "table"* OR "official"* OR "prompts"* OR "keep"* OR "face"*')
})

test('official search uses bound values and returns compact summaries', async () => {
  const database = new FakeDatabase()
  const repository = new OfficialPromptRepository(database)
  const [candidate] = await repository.search({
    query: 'replace room',
    inputModes: ['single-image'],
    preservationNeeds: ['identity'],
    categories: ['start-fast'],
    families: ['reference-transformation'],
    limit: 8,
  })
  assert.equal(candidate?.source, 'official')
  assert.equal(candidate?.id, 'change-background')
  assert.equal('template' in (candidate ?? {}), false)
  const call = database.calls[0]
  assert.ok(call)
  assert.equal(call.query.includes('replace room'), false)
  assert.equal(call.values[0], '"replace"* OR "room"*')
})

test('search request validation is closed and bounded', () => {
  assert.deepEqual(parseOfficialPromptSearch({
    query: 'wider banner', limit: 8, categories: ['start-fast'], families: ['canvas-expansion'],
  }), {
    query: 'wider banner', limit: 8, categories: ['start-fast'], families: ['canvas-expansion'],
  })
  assert.throws(() => parseOfficialPromptSearch({ query: 'x', unexpected: true }), /unsupported fields/)
  assert.throws(() => parseOfficialPromptSearch({ query: 'x', limit: 21 }), /1 to 20/)
})

test('catalog route returns summaries with ETag but no prompt body', async () => {
  const response = await handleOfficialLibraryRequest(
    new Request('https://example.test/api/official-library/catalog'),
    new FakeDatabase(),
  )
  assert.equal(response?.status, 200)
  assert.equal(response?.headers.get('cache-control'), 'public, max-age=300')
  assert.equal(response?.headers.get('etag'), '"sha256:catalog"')
  const body = await response?.text()
  assert.ok(body?.includes('change-background'))
  assert.equal(body?.includes('template_json'), false)
  assert.equal(body?.includes('prompt-workspace-template'), false)
})

test('versioned prompt route is immutable and public writes do not exist', async () => {
  const database = new FakeDatabase()
  const response = await handleOfficialLibraryRequest(
    new Request('https://example.test/api/official-library/prompts/change-background/versions/1'),
    database,
  )
  assert.equal(response?.status, 200)
  assert.equal(response?.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(response?.headers.get('etag'), '"sha256:abc"')

  const write = await handleOfficialLibraryRequest(
    new Request('https://example.test/api/official-library/prompts', { method: 'POST', body: '{}' }),
    database,
  )
  assert.equal(write?.status, 404)
})

test('search route caps bodies even without Content-Length', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ query: 'x'.repeat(17_000) })))
    },
    cancel() {
      cancelled = true
    },
  })
  const response = await handleOfficialLibraryRequest(
    new Request('https://example.test/api/official-library/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }),
    new FakeDatabase(),
  )
  assert.equal(response?.status, 413)
  assert.equal(cancelled, true)
})

test('search route returns stable client errors and does not expose internal failures', async () => {
  const malformed = await handleOfficialLibraryRequest(
    new Request('https://example.test/api/official-library/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    }),
    new FakeDatabase(),
  )
  assert.equal(malformed?.status, 400)
  assert.equal((await malformed?.json() as { error: { code: string } }).error.code, 'INVALID_JSON')

  const unsupported = await handleOfficialLibraryRequest(
    new Request('https://example.test/api/official-library/search', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    }),
    new FakeDatabase(),
  )
  assert.equal(unsupported?.status, 415)

  const failingDatabase: D1Database = {
    prepare() {
      throw new Error('secret database detail')
    },
  }
  const failed = await handleOfficialLibraryRequest(
    new Request('https://example.test/api/official-library/catalog'),
    failingDatabase,
  )
  assert.equal(failed?.status, 500)
  assert.equal((await failed?.text())?.includes('secret database detail'), false)
})

test('catalog pagination is finite and bounded', async () => {
  const response = await handleOfficialLibraryRequest(
    new Request('https://example.test/api/official-library/catalog?offset=Infinity'),
    new FakeDatabase(),
  )
  assert.equal(response?.status, 400)
})
