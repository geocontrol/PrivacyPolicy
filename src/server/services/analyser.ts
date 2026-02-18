import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import {
  getDocumentById,
  insertPolicyAnalysis,
  insertSupplyChainEdge,
  upsertThirdParty,
  type PolicyAnalysis,
} from '../db/queries.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThirdPartyMention {
  name: string
  url?: string
  role: string          // e.g. "analytics", "advertising", "payment processor"
  contextSnippet: string
}

export interface PolicyAnalysisResult {
  summary: string
  dataCollected: string[]
  purposes: string[]
  legalBases: string[]
  retention: string
  userRights: string[]
  contact: {
    email?: string
    address?: string
    dpoName?: string
    url?: string
  }
  thirdParties: ThirdPartyMention[]
}

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

type LlmProvider = 'anthropic' // | 'openai' | 'ollama' — extend here

function getProvider(): LlmProvider {
  const p = process.env.LLM_PROVIDER ?? 'anthropic'
  if (p !== 'anthropic') {
    throw new AnalyserError(
      `LLM provider "${p}" is not yet implemented. Only "anthropic" is currently supported.`,
      'PROVIDER_NOT_SUPPORTED',
    )
  }
  return 'anthropic'
}

async function callLlm(prompt: string): Promise<string> {
  const provider = getProvider()

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || apiKey === 'your_api_key_here') {
      throw new AnalyserError(
        'ANTHROPIC_API_KEY is not set. Please add it to your .env file.',
        'CONFIG_ERROR',
      )
    }

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = message.content[0]
    if (block.type !== 'text') {
      throw new AnalyserError('Unexpected response type from Anthropic API', 'PARSE_ERROR')
    }
    return block.text
  }

  throw new AnalyserError('Unreachable', 'PROVIDER_NOT_SUPPORTED')
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const ANALYSIS_PROMPT = (policyText: string) => `
You are a privacy policy analyst. Analyse the following privacy policy text and return a
structured JSON response. Be thorough but concise. Extract specific named third parties
wherever possible rather than using vague categories.

Return ONLY valid JSON with no markdown, no code fences, no explanation — just the raw JSON object.

The JSON must match this exact structure:
{
  "summary": "2-4 sentence plain English summary of the policy",
  "dataCollected": ["array", "of", "data", "categories", "collected"],
  "purposes": ["array", "of", "stated", "purposes", "for", "processing"],
  "legalBases": ["array of legal bases cited, e.g. Legitimate Interest, Consent, Contract"],
  "retention": "plain English description of how long data is kept",
  "userRights": ["array of user rights mentioned, e.g. Right to erasure, Right to access"],
  "contact": {
    "email": "dpo@example.com or null",
    "address": "postal address or null",
    "dpoName": "name of DPO if mentioned or null",
    "url": "link to contact/request form or null"
  },
  "thirdParties": [
    {
      "name": "Name of third party company",
      "url": "their website if mentioned or null",
      "role": "their role, e.g. analytics, advertising, payment processing, cloud hosting",
      "contextSnippet": "short verbatim quote from the policy mentioning this party (max 150 chars)"
    }
  ]
}

If a field cannot be determined from the policy text, use null for strings or [] for arrays.

PRIVACY POLICY TEXT:
---
${policyText.slice(0, 80_000)}
---
`.trim()

// ---------------------------------------------------------------------------
// Core analysis function
// ---------------------------------------------------------------------------

/**
 * Parses the raw LLM response text into a PolicyAnalysisResult.
 * Throws AnalyserError if the JSON is invalid or missing required fields.
 */
function parseAnalysisResponse(raw: string): PolicyAnalysisResult {
  let parsed: unknown
  try {
    // Strip any accidental markdown fences the model may have added
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new AnalyserError(
      'LLM returned invalid JSON. Raw response: ' + raw.slice(0, 200),
      'PARSE_ERROR',
    )
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new AnalyserError('LLM response was not a JSON object', 'PARSE_ERROR')
  }

  const obj = parsed as Record<string, unknown>

  return {
    summary: String(obj.summary ?? ''),
    dataCollected: ensureStringArray(obj.dataCollected),
    purposes: ensureStringArray(obj.purposes),
    legalBases: ensureStringArray(obj.legalBases),
    retention: String(obj.retention ?? ''),
    userRights: ensureStringArray(obj.userRights),
    contact: parseContact(obj.contact),
    thirdParties: parseThirdParties(obj.thirdParties),
  }
}

function ensureStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val.filter((v): v is string => typeof v === 'string')
}

function parseContact(val: unknown): PolicyAnalysisResult['contact'] {
  if (typeof val !== 'object' || val === null) return {}
  const obj = val as Record<string, unknown>
  return {
    email: typeof obj.email === 'string' ? obj.email : undefined,
    address: typeof obj.address === 'string' ? obj.address : undefined,
    dpoName: typeof obj.dpoName === 'string' ? obj.dpoName : undefined,
    url: typeof obj.url === 'string' ? obj.url : undefined,
  }
}

function parseThirdParties(val: unknown): ThirdPartyMention[] {
  if (!Array.isArray(val)) return []
  return val.flatMap((item): ThirdPartyMention[] => {
    if (typeof item !== 'object' || item === null) return []
    const obj = item as Record<string, unknown>
    if (typeof obj.name !== 'string' || !obj.name) return []
    return [{
      name: obj.name,
      url: typeof obj.url === 'string' ? obj.url : undefined,
      role: typeof obj.role === 'string' ? obj.role : 'unknown',
      contextSnippet: typeof obj.contextSnippet === 'string' ? obj.contextSnippet : '',
    }]
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyses a stored policy document using the configured LLM provider.
 * Saves the structured analysis to the database and creates supply chain
 * edges for every third party mentioned.
 *
 * Returns the persisted PolicyAnalysis record.
 */
export async function analyseDocument(
  documentId: string,
  serviceId: string,
): Promise<PolicyAnalysis> {
  const doc = getDocumentById(documentId)
  if (!doc) {
    throw new AnalyserError(`Document ${documentId} not found`, 'NOT_FOUND')
  }

  // Read the stored policy HTML/text from disk
  let rawContent: string
  try {
    rawContent = await readFile(doc.file_path, 'utf-8')
  } catch {
    throw new AnalyserError(
      `Could not read policy file at ${doc.file_path}`,
      'FILE_READ_ERROR',
    )
  }

  // Strip HTML tags for the LLM — plain text is cheaper and cleaner
  const policyText = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  if (policyText.length < 100) {
    throw new AnalyserError(
      'Policy text is too short to analyse — the document may be empty or failed to parse.',
      'CONTENT_TOO_SHORT',
    )
  }

  const provider = getProvider()
  const prompt = ANALYSIS_PROMPT(policyText)
  const rawResponse = await callLlm(prompt)
  const result = parseAnalysisResponse(rawResponse)

  // Persist the analysis
  const analysis = insertPolicyAnalysis(documentId, provider, result, { raw: rawResponse })

  // Persist third parties and create supply chain edges
  for (const tp of result.thirdParties) {
    const thirdParty = upsertThirdParty(tp.name, tp.url, tp.role)
    insertSupplyChainEdge(serviceId, thirdParty.id, documentId, tp.contextSnippet)
  }

  return analysis
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class AnalyserError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'FILE_READ_ERROR'
      | 'CONFIG_ERROR'
      | 'PROVIDER_NOT_SUPPORTED'
      | 'PARSE_ERROR'
      | 'CONTENT_TOO_SHORT',
  ) {
    super(message)
    this.name = 'AnalyserError'
  }
}
