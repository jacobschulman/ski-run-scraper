// lift.js - Client-side rendering for lift-specific pages

// Get lift slug from URL parameter
const urlParams = new URLSearchParams(window.location.search);
const liftSlug = urlParams.get('name');

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
 * Format timestamp for display
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Get lift type badge HTML
 */
function getLiftTypeBadge(type, capacity) {
  const typeMap = {
    'gondola': 'Gondola',
    'quad': 'Quad Chair',
    'six': '6-Pack Chair',
    'double': 'Double Chair',
    'triple': 'Triple Chair'
  };
  const typeName = typeMap[type] || type;
  const displayText = capacity ? `${typeName} (${capacity})` : typeName;
  return `<span class="lift-type-badge">${displayText}</span>`;
}

/**
 * Get status badge HTML
 */
function getStatusBadge(status) {
  if (status === 'Open') {
    return '<span class="status-badge status-open">Open</span>';
  }
  return '<span class="status-badge status-closed">Closed</span>';
}

/**
 * Get wait time display HTML
 */
function getWaitTimeDisplay(waitMinutes) {
  if (waitMinutes === null || waitMinutes === undefined) {
    return '<div class="wait-time-display wait-time-none">No wait data</div>';
  }

  let className = 'wait-time-display';
  let emoji = '✅';

  if (waitMinutes === 0) {
    className += ' wait-time-none';
    emoji = '🎿';
  } else if (waitMinutes <= 5) {
    className += ' wait-time-short';
    emoji = '✅';
  } else if (waitMinutes <= 10) {
    className += ' wait-time-medium';
    emoji = '⏱️';
  } else {
    className += ' wait-time-long';
    emoji = '⏳';
  }

  return `
    <div class="${className}">
      <span class="wait-time-icon">${emoji}</span>
      <span class="wait-time-value">${waitMinutes}</span>
      <span class="wait-time-label">minute${waitMinutes !== 1 ? 's' : ''}</span>
    </div>
  `;
}

/**
 * Generate wait time history chart
 */
function getWaitTimeHistoryChart(history) {
  if (!history || history.length === 0) {
    return '<div class="chart-empty">No historical data available</div>';
  }

  // Show last 14 days
  const recentHistory = history.slice(0, 14).reverse();

  let html = '<div class="wait-time-chart">';

  recentHistory.forEach(day => {
    const avgWait = day.avgWaitTime !== null ? day.avgWaitTime : 0;
    const maxHeight = 60; // minutes
    const barHeight = Math.min((avgWait / maxHeight) * 100, 100);
    const wasOpen = day.wasOpen;

    let barClass = 'wait-bar';
    if (!wasOpen) {
      barClass += ' wait-bar-closed';
    } else if (avgWait <= 5) {
      barClass += ' wait-bar-short';
    } else if (avgWait <= 10) {
      barClass += ' wait-bar-medium';
    } else {
      barClass += ' wait-bar-long';
    }

    const label = day.avgWaitTime !== null
      ? `${day.avgWaitTime} min avg`
      : (wasOpen ? 'Open' : 'Closed');

    html += `
      <div class="wait-bar-container">
        <div class="${barClass}" style="height: ${barHeight}%"
             title="${formatDate(day.date)}: ${label}">
        </div>
        <div class="wait-bar-label">${formatDate(day.date).split(',')[0]}</div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

/**
 * Generate operating hours display
 */
function getOperatingHoursDisplay(openTime, closeTime) {
  if (!openTime || !closeTime) {
    return '<div class="hours-display">Hours not available</div>';
  }

  return `
    <div class="hours-display">
      <div class="hours-row">
        <span class="hours-label">Opens:</span>
        <span class="hours-value">${openTime}</span>
      </div>
      <div class="hours-row">
        <span class="hours-label">Closes:</span>
        <span class="hours-value">${closeTime}</span>
      </div>
    </div>
  `;
}

/**
 * Render lift page
 */
function renderLiftPage(liftData) {
  const content = document.getElementById('content');

  // Update page title and heading
  document.getElementById('page-title').textContent =
    `${liftData.liftName} - ${liftData.resortName}`;
  document.getElementById('page-heading').textContent =
    `🚡 ${liftData.liftName}`;

  // Update subtitle
  const subtitle = document.getElementById('liftSubtitle');
  if (subtitle) {
    subtitle.innerHTML = `
      ${getLiftTypeBadge(liftData.type, liftData.capacity)}
      <span class="trail-area">${liftData.mountain}</span>
    `;
  }

  // Build main content
  const stats = liftData.stats;
  const current = liftData.currentStatus;
  const isOpen = current.status === 'Open';

  const html = `
    <div class="trail-content">
      <!-- Current Status Card -->
      <div class="stats-card">
        <h2>Current Status</h2>
        <div class="current-status">
          ${getStatusBadge(current.status)}
          ${isOpen ? getWaitTimeDisplay(current.waitMinutes) : ''}
          <div class="status-details">
            <div class="status-row">
              <span class="label">Last Updated:</span>
              <span class="value">${formatTimestamp(current.timestamp)}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Operating Hours Card -->
      <div class="stats-card">
        <h2>Operating Hours</h2>
        ${getOperatingHoursDisplay(current.openTime, current.closeTime)}
      </div>

      <!-- Wait Time Statistics Card -->
      <div class="stats-card">
        <h2>Wait Time Statistics</h2>
        <div class="season-stats">
          <div class="stat-item">
            <div class="stat-value">${stats.avgWaitTime !== null ? stats.avgWaitTime + ' min' : '—'}</div>
            <div class="stat-label">Average Wait</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${stats.minWaitTime !== null ? stats.minWaitTime + ' min' : '—'}</div>
            <div class="stat-label">Minimum Wait</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${stats.maxWaitTime !== null ? stats.maxWaitTime + ' min' : '—'}</div>
            <div class="stat-label">Maximum Wait</div>
          </div>
        </div>
        <div class="season-info">
          Based on ${stats.totalRecords} measurements over ${stats.daysTracked} day${stats.daysTracked !== 1 ? 's' : ''}
        </div>
      </div>

      <!-- Wait Time History Chart -->
      <div class="stats-card">
        <h2>Average Wait Times (Last 14 Days)</h2>
        <div class="chart-subtitle">Daily average wait times</div>
        ${getWaitTimeHistoryChart(liftData.history)}
      </div>

      <!-- Lift Info Card -->
      <div class="stats-card trail-info-card">
        <h2>Lift Information</h2>
        <div class="trail-info-grid">
          <div class="info-row">
            <span class="label">Lift Name:</span>
            <span class="value">${liftData.liftName}</span>
          </div>
          <div class="info-row">
            <span class="label">Location:</span>
            <span class="value">${liftData.mountain}</span>
          </div>
          <div class="info-row">
            <span class="label">Type:</span>
            <span class="value">${liftData.type}</span>
          </div>
          <div class="info-row">
            <span class="label">Capacity:</span>
            <span class="value">${liftData.capacity || 'Unknown'}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  content.innerHTML = html;

  // Update footer
  const updateTime = document.getElementById('update-time');
  if (updateTime && liftData.generated) {
    const genDate = new Date(liftData.generated);
    updateTime.textContent = `Last updated: ${genDate.toLocaleString()}`;
  }
}

/**
 * Load and render lift data
 */
function loadLiftData() {
  if (!liftSlug) {
    document.getElementById('content').innerHTML = `
      <div class="error">
        <h2>Lift Not Specified</h2>
        <p>Please provide a lift name in the URL (e.g., ?name=gondola-one)</p>
        <p><a href="lifts.html">← Return to Lift Status</a></p>
      </div>
    `;
    return;
  }

  const liftDataUrl = `lifts/data/${liftSlug}.json`;

  fetch(liftDataUrl)
    .then(response => {
      if (!response.ok) {
        throw new Error('Lift not found');
      }
      return response.json();
    })
    .then(liftData => {
      renderLiftPage(liftData);
    })
    .catch(error => {
      console.error('Error loading lift data:', error);
      document.getElementById('content').innerHTML = `
        <div class="error">
          <h2>Lift Not Found</h2>
          <p>Could not load data for lift "${liftSlug}"</p>
          <p>Error: ${error.message}</p>
          <p><a href="lifts.html">← Return to Lift Status</a></p>
        </div>
      `;
    });
}

// Load lift data when page loads
loadLiftData();
