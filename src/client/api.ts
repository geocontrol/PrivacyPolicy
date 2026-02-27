// Shared types (mirrors backend)

export interface Service {
  id: string
  name: string
  url: string
  category: string | null
  created_at: string
  updated_at: string
}

export interface PolicyDocument {
  id: string
  service_id: string
  retrieved_at: string
  source_url: string
  file_path: string
  content_hash: string
  status: string
}

export interface PolicyAnalysisResult {
  summary: string | null
  data_collected: string[] | null
  purposes: string[] | null
  legal_bases: string[] | null
  retention: string | null
  user_rights: string[] | null
  contact: Record<string, string> | null
}

export interface PolicyAnalysis extends PolicyAnalysisResult {
  id: string
  document_id: string
  analysed_at: string
  llm_provider: string
  raw_response: unknown | null
}

export interface ThirdParty {
  id: string
  name: string
  url: string | null
  category: string | null
}

export interface SupplyChainEdge {
  from: string
  to: string
  documentId: string
  contextSnippet: string | null
}

export interface SupplyChain {
  service: Pick<Service, 'id' | 'name' | 'url'>
  thirdParties: ThirdParty[]
  edges: SupplyChainEdge[]
}

export interface ServiceWithDoc extends Service {
  latestDocument: PolicyDocument | null
}

export interface LegalDocument {
  id: string
  service_id: string
  doc_type: string
  title: string | null
  source_url: string
  resolved_url: string
  file_path: string
  content_hash: string
  retrieved_at: string
  status: string
  discovery_method: string
  is_regulation_specific: number
  regulation_tag: string | null
}

export interface ResourceHub {
  id: string
  service_id: string
  hub_type: string
  url: string
  title: string | null
  confidence: number
  notes: string | null
  detected_at: string
}

export interface ChecklistItem {
  id: string
  service_id: string
  doc_type: string
  required: boolean
  found: boolean
  document_id: string | null
  notes: string | null
  updated_at: string
}

export interface DiscoveryRun {
  id: string
  service_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'partial'
  started_at: string
  finished_at: string | null
  error: string | null
  stats_json: Record<string, unknown> | null
}

// API Error type
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Helper function
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let body: any = {}
    try {
      body = await res.json()
    } catch {
      // JSON parse failed, use empty object
    }
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.code)
  }
  return res.json() as Promise<T>
}

// API namespace
export const api = {
  services: {
    list: () => apiFetch<Service[]>('/api/services'),

    get: (id: string) => apiFetch<ServiceWithDoc>(`/api/services/${id}`),

    create: (body: { name: string; url: string; category?: string }) =>
      apiFetch<Service>('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),

    delete: (id: string) =>
      apiFetch<void>(`/api/services/${id}`, { method: 'DELETE' }),

    fetch: (id: string) =>
      apiFetch<{ documentId: string; resolvedUrl: string; message: string }>(
        `/api/services/${id}/fetch`,
        { method: 'POST' },
      ),

    documents: (id: string) => apiFetch<PolicyDocument[]>(`/api/services/${id}/documents`),

    legalDocuments: (id: string) =>
      apiFetch<{ legalDocuments: LegalDocument[]; resourceHubs: ResourceHub[] }>(
        `/api/services/${id}/legal-documents`,
      ),

    checklist: (id: string) =>
      apiFetch<ChecklistItem[]>(`/api/services/${id}/checklist`),

    latestDiscoveryRun: (id: string) =>
      apiFetch<DiscoveryRun>(`/api/services/${id}/discovery-runs/latest`),

    discover: (id: string) =>
      apiFetch<{ message: string }>(`/api/services/${id}/discover`, {
        method: 'POST',
      }),
  },

  analyses: {
    trigger: (serviceId: string) =>
      apiFetch<PolicyAnalysis>(`/api/analyses/services/${serviceId}`, {
        method: 'POST',
      }),

    get: (serviceId: string) => apiFetch<PolicyAnalysis>(`/api/analyses/services/${serviceId}`),

    supplyChain: (serviceId: string) =>
      apiFetch<SupplyChain>(`/api/analyses/services/${serviceId}/supply-chain`),
  },

  thirdParties: {
    list: () => apiFetch<ThirdParty[]>('/api/analyses/third-parties'),
  },
}
