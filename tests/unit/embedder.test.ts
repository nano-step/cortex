const { mockPrepare, mockAll, mockRun, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockAll: vi.fn().mockReturnValue([]),
  mockRun: vi.fn(),
  mockTransaction: vi.fn((fn: Function) => fn)
}))

vi.mock('../../electron/services/db', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: mockPrepare.mockReturnValue({
      all: mockAll,
      run: mockRun
    }),
    transaction: mockTransaction
  }),
  chunkQueries: {
    updateEmbedding: vi.fn().mockReturnValue({
      run: mockRun
    })
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/cortex-test-models')
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([])
  }
}))

vi.mock('../../electron/services/settings-service', () => ({
  getProxyUrl: vi.fn().mockReturnValue('http://localhost:3456'),
  getProxyKey: vi.fn().mockReturnValue('test-key'),
  getJinaApiKey: vi.fn().mockReturnValue('jina_test_key')
}))

function mockFetchResponse(embeddings: number[][]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: embeddings.map((emb, i) => ({ embedding: emb, index: i }))
    })
  }
}

function mockFetch429() {
  return {
    ok: false,
    status: 429,
    headers: { get: () => null },
    text: async () => '{"detail":"rate limited"}'
  }
}

async function loadEmbedder() {
  vi.resetModules()
  return await import('../../electron/services/embedder')
}

describe('embedQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse([[0.1, 0.2, 0.3]])
    ))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls Jina API with correct parameters', async () => {
    const { embedQuery } = await loadEmbedder()
    const result = await embedQuery('test query')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.jina.ai/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer jina_test_key'
        })
      })
    )

    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.model).toBe('jina-embeddings-v3')
    expect(body.task).toBe('retrieval.query')
    expect(body.dimensions).toBe(1024)
    expect(result).toEqual([0.1, 0.2, 0.3])
  })

  it('returns embedding array from API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse([[0.5, 0.6, 0.7]])
    ))

    const { embedQuery } = await loadEmbedder()
    const result = await embedQuery('test')
    expect(result).toEqual([0.5, 0.6, 0.7])
  })

  it('returns empty array when API returns empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] })
    }))

    const { embedQuery } = await loadEmbedder()
    const result = await embedQuery('test')
    expect(result).toEqual([])
  })
})

describe('embedProjectChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse([[0.1, 0.2, 0.3]])
    ))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 0 when no chunks need embedding', async () => {
    mockAll.mockReturnValueOnce([])
    const { embedProjectChunks } = await loadEmbedder()
    const result = await embedProjectChunks('project-1')
    expect(result).toBe(0)
  })

  it('processes chunks and calls onProgress', async () => {
    const chunks = Array.from({ length: 5 }, (_, i) => ({
      id: `chunk-${i}`,
      content: `content ${i}`,
      name: `func${i}`,
      relative_path: `src/file${i}.ts`,
      chunk_type: 'function'
    }))
    mockAll.mockReturnValueOnce(chunks)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(chunks.map(() => [0.1, 0.2, 0.3]))
    ))

    const { embedProjectChunks } = await loadEmbedder()
    const onProgress = vi.fn()
    const result = await embedProjectChunks('project-1', onProgress)

    expect(result).toBe(5)
    expect(onProgress).toHaveBeenCalledWith(5, 5)
  })

  it('uses retrieval.passage task for indexing', async () => {
    const chunks = [{ id: 'c1', content: 'hello', name: 'test', relative_path: 'src/a.ts', chunk_type: 'function' }]
    mockAll.mockReturnValueOnce(chunks)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse([[0.1]])
    ))

    const { embedProjectChunks } = await loadEmbedder()
    await embedProjectChunks('project-1')

    const calls = (fetch as any).mock.calls
    const indexBody = JSON.parse(calls[calls.length - 1][1].body)
    expect(indexBody.task).toBe('retrieval.passage')
  })
})

describe('needsReEmbed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when no embeddings exist', async () => {
    mockPrepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) })
    const { needsReEmbed } = await loadEmbedder()
    expect(needsReEmbed('project-1')).toBe(false)
  })

  it('returns true when embedding dimensions differ from expected', async () => {
    const legacyEmbedding = Buffer.from(new Float32Array(384).buffer)
    mockPrepare.mockReturnValue({ get: vi.fn().mockReturnValue({ embedding: legacyEmbedding }) })
    const { needsReEmbed } = await loadEmbedder()
    expect(needsReEmbed('project-1')).toBe(true)
  })

  it('returns false when embedding dimensions match expected 1024', async () => {
    const correctEmbedding = Buffer.from(new Float32Array(1024).buffer)
    mockPrepare.mockReturnValue({ get: vi.fn().mockReturnValue({ embedding: correctEmbedding }) })
    const { needsReEmbed } = await loadEmbedder()
    expect(needsReEmbed('project-1')).toBe(false)
  })
})
