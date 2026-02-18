import { api, ThirdParty, ApiError } from '../api.js'

let thirdParties: ThirdParty[] = []

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

async function loadThirdParties(container: HTMLElement) {
  try {
    thirdParties = await api.thirdParties.list()
    renderTable(container)
  } catch (err) {
    const error = err as ApiError
    container.innerHTML = `<div class="empty-state"><p>Error loading third parties: ${escapeHtml(error.message)}</p></div>`
  }
}

function renderTable(container: HTMLElement) {
  if (thirdParties.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No third parties discovered yet. Fetch and analyse some policies first.</p>
      </div>
    `
    return
  }

  const html = `
    <div class="card">
      <h3>Discovered Third Parties</h3>
      <table class="table">
        <thead class="table__head">
          <tr>
            <th class="table__head-cell">Name</th>
            <th class="table__head-cell">URL</th>
            <th class="table__head-cell">Category</th>
          </tr>
        </thead>
        <tbody>
          ${thirdParties
            .map(
              (tp) => `
            <tr class="table__body-row">
              <td class="table__body-cell">${escapeHtml(tp.name)}</td>
              <td class="table__body-cell table__body-cell--muted">
                ${tp.url ? `<a href="${escapeHtml(tp.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(tp.url)}</a>` : '—'}
              </td>
              <td class="table__body-cell table__body-cell--muted">${tp.category ? escapeHtml(tp.category) : '—'}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `

  container.innerHTML = html
}

export async function mount(container: HTMLElement) {
  container.innerHTML = `
    <div class="empty-state">
      <p>Loading third parties...</p>
    </div>
  `

  await loadThirdParties(container)

  // Add a reload button by wrapping the table
  const reloadBtn = document.createElement('button')
  reloadBtn.className = 'btn btn--sm'
  reloadBtn.textContent = '🔄 Reload'
  reloadBtn.addEventListener('click', () => {
    loadThirdParties(container)
  })

  // Insert reload button before the table
  const card = container.querySelector('.card')
  if (card) {
    const heading = card.querySelector('h3')
    if (heading) {
      heading.parentNode?.insertBefore(reloadBtn, heading.nextSibling)
    }
  }
}
