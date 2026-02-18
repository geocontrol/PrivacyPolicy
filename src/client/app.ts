import { mount as mountServices } from './views/services.ts'
import { mount as mountSupplyChain } from './views/supply-chain.ts'
import { mount as mountThirdParties } from './views/third-parties.ts'
import { openDetail, closeDetail } from './views/detail.ts'

type ViewName = 'services' | 'supply-chain' | 'third-parties'

const mounted: Record<ViewName, boolean> = {
  services: false,
  'supply-chain': false,
  'third-parties': false,
}

function switchView(viewName: ViewName) {
  // Hide all views
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.remove('view--active')
  })

  // Update nav buttons
  document.querySelectorAll('.nav__btn').forEach((btn) => {
    btn.classList.remove('nav__btn--active')
  })

  // Show selected view
  const viewEl = document.getElementById(`view-${viewName}`)!
  viewEl.classList.add('view--active')

  // Highlight nav button
  const navBtn = document.querySelector(`[data-view="${viewName}"]`)!
  navBtn.classList.add('nav__btn--active')

  // Lazy-load view if not already mounted
  if (!mounted[viewName]) {
    mounted[viewName] = true

    if (viewName === 'services') {
      mountServices(viewEl, (serviceId: string) => {
        openDetail(serviceId)
      })
    } else if (viewName === 'supply-chain') {
      mountSupplyChain(viewEl)
    } else if (viewName === 'third-parties') {
      mountThirdParties(viewEl)
    }
  }
}

// Attach nav button listeners
document.querySelectorAll('.nav__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const viewName = btn.getAttribute('data-view') as ViewName
    switchView(viewName)
  })
})

// Attach detail panel close button
document.getElementById('detail-close')!.addEventListener('click', closeDetail)

// Attach detail panel overlay close
document.getElementById('detail-overlay')!.addEventListener('click', closeDetail)

// Mount the default view (services)
switchView('services')

