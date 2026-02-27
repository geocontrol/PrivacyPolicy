import { api, ChecklistItem, LegalDocument, ResourceHub, DiscoveryRun } from '../api.ts'

let currentServiceId: string | null = null

// Category to colour mapping for tags
const CATEGORY_TAG_MAP: Record<string, string> = {
  email: 'default',
  name: 'default',
  phone: 'default',
  ip_address: 'default',
  location: 'default',
  cookies: 'default',
  analytics: 'analytics',
  tracking: 'analytics',
  personalization: 'marketing',
  marketing: 'marketing',
  payment: 'payment',
  billing: 'payment',
  support: 'support',
  security: 'security',
}

function getTagColour(item: string): string {
  const lowerItem = item.toLowerCase()
  for (const [key, colour] of Object.entries(CATEGORY_TAG_MAP)) {
    if (lowerItem.includes(key)) {
      return colour
    }
  }
  return 'default'
}

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function humaniseDocType(docType: string): string {
  return docType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Render tag chips
function renderTags(items: string[] | null): string {
  if (!items || items.length === 0) {
    return '<p class="text-muted">None</p>'
  }
  return `
    <div class="tag-group">
      ${items.map((item) => `<span class="tag tag--${getTagColour(item)}">${escapeHtml(item)}</span>`).join('')}
    </div>
  `
}

// Render the detail panel content
async function renderDetail(serviceId: string) {
  const detailContent = document.getElementById('detail-content')!

  try {
    const service = await api.services.get(serviceId)

    let analysisHtml = `
      <p class="text-muted">No analysis yet. Go to Services tab and click Analyse to get started.</p>
    `

    let documentHistoryHtml = ''
    let checklistHtml = '<p class="text-muted">No checklist available yet.</p>'
    let legalDocsHtml = '<p class="text-muted">No legal documents discovered yet.</p>'
    let resourceHubsHtml = '<p class="text-muted">No resource hubs detected yet.</p>'
    let discoveryRunHtml = '<p class="text-muted">No discovery run has been started yet.</p>'

    try {
      const checklist = await api.services.checklist(serviceId)
      checklistHtml = renderChecklist(checklist)
    } catch {
      // Discovery may not have run yet.
    }

    try {
      const legalData = await api.services.legalDocuments(serviceId)
      legalDocsHtml = renderLegalDocuments(legalData.legalDocuments)
      resourceHubsHtml = renderResourceHubs(legalData.resourceHubs)
    } catch {
      // Discovery may not have run yet.
    }

    try {
      const run = await api.services.latestDiscoveryRun(serviceId)
      discoveryRunHtml = renderDiscoveryRun(run)
    } catch {
      // No run yet.
    }

    if (service.latestDocument) {
      const docs = await api.services.documents(serviceId)
      documentHistoryHtml = `
        <h4>Policy Document History</h4>
        <div>
          ${docs
            .map(
              (doc) => `
            <div style="padding: 8px 0; border-bottom: 1px solid var(--colour-border);">
              <div style="font-size: 12px; color: var(--colour-text-muted);">${formatDate(doc.retrieved_at)}</div>
              <a href="${escapeHtml(doc.source_url)}" target="_blank" rel="noopener noreferrer" style="word-break: break-all;">
                ${escapeHtml(doc.source_url)}
              </a>
            </div>
          `,
            )
            .join('')}
        </div>
      `

      // Try to load analysis
      try {
        const analysis = await api.analyses.get(serviceId)
        analysisHtml = `
          <div>
            <h4>Summary</h4>
            <p>${escapeHtml(analysis.summary || 'No summary available')}</p>

            <h4>Data Collected</h4>
            ${renderTags(analysis.data_collected as string[] | null)}

            <h4>Purposes</h4>
            ${renderTags(analysis.purposes as string[] | null)}

            <h4>Legal Bases</h4>
            ${renderTags(analysis.legal_bases as string[] | null)}

            <h4>User Rights</h4>
            ${renderTags(analysis.user_rights as string[] | null)}

            <h4>Retention Period</h4>
            <p>${escapeHtml(analysis.retention || 'Not specified')}</p>

            <h4>Contact Information</h4>
            ${renderContactCard(analysis.contact)}

            <div style="font-size: 11px; color: var(--colour-text-muted); margin-top: var(--spacing);">
              Analysed ${formatDate(analysis.analysed_at)} with ${analysis.llm_provider}
            </div>
          </div>
        `
      } catch {
        // Analysis not found, keep default message
      }
    }

    detailContent.innerHTML = `
      <h2>${escapeHtml(service.name)}</h2>
      <a href="${escapeHtml(service.url)}" target="_blank" rel="noopener noreferrer" style="word-break: break-all;">
        ${escapeHtml(service.url)}
      </a>
      ${service.category ? `<div style="color: var(--colour-text-muted); font-size: 13px; margin-top: 8px;">${escapeHtml(service.category)}</div>` : ''}

      <hr style="margin: var(--spacing) 0; border: none; border-top: 1px solid var(--colour-border);" />

      <h4>Analysis</h4>
      ${analysisHtml}

      <hr style="margin: var(--spacing) 0; border: none; border-top: 1px solid var(--colour-border);" />

      <h4>Legal Discovery Run</h4>
      ${discoveryRunHtml}

      <hr style="margin: var(--spacing) 0; border: none; border-top: 1px solid var(--colour-border);" />

      <h4>Legal Documents Checklist</h4>
      ${checklistHtml}

      <hr style="margin: var(--spacing) 0; border: none; border-top: 1px solid var(--colour-border);" />

      <h4>Discovered Legal Documents</h4>
      ${legalDocsHtml}

      <hr style="margin: var(--spacing) 0; border: none; border-top: 1px solid var(--colour-border);" />

      <h4>Privacy Centre / Settings Hubs</h4>
      ${resourceHubsHtml}

      <hr style="margin: var(--spacing) 0; border: none; border-top: 1px solid var(--colour-border);" />

      ${documentHistoryHtml}
    `
  } catch (err) {
    detailContent.innerHTML = `
      <h2>Error Loading Service</h2>
      <p class="text-muted">Unable to load service details. Please try again.</p>
    `
  }
}

function renderChecklist(items: ChecklistItem[]): string {
  if (items.length === 0) return '<p class="text-muted">No checklist available yet.</p>'

  return `
    <div>
      ${items.map((item) => `
        <div style="padding: 8px 0; border-bottom: 1px solid var(--colour-border);">
          <div style="font-weight: 600;">${escapeHtml(humaniseDocType(item.doc_type))}</div>
          <div style="font-size: 12px; color: var(--colour-text-muted);">
            Required: ${item.required ? 'Yes' : 'No'} · Found: ${item.found ? 'Yes' : 'No'}
          </div>
          ${item.notes ? `<div style="font-size: 12px;">${escapeHtml(item.notes)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `
}

function renderLegalDocuments(documents: LegalDocument[]): string {
  if (documents.length === 0) return '<p class="text-muted">No legal documents discovered yet.</p>'

  return `
    <div>
      ${documents.map((doc) => `
        <div style="padding: 8px 0; border-bottom: 1px solid var(--colour-border);">
          <div style="font-weight: 600;">${escapeHtml(humaniseDocType(doc.doc_type))}</div>
          ${doc.title ? `<div style="font-size: 13px;">${escapeHtml(doc.title)}</div>` : ''}
          <div style="font-size: 12px; color: var(--colour-text-muted);">
            Found via ${escapeHtml(doc.discovery_method)} · ${escapeHtml(formatDate(doc.retrieved_at))}
          </div>
          <a href="${escapeHtml(doc.resolved_url)}" target="_blank" rel="noopener noreferrer" style="word-break: break-all;">
            ${escapeHtml(doc.resolved_url)}
          </a>
        </div>
      `).join('')}
    </div>
  `
}

function renderResourceHubs(hubs: ResourceHub[]): string {
  if (hubs.length === 0) return '<p class="text-muted">No resource hubs detected yet.</p>'

  return `
    <div>
      ${hubs.map((hub) => `
        <div style="padding: 8px 0; border-bottom: 1px solid var(--colour-border);">
          <div style="font-weight: 600;">${escapeHtml(humaniseDocType(hub.hub_type))}</div>
          ${hub.title ? `<div style="font-size: 13px;">${escapeHtml(hub.title)}</div>` : ''}
          <div style="font-size: 12px; color: var(--colour-text-muted);">
            Confidence: ${Math.round(hub.confidence * 100)}%
          </div>
          <a href="${escapeHtml(hub.url)}" target="_blank" rel="noopener noreferrer" style="word-break: break-all;">
            ${escapeHtml(hub.url)}
          </a>
          ${hub.notes ? `<div style="font-size: 12px;">${escapeHtml(hub.notes)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `
}

function renderDiscoveryRun(run: DiscoveryRun): string {
  const stats = run.stats_json ? JSON.stringify(run.stats_json) : null
  return `
    <div style="background-color: var(--colour-surface); padding: var(--spacing); border-radius: var(--radius); border: 1px solid var(--colour-border);">
      <div><strong>Status:</strong> ${escapeHtml(run.status)}</div>
      <div><strong>Started:</strong> ${escapeHtml(formatDate(run.started_at))}</div>
      ${run.finished_at ? `<div><strong>Finished:</strong> ${escapeHtml(formatDate(run.finished_at))}</div>` : ''}
      ${run.error ? `<div><strong>Error:</strong> ${escapeHtml(run.error)}</div>` : ''}
      ${stats ? `<div style="font-size: 12px; margin-top: 6px;"><strong>Stats:</strong> ${escapeHtml(stats)}</div>` : ''}
    </div>
  `
}

function renderContactCard(contact: Record<string, string> | null): string {
  if (!contact || Object.keys(contact).length === 0) {
    return '<p class="text-muted">No contact information available</p>'
  }

  return `
    <div style="background-color: var(--colour-surface); padding: var(--spacing); border-radius: var(--radius); border: 1px solid var(--colour-border); font-size: 13px;">
      ${contact.dpoName ? `<div><strong>DPO:</strong> ${escapeHtml(contact.dpoName)}</div>` : ''}
      ${contact.email ? `<div><strong>Email:</strong> <a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></div>` : ''}
      ${contact.address ? `<div><strong>Address:</strong> ${escapeHtml(contact.address)}</div>` : ''}
      ${contact.url ? `<div><strong>URL:</strong> <a href="${escapeHtml(contact.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(contact.url)}</a></div>` : ''}
    </div>
  `
}

export function openDetail(serviceId: string) {
  currentServiceId = serviceId
  const panel = document.getElementById('detail-panel')!
  const overlay = document.getElementById('detail-overlay')!

  panel.classList.add('detail-panel--open')
  overlay.classList.add('overlay--visible')

  renderDetail(serviceId)
}

export function closeDetail() {
  currentServiceId = null
  const panel = document.getElementById('detail-panel')!
  const overlay = document.getElementById('detail-overlay')!

  panel.classList.remove('detail-panel--open')
  overlay.classList.remove('overlay--visible')
}
