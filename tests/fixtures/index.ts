import type { Service, PolicyDocument, PolicyAnalysis, ThirdParty, SupplyChainEdge } from '../../src/server/db/queries.js'
import type { PolicyAnalysisResult } from '../../src/server/services/analyser.js'

// ---------------------------------------------------------------------------
// Factory functions — each returns a minimal valid object with sensible defaults.
// Override any field: makeService({ name: 'Custom' })
// ---------------------------------------------------------------------------

export function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc-test-id-001',
    name: 'Test Service',
    url: 'https://example.com',
    category: 'Technology',
    created_at: '2024-01-01 00:00:00',
    updated_at: '2024-01-01 00:00:00',
    ...overrides,
  }
}

export function makePolicyDocument(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return {
    id: 'doc-test-id-001',
    service_id: 'svc-test-id-001',
    retrieved_at: '2024-01-01 00:00:00',
    source_url: 'https://example.com/privacy-policy',
    file_path: '/data/policies/svc-test-id-001/2024-01-01T00-00-00-000Z.html',
    content_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
    status: 'retrieved',
    ...overrides,
  }
}

export function makePolicyAnalysis(overrides: Partial<PolicyAnalysis> = {}): PolicyAnalysis {
  return {
    id: 'ana-test-id-001',
    document_id: 'doc-test-id-001',
    analysed_at: '2024-01-01 00:00:00',
    llm_provider: 'anthropic',
    summary: 'This is a test summary of the privacy policy.',
    data_collected: '["email","name","ip_address"]',
    purposes: '["service delivery","analytics"]',
    legal_bases: '["Legitimate Interest","Consent"]',
    retention: 'Data is kept for 2 years after account deletion.',
    user_rights: '["Right to erasure","Right to access","Right to portability"]',
    contact: '{"email":"dpo@example.com","address":"123 Test Street","dpoName":"Jane Smith","url":"https://example.com/contact"}',
    raw_response: '{"raw":"response"}',
    ...overrides,
  }
}

export function makeThirdParty(overrides: Partial<ThirdParty> = {}): ThirdParty {
  return {
    id: 'tp-test-id-001',
    name: 'Google Analytics',
    url: 'https://analytics.google.com',
    category: 'analytics',
    ...overrides,
  }
}

export function makeSupplyChainEdge(overrides: Partial<SupplyChainEdge> = {}): SupplyChainEdge {
  return {
    id: 'edge-test-id-001',
    from_service_id: 'svc-test-id-001',
    to_third_party_id: 'tp-test-id-001',
    document_id: 'doc-test-id-001',
    context_snippet: 'We share data with Google Analytics for usage tracking.',
    ...overrides,
  }
}

export function makePolicyAnalysisResult(
  overrides: Partial<PolicyAnalysisResult> = {}
): PolicyAnalysisResult {
  return {
    summary: 'We collect minimal data for service delivery.',
    dataCollected: ['email', 'name'],
    purposes: ['service delivery', 'analytics'],
    legalBases: ['Legitimate Interest', 'Consent'],
    retention: 'Data is kept for 2 years after account deletion.',
    userRights: ['Right to erasure', 'Right to access'],
    contact: {
      email: 'dpo@example.com',
      address: '123 Test Street, London',
      dpoName: 'Jane Smith',
      url: 'https://example.com/contact',
    },
    thirdParties: [
      {
        name: 'Google Analytics',
        url: 'https://analytics.google.com',
        role: 'analytics',
        contextSnippet: 'We use Google Analytics.',
      },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// HTML fixtures
// ---------------------------------------------------------------------------

/** A homepage that has a clear /privacy-policy link in the footer */
export const SAMPLE_HOMEPAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Example Service</title></head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <main><h1>Welcome to Example Service</h1></main>
  <footer>
    <a href="/privacy-policy">Privacy Policy</a>
    <a href="/terms">Terms of Service</a>
    <a href="/cookies">Cookie Policy</a>
  </footer>
</body>
</html>`

/** A homepage with absolutely no privacy-related links — forces fallback path probing */
export const HOMEPAGE_WITHOUT_PRIVACY_LINK = `<!DOCTYPE html>
<html lang="en">
<head><title>Example</title></head>
<body><p>Nothing to see here.</p></body>
</html>`

/** A realistic privacy policy page with sufficient text for analysis */
export const SAMPLE_PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Privacy Policy - Example Service</title></head>
<body>
  <nav><a href="/">Home</a></nav>
  <main>
    <h1>Privacy Policy</h1>
    <p>Last updated: 1 January 2024</p>
    <p>Example Service ("we", "us", "our") collects your email address and name when you
    register for our service. We use this information solely to provide and improve the
    service you have requested.</p>
    <p>We use Google Analytics (https://analytics.google.com) to track anonymous usage
    statistics. We use Stripe for payment processing. Data is retained for a period of
    two years following account deletion.</p>
    <p>Under GDPR you have the right to erasure, right to access, and right to data
    portability. To exercise your rights please contact our Data Protection Officer
    at dpo@example.com or write to 123 Test Street, London, EC1A 1BB.</p>
  </main>
  <footer><a href="/privacy-policy">Privacy Policy</a></footer>
</body>
</html>`

/** A valid JSON string matching the shape the analyser's ANALYSIS_PROMPT requests */
export const SAMPLE_LLM_RESPONSE_JSON = JSON.stringify({
  summary: 'Example Service collects email and name for service delivery. Analytics are provided by Google Analytics.',
  dataCollected: ['email address', 'name'],
  purposes: ['service delivery', 'usage analytics'],
  legalBases: ['Legitimate Interest', 'Contract'],
  retention: 'Data is kept for two years following account deletion.',
  userRights: ['Right to erasure', 'Right to access', 'Right to data portability'],
  contact: {
    email: 'dpo@example.com',
    address: '123 Test Street, London, EC1A 1BB',
    dpoName: null,
    url: null,
  },
  thirdParties: [
    {
      name: 'Google Analytics',
      url: 'https://analytics.google.com',
      role: 'analytics',
      contextSnippet: 'We use Google Analytics to track anonymous usage statistics.',
    },
    {
      name: 'Stripe',
      url: null,
      role: 'payment processing',
      contextSnippet: 'We use Stripe for payment processing.',
    },
  ],
})
