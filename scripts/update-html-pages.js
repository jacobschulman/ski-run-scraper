#!/usr/bin/env node

/**
 * Batch update all resort HTML pages with PWA enhancements
 *
 * This script updates:
 * - grooming.html (Overview)
 * - trails.html
 * - snow.html
 * - lifts.html
 *
 * For each resort directory in data/
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

// Get all resort directories
function getResortDirs() {
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .filter(e => !e.name.startsWith('.') && e.name !== 'icons')
    .map(e => e.name);
}

// PWA meta tags to inject into <head>
const PWA_META_TAGS = `
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#2c5aa0" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1a3a6e" media="(prefers-color-scheme: dark)">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="../manifest.json">
  <link rel="apple-touch-icon" href="../icons/icon.svg">
  <link rel="icon" href="../icons/icon.svg" type="image/svg+xml">`;

// Pull-to-refresh indicator HTML
const PULL_INDICATOR = `
    <!-- Pull-to-refresh indicator -->
    <div class="pull-indicator" id="pullIndicator">
        <div class="pull-spinner"></div>
    </div>
`;

// Morning brief widget container (only for grooming.html)
const BRIEF_WIDGET = `
        <!-- Morning Brief Widget -->
        <div id="briefWidget" class="brief-widget" style="display: none;"></div>
`;

// Script includes
const SCRIPT_INCLUDES = `
    <script src="../pwa.js"></script>
    <script src="../debug.js"></script>`;

// Generate the updated grooming.html template
function generateGroomingHtml(resortKey) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#2c5aa0" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#1a3a6e" media="(prefers-color-scheme: dark)">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="manifest" href="../manifest.json">
    <link rel="apple-touch-icon" href="../icons/icon.svg">
    <link rel="icon" href="../icons/icon.svg" type="image/svg+xml">
    <title id="page-title">Grooming Report</title>
    <link rel="stylesheet" href="../styles.css">
</head>
<body class="has-bottom-nav">
    <!-- Pull-to-refresh indicator -->
    <div class="pull-indicator" id="pullIndicator">
        <div class="pull-spinner"></div>
    </div>

    <div class="header">
        <div class="header-content">
            <h1 id="page-heading">Grooming Report</h1>
            <div class="date-nav" id="dateNav">
                <div class="date-controls">
                    <button class="nav-btn" id="prevBtn" onclick="navigateDate(-1)" aria-label="Previous day">
                        <span class="nav-text-short">‹</span>
                        <span class="nav-text-full">← Previous</span>
                    </button>
                    <span class="date-display" id="dateDisplay" onclick="openDatePicker()" tabindex="0" role="button" aria-label="Select date">Loading...</span>
                    <button class="nav-btn" id="nextBtn" onclick="navigateDate(1)" aria-label="Next day">
                        <span class="nav-text-short">›</span>
                        <span class="nav-text-full">Next →</span>
                    </button>
                </div>
                <input type="date" id="datePicker" onchange="selectDate()" aria-label="Date picker">
            </div>
        </div>
    </div>

    <div class="container">
        <!-- Morning Brief Widget -->
        <div id="briefWidget" class="brief-widget" style="display: none;"></div>

        <!-- Weather Widget -->
        <div id="weatherWidget" class="weather-widget" style="display: none;"></div>

        <!-- Main Content -->
        <div id="content">
            <div class="skeleton-container">
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
            </div>
        </div>
    </div>

    <div class="footer">
        <p id="update-time">Data updated daily</p>
    </div>

    <script>
        // Auto-detect resort key from URL path
        const pathParts = window.location.pathname.split('/');
        const dataIndex = pathParts.findIndex(part => part === 'data');
        const RESORT_KEY = pathParts[dataIndex + 1];

        // Fetch resort config to get display name
        fetch('../index.json')
            .then(r => r.json())
            .then(index => {
                const resortInfo = index.resorts[RESORT_KEY];
                if (resortInfo) {
                    const resortName = resortInfo.name;
                    document.getElementById('page-title').textContent = \`\${resortName} Grooming Report\`;
                    document.getElementById('page-heading').textContent = \`\${resortName} Grooming Report\`;
                }
            })
            .catch(err => console.warn('Could not load resort name:', err));
    </script>
    <script src="../pwa.js"></script>
    <script src="../debug.js"></script>
    <script src="../resort.js"></script>

    <!-- Bottom Navigation -->
    <nav class="bottom-nav" id="bottomNav">
        <a href="grooming.html" class="nav-tab active">
            <span class="nav-tab-icon">🏔️</span>
            <span class="nav-tab-label">Overview</span>
        </a>
        <a href="trails.html" class="nav-tab">
            <span class="nav-tab-icon">🥽</span>
            <span class="nav-tab-label">Trails</span>
        </a>
        <a href="snow.html" class="nav-tab">
            <span class="nav-tab-icon">❄️</span>
            <span class="nav-tab-label">Snow</span>
        </a>
        <a href="lifts.html" class="nav-tab" id="liftsTab">
            <span class="nav-tab-icon">🚡</span>
            <span class="nav-tab-label">Lifts</span>
        </a>
    </nav>
</body>
</html>
`;
}

// Generate the updated trails.html template
function generateTrailsHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#2c5aa0" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#1a3a6e" media="(prefers-color-scheme: dark)">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="manifest" href="../manifest.json">
    <link rel="apple-touch-icon" href="../icons/icon.svg">
    <link rel="icon" href="../icons/icon.svg" type="image/svg+xml">
    <title id="page-title">Trail Leaderboard</title>
    <link rel="stylesheet" href="../styles.css">
</head>
<body class="has-bottom-nav">
    <!-- Pull-to-refresh indicator -->
    <div class="pull-indicator" id="pullIndicator">
        <div class="pull-spinner"></div>
    </div>

    <div class="header">
        <div class="header-content">
            <div class="trails-header">
                <h1 id="page-heading">Trail Leaderboard</h1>
                <p class="trails-subtitle" id="trailCount">Loading trails...</p>
            </div>
        </div>
    </div>

    <div class="container">
        <!-- Leaderboards -->
        <div class="leaderboard-section" id="leaderboardSection">
            <div class="leaderboard-grid">
                <div class="leaderboard-card">
                    <div class="leaderboard-title">
                        <span class="leaderboard-icon">🏆</span>
                        Most Groomed
                    </div>
                    <ul class="leaderboard-list" id="mostGroomed">
                        <div class="skeleton skeleton-row"></div>
                    </ul>
                </div>
                <div class="leaderboard-card">
                    <div class="leaderboard-title">
                        <span class="leaderboard-icon">🔥</span>
                        Longest Streak
                    </div>
                    <ul class="leaderboard-list" id="longestStreak">
                        <div class="skeleton skeleton-row"></div>
                    </ul>
                </div>
            </div>
        </div>

        <!-- All Trails -->
        <div class="trail-list-section" id="trailListSection">
            <div class="trail-list-header">
                <span class="trail-list-title">All Trails</span>
                <div class="sort-controls">
                    <button class="sort-btn active" id="sortName" onclick="sortBy('name')">A-Z</button>
                    <button class="sort-btn" id="sortPercent" onclick="sortBy('percent')">%</button>
                    <div class="search-wrapper">
                        <button class="search-btn" id="searchBtn" onclick="toggleSearch()">🔍</button>
                        <div class="search-dropdown" id="searchDropdown">
                            <input type="text" class="search-input" id="searchInput" placeholder="Search trails..." oninput="filterTrails()">
                            <button class="search-clear" id="searchClear" onclick="clearSearch()">×</button>
                        </div>
                    </div>
                </div>
            </div>
            <table class="trails-table">
                <thead>
                    <tr>
                        <th>Trail</th>
                        <th class="hide-mobile">Area</th>
                        <th>Groomed</th>
                        <th class="hide-mobile">Streak</th>
                    </tr>
                </thead>
                <tbody id="trailsBody">
                    <tr><td colspan="4"><div class="skeleton skeleton-row"></div></td></tr>
                </tbody>
            </table>
        </div>

        <!-- No Results -->
        <div class="no-results" id="noResults" style="display: none;">
            <div class="no-results-icon">🔍</div>
            <div class="no-results-text">No trails match your search</div>
        </div>
    </div>

    <div class="footer">
        <p id="update-time">Data updated daily</p>
    </div>

    <script>
        // Auto-detect resort key from URL path
        const pathParts = window.location.pathname.split('/');
        const dataIndex = pathParts.findIndex(part => part === 'data');
        const RESORT_KEY = pathParts[dataIndex + 1];
        let allTrails = [];
        let currentSort = 'name';

        // Fetch resort config to get display name
        fetch('../index.json')
            .then(r => r.json())
            .then(index => {
                const resortInfo = index.resorts[RESORT_KEY];
                if (resortInfo) {
                    const resortName = resortInfo.name;
                    document.getElementById('page-title').textContent = \`\${resortName} Trail Leaderboard\`;
                    document.getElementById('page-heading').textContent = \`\${resortName} Trails\`;
                }
            })
            .catch(err => console.warn('Could not load resort name:', err));

        // Load trail data
        fetch('trails/index.json')
            .then(r => r.json())
            .then(data => {
                allTrails = data.trails || [];
                document.getElementById('trailCount').textContent =
                    \`\${allTrails.length} trails tracked\`;
                renderLeaderboards();
                renderTrailList();
                updateFooter(data.generated);
            })
            .catch(err => {
                console.error('Error loading trails:', err);
                document.getElementById('trailCount').textContent = 'Error loading trails';
            });

        function renderLeaderboards() {
            // Most groomed (top 5 by percentage)
            const mostGroomed = [...allTrails]
                .filter(t => t.groomingPercentage > 0)
                .sort((a, b) => b.groomingPercentage - a.groomingPercentage)
                .slice(0, 5);

            const mostGroomedHtml = mostGroomed.length > 0
                ? mostGroomed.map((t, i) => renderLeaderboardItem(t, i, 'percent')).join('')
                : '<div class="leaderboard-empty">No data yet</div>';
            document.getElementById('mostGroomed').innerHTML = mostGroomedHtml;

            // Longest streak (top 5)
            const longestStreak = [...allTrails]
                .filter(t => t.longestStreak > 0)
                .sort((a, b) => b.longestStreak - a.longestStreak)
                .slice(0, 5);

            const longestStreakHtml = longestStreak.length > 0
                ? longestStreak.map((t, i) => renderLeaderboardItem(t, i, 'streak')).join('')
                : '<div class="leaderboard-empty">No data yet</div>';
            document.getElementById('longestStreak').innerHTML = longestStreakHtml;
        }

        function renderLeaderboardItem(trail, index, type) {
            const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
            const stat = type === 'percent'
                ? \`\${trail.groomingPercentage}%\`
                : \`\${trail.longestStreak} days\`;
            const link = trail.slug ? \`trail.html?name=\${encodeURIComponent(trail.slug)}\` : '#';

            return \`
                <li class="leaderboard-item">
                    <span class="leaderboard-rank \${rankClass}">\${index + 1}</span>
                    <div class="leaderboard-trail">
                        <a href="\${link}" class="leaderboard-trail-name">\${escapeHtml(trail.name)}</a>
                    </div>
                    <span class="leaderboard-stat">\${stat}</span>
                </li>
            \`;
        }

        function renderTrailList() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();

            let displayTrails = searchTerm
                ? allTrails.filter(t => t.name.toLowerCase().includes(searchTerm))
                : allTrails;

            // Sort
            if (currentSort === 'percent') {
                displayTrails = [...displayTrails].sort((a, b) => b.groomingPercentage - a.groomingPercentage);
            } else {
                displayTrails = [...displayTrails].sort((a, b) => a.name.localeCompare(b.name));
            }

            // Show/hide elements
            const noResults = document.getElementById('noResults');
            const trailListSection = document.getElementById('trailListSection');
            const leaderboardSection = document.getElementById('leaderboardSection');

            if (displayTrails.length === 0 && searchTerm) {
                noResults.style.display = 'block';
                trailListSection.style.display = 'none';
                leaderboardSection.style.display = 'none';
                return;
            } else {
                noResults.style.display = 'none';
                trailListSection.style.display = 'block';
                leaderboardSection.style.display = searchTerm ? 'none' : 'block';
            }

            const tbody = document.getElementById('trailsBody');
            tbody.innerHTML = displayTrails.map(trail => {
                const link = trail.slug ? \`trail.html?name=\${encodeURIComponent(trail.slug)}\` : '#';
                const difficulty = trail.difficulty || 'Blue';
                return \`
                    <tr>
                        <td>
                            <span class="difficulty-indicator difficulty-\${difficulty}"></span>
                            <a href="\${link}" class="trail-table-name">\${escapeHtml(trail.name)}</a>
                        </td>
                        <td class="hide-mobile trail-table-secondary">\${escapeHtml(trail.area || 'Unknown')}</td>
                        <td class="trail-table-stat">\${trail.groomingPercentage}%</td>
                        <td class="hide-mobile trail-table-secondary">\${trail.currentStreak || 0} days</td>
                    </tr>
                \`;
            }).join('');
        }

        function sortBy(type) {
            currentSort = type;
            document.getElementById('sortName').classList.toggle('active', type === 'name');
            document.getElementById('sortPercent').classList.toggle('active', type === 'percent');
            renderTrailList();
        }

        function toggleSearch() {
            const dropdown = document.getElementById('searchDropdown');
            const btn = document.getElementById('searchBtn');
            const input = document.getElementById('searchInput');

            if (dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
                btn.classList.remove('active');
            } else {
                dropdown.classList.add('show');
                btn.classList.add('active');
                input.focus();
            }
        }

        function filterTrails() {
            renderTrailList();
        }

        function clearSearch() {
            document.getElementById('searchInput').value = '';
            document.getElementById('searchDropdown').classList.remove('show');
            document.getElementById('searchBtn').classList.remove('active');
            renderTrailList();
        }

        function updateFooter(generated) {
            if (!generated) return;
            const genDate = new Date(generated);
            document.getElementById('update-time').textContent =
                \`Last updated: \${genDate.toLocaleString()}\`;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Close search on click outside
        document.addEventListener('click', function(e) {
            const wrapper = document.querySelector('.search-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                document.getElementById('searchDropdown').classList.remove('show');
                document.getElementById('searchBtn').classList.remove('active');
            }
        });
    </script>
    <script src="../pwa.js"></script>
    <script src="../debug.js"></script>

    <!-- Bottom Navigation -->
    <nav class="bottom-nav" id="bottomNav">
        <a href="grooming.html" class="nav-tab">
            <span class="nav-tab-icon">🏔️</span>
            <span class="nav-tab-label">Overview</span>
        </a>
        <a href="trails.html" class="nav-tab active">
            <span class="nav-tab-icon">🥽</span>
            <span class="nav-tab-label">Trails</span>
        </a>
        <a href="snow.html" class="nav-tab">
            <span class="nav-tab-icon">❄️</span>
            <span class="nav-tab-label">Snow</span>
        </a>
        <a href="lifts.html" class="nav-tab" id="liftsTab">
            <span class="nav-tab-icon">🚡</span>
            <span class="nav-tab-label">Lifts</span>
        </a>
    </nav>
</body>
</html>
`;
}

// Generate updated snow.html template
function generateSnowHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#2c5aa0" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#1a3a6e" media="(prefers-color-scheme: dark)">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="manifest" href="../manifest.json">
    <link rel="apple-touch-icon" href="../icons/icon.svg">
    <link rel="icon" href="../icons/icon.svg" type="image/svg+xml">
    <title id="page-title">Snow Report</title>
    <link rel="stylesheet" href="../styles.css">
    <style>
        .snow-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .snow-card {
            background: var(--bg-secondary);
            border-radius: 12px;
            padding: 25px;
            box-shadow: var(--shadow-sm);
            border-left: 5px solid var(--accent-primary);
        }
        .snow-card h3 {
            margin: 0 0 15px 0;
            color: var(--accent-primary);
            font-size: 1.1em;
        }
        .snow-value {
            font-size: 2.5em;
            font-weight: bold;
            color: var(--accent-primary);
            margin: 10px 0;
        }
        .snow-label {
            color: var(--text-secondary);
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .conditions {
            font-size: 1.3em;
            color: var(--accent-primary);
            font-weight: 600;
        }
        .forecast-section {
            margin-top: 40px;
        }
        .forecast-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        .forecast-card {
            background: linear-gradient(135deg, #2c5aa0 0%, #3a7bd5 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
        }
        .forecast-card h4 {
            margin: 0 0 10px 0;
            font-size: 1em;
            opacity: 0.9;
        }
        .forecast-temp {
            font-size: 2em;
            font-weight: bold;
            margin: 10px 0;
        }
        .forecast-temp-range {
            font-size: 0.9em;
            opacity: 0.85;
        }
        .last-updated {
            text-align: center;
            color: var(--text-secondary);
            font-size: 0.9em;
            margin: 30px 0;
        }
        .metric-toggle {
            text-align: center;
            margin: 20px 0;
        }
        .metric-toggle button {
            background: var(--accent-primary);
            color: white;
            border: none;
            padding: 8px 20px;
            border-radius: 20px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
        }
        .metric-toggle button:hover {
            background: var(--accent-hover);
        }
        .metric-toggle button:active {
            transform: scale(0.96);
        }
    </style>
</head>
<body class="has-bottom-nav">
    <!-- Pull-to-refresh indicator -->
    <div class="pull-indicator" id="pullIndicator">
        <div class="pull-spinner"></div>
    </div>

    <div class="header">
        <div class="header-content">
            <h1 id="page-heading">Snow Report</h1>
            <div class="date-nav" id="dateNav">
                <div class="date-controls">
                    <button class="nav-btn" id="prevBtn" onclick="navigateDate(-1)" aria-label="Previous day">
                        <span class="nav-text-short">‹</span>
                        <span class="nav-text-full">← Previous</span>
                    </button>
                    <span class="date-display" id="dateDisplay" onclick="openDatePicker()" tabindex="0" role="button" aria-label="Select date">Loading...</span>
                    <button class="nav-btn" id="nextBtn" onclick="navigateDate(1)" aria-label="Next day">
                        <span class="nav-text-short">›</span>
                        <span class="nav-text-full">Next →</span>
                    </button>
                </div>
                <input type="date" id="datePicker" onchange="selectDate()" aria-label="Date picker">
            </div>
        </div>
    </div>

    <div class="container">
        <div class="metric-toggle">
            <button onclick="toggleMetric()" id="metricToggle">Switch to Metric (cm/°C)</button>
        </div>
        <div id="content">
            <div class="skeleton-container">
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
            </div>
        </div>
    </div>

    <div class="footer">
        <p><a href="#" id="rawJsonLink" target="_blank">View Raw JSON Data</a></p>
        <p id="update-time">Data updated daily</p>
    </div>

    <script>
        // Auto-detect resort key from URL path
        const pathParts = window.location.pathname.split('/');
        const dataIndex = pathParts.findIndex(part => part === 'data');
        const RESORT_KEY = pathParts[dataIndex + 1];
        const DATA_PATH = 'snow';
        let currentDate = null;
        let useMetric = false;
        let snowData = null;

        // Fetch resort config to get display name
        fetch('../index.json')
            .then(r => r.json())
            .then(index => {
                const resortInfo = index.resorts[RESORT_KEY];
                if (resortInfo) {
                    const resortName = resortInfo.name;
                    document.getElementById('page-title').textContent = \`\${resortName} Snow Report\`;
                    document.getElementById('page-heading').textContent = \`\${resortName} Snow Report\`;
                }
            })
            .catch(err => console.warn('Could not load resort name:', err));

        function formatDate(dateStr) {
            const date = new Date(dateStr + 'T12:00:00');
            return date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }

        function toggleMetric() {
            useMetric = !useMetric;
            document.getElementById('metricToggle').textContent =
                useMetric ? 'Switch to Imperial (in/°F)' : 'Switch to Metric (cm/°C)';
            if (snowData) {
                renderSnowData(snowData);
            }
            if (typeof hapticFeedback === 'function') {
                hapticFeedback('light');
            }
        }

        function renderSnowData(data) {
            snowData = data;
            const content = document.getElementById('content');

            const snowfall = data.snowfall || {};
            const baseDepth = data.baseDepth || {};
            const conditions = data.conditions || 'Unknown';

            let html = \`
                <div class="snow-grid stagger-fade-in">
                    <div class="snow-card">
                        <h3>Conditions</h3>
                        <div class="conditions">\${conditions}</div>
                    </div>
                    <div class="snow-card">
                        <div class="snow-label">Base Depth</div>
                        <div class="snow-value">\${useMetric ? baseDepth.cm : baseDepth.inches}\${useMetric ? 'cm' : '"'}</div>
                    </div>
                    <div class="snow-card">
                        <div class="snow-label">24 Hour</div>
                        <div class="snow-value">\${useMetric ? snowfall['24hour_cm'] : snowfall['24hour_inches']}\${useMetric ? 'cm' : '"'}</div>
                    </div>
                    <div class="snow-card">
                        <div class="snow-label">7 Day</div>
                        <div class="snow-value">\${useMetric ? snowfall['7day_cm'] : snowfall['7day_inches']}\${useMetric ? 'cm' : '"'}</div>
                    </div>
                    <div class="snow-card">
                        <div class="snow-label">Season Total</div>
                        <div class="snow-value">\${useMetric ? snowfall.season_total_cm : snowfall.season_total_inches}\${useMetric ? 'cm' : '"'}</div>
                    </div>
                </div>
            \`;

            if (data.forecast && data.forecast.locations && data.forecast.locations.length > 0) {
                html += '<div class="forecast-section"><h2>Weather Forecast</h2><div class="forecast-grid stagger-fade-in">';

                data.forecast.locations.forEach((location, idx) => {
                    if (location.today) {
                        const t = location.today;
                        const high = useMetric ? t.high_c : t.high_f;
                        const low = useMetric ? t.low_c : t.low_f;
                        const unit = useMetric ? '°C' : '°F';

                        html += \`
                            <div class="forecast-card">
                                <h4>\${location.name !== 'Unknown' ? location.name : \`Location \${idx + 1}\`}</h4>
                                <div class="forecast-temp">\${high}\${unit}</div>
                                <div class="forecast-temp-range">Low: \${low}\${unit}</div>
                                <div style="margin-top: 15px; opacity: 0.9;">\${t.description || ''}</div>
                                \${t.wind ? \`<div style="margin-top: 8px; font-size: 0.9em; opacity: 0.85;">Wind: \${t.wind} \${t.wind_speed ? Math.round(t.wind_speed) + ' mph' : ''}</div>\` : ''}
                            </div>
                        \`;
                    }
                });

                html += '</div></div>';
            }

            if (data.lastUpdated) {
                html += \`<div class="last-updated">Last Updated: \${data.lastUpdated}</div>\`;
            }

            content.innerHTML = html;
        }

        async function loadData(dateStr) {
            try {
                const url = \`../\${RESORT_KEY}/\${DATA_PATH}/\${dateStr}.json\`;
                document.getElementById('rawJsonLink').href = url;

                const response = await fetch(url);
                if (!response.ok) throw new Error('Data not found');

                const data = await response.json();
                renderSnowData(data);

                document.getElementById('dateDisplay').textContent = formatDate(dateStr);
                currentDate = dateStr;

                document.getElementById('prevBtn').disabled = false;
                document.getElementById('nextBtn').disabled = dateStr >= new Date().toISOString().split('T')[0];
            } catch (error) {
                document.getElementById('content').innerHTML =
                    \`<div class="error">No data available for \${formatDate(dateStr)}</div>\`;
            }
        }

        function navigateDate(offset) {
            const date = new Date(currentDate + 'T12:00:00');
            date.setDate(date.getDate() + offset);
            const newDate = date.toISOString().split('T')[0];
            loadData(newDate);
            if (typeof hapticFeedback === 'function') {
                hapticFeedback('light');
            }
        }

        function openDatePicker() {
            const picker = document.getElementById('datePicker');
            picker.value = currentDate;
            if (picker.showPicker) picker.showPicker();
        }

        function selectDate() {
            const selected = document.getElementById('datePicker').value;
            if (selected) loadData(selected);
        }

        // Load latest data on page load
        fetch(\`../\${RESORT_KEY}/\${DATA_PATH}/latest.json\`)
            .then(r => r.json())
            .then(data => {
                currentDate = data.date;
                loadData(currentDate);
            })
            .catch(() => {
                const today = new Date().toISOString().split('T')[0];
                loadData(today);
            });
    </script>
    <script src="../pwa.js"></script>
    <script src="../debug.js"></script>

    <!-- Bottom Navigation -->
    <nav class="bottom-nav" id="bottomNav">
        <a href="grooming.html" class="nav-tab">
            <span class="nav-tab-icon">🏔️</span>
            <span class="nav-tab-label">Overview</span>
        </a>
        <a href="trails.html" class="nav-tab">
            <span class="nav-tab-icon">🥽</span>
            <span class="nav-tab-label">Trails</span>
        </a>
        <a href="snow.html" class="nav-tab active">
            <span class="nav-tab-icon">❄️</span>
            <span class="nav-tab-label">Snow</span>
        </a>
        <a href="lifts.html" class="nav-tab" id="liftsTab">
            <span class="nav-tab-icon">🚡</span>
            <span class="nav-tab-label">Lifts</span>
        </a>
    </nav>
</body>
</html>
`;
}

// Generate updated lifts.html template
function generateLiftsHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#2c5aa0" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#1a3a6e" media="(prefers-color-scheme: dark)">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="manifest" href="../manifest.json">
    <link rel="apple-touch-icon" href="../icons/icon.svg">
    <link rel="icon" href="../icons/icon.svg" type="image/svg+xml">
    <title id="page-title">Lift Status</title>
    <link rel="stylesheet" href="../styles.css">
    <style>
        .lift-stat-large {
            font-size: 3rem;
            font-weight: bold;
            text-align: center;
            padding: 1rem 0;
            color: var(--accent-primary);
        }
        .lift-stat-open { color: #22c55e; }
        .lift-stat-closed { color: #ef4444; }
        .lift-area-section { margin-bottom: 2rem; }
        .lift-area-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: var(--text-primary);
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 0.5rem;
        }
        .lifts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1rem;
        }
        .lift-card {
            background: var(--bg-secondary);
            border: 2px solid var(--border-color);
            border-radius: 12px;
            padding: 1rem;
            text-decoration: none;
            color: var(--text-primary);
            transition: all 0.2s ease;
            display: block;
        }
        .lift-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            border-color: var(--accent-primary);
        }
        .lift-card:active {
            transform: scale(0.98);
        }
        .lift-card.lift-open { border-left: 4px solid #22c55e; }
        .lift-card.lift-closed { border-left: 4px solid #ef4444; opacity: 0.7; }
        .lift-card-header {
            display: flex;
            align-items: flex-start;
            gap: 0.5rem;
            margin-bottom: 0.75rem;
        }
        .lift-status-icon { font-size: 1.25rem; flex-shrink: 0; }
        .lift-card-name { font-weight: 600; font-size: 1rem; line-height: 1.3; }
        .lift-card-details {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            font-size: 0.875rem;
            color: var(--text-secondary);
        }
        .lift-card-type { font-weight: 500; }
        .lift-card-wait { color: var(--accent-primary); font-weight: 600; }
        .lift-card-hours { font-size: 0.8rem; }
        .historical-notice {
            background: var(--badge-new);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            text-align: center;
            margin-bottom: 20px;
            font-weight: 500;
        }
    </style>
</head>
<body class="has-bottom-nav">
    <!-- Pull-to-refresh indicator -->
    <div class="pull-indicator" id="pullIndicator">
        <div class="pull-spinner"></div>
    </div>

    <div class="header">
        <div class="header-content">
            <h1 id="page-heading">Lift Status</h1>
            <p class="trails-subtitle" id="liftCount">Loading lifts...</p>
        </div>
    </div>

    <div class="container">
        <!-- Historical Notice (hidden by default) -->
        <div id="historicalNotice" class="historical-notice" style="display: none;">
            Lift wait times are not available for previous days
        </div>

        <!-- Overview Stats -->
        <div class="leaderboard-section" id="statsSection">
            <div class="leaderboard-grid">
                <div class="leaderboard-card">
                    <div class="leaderboard-title">
                        <span class="leaderboard-icon">🚡</span>
                        Total Lifts
                    </div>
                    <div class="lift-stat-large" id="totalLifts">-</div>
                </div>
                <div class="leaderboard-card">
                    <div class="leaderboard-title">
                        <span class="leaderboard-icon">✅</span>
                        Currently Open
                    </div>
                    <div class="lift-stat-large lift-stat-open" id="openLifts">-</div>
                </div>
                <div class="leaderboard-card">
                    <div class="leaderboard-title">
                        <span class="leaderboard-icon">⛔</span>
                        Currently Closed
                    </div>
                    <div class="lift-stat-large lift-stat-closed" id="closedLifts">-</div>
                </div>
            </div>
        </div>

        <!-- Lifts by Area -->
        <div class="trail-list-section" id="liftListSection">
            <div class="trail-list-header">
                <span class="trail-list-title">Lifts by Area</span>
                <div class="sort-controls">
                    <div class="search-wrapper">
                        <button class="search-btn" id="searchBtn" onclick="toggleSearch()">🔍</button>
                        <div class="search-dropdown" id="searchDropdown">
                            <input type="text" class="search-input" id="searchInput" placeholder="Search lifts..." oninput="filterLifts()">
                            <button class="search-clear" id="searchClear" onclick="clearSearch()">×</button>
                        </div>
                    </div>
                </div>
            </div>
            <div id="liftsByArea">
                <div class="skeleton-container">
                    <div class="skeleton skeleton-card"></div>
                    <div class="skeleton skeleton-card"></div>
                </div>
            </div>
        </div>

        <!-- No Results -->
        <div class="no-results" id="noResults" style="display: none;">
            <div class="no-results-icon">🔍</div>
            <div class="no-results-text">No lifts match your search</div>
        </div>
    </div>

    <div class="footer">
        <p id="update-time">Data updated every 4 minutes</p>
    </div>

    <script>
        // Auto-detect resort key from URL path
        const pathParts = window.location.pathname.split('/');
        const dataIndex = pathParts.findIndex(part => part === 'data');
        const RESORT_KEY = pathParts[dataIndex + 1];

        let allLifts = [];

        // Fetch resort config to get display name
        fetch('../index.json')
            .then(r => r.json())
            .then(index => {
                const resortInfo = index.resorts[RESORT_KEY];
                if (resortInfo) {
                    const resortName = resortInfo.name;
                    document.getElementById('page-title').textContent = \`\${resortName} Lift Status\`;
                    document.getElementById('page-heading').textContent = \`\${resortName} Lifts\`;
                }
            })
            .catch(err => console.warn('Could not load resort name:', err));

        // Load lift data
        fetch(\`lifts/index.json\`)
            .then(r => r.json())
            .then(data => {
                allLifts = data.lifts || [];
                document.getElementById('liftCount').textContent =
                    \`\${allLifts.length} lifts tracked\`;
                renderStats();
                renderLiftsByArea();
                updateFooter(data.generated);
            })
            .catch(err => {
                console.error('Error loading lifts:', err);
                document.getElementById('liftCount').textContent = 'No lift data available';
                document.getElementById('liftsByArea').innerHTML =
                    '<div class="error">Lift data is not available for this resort.</div>';
            });

        function renderStats() {
            const openLifts = allLifts.filter(l => l.status === 'Open').length;
            const closedLifts = allLifts.filter(l => l.status === 'Closed').length;

            document.getElementById('totalLifts').textContent = allLifts.length;
            document.getElementById('openLifts').textContent = openLifts;
            document.getElementById('closedLifts').textContent = closedLifts;
        }

        function renderLiftsByArea() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();

            let displayLifts = searchTerm
                ? allLifts.filter(l => l.name.toLowerCase().includes(searchTerm))
                : allLifts;

            const noResults = document.getElementById('noResults');
            const liftListSection = document.getElementById('liftListSection');
            const statsSection = document.getElementById('statsSection');

            if (displayLifts.length === 0 && searchTerm) {
                noResults.style.display = 'block';
                liftListSection.style.display = 'none';
                statsSection.style.display = 'none';
                return;
            } else {
                noResults.style.display = 'none';
                liftListSection.style.display = 'block';
                statsSection.style.display = searchTerm ? 'none' : 'block';
            }

            // Group by mountain area
            const byArea = {};
            displayLifts.forEach(lift => {
                const area = lift.mountain || 'Unknown';
                if (!byArea[area]) byArea[area] = [];
                byArea[area].push(lift);
            });

            const container = document.getElementById('liftsByArea');
            const areas = Object.keys(byArea).sort();

            if (areas.length === 0) {
                container.innerHTML = '<div class="loading">No lifts available</div>';
                return;
            }

            container.innerHTML = areas.map(area => {
                const lifts = byArea[area];
                return \`
                    <div class="lift-area-section">
                        <h3 class="lift-area-title">\${area}</h3>
                        <div class="lifts-grid stagger-fade-in">
                            \${lifts.map(lift => renderLiftCard(lift)).join('')}
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function renderLiftCard(lift) {
            const isOpen = lift.status === 'Open';
            const statusClass = isOpen ? 'lift-open' : 'lift-closed';
            const statusIcon = isOpen ? '✅' : '⛔';
            const waitDisplay = lift.waitMinutes !== null && isOpen
                ? \`\${lift.waitMinutes} min wait\`
                : (isOpen ? 'No wait data' : '');

            return \`
                <a href="lift.html?name=\${encodeURIComponent(lift.slug)}" class="lift-card \${statusClass}">
                    <div class="lift-card-header">
                        <span class="lift-status-icon">\${statusIcon}</span>
                        <div class="lift-card-name">\${lift.name}</div>
                    </div>
                    <div class="lift-card-details">
                        <div class="lift-card-type">\${formatLiftType(lift.type, lift.capacity)}</div>
                        \${waitDisplay ? \`<div class="lift-card-wait">\${waitDisplay}</div>\` : ''}
                        \${lift.openTime && lift.closeTime ? \`
                            <div class="lift-card-hours">\${lift.openTime} - \${lift.closeTime}</div>
                        \` : ''}
                    </div>
                </a>
            \`;
        }

        function formatLiftType(type, capacity) {
            const typeMap = {
                'gondola': 'Gondola',
                'quad': 'Quad Chair',
                'six': '6-Pack Chair',
                'double': 'Double Chair',
                'triple': 'Triple Chair'
            };
            const typeName = typeMap[type] || type;
            return capacity ? \`\${typeName} (\${capacity})\` : typeName;
        }

        function toggleSearch() {
            const dropdown = document.getElementById('searchDropdown');
            const btn = document.getElementById('searchBtn');
            const input = document.getElementById('searchInput');

            if (dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
                btn.classList.remove('active');
            } else {
                dropdown.classList.add('show');
                btn.classList.add('active');
                input.focus();
            }
        }

        function filterLifts() {
            renderLiftsByArea();
        }

        function clearSearch() {
            document.getElementById('searchInput').value = '';
            document.getElementById('searchDropdown').classList.remove('show');
            document.getElementById('searchBtn').classList.remove('active');
            renderLiftsByArea();
        }

        function updateFooter(generated) {
            if (!generated) return;
            const genDate = new Date(generated);
            document.getElementById('update-time').textContent =
                \`Last updated: \${genDate.toLocaleString()}\`;
        }

        // Close search on click outside
        document.addEventListener('click', function(e) {
            const wrapper = document.querySelector('.search-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                document.getElementById('searchDropdown').classList.remove('show');
                document.getElementById('searchBtn').classList.remove('active');
            }
        });
    </script>
    <script src="../pwa.js"></script>
    <script src="../debug.js"></script>

    <!-- Bottom Navigation -->
    <nav class="bottom-nav" id="bottomNav">
        <a href="grooming.html" class="nav-tab">
            <span class="nav-tab-icon">🏔️</span>
            <span class="nav-tab-label">Overview</span>
        </a>
        <a href="trails.html" class="nav-tab">
            <span class="nav-tab-icon">🥽</span>
            <span class="nav-tab-label">Trails</span>
        </a>
        <a href="snow.html" class="nav-tab">
            <span class="nav-tab-icon">❄️</span>
            <span class="nav-tab-label">Snow</span>
        </a>
        <a href="lifts.html" class="nav-tab active" id="liftsTab">
            <span class="nav-tab-icon">🚡</span>
            <span class="nav-tab-label">Lifts</span>
        </a>
    </nav>
</body>
</html>
`;
}

// Main function
function main() {
  const resorts = getResortDirs();
  console.log(`Found ${resorts.length} resort directories`);

  let updated = 0;
  let errors = 0;

  for (const resort of resorts) {
    const resortDir = path.join(DATA_DIR, resort);

    try {
      // Update grooming.html
      const groomingPath = path.join(resortDir, 'grooming.html');
      fs.writeFileSync(groomingPath, generateGroomingHtml(resort));

      // Update trails.html
      const trailsPath = path.join(resortDir, 'trails.html');
      fs.writeFileSync(trailsPath, generateTrailsHtml());

      // Update snow.html
      const snowPath = path.join(resortDir, 'snow.html');
      fs.writeFileSync(snowPath, generateSnowHtml());

      // Update lifts.html
      const liftsPath = path.join(resortDir, 'lifts.html');
      fs.writeFileSync(liftsPath, generateLiftsHtml());

      console.log(`✓ Updated ${resort}`);
      updated++;
    } catch (err) {
      console.error(`✗ Error updating ${resort}:`, err.message);
      errors++;
    }
  }

  console.log(`\nDone! Updated ${updated} resorts, ${errors} errors.`);
}

main();
