// Shared JavaScript for resort grooming reports
// This file should be included after pwa.js and debug.js

let availableDates = [];
let currentDateIndex = 0;
let yesterdayData = null;
let currentDate = null;
let terrainData = null;
let weatherData = null;
let liftData = null;

/**
 * Convert trail name to URL-safe slug (matches backend logic)
 */
function slugifyTrailName(name) {
    return name
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-')      // Replace spaces with hyphens
        .replace(/--+/g, '-')      // Replace multiple hyphens with single
        .trim();
}

/**
 * Check if trail pages are available for this resort
 */
function hasTrailPages() {
    // For now, only Vail has trail pages
    return RESORT_KEY === 'vail';
}

/**
 * Show skeleton loading state
 */
function showSkeletonLoading() {
    const content = document.getElementById('content');
    if (content) {
        content.innerHTML = `
            <div class="skeleton-container stagger-fade-in">
                <div class="skeleton skeleton-weather"></div>
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
            </div>
        `;
    }
}

/**
 * Load the index of available dates
 */
async function loadIndex() {
    showSkeletonLoading();

    try {
        const response = await fetch('../index.json');
        const index = await response.json();

        if (index.resorts && index.resorts[RESORT_KEY] && index.resorts[RESORT_KEY].files) {
            availableDates = index.resorts[RESORT_KEY].files
                .map(f => f.replace('.json', ''))
                .sort()
                .reverse(); // Most recent first

            currentDateIndex = 0;
            await loadDate(availableDates[currentDateIndex]);

            // Load morning brief after terrain data
            loadMorningBrief();
        } else {
            showError('No data available for this resort.');
        }
    } catch (error) {
        showError('Failed to load data index: ' + error.message);
    }
}

/**
 * Load data for a specific date
 */
async function loadDate(date) {
    currentDate = date;

    try {
        const filePath = `../${RESORT_KEY}/terrain/${date}.json`;
        const response = await fetch(filePath);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        terrainData = await response.json();

        // Load yesterday's data for comparison (actual calendar yesterday, not just previous file)
        const currentDateObj = new Date(date + 'T00:00:00');
        const yesterdayDateObj = new Date(currentDateObj);
        yesterdayDateObj.setDate(yesterdayDateObj.getDate() - 1);
        const actualYesterday = yesterdayDateObj.toISOString().split('T')[0];

        // Only use yesterday's data if we have the actual calendar yesterday
        if (availableDates.includes(actualYesterday)) {
            try {
                const yResponse = await fetch(`../${RESORT_KEY}/terrain/${actualYesterday}.json`);
                yesterdayData = await yResponse.json();
            } catch {
                yesterdayData = null;
            }
        } else {
            // No data for actual yesterday - don't show "new" badges
            yesterdayData = null;
        }

        // Load weather and lift data in parallel
        await Promise.all([
            loadWeatherData(date),
            loadLiftData()
        ]);

        renderOverview();
        updateNavigation(date);
    } catch (error) {
        showError(`Failed to load data for ${date}: ${error.message}`);
    }
}

/**
 * Load weather data for a specific date
 */
async function loadWeatherData(date = null) {
    try {
        let response;
        let isHistorical = false;

        if (date && date !== getTodayDate()) {
            response = await fetch(`../${RESORT_KEY}/snow/${date}.json`);
            isHistorical = true;
        }

        if (!response || !response.ok) {
            response = await fetch(`../${RESORT_KEY}/snow/latest.json`);
            isHistorical = false;
        }

        if (response.ok) {
            weatherData = await response.json();
            weatherData.isHistorical = isHistorical;
        } else {
            weatherData = null;
        }
    } catch (error) {
        weatherData = null;
    }
}

/**
 * Load lift data
 */
async function loadLiftData() {
    try {
        const response = await fetch(`../${RESORT_KEY}/lifts/index.json`);
        if (response.ok) {
            liftData = await response.json();
        } else {
            liftData = null;
        }
    } catch (error) {
        liftData = null;
    }
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Render the complete overview page
 */
function renderOverview() {
    const content = document.getElementById('content');

    if (!terrainData || !terrainData.GroomingAreas || terrainData.GroomingAreas.length === 0) {
        content.innerHTML = '<div class="error">No grooming data available for this date.</div>';
        return;
    }

    // Get groomed trails data
    const { groomedTrails, newlyGroomed, yesterdayGroomed } = getGroomedTrailsData();

    let html = '<div class="stagger-fade-in">';

    // 1. Snow Conditions Widget
    html += renderSnowConditionsWidget(groomedTrails.length);

    // 2. Lift Status Widget (if we have lift data)
    if (liftData && liftData.lifts && liftData.lifts.length > 0) {
        html += renderLiftStatusWidget();
    }

    // 3. Groomed Highlights Widget (if we have newly groomed trails or show top groomed)
    if (groomedTrails.length > 0) {
        html += renderGroomedHighlightsWidget(groomedTrails, newlyGroomed, yesterdayGroomed);
    }

    // Full trail list moved to trails.html page

    html += '</div>';

    content.innerHTML = html;

    // Update weather widget separately (for legacy support)
    const weatherWidget = document.getElementById('weatherWidget');
    if (weatherWidget) {
        weatherWidget.style.display = 'none';
    }
}

/**
 * Get groomed trails data
 */
function getGroomedTrailsData() {
    const groomedTrails = [];
    const newlyGroomed = [];
    const yesterdayGroomed = new Set();

    // Build set of yesterday's groomed trails
    if (yesterdayData && yesterdayData.GroomingAreas) {
        yesterdayData.GroomingAreas.forEach(area => {
            if (area.Trails) {
                area.Trails.forEach(trail => {
                    if (trail.IsGroomed) {
                        yesterdayGroomed.add(trail.Id);
                    }
                });
            }
        });
    }

    // Get today's groomed trails
    terrainData.GroomingAreas.forEach(area => {
        if (area.Trails) {
            area.Trails.forEach(trail => {
                if (trail.IsGroomed) {
                    const trailWithArea = { ...trail, areaName: area.Name };
                    groomedTrails.push(trailWithArea);
                    if (!yesterdayGroomed.has(trail.Id)) {
                        newlyGroomed.push(trailWithArea);
                    }
                }
            });
        }
    });

    return { groomedTrails, newlyGroomed, yesterdayGroomed };
}

/**
 * Render Snow Conditions Widget
 */
function renderSnowConditionsWidget(groomedCount) {
    const conditions = weatherData?.conditions || 'Unknown';
    const snowfall24h = weatherData?.snowfall?.['24hour_inches'] ?? 0;

    // Get temperature - try forecast first, then currentConditions (Canadian resorts)
    let currentTemp = '--';
    let loTemp = '--';
    let hiTemp = '--';

    if (weatherData?.forecast?.locations?.[0]?.today) {
        const today = weatherData.forecast.locations[0].today;
        hiTemp = today.high_f ?? '--';
        loTemp = today.low_f ?? '--';
        currentTemp = hiTemp; // Use high as current for now
    } else if (weatherData?.currentConditions?.temperature_f) {
        // Fallback for Canadian resorts that only have currentConditions
        currentTemp = Math.round(weatherData.currentConditions.temperature_f);
        hiTemp = currentTemp;
        loTemp = '--';
    }

    // Get lift count
    let openLifts = '--';
    let totalLifts = '--';
    if (liftData?.lifts) {
        const lifts = liftData.lifts;
        totalLifts = lifts.length;
        openLifts = lifts.filter(l => l.status === 'Open').length;
    }

    // Get trail count
    let totalTrails = 0;
    terrainData.GroomingAreas.forEach(area => {
        if (area.Trails) {
            totalTrails += area.Trails.length;
        }
    });

    const lastUpdated = weatherData?.lastUpdated || '';
    const updateTime = lastUpdated ? lastUpdated.replace('Updated ', '') : '';

    return `
        <div class="widget-card">
            <a href="snow.html" class="widget-header widget-header-link">
                <div class="widget-title-group">
                    <span class="widget-title">Snow Conditions</span>
                    <span class="widget-subtitle">${updateTime ? `Updated ${updateTime}` : 'Current conditions'}</span>
                </div>
                <span class="widget-see-all">See all →</span>
            </a>
            <div class="weather-condition-banner">${escapeHtml(conditions)}</div>
            <div class="weather-stats-grid">
                <div class="weather-stat">
                    <span class="weather-stat-value">${currentTemp}°</span>
                    <span class="weather-stat-label">Now</span>
                </div>
                <div class="weather-stat">
                    <span class="weather-stat-value">${loTemp}°/${hiTemp}°</span>
                    <span class="weather-stat-label">Lo/Hi</span>
                </div>
                <div class="weather-stat">
                    <span class="weather-stat-value">${snowfall24h}"</span>
                    <span class="weather-stat-label">24hr</span>
                </div>
            </div>
            <div class="weather-terrain-row">
                <div class="terrain-stat">
                    <span class="terrain-stat-value">${openLifts}/${totalLifts}</span>
                    <span class="terrain-stat-label">Open Lifts</span>
                </div>
                <div class="terrain-stat">
                    <span class="terrain-stat-value">${groomedCount}/${totalTrails}</span>
                    <span class="terrain-stat-label">Groomed Trails</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Check if resort is currently within operating hours
 * Returns { isOpen: boolean, message: string }
 */
function checkOperatingHours() {
    // Only apply operating hours check if lift data has the info
    if (!liftData?.operatingHours || !liftData?.timezone) {
        return { isOpen: true, message: null };
    }

    try {
        // Get current time in resort's timezone
        const now = new Date();
        const resortTime = new Date(now.toLocaleString('en-US', { timeZone: liftData.timezone }));
        const currentHour = resortTime.getHours();
        const currentMinute = resortTime.getMinutes();
        const currentTime = currentHour * 60 + currentMinute;

        // Parse operating hours (format: "HH:MM")
        const [openHour, openMin] = liftData.operatingHours.open.split(':').map(Number);
        const [closeHour, closeMin] = liftData.operatingHours.close.split(':').map(Number);
        const openTime = openHour * 60 + openMin;
        const closeTime = closeHour * 60 + closeMin;

        if (currentTime < openTime || currentTime >= closeTime) {
            // Format times for display
            const formatTime = (h, m) => {
                const ampm = h >= 12 ? 'PM' : 'AM';
                const hour12 = h % 12 || 12;
                return m > 0 ? `${hour12}:${m.toString().padStart(2, '0')} ${ampm}` : `${hour12} ${ampm}`;
            };
            const openStr = formatTime(openHour, openMin);
            const closeStr = formatTime(closeHour, closeMin);

            return {
                isOpen: false,
                message: `Resort closed · Opens ${openStr} - ${closeStr}`
            };
        }
    } catch (e) {
        console.error('Error checking operating hours:', e);
    }

    return { isOpen: true, message: null };
}

/**
 * Render Lift Status Widget
 */
function renderLiftStatusWidget() {
    // Check if resort is within operating hours
    const hoursCheck = checkOperatingHours();

    // If resort is closed, show closed message instead of lift statuses
    if (!hoursCheck.isOpen) {
        return `
            <div class="widget-card">
                <a href="lifts.html" class="widget-header widget-header-link">
                    <div class="widget-title-group">
                        <span class="widget-title">Lift Status</span>
                        <span class="widget-subtitle">${hoursCheck.message}</span>
                    </div>
                    <span class="widget-see-all">See all →</span>
                </a>
                <div class="resort-closed-notice">
                    <span class="closed-icon">🌙</span>
                    <span class="closed-text">Lift status will update when the resort opens</span>
                </div>
            </div>
        `;
    }

    const openLifts = liftData.lifts.filter(l => l.status === 'Open');

    // Sort by wait time (longest first), then take top 3
    const sortedLifts = [...openLifts]
        .sort((a, b) => (b.waitMinutes || 0) - (a.waitMinutes || 0))
        .slice(0, 3);

    if (sortedLifts.length === 0) {
        return '';
    }

    let liftsHtml = sortedLifts.map(lift => {
        const statusClass = lift.status.toLowerCase();
        const waitMinutes = lift.waitMinutes;
        const hasWaitData = waitMinutes !== null && waitMinutes !== undefined;
        const liftUrl = lift.slug ? `lift.html?name=${encodeURIComponent(lift.slug)}` : 'lifts.html';

        // Show close time only (wait time shown in badge)
        let detailsHtml = '';
        if (lift.closeTime) {
            detailsHtml = `<span class="lift-details">Closes at ${lift.closeTime}</span>`;
        }

        return `
            <li class="lift-item">
                <a href="${liftUrl}" class="lift-item-link">
                    <span class="lift-status-dot ${statusClass}"></span>
                    <div class="lift-info">
                        <span class="lift-name">${escapeHtml(lift.name)}</span>
                        ${detailsHtml}
                    </div>
                    ${hasWaitData
                        ? `<span class="lift-wait-badge">${waitMinutes} min</span>`
                        : `<span class="lift-badge ${statusClass}">${lift.status}</span>`
                    }
                </a>
            </li>
        `;
    }).join('');

    // Format last updated time
    let lastUpdatedStr = '';
    if (liftData.generated) {
        const genDate = new Date(liftData.generated);
        lastUpdatedStr = genDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    const subtitle = lastUpdatedStr
        ? `Updated at ${lastUpdatedStr}`
        : (sortedLifts.some(l => l.waitMinutes) ? 'Sorted by longest wait' : 'Open lifts right now');

    return `
        <div class="widget-card">
            <a href="lifts.html" class="widget-header widget-header-link">
                <div class="widget-title-group">
                    <span class="widget-title">Lift Status</span>
                    <span class="widget-subtitle">${subtitle}</span>
                </div>
                <span class="widget-see-all">See all →</span>
            </a>
            <ul class="lift-list">
                ${liftsHtml}
            </ul>
        </div>
    `;
}

/**
 * Render Groomed Highlights Widget
 */
function renderGroomedHighlightsWidget(groomedTrails, newlyGroomed, yesterdayGroomed) {
    // Show newly groomed trails if available, otherwise show first few groomed trails
    const trailsToShow = newlyGroomed.length > 0 ? newlyGroomed.slice(0, 3) : groomedTrails.slice(0, 3);
    const showingNew = newlyGroomed.length > 0;

    let trailsHtml = trailsToShow.map(trail => {
        const difficulty = trail.Difficulty || 'Blue';
        const diffClass = difficulty.toLowerCase().replace('doubleblack', 'double-black');
        const isNew = !yesterdayGroomed.has(trail.Id);

        return `
            <li class="trail-item">
                <span class="difficulty-dot ${diffClass}"></span>
                <div class="trail-info">
                    ${hasTrailPages()
                        ? `<a href="trail.html?name=${encodeURIComponent(slugifyTrailName(trail.Name))}" class="trail-name trail-link">${escapeHtml(trail.Name)}</a>`
                        : `<span class="trail-name">${escapeHtml(trail.Name)}</span>`
                    }
                    <span class="trail-area">${escapeHtml(trail.areaName)}</span>
                </div>
                <div class="trail-badges">
                    <span class="badge badge-groomed">Groomed</span>
                    ${isNew && yesterdayData ? '<span class="badge badge-new">NEW</span>' : ''}
                </div>
            </li>
        `;
    }).join('');

    return `
        <div class="widget-card">
            <div class="widget-header">
                <div class="widget-title-group">
                    <span class="widget-title">Groomed Highlights</span>
                    <span class="widget-subtitle">${showingNew ? 'Freshly corduroyed runs' : 'Today\'s groomed runs'}</span>
                </div>
                <a href="trails.html" class="widget-see-all">See all →</a>
            </div>
            <ul class="trail-list">
                ${trailsHtml}
            </ul>
        </div>
    `;
}

/**
 * Render Area Sections with groomed trails
 */
function renderAreaSections(yesterdayGroomed) {
    let html = '';

    terrainData.GroomingAreas.forEach(area => {
        if (!area.Trails || area.Trails.length === 0) return;

        // Filter to only groomed trails
        const groomedTrails = area.Trails.filter(t => t.IsGroomed);
        if (groomedTrails.length === 0) return;

        let trailsHtml = groomedTrails.map(trail => {
            const isNew = !yesterdayGroomed.has(trail.Id);
            const difficulty = trail.Difficulty || 'Blue';

            return `
                <li class="trail-item">
                    <span class="difficulty-indicator difficulty-${difficulty}"></span>
                    <div class="trail-info">
                        ${hasTrailPages()
                            ? `<a href="trail.html?name=${encodeURIComponent(slugifyTrailName(trail.Name))}" class="trail-name trail-link">${escapeHtml(trail.Name)}</a>`
                            : `<span class="trail-name">${escapeHtml(trail.Name)}</span>`
                        }
                    </div>
                    <div class="trail-status">
                        <span class="groomed-badge">Groomed</span>
                        ${isNew && yesterdayData ? '<span class="new-badge">NEW</span>' : ''}
                        ${!trail.IsOpen ? '<span class="closed-badge">Closed</span>' : ''}
                    </div>
                </li>
            `;
        }).join('');

        html += `
            <div class="area-section">
                <h2 class="area-title">${escapeHtml(area.Name)}</h2>
                <ul class="trail-list">
                    ${trailsHtml}
                </ul>
            </div>
        `;
    });

    return html;
}

/**
 * Update the date navigation UI
 */
function updateNavigation(date) {
    const dateDisplay = document.getElementById('dateDisplay');
    const datePicker = document.getElementById('datePicker');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    if (dateDisplay) {
        const dateObj = new Date(date + 'T00:00:00');
        const today = getTodayDate();

        // Use short format for header (like "Sat, Dec 6")
        if (date === today) {
            dateDisplay.textContent = 'Today';
        } else {
            const options = { weekday: 'short', month: 'short', day: 'numeric' };
            dateDisplay.textContent = dateObj.toLocaleDateString('en-US', options);
        }
    }

    if (datePicker) {
        datePicker.value = date;
    }

    if (prevBtn) {
        prevBtn.disabled = currentDateIndex === availableDates.length - 1;
    }

    if (nextBtn) {
        nextBtn.disabled = currentDateIndex === 0;
    }
}

/**
 * Navigate to previous/next date
 */
function navigateDate(direction) {
    // direction: -1 = previous (back in time, older, higher index)
    // direction: +1 = next (forward in time, newer, lower index)
    const newIndex = currentDateIndex - direction;
    if (newIndex >= 0 && newIndex < availableDates.length) {
        currentDateIndex = newIndex;
        loadDate(availableDates[currentDateIndex]);

        // Haptic feedback
        if (typeof hapticFeedback === 'function') {
            hapticFeedback('light');
        }
    }
}

/**
 * Handle date picker selection
 */
function selectDate() {
    const datePicker = document.getElementById('datePicker');
    if (!datePicker) return;

    const selectedDate = datePicker.value;
    const index = availableDates.indexOf(selectedDate);
    if (index !== -1) {
        currentDateIndex = index;
        loadDate(availableDates[currentDateIndex]);
    }
}

/**
 * Open the native date picker
 */
function openDatePicker() {
    const datePicker = document.getElementById('datePicker');
    if (datePicker && datePicker.showPicker) {
        datePicker.showPicker();
    }
}

/**
 * Show error message
 */
function showError(message) {
    const content = document.getElementById('content');
    if (content) {
        content.innerHTML = `<div class="error"><strong>Error:</strong> ${escapeHtml(message)}</div>`;
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Morning Brief Widget
// ============================================

/**
 * Load and display the morning brief
 */
async function loadMorningBrief() {
    const widget = document.getElementById('briefWidget');
    if (!widget) return;

    // Check if briefs are enabled in debug settings
    if (typeof window.debugSettings !== 'undefined' && !window.debugSettings.dailyBriefs) {
        widget.style.display = 'none';
        return;
    }

    // Check if already dismissed today
    if (isBriefDismissed()) {
        widget.style.display = 'none';
        return;
    }

    try {
        const response = await fetch(`../${RESORT_KEY}/brief/latest.json`);
        if (!response.ok) {
            widget.style.display = 'none';
            return;
        }

        const data = await response.json();
        displayMorningBrief(data);
    } catch (error) {
        widget.style.display = 'none';
    }
}

/**
 * Display the morning brief widget
 */
function displayMorningBrief(data) {
    const widget = document.getElementById('briefWidget');
    if (!widget) return;

    const brief = data.morningBrief || {};
    const headline = brief.headline || 'Morning Report';
    const body = brief.body || '';

    if (!headline && !body) {
        widget.style.display = 'none';
        return;
    }

    // Check if we should show dismiss button
    const showDismiss = typeof window.debugSettings === 'undefined' ||
                        window.debugSettings.briefDismissable !== false;

    // Determine tag based on insights
    let tagHtml = '';
    if (data.computedInsights?.flags?.isPowderDay) {
        tagHtml = '<span class="brief-tag">Powder Day</span>';
    } else if (data.computedInsights?.flags?.hasFreshSnow) {
        tagHtml = '<span class="brief-tag">Fresh Snow</span>';
    }

    // Build alerts HTML
    let alertsHtml = '';
    if (data.computedInsights?.alerts?.length > 0) {
        alertsHtml = '<div class="brief-alerts">';
        data.computedInsights.alerts.forEach(alert => {
            alertsHtml += `<span class="brief-alert-tag">${escapeHtml(alert)}</span>`;
        });
        alertsHtml += '</div>';
    }

    const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    });

    widget.innerHTML = `
        ${showDismiss ? '<button class="brief-dismiss" onclick="dismissBrief()" aria-label="Dismiss brief">&times;</button>' : ''}
        <div class="brief-header">
            <div class="brief-title-group">
                <span class="brief-title">Morning Brief</span>
                <span class="brief-date">${dateStr}</span>
            </div>
            ${tagHtml}
        </div>
        <div class="brief-content">
            <div class="brief-headline">${escapeHtml(headline)}</div>
            <div class="brief-body">${escapeHtml(body)}</div>
            ${alertsHtml}
        </div>
    `;

    widget.style.display = 'block';
}

/**
 * Dismiss the morning brief
 */
function dismissBrief() {
    const widget = document.getElementById('briefWidget');
    if (widget) {
        widget.style.display = 'none';

        // Store dismissal in localStorage with today's date
        const today = getTodayDate();
        localStorage.setItem(`brief-dismissed-${RESORT_KEY}`, today);

        // Haptic feedback
        if (typeof hapticFeedback === 'function') {
            hapticFeedback('light');
        }

        // Show toast
        if (typeof showToast === 'function') {
            showToast('Brief dismissed for today', 'info', 2000);
        }
    }
}

/**
 * Check if the brief was dismissed today
 */
function isBriefDismissed() {
    const dismissedDate = localStorage.getItem(`brief-dismissed-${RESORT_KEY}`);
    const today = getTodayDate();
    return dismissedDate === today;
}

// ============================================
// Pull-to-Refresh Handler
// ============================================

/**
 * Override the refreshData function from pwa.js
 */
window.refreshData = async function() {
    if (currentDate) {
        await loadDate(currentDate);
        await loadMorningBrief();
    } else {
        await loadIndex();
    }
};

// ============================================
// Debug Settings Listener
// ============================================

window.addEventListener('debugSettingsChanged', (e) => {
    const { key, value } = e.detail;

    // Handle brief visibility changes
    if (key === 'dailyBriefs') {
        if (value) {
            loadMorningBrief();
        } else {
            const widget = document.getElementById('briefWidget');
            if (widget) widget.style.display = 'none';
        }
    }

    // Handle date picker visibility
    if (key === 'datePicker') {
        const dateNav = document.getElementById('dateNav');
        if (dateNav) {
            dateNav.style.display = value ? 'flex' : 'none';
        }
    }
});

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Setup keyboard navigation for date display
    const dateDisplay = document.getElementById('dateDisplay');
    if (dateDisplay) {
        dateDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDatePicker();
            }
        });
    }

    // Initialize on page load
    loadIndex();
});
