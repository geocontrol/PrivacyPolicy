// Policy page crawler
// Fetches and stores privacy policy documents for a given service URL.
// Phase 1: static HTML via axios + cheerio
// Phase 2 (future): Playwright fallback for JS-rendered sites

export async function crawlPolicyPage(_serviceUrl: string): Promise<{ html: string; resolvedUrl: string }> {
  throw new Error('Not implemented yet')
}
