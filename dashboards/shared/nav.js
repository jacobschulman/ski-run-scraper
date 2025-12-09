/**
 * Shared Dashboard Navigation
 * Injects a consistent navigation bar across all dashboard pages
 */

const NAV_PAGES = [
  { id: 'home', label: 'Home', href: 'index.html' },
  { id: 'terrain', label: 'Trails', href: 'terrain-dashboard.html' },
  { id: 'lifts', label: 'Lifts', href: 'live-lifts.html' },
  { id: 'briefs', label: 'Briefs', href: 'briefs-overview.html' },
  { id: 'overview', label: 'Admin', href: 'resort-overview.html' }
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

  nav.innerHTML = links;

  // Insert at top of .page element if it exists, otherwise at body start
  const pageEl = document.querySelector('.page');
  if (pageEl) {
    pageEl.insertBefore(nav, pageEl.firstChild);
  } else {
    document.body.insertBefore(nav, document.body.firstChild);
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
    }
  `;
  document.head.appendChild(style);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initNav, NAV_PAGES };
}
