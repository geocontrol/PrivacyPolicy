import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { insertPolicyDocument } from '../db/queries.js'
import { crawlPolicyPage, fetchAndStorePolicyDocument, CrawlerError } from './crawler.js'
import {
  SAMPLE_HOMEPAGE_HTML,
  SAMPLE_PRIVACY_HTML,
  HOMEPAGE_WITHOUT_PRIVACY_LINK,
  HOMEPAGE_WITH_MODAL_POLICY,
  HOMEPAGE_WITH_HIDDEN_POLICY_DIV,
  HOMEPAGE_WITH_INLINE_POLICY_SECTION,
  HOMEPAGE_WITH_RSC_POLICY,
  makePolicyDocument,
} from '../../../tests/fixtures/index.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    head: vi.fn(),
  },
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../db/queries.js', () => ({
  insertPolicyDocument: vi.fn(),
}))

// Import axios AFTER vi.mock so we get the mocked version
const axiosMod = await import('axios')
const axios = axiosMod.default as { get: MockedFunction<(url: string, config?: unknown) => Promise<unknown>>; head: MockedFunction<(url: string, config?: unknown) => Promise<unknown>> }

const mockedMkdir = mkdir as MockedFunction<typeof mkdir>
const mockedWriteFile = writeFile as MockedFunction<typeof writeFile>
const mockedInsertPolicyDocument = insertPolicyDocument as MockedFunction<typeof insertPolicyDocument>

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// crawlPolicyPage — link discovery
// ---------------------------------------------------------------------------

describe('crawlPolicyPage() — link discovery', () => {
  it('finds a privacy-policy link in the footer and fetches the policy page', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })

    const result = await crawlPolicyPage('https://example.com')
    expect(result.resolvedUrl).toBe('https://example.com/privacy-policy')
    expect(result.html).toBe(SAMPLE_PRIVACY_HTML)
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('normalises a URL without protocol by prepending https://', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })

    const result = await crawlPolicyPage('example.com')
    expect(result.resolvedUrl).toBe('https://example.com/privacy-policy')
  })

  it('normalises a URL with a path to its origin only', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })

    await crawlPolicyPage('https://example.com/some/deep/path?foo=bar')
    expect(axios.get.mock.calls[0][0]).toBe('https://example.com')
  })

  it('produces a deterministic SHA-256 hash for the same content', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    const r1 = await crawlPolicyPage('https://example.com')

    vi.clearAllMocks()
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    const r2 = await crawlPolicyPage('https://example.com')

    expect(r1.contentHash).toBe(r2.contentHash)
  })

  it('strips script / style / nav / footer from extracted text', async () => {
    const htmlWithNoise = `<html><body>
      <nav>Nav content should be removed</nav>
      <script>alert('should be removed')</script>
      <footer>Footer text should be removed</footer>
      <main><p>Real policy content that should remain.</p></main>
    </body></html>`

    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: htmlWithNoise })

    const result = await crawlPolicyPage('https://example.com')
    expect(result.text).not.toContain('Nav content should be removed')
    expect(result.text).not.toContain("alert('should be removed')")
    expect(result.text).not.toContain('Footer text should be removed')
    expect(result.text).toContain('Real policy content that should remain.')
  })
})

// ---------------------------------------------------------------------------
// crawlPolicyPage — fallback path probing
// ---------------------------------------------------------------------------

describe('crawlPolicyPage() — fallback path probing', () => {
  it('uses HEAD requests to probe common paths when no link is found in homepage', async () => {
    axios.get
      .mockResolvedValueOnce({ data: HOMEPAGE_WITHOUT_PRIVACY_LINK })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    axios.head.mockResolvedValueOnce({ status: 200 })

    const result = await crawlPolicyPage('https://example.com')
    expect(axios.head).toHaveBeenCalled()
    expect(result.html).toBe(SAMPLE_PRIVACY_HTML)
  })

  it('tries multiple paths before finding one', async () => {
    axios.get
      .mockResolvedValueOnce({ data: HOMEPAGE_WITHOUT_PRIVACY_LINK })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    // First two HEAD attempts fail, third succeeds
    axios.head
      .mockRejectedValueOnce(new Error('404'))
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ status: 200 })

    await crawlPolicyPage('https://example.com')
    expect(axios.head.mock.calls.length).toBe(3)
  })

  it('throws CrawlerError with POLICY_NOT_FOUND when no link found and all common paths fail', async () => {
    axios.get.mockResolvedValueOnce({ data: HOMEPAGE_WITHOUT_PRIVACY_LINK })
    axios.head.mockRejectedValue(new Error('Not found'))

    await expect(crawlPolicyPage('https://notfound.com')).rejects.toMatchObject({
      code: 'POLICY_NOT_FOUND',
    })
    await expect(crawlPolicyPage('https://notfound.com')).rejects.toBeInstanceOf(CrawlerError)
  })
})

// ---------------------------------------------------------------------------
// crawlPolicyPage — inline/modal policy detection
// ---------------------------------------------------------------------------

describe('crawlPolicyPage() — inline/modal policy detection', () => {
  it('extracts policy content from a <dialog> element', async () => {
    axios.get.mockResolvedValueOnce({ data: HOMEPAGE_WITH_MODAL_POLICY })

    const result = await crawlPolicyPage('https://modal-site.com')
    expect(result.resolvedUrl).toBe('https://modal-site.com#privacy-dialog')
    expect(result.text.toLowerCase()).toContain('privacy')
    expect(result.text.toLowerCase()).toContain('cookies')
    expect(result.html).toContain('<dialog')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('extracts policy content from a hidden div[role="dialog"]', async () => {
    axios.get.mockResolvedValueOnce({ data: HOMEPAGE_WITH_HIDDEN_POLICY_DIV })

    const result = await crawlPolicyPage('https://hidden-dialog.com')
    expect(result.resolvedUrl).toBe('https://hidden-dialog.com#privacy-modal')
    expect(result.text).toContain('personal data')
    expect(result.html).toContain('role="dialog"')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('extracts policy content from an in-page <section> linked via anchor', async () => {
    axios.get.mockResolvedValueOnce({ data: HOMEPAGE_WITH_INLINE_POLICY_SECTION })

    const result = await crawlPolicyPage('https://section-site.com')
    expect(result.resolvedUrl).toBe('https://section-site.com#privacy')
    expect(result.text).toContain('data collection')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('prefers an external link over inline content when both exist', async () => {
    // Homepage has both a <a href="/privacy-policy"> AND a <dialog> with policy text
    const homepageWithBoth = `<!DOCTYPE html>
    <html><body>
      <a href="/privacy-policy">Privacy Policy</a>
      <dialog id="privacy-dialog">
        <p>We collect personal data and use cookies for analytics.
        This privacy policy covers GDPR compliance and data protection.
        We retain data for two years and share with third party processors.</p>
      </dialog>
    </body></html>`

    axios.get
      .mockResolvedValueOnce({ data: homepageWithBoth })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })

    const result = await crawlPolicyPage('https://both-site.com')
    expect(result.resolvedUrl).toBe('https://both-site.com/privacy-policy')
  })

  it('falls through to tryCommonPaths when inline content is too short', async () => {
    const homepageWithShortModal = `<!DOCTYPE html>
    <html><body>
      <dialog id="cookie-notice"><p>We use cookies.</p></dialog>
    </body></html>`

    axios.get
      .mockResolvedValueOnce({ data: homepageWithShortModal })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    axios.head.mockResolvedValueOnce({ status: 200 })

    const result = await crawlPolicyPage('https://short-modal.com')
    // Should have fallen through to common paths
    expect(axios.head).toHaveBeenCalled()
    expect(result.html).toBe(SAMPLE_PRIVACY_HTML)
  })

  it('produces a deterministic hash for inline content', async () => {
    axios.get.mockResolvedValueOnce({ data: HOMEPAGE_WITH_MODAL_POLICY })
    const r1 = await crawlPolicyPage('https://modal-site.com')

    vi.clearAllMocks()
    axios.get.mockResolvedValueOnce({ data: HOMEPAGE_WITH_MODAL_POLICY })
    const r2 = await crawlPolicyPage('https://modal-site.com')

    expect(r1.contentHash).toBe(r2.contentHash)
  })

  it('extracts policy from Next.js RSC <script> payload', async () => {
    axios.get.mockResolvedValueOnce({ data: HOMEPAGE_WITH_RSC_POLICY })

    const result = await crawlPolicyPage('https://rsc-site.com')
    expect(result.resolvedUrl).toBe('https://rsc-site.com#embedded-policy')
    expect(result.text.toLowerCase()).toContain('privacy')
    expect(result.text.toLowerCase()).toContain('personal data')
    expect(result.text.toLowerCase()).toContain('cookies')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('falls through to common paths when script content has insufficient keywords', async () => {
    const homepageWithWeakScript = `<!DOCTYPE html>
    <html><body>
      <script>self.__next_f.push([1,"\\"children\\":\\"Hello world, this is some generic text without policy keywords.\\""])</script>
    </body></html>`

    axios.get
      .mockResolvedValueOnce({ data: homepageWithWeakScript })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    axios.head.mockResolvedValueOnce({ status: 200 })

    const result = await crawlPolicyPage('https://weak-script.com')
    expect(axios.head).toHaveBeenCalled()
    expect(result.html).toBe(SAMPLE_PRIVACY_HTML)
  })
})

// ---------------------------------------------------------------------------
// crawlPolicyPage — error handling
// ---------------------------------------------------------------------------

describe('crawlPolicyPage() — error handling', () => {
  it('throws CrawlerError with FETCH_ERROR when homepage fetch fails', async () => {
    axios.get.mockRejectedValueOnce(new Error('Network timeout'))
    await expect(crawlPolicyPage('https://example.com')).rejects.toMatchObject({
      code: 'FETCH_ERROR',
    })
  })

  it('throws CrawlerError with FETCH_ERROR when policy page fetch fails', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockRejectedValueOnce(new Error('Connection refused'))
    await expect(crawlPolicyPage('https://example.com')).rejects.toMatchObject({
      code: 'FETCH_ERROR',
    })
  })

  it('includes a descriptive message in the FETCH_ERROR', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(crawlPolicyPage('https://example.com')).rejects.toThrow('ECONNREFUSED')
  })
})

// ---------------------------------------------------------------------------
// fetchAndStorePolicyDocument
// ---------------------------------------------------------------------------

describe('fetchAndStorePolicyDocument()', () => {
  it('creates the service directory and writes the HTML file', async () => {
    const fakeDoc = makePolicyDocument()
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    mockedInsertPolicyDocument.mockReturnValue(fakeDoc)

    await fetchAndStorePolicyDocument('svc-001', 'https://example.com')

    expect(mockedMkdir).toHaveBeenCalledWith(
      expect.stringContaining('svc-001'),
      { recursive: true },
    )
    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('svc-001'),
      SAMPLE_PRIVACY_HTML,
      'utf-8',
    )
  })

  it('uses a timestamped .html filename inside the service directory', async () => {
    const fakeDoc = makePolicyDocument()
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    mockedInsertPolicyDocument.mockReturnValue(fakeDoc)

    await fetchAndStorePolicyDocument('svc-ts', 'https://example.com')

    const writtenPath = mockedWriteFile.mock.calls[0][0] as string
    expect(writtenPath).toContain('svc-ts')
    expect(writtenPath).toMatch(/\.html$/)
  })

  it('records the document in the DB with the SHA-256 hash', async () => {
    const fakeDoc = makePolicyDocument()
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    mockedInsertPolicyDocument.mockReturnValue(fakeDoc)

    await fetchAndStorePolicyDocument('svc-001', 'https://example.com')

    expect(mockedInsertPolicyDocument).toHaveBeenCalledWith(
      'svc-001',
      'https://example.com/privacy-policy',
      expect.stringMatching(/\.html$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    )
  })

  it('returns the documentId, resolvedUrl and isNew: true from the DB record', async () => {
    const fakeDoc = makePolicyDocument({ id: 'returned-doc-id' })
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_HOMEPAGE_HTML })
      .mockResolvedValueOnce({ data: SAMPLE_PRIVACY_HTML })
    mockedInsertPolicyDocument.mockReturnValue(fakeDoc)

    const result = await fetchAndStorePolicyDocument('svc-001', 'https://example.com')
    expect(result.documentId).toBe('returned-doc-id')
    expect(result.resolvedUrl).toBe('https://example.com/privacy-policy')
    expect(result.isNew).toBe(true)
  })

  it('propagates CrawlerError without writing to disk or DB', async () => {
    axios.get.mockRejectedValueOnce(new Error('Network down'))

    await expect(
      fetchAndStorePolicyDocument('svc-fail', 'https://fail.com')
    ).rejects.toMatchObject({ code: 'FETCH_ERROR' })

    expect(mockedWriteFile).not.toHaveBeenCalled()
    expect(mockedInsertPolicyDocument).not.toHaveBeenCalled()
  })
})
