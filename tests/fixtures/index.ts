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

/** A homepage with a privacy policy inside a <dialog> element */
export const HOMEPAGE_WITH_MODAL_POLICY = `<!DOCTYPE html>
<html lang="en">
<head><title>Modal Policy Site</title></head>
<body>
  <main><h1>Welcome</h1><p>Our main content.</p></main>
  <button data-target="#privacy-dialog">Privacy Policy</button>
  <dialog id="privacy-dialog">
    <h2>Privacy Policy</h2>
    <p>We collect your email address and name when you register. We use cookies to
    improve your experience. Your personal data is processed under GDPR legal bases
    including consent and legitimate interest. Data retention is limited to 2 years
    after account closure. We may share data with third party analytics providers
    for the purpose of improving our service. You have the right to request data
    protection measures including erasure and portability.</p>
  </dialog>
</body>
</html>`

/** A homepage with a hidden div[role="dialog"] containing a privacy policy (React-style) */
export const HOMEPAGE_WITH_HIDDEN_POLICY_DIV = `<!DOCTYPE html>
<html lang="en">
<head><title>Hidden Dialog Site</title></head>
<body>
  <main><h1>App</h1></main>
  <div id="privacy-modal" role="dialog" aria-modal="true" aria-hidden="true" style="display:none">
    <div class="modal-content">
      <h2>Privacy Policy</h2>
      <p>This privacy policy explains how we collect and use your personal data.
      We collect information such as your name, email, and usage data. Cookies are
      used to remember your preferences. Under GDPR and data protection law, you
      have rights including access, rectification, and erasure. Our data retention
      period is 12 months. We work with third party processors for analytics and
      payment services.</p>
    </div>
  </div>
</body>
</html>`

/** A homepage with a <section id="privacy"> linked via an in-page anchor */
export const HOMEPAGE_WITH_INLINE_POLICY_SECTION = `<!DOCTYPE html>
<html lang="en">
<head><title>Inline Section Site</title></head>
<body>
  <nav>
    <a href="#about">About</a>
    <a href="#privacy">Privacy Policy</a>
    <a href="#contact">Contact</a>
  </nav>
  <section id="about"><h2>About Us</h2><p>We make things.</p></section>
  <section id="privacy">
    <h2>Privacy Policy</h2>
    <p>Your privacy matters to us. This section describes our data collection
    practices. We collect your email address when you sign up and use cookies
    for analytics. Personal data is handled in accordance with GDPR. We engage
    third party services for hosting and analytics. Data retention is governed
    by our internal policy and limited to the period necessary for the stated
    purposes. We implement data protection measures to safeguard your information.</p>
  </section>
  <section id="contact"><h2>Contact</h2><p>Email us.</p></section>
</body>
</html>`

/** A homepage with a Next.js RSC script payload containing privacy policy text */
export const HOMEPAGE_WITH_RSC_POLICY = `<!DOCTYPE html>
<html lang="en">
<head><title>RSC App</title></head>
<body>
  <div id="__next"></div>
  <script>self.__next_f.push([1,"${
    [
      'Privacy Policy. ',
      'We collect your personal data including your email address and name when you register. ',
      'We use cookies to improve your experience and for analytics purposes. ',
      'Your data is processed under GDPR legal bases including consent and legitimate interest. ',
      'Data retention is limited to 2 years after account closure. ',
      'We may share data with third party analytics providers. ',
      'You have the right to request data protection measures including erasure and portability.',
    ]
      .map(t => `\\"children\\":\\"${t}\\"`)
      .join(',\\"type\\":\\"p\\",')
  }"])</script>
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
