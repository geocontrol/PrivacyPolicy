import { api, Service, ApiError } from '../api.ts'

let services: Service[] = []
let onSelectService: (id: string) => void

// Format a date from ISO string
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

// Render the services list into the dedicated list container
function renderServices(listContainer: HTMLElement) {
  if (services.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <p>No services registered yet. Add one above to get started.</p>
      </div>
    `
    return
  }

  listContainer.innerHTML = `
    <div>
      ${services
        .map(
          (svc) => `
        <div class="service-row">
          <div class="service-row__name">${escapeHtml(svc.name)}</div>
          <div class="service-row__url">${escapeHtml(svc.url)}</div>
          <div class="service-row__category">${svc.category ? escapeHtml(svc.category) : '—'}</div>
          <div class="service-row__fetched">${escapeHtml(formatDate(svc.updated_at))}</div>
          <div class="service-row__actions">
            <button class="btn btn--sm" data-action="fetch" data-id="${svc.id}" title="Fetch policy">⬇️</button>
            <button class="btn btn--sm" data-action="analyse" data-id="${svc.id}" title="Analyse policy">✨</button>
            <button class="btn btn--sm" data-action="view" data-id="${svc.id}" title="View details">👁️</button>
            <button class="btn btn--sm btn--danger" data-action="delete" data-id="${svc.id}" title="Delete">🗑️</button>
          </div>
          <div class="error-msg" data-error-for="${svc.id}"></div>
        </div>
      `,
        )
        .join('')}
    </div>
  `

  // Attach event listeners to action buttons
  listContainer.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', handleAction)
  })
}

// Get the stable list container (created once in mount)
function getListContainer(): HTMLElement {
  return document.getElementById('services-list')!
}

// Handle service row actions
async function handleAction(event: Event) {
  const btn = event.currentTarget as HTMLButtonElement
  const action = btn.dataset.action
  const serviceId = btn.dataset.id!
  const errorEl = btn.closest('.service-row')?.querySelector(`[data-error-for="${serviceId}"]`)

  if (errorEl) {
    errorEl.textContent = ''
  }

  if (action === 'view') {
    onSelectService(serviceId)
  } else if (action === 'fetch') {
    await handleFetch(serviceId, btn, errorEl)
  } else if (action === 'analyse') {
    await handleAnalyse(serviceId, btn, errorEl)
  } else if (action === 'delete') {
    await handleDelete(serviceId, btn, errorEl)
  }
}

async function handleFetch(serviceId: string, btn: HTMLButtonElement, errorEl: Element | undefined) {
  btn.disabled = true
  const originalText = btn.textContent
  btn.innerHTML = '<span class="spinner"></span>'

  try {
    await api.services.fetch(serviceId)
    // Reload the service to get updated data
    const updatedService = await api.services.get(serviceId)
    const idx = services.findIndex((s) => s.id === serviceId)
    if (idx >= 0) {
      services[idx] = updatedService
    }
    renderServices(getListContainer())
  } catch (err) {
    const error = err as ApiError
    if (errorEl) {
      errorEl.textContent = error.message || 'Failed to fetch policy'
    }
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
}

async function handleAnalyse(serviceId: string, btn: HTMLButtonElement, errorEl: Element | undefined) {
  btn.disabled = true
  const originalText = btn.textContent
  btn.innerHTML = '<span class="spinner"></span>'

  try {
    await api.analyses.trigger(serviceId)
    if (errorEl) {
      const successEl = btn.closest('.service-row')?.querySelector('.success-msg') as HTMLElement
      if (successEl) {
        successEl.textContent = 'Analysis complete!'
      }
    }
    // Reload service to show updated data
    const updatedService = await api.services.get(serviceId)
    const idx = services.findIndex((s) => s.id === serviceId)
    if (idx >= 0) {
      services[idx] = updatedService
    }
    renderServices(getListContainer())
  } catch (err) {
    const error = err as ApiError
    if (errorEl) {
      errorEl.textContent = error.message || 'Failed to analyse policy'
    }
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
}

async function handleDelete(serviceId: string, btn: HTMLButtonElement, errorEl: Element | undefined) {
  const service = services.find((s) => s.id === serviceId)
  if (!confirm(`Delete "${service?.name}"? This action cannot be undone.`)) {
    return
  }

  btn.disabled = true
  const originalText = btn.textContent
  btn.innerHTML = '<span class="spinner"></span>'

  try {
    await api.services.delete(serviceId)
    services = services.filter((s) => s.id !== serviceId)
    renderServices(getListContainer())
  } catch (err) {
    const error = err as ApiError
    if (errorEl) {
      errorEl.textContent = error.message || 'Failed to delete service'
    }
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
}

// Render the add service form
function renderForm(container: HTMLElement) {
  const formHtml = `
    <div class="card card--large">
      <h3>Add a New Service</h3>
      <form id="add-service-form" class="form">
        <div class="form-group">
          <label class="form-group__label">Service Name *</label>
          <input type="text" class="form-group__input" id="form-name" placeholder="e.g., Stripe" required />
        </div>
        <div class="form-group">
          <label class="form-group__label">URL *</label>
          <input type="url" class="form-group__input" id="form-url" placeholder="https://stripe.com" required />
        </div>
        <div class="form-group">
          <label class="form-group__label">Category (optional)</label>
          <input type="text" class="form-group__input" id="form-category" placeholder="e.g., Payment Processing" />
        </div>
        <div>
          <button type="submit" class="btn btn--primary">Add Service</button>
          <span class="error-msg" id="form-error"></span>
          <span class="success-msg" id="form-success"></span>
        </div>
      </form>
    </div>
  `

  container.innerHTML = formHtml

  const form = document.getElementById('add-service-form')!
  form.addEventListener('submit', handleAddService)
}

async function handleAddService(event: Event) {
  event.preventDefault()
  const form = event.currentTarget as HTMLFormElement
  const name = (document.getElementById('form-name') as HTMLInputElement).value.trim()
  const url = (document.getElementById('form-url') as HTMLInputElement).value.trim()
  const category = (document.getElementById('form-category') as HTMLInputElement).value.trim() || undefined
  const errorEl = document.getElementById('form-error')!
  const successEl = document.getElementById('form-success')!
  const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement

  errorEl.textContent = ''
  successEl.textContent = ''

  if (!name || !url) {
    errorEl.textContent = 'Name and URL are required'
    return
  }

  submitBtn.disabled = true
  const originalText = submitBtn.textContent
  submitBtn.innerHTML = '<span class="spinner"></span>'

  try {
    const newService = await api.services.create({ name, url, category })
    services.push(newService)
    renderServices(getListContainer())
    form.reset()
    successEl.textContent = 'Service added successfully!'
    setTimeout(() => {
      successEl.textContent = ''
    }, 3000)
  } catch (err) {
    const error = err as ApiError
    errorEl.textContent = error.message || 'Failed to add service'
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = originalText
  }
}

// Helper to escape HTML
function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// Main mount function
export async function mount(container: HTMLElement, onSelect: (id: string) => void) {
  onSelectService = onSelect

  // Set up stable layout: form section + list section (neither overwrites the other)
  container.innerHTML = `
    <div id="services-form-area"></div>
    <div id="services-list"></div>
  `

  // Render the form into its dedicated area
  const formArea = document.getElementById('services-form-area')!
  renderForm(formArea)

  // Load and render services into the list area
  try {
    services = await api.services.list()
    renderServices(getListContainer())
  } catch (err) {
    const error = err as ApiError
    getListContainer().innerHTML = `<div class="empty-state"><p>Error loading services: ${escapeHtml(error.message)}</p></div>`
  }
}
