/**
 * Shared Dashboard Navigation
 * Injects a consistent navigation bar across all dashboard pages
 */

const NAV_PAGES = [
  { id: 'overview', label: 'Home', href: 'resort-overview.html' },
  { id: 'terrain', label: 'Trails', href: 'terrain-dashboard.html' },
  { id: 'lifts', label: 'Lifts', href: 'live-lifts.html' },
  { id: 'briefs', label: 'Briefs', href: 'briefs-overview.html' },
  { id: 'api-providers', label: 'APIs Status', href: 'api-providers.html' },
  { id: 'monitor', label: 'Health', href: '../hetzner/monitor.html' }
];

function initNav(currentPage) {
  // Create nav element
  const nav = document.createElement('nav');
  nav.className = 'dashboard-nav';

  // Create nav links
  const links = NAV_PAGES.map(page => {
    const isActive = page.id === currentPage;
    return `<a href="${page.href}" class="nav-link${isActive ? ' active' : ''}">${page.label}</a>`;
  }).join('');

  // Create data source selector if dataSourceManager is available
  let dataSourceSelector = '';
  if (typeof dataSourceManager !== 'undefined') {
    const currentSource = dataSourceManager.getCurrentSource();
    const allSources = dataSourceManager.getAllSources();

    dataSourceSelector = `
      <div class="data-source-selector">
        <label for="data-source-select" class="data-source-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          Data:
        </label>
        <select id="data-source-select" class="data-source-select" title="${currentSource.description}">
          ${allSources.map(source =>
            `<option value="${source.id}" ${source.id === currentSource.id ? 'selected' : ''} title="${source.description}">
              ${source.name}
            </option>`
          ).join('')}
        </select>
      </div>
    `;
  }

  nav.innerHTML = links + dataSourceSelector;

  // Insert at top of .page element if it exists, otherwise at body start
  const pageEl = document.querySelector('.page');
  if (pageEl) {
    pageEl.insertBefore(nav, pageEl.firstChild);
  } else {
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // Set up data source change handler
  if (typeof dataSourceManager !== 'undefined') {
    const select = document.getElementById('data-source-select');
    if (select) {
      select.addEventListener('change', (e) => {
        const newSource = e.target.value;
        if (dataSourceManager.setCurrentSource(newSource)) {
          // Reload the page to fetch data from new source
          window.location.reload();
        }
      });
    }
  }

  // Inject nav styles
  const style = document.createElement('style');
  style.textContent = `
    .dashboard-nav {
      display: flex;
      gap: 6px;
      margin-bottom: 24px;
      padding: 6px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      width: fit-content;
      align-items: center;
    }
    .nav-link {
      padding: 10px 18px;
      border-radius: 8px;
      color: var(--muted);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .nav-link:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.05);
    }
    .nav-link.active {
      background: var(--accent);
      color: var(--bg);
      font-weight: 600;
    }
    .data-source-selector {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      padding: 6px 12px;
      border-left: 1px solid var(--border);
      padding-left: 12px;
    }
    .data-source-label {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--muted);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: default;
    }
    .data-source-label svg {
      opacity: 0.7;
    }
    .data-source-select {
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .data-source-select:hover {
      border-color: var(--accent);
      background: rgba(255, 255, 255, 0.05);
    }
    .data-source-select:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }
    @media (max-width: 600px) {
      .dashboard-nav {
        flex-wrap: wrap;
        width: 100%;
      }
      .nav-link {
        flex: 1;
        text-align: center;
        padding: 10px 12px;
        font-size: 0.85rem;
      }
      .data-source-selector {
        width: 100%;
        margin-left: 0;
        border-left: none;
        border-top: 1px solid var(--border);
        padding-left: 6px;
        padding-top: 6px;
        justify-content: center;
      }
    }
  `;
  document.head.appendChild(style);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initNav, NAV_PAGES };
}
