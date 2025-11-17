// trail.js - Client-side rendering for trail-specific pages

// Get trail slug from URL parameter
const urlParams = new URLSearchParams(window.location.search);
const trailSlug = urlParams.get('name');

// Auto-detect resort key from URL path
const pathParts = window.location.pathname.split('/');
const dataIndex = pathParts.findIndex(part => part === 'data');
const RESORT_KEY = pathParts[dataIndex + 1];

/**
 * Format date for display
 */
function formatDate(dateString) {
  if (!dateString) return 'Never';
  const date = new Date(dateString + 'T00:00:00');
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

/**
 * Get difficulty badge HTML
 */
function getDifficultyBadge(difficulty) {
  const classes = {
    'Green': 'badge-green',
    'Blue': 'badge-blue',
    'Black': 'badge-black',
    'Double Black': 'badge-double-black'
  };
  const className = classes[difficulty] || 'badge-unknown';
  return `<span class="difficulty-badge ${className}">${difficulty}</span>`;
}

/**
 * Get status badge HTML
 */
function getStatusBadge(isOpen, isGroomed) {
  if (!isOpen) {
    return '<span class="status-badge status-closed">Closed</span>';
  }
  if (isGroomed) {
    return '<span class="status-badge status-groomed">Groomed Today</span>';
  }
  return '<span class="status-badge status-open">Open</span>';
}

/**
 * Generate streak display HTML
 */
function getStreakDisplay(currentStreak, longestStreak) {
  const streakIcon = currentStreak > 0 ? '🔥' : '❄️';
  const streakText = currentStreak > 0 ? `${currentStreak} day${currentStreak !== 1 ? 's' : ''}` : 'No streak';

  return `
    <div class="streak-display">
      <div class="streak-current">
        <span class="streak-icon">${streakIcon}</span>
        <div>
          <div class="streak-label">Current Streak</div>
          <div class="streak-value">${streakText}</div>
        </div>
      </div>
      ${longestStreak > 0 ? `
        <div class="streak-record">
          <span class="streak-icon">🏆</span>
          <div>
            <div class="streak-label">Season Record</div>
            <div class="streak-value">${longestStreak} day${longestStreak !== 1 ? 's' : ''}</div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Generate calendar heatmap HTML
 */
function getCalendarHeatmap(history, daysToShow = 90) {
  if (!history || history.length === 0) {
    return '<div class="calendar-empty">No historical data available</div>';
  }

  // Take last N days
  const records = history.slice(0, daysToShow).reverse();

  let html = '<div class="calendar-heatmap">';

  records.forEach((record, index) => {
    let cellClass = 'cal-cell';
    let tooltip = formatDate(record.date);

    if (record.isGroomed && record.isOpen) {
      cellClass += ' cal-groomed';
      tooltip += ' - Groomed & Open';
    } else if (record.isOpen) {
      cellClass += ' cal-open';
      tooltip += ' - Open (not groomed)';
    } else {
      cellClass += ' cal-closed';
      tooltip += ' - Closed';
    }

    html += `<div class="${cellClass}" title="${tooltip}"></div>`;
  });

  html += '</div>';

  // Add legend
  html += `
    <div class="calendar-legend">
      <span><span class="legend-box cal-groomed"></span> Groomed</span>
      <span><span class="legend-box cal-open"></span> Open</span>
      <span><span class="legend-box cal-closed"></span> Closed</span>
    </div>
  `;

  return html;
}

/**
 * Generate day of week stats bar chart
 */
function getDayOfWeekChart(stats) {
  if (!stats || stats.length === 0) {
    return '<div class="chart-empty">No statistics available</div>';
  }

  let html = '<div class="day-chart">';

  stats.forEach(day => {
    const barWidth = day.percentage;
    const label = day.total > 0
      ? `${day.groomed}/${day.total} (${day.percentage}%)`
      : 'No data';

    html += `
      <div class="day-row">
        <div class="day-label">${day.day}</div>
        <div class="day-bar-container">
          <div class="day-bar" style="width: ${barWidth}%"></div>
        </div>
        <div class="day-value">${label}</div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

/**
 * Render trail page
 */
function renderTrailPage(trailData) {
  const content = document.getElementById('content');

  // Update page title and heading
  document.getElementById('page-title').textContent =
    `${trailData.trailName} - ${trailData.resortName}`;
  document.getElementById('page-heading').textContent =
    `🎿 ${trailData.trailName}`;

  // Update subtitle
  const subtitle = document.getElementById('trailSubtitle');
  if (subtitle) {
    subtitle.innerHTML = `
      ${getDifficultyBadge(trailData.difficulty)}
      <span class="trail-area">${trailData.area}</span>
    `;
  }

  // Update back link
  const backLink = document.getElementById('backLink');
  if (backLink) {
    backLink.href = 'grooming.html';
  }

  // Build main content
  const stats = trailData.stats;
  const current = trailData.currentStatus;

  const html = `
    <div class="trail-content">
      <!-- Current Status Card -->
      <div class="stats-card">
        <h2>Current Status</h2>
        <div class="current-status">
          ${getStatusBadge(current.isOpen, current.isGroomed)}
          <div class="status-details">
            <div class="status-row">
              <span class="label">Last Updated:</span>
              <span class="value">${formatDate(current.date)}</span>
            </div>
            ${stats.lastGroomed ? `
              <div class="status-row">
                <span class="label">Last Groomed:</span>
                <span class="value">${formatDate(stats.lastGroomed)}</span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>

      <!-- Grooming Streaks Card -->
      <div class="stats-card">
        <h2>Grooming Streaks</h2>
        ${getStreakDisplay(stats.currentStreak, stats.longestStreak)}
      </div>

      <!-- Season Statistics Card -->
      <div class="stats-card">
        <h2>Season Statistics</h2>
        <div class="season-stats">
          <div class="stat-item">
            <div class="stat-value">${stats.groomingPercentage}%</div>
            <div class="stat-label">Grooming Rate</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${stats.daysGroomed}</div>
            <div class="stat-label">Days Groomed</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${stats.daysTracked}</div>
            <div class="stat-label">Days Tracked</div>
          </div>
        </div>
        <div class="season-info">
          Season started ${formatDate(stats.seasonStartDate)}
        </div>
      </div>

      <!-- Grooming History Calendar -->
      <div class="stats-card">
        <h2>Grooming History (Last 90 Days)</h2>
        ${getCalendarHeatmap(trailData.history, 90)}
      </div>

      <!-- Day of Week Analysis -->
      <div class="stats-card">
        <h2>Grooming by Day of Week</h2>
        <div class="chart-subtitle">How often is this trail groomed on each day?</div>
        ${getDayOfWeekChart(stats.dayOfWeek)}
      </div>

      <!-- Trail Info Card -->
      <div class="stats-card trail-info-card">
        <h2>Trail Information</h2>
        <div class="trail-info-grid">
          <div class="info-row">
            <span class="label">Trail Name:</span>
            <span class="value">${trailData.trailName}</span>
          </div>
          <div class="info-row">
            <span class="label">Area:</span>
            <span class="value">${trailData.area}</span>
          </div>
          <div class="info-row">
            <span class="label">Difficulty:</span>
            <span class="value">${trailData.difficulty}</span>
          </div>
          <div class="info-row">
            <span class="label">Type:</span>
            <span class="value">${trailData.trailType}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  content.innerHTML = html;

  // Update footer
  const updateTime = document.getElementById('update-time');
  if (updateTime && trailData.generated) {
    const genDate = new Date(trailData.generated);
    updateTime.textContent = `Last updated: ${genDate.toLocaleString()}`;
  }
}

/**
 * Load and render trail data
 */
function loadTrailData() {
  if (!trailSlug) {
    document.getElementById('content').innerHTML = `
      <div class="error">
        <h2>Trail Not Specified</h2>
        <p>Please provide a trail name in the URL (e.g., ?name=born-free)</p>
        <p><a href="grooming.html">← Return to Grooming Report</a></p>
      </div>
    `;
    return;
  }

  const trailDataUrl = `trails/data/${trailSlug}.json`;

  fetch(trailDataUrl)
    .then(response => {
      if (!response.ok) {
        throw new Error('Trail not found');
      }
      return response.json();
    })
    .then(trailData => {
      renderTrailPage(trailData);
    })
    .catch(error => {
      console.error('Error loading trail data:', error);
      document.getElementById('content').innerHTML = `
        <div class="error">
          <h2>Trail Not Found</h2>
          <p>Could not load data for trail "${trailSlug}"</p>
          <p>Error: ${error.message}</p>
          <p><a href="grooming.html">← Return to Grooming Report</a></p>
        </div>
      `;
    });
}

// Load trail data when page loads
loadTrailData();
