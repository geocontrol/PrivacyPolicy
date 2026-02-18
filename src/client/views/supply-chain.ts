// @ts-ignore
import Cytoscape from 'cytoscape'
import { api, Service, ApiError } from '../api.js'

let cy: Cytoscape.Core | null = null
let services: Service[] = []

const CATEGORY_COLOUR: Record<string, string> = {
  analytics: '#f59e0b',
  payment: '#10b981',
  marketing: '#ec4899',
  'customer support': '#8b5cf6',
  support: '#8b5cf6',
  security: '#ef4444',
  'data storage': '#06b6d4',
  'communication': '#3b82f6',
}
const DEFAULT_COLOUR = '#94a3b8'

function getCategoryColour(category: string | null): string {
  if (!category) return DEFAULT_COLOUR
  const lowerCat = category.toLowerCase()
  return CATEGORY_COLOUR[lowerCat] || DEFAULT_COLOUR
}

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

async function renderGraph(container: HTMLElement, serviceId: string) {
  try {
    const supplyChain = await api.analyses.supplyChain(serviceId)

    // Destroy previous cy instance if it exists
    if (cy) {
      cy.destroy()
      cy = null
    }

    // Build elements for Cytoscape
    const elements: Cytoscape.ElementDefinition[] = []

    // Add service node
    elements.push({
      data: {
        id: supplyChain.service.id,
        label: supplyChain.service.name,
        type: 'service',
      },
    })

    // Add third-party nodes (deduplicated)
    const seenThirdParties = new Set<string>()
    for (const tp of supplyChain.thirdParties) {
      if (!seenThirdParties.has(tp.id)) {
        seenThirdParties.add(tp.id)
        elements.push({
          data: {
            id: tp.id,
            label: tp.name,
            type: 'third-party',
            colour: getCategoryColour(tp.category),
            category: tp.category,
          },
        })
      }
    }

    // Add edges
    for (const edge of supplyChain.edges) {
      elements.push({
        data: {
          id: `${edge.from}-${edge.to}`,
          source: edge.from,
          target: edge.to,
          contextSnippet: edge.contextSnippet || 'No additional details',
        },
      })
    }

    // Initialize Cytoscape
    const cyContainer = container.querySelector('#cy') as HTMLElement
    cy = Cytoscape({
      container: cyContainer,
      elements,
      layout: {
        name: 'cose',
        padding: 40,
        animate: false,
      },
      style: [
        {
          selector: 'node[type="service"]',
          style: {
            'background-color': '#3b82f6',
            label: 'data(label)',
            'color': '#ffffff',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': 12,
            'font-weight': 'bold',
            width: 60,
            height: 60,
          },
        },
        {
          selector: 'node[type="third-party"]',
          style: {
            'background-color': 'data(colour)',
            label: 'data(label)',
            'color': '#ffffff',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': 11,
            width: 50,
            height: 50,
            'text-wrap': 'wrap',
            'text-max-width': 45,
          },
        },
        {
          selector: 'edge',
          style: {
            'line-color': '#cbd5e1',
            'target-arrow-color': '#94a3b8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            width: 1.5,
            'arrow-scale': 1,
          },
        },
      ],
    })

    // Handle node clicks
    cy.on('tap', 'node', (evt) => {
      const node = evt.target
      const nodeId = node.id()

      // Find edges connected to this node as target
      const connectedEdges = cy!.edges().filter((e) => e.target().id() === nodeId)

      if (connectedEdges.length > 0) {
        const snippets = connectedEdges.map((e) => e.data('contextSnippet')).filter(Boolean)
        const snippetText = snippets.join('\n\n') || 'No context information'
        const tooltipEl = container.querySelector('#cy-tooltip') as HTMLElement
        if (tooltipEl) {
          tooltipEl.textContent = snippetText
        }
      }
    })

    // Hide tooltip when clicking on background
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        const tooltipEl = container.querySelector('#cy-tooltip') as HTMLElement
        if (tooltipEl) {
          tooltipEl.textContent = 'Click on a third-party node to see relationship details'
        }
      }
    })
  } catch (err) {
    const error = err as ApiError
    const tooltipEl = container.querySelector('#cy-tooltip') as HTMLElement
    if (tooltipEl) {
      tooltipEl.textContent = `Error loading supply chain: ${error.message}`
    }
  }
}

export async function mount(container: HTMLElement) {
  // Load services for the selector
  try {
    services = await api.services.list()
  } catch (err) {
    const error = err as ApiError
    container.innerHTML = `<div class="empty-state"><p>Error loading services: ${escapeHtml(error.message)}</p></div>`
    return
  }

  // Render HTML structure
  const html = `
    <div class="card">
      <h3>Supply Chain Visualization</h3>
      <div class="form-group" style="margin: var(--spacing) 0;">
        <label class="form-group__label">Select a Service</label>
        <select id="sc-service-selector" class="form-group__select">
          <option value="">— Choose a service —</option>
          ${services.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card">
      <div id="cy"></div>
      <p id="cy-tooltip" class="cy-tooltip">Select a service above to view its supply chain. Click on third-party nodes to see relationship details.</p>
    </div>
  `

  container.innerHTML = html

  // Attach event listener to selector
  const selector = container.querySelector('#sc-service-selector') as HTMLSelectElement
  selector.addEventListener('change', (evt) => {
    const serviceId = (evt.target as HTMLSelectElement).value
    if (serviceId) {
      renderGraph(container, serviceId)
    }
  })
}
