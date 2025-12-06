// Shared JavaScript for resort grooming reports
// This file should be included after pwa.js and debug.js

let availableDates = [];
let currentDateIndex = 0;
let yesterdayData = null;
let currentDate = null;

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
                <div class="skeleton skeleton-card"></div>
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

        const data = await response.json();

        // Load yesterday's data for comparison
        const dateIdx = availableDates.indexOf(date);
        if (dateIdx < availableDates.length - 1) {
            const yesterdayDate = availableDates[dateIdx + 1];
            try {
                const yResponse = await fetch(`../${RESORT_KEY}/terrain/${yesterdayDate}.json`);
                yesterdayData = await yResponse.json();
            } catch {
                yesterdayData = null;
            }
        } else {
            yesterdayData = null;
        }

        renderData(data, date);
        updateNavigation(date);

        // Load weather for the selected date (not just latest)
        loadWeatherData(date);
    } catch (error) {
        showError(`Failed to load data for ${date}: ${error.message}`);
    }
}

/**
 * Render the grooming data
 */
function renderData(data, date) {
    const content = document.getElementById('content');

    if (!data.GroomingAreas || data.GroomingAreas.length === 0) {
        content.innerHTML = '<div class="error">No grooming data available for this date.</div>';
        return;
    }

    // Get set of groomed trails from yesterday
    const yesterdayGroomed = new Set();
    if (yesterdayData && yesterdayData.GroomingAreas) {
        yesterdayData.GroomingAreas.forEach(area => {
            area.Trails.forEach(trail => {
                if (trail.IsGroomed) {
                    yesterdayGroomed.add(trail.Id);
                }
            });
        });
    }

    let html = '<div class="stagger-fade-in">';

    data.GroomingAreas.forEach(area => {
        if (!area.Trails || area.Trails.length === 0) return;

        // Filter to only groomed trails
        const groomedTrails = area.Trails.filter(t => t.IsGroomed);
        if (groomedTrails.length === 0) return;

        html += `<div class="area-section">`;
        html += `<h2 class="area-title">${escapeHtml(area.Name)}</h2>`;
        html += `<ul class="trail-list">`;

        groomedTrails.forEach(trail => {
            const isNew = !yesterdayGroomed.has(trail.Id);
            const difficulty = trail.Difficulty || 'Blue';
            const trailName = escapeHtml(trail.Name);

            html += `<li class="trail-item">`;
            html += `<span class="difficulty-indicator difficulty-${difficulty}"></span>`;

            // Make trail name clickable if trail pages are available
            if (hasTrailPages()) {
                const trailSlug = slugifyTrailName(trail.Name);
                html += `<a href="trail.html?name=${encodeURIComponent(trailSlug)}" class="trail-name trail-link">${trailName}</a>`;
            } else {
                html += `<span class="trail-name">${trailName}</span>`;
            }

            html += `<span class="trail-status">`;
            html += `<span class="groomed-badge">Groomed</span>`;
            if (isNew && yesterdayData) {
                html += `<span class="new-badge">New!</span>`;
            }
            if (!trail.IsOpen) {
                html += `<span class="closed-badge">Closed</span>`;
            }
            html += `</span>`;
            html += `</li>`;
        });

        html += `</ul></div>`;
    });

    html += '</div>';

    if (html === '<div class="stagger-fade-in"></div>') {
        content.innerHTML = '<div class="error">No groomed trails found for this date.</div>';
    } else {
        content.innerHTML = html;
    }
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
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateDisplay.textContent = dateObj.toLocaleDateString('en-US', options);
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
// Weather Widget
// ============================================

/**
 * Load weather data for a specific date (or latest if not specified)
 */
async function loadWeatherData(date = null) {
    const widget = document.getElementById('weatherWidget');
    if (!widget) return;

    try {
        // Try to load date-specific weather, fall back to latest
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

        if (!response.ok) {
            hideWeatherWidget();
            return;
        }

        const data = await response.json();
        displayWeatherWidget(data, isHistorical);
    } catch (error) {
        hideWeatherWidget();
    }
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Display the weather widget
 */
function displayWeatherWidget(data, isHistorical = false) {
    const widget = document.getElementById('weatherWidget');
    if (!widget) return;

    const conditions = data.conditions || 'N/A';
    const baseDepth = data.baseDepth ? `${data.baseDepth.inches}"` : 'N/A';
    const snowfall24h = data.snowfall ? `${data.snowfall['24hour_inches']}"` : '0"';

    // Get today's forecast from first location
    let todayHigh = 'N/A';
    let todayLow = 'N/A';
    let todayDesc = 'N/A';

    if (data.forecast && data.forecast.locations && data.forecast.locations.length > 0) {
        const firstLocation = data.forecast.locations[0];
        if (firstLocation.today) {
            todayHigh = firstLocation.today.high_f ? `${firstLocation.today.high_f}°F` : 'N/A';
            todayLow = firstLocation.today.low_f ? `${firstLocation.today.low_f}°F` : 'N/A';
            todayDesc = firstLocation.today.description || 'N/A';
        }
    }

    const historicalNote = isHistorical ? ' <span style="opacity:0.7">(historical)</span>' : '';

    const html = `
        <a href="snow.html" class="weather-conditions-link">${escapeHtml(conditions)}${historicalNote} →</a>
        <div class="weather-summary-compact">
            <div class="weather-item-compact">
                <div class="weather-label">${isHistorical ? 'Weather' : 'Today'}</div>
                <div class="weather-value">${escapeHtml(todayDesc)} • ${escapeHtml(todayHigh)} / ${escapeHtml(todayLow)}</div>
            </div>
            <div class="weather-item-compact">
                <div class="weather-label">Base Depth</div>
                <div class="weather-value">${escapeHtml(baseDepth)}</div>
            </div>
            <div class="weather-item-compact">
                <div class="weather-label">24hr Snow</div>
                <div class="weather-value">${escapeHtml(snowfall24h)}</div>
            </div>
        </div>
    `;

    widget.innerHTML = html;
    widget.style.display = 'block';
}

/**
 * Hide the weather widget
 */
function hideWeatherWidget() {
    const widget = document.getElementById('weatherWidget');
    if (widget) {
        widget.style.display = 'none';
    }
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

    // Check if we should show dismiss button
    const showDismiss = typeof window.debugSettings === 'undefined' ||
                        window.debugSettings.briefDismissable !== false;

    // Build alerts HTML
    let alertsHtml = '';
    if (data.computedInsights && data.computedInsights.alerts && data.computedInsights.alerts.length > 0) {
        alertsHtml = '<div class="brief-alerts">';
        data.computedInsights.alerts.forEach(alert => {
            alertsHtml += `<span class="brief-alert-tag">${escapeHtml(alert)}</span>`;
        });
        alertsHtml += '</div>';
    }

    widget.innerHTML = `
        ${showDismiss ? '<button class="brief-dismiss" onclick="dismissBrief()" aria-label="Dismiss brief">&times;</button>' : ''}
        <div class="brief-headline">${escapeHtml(headline)}</div>
        <div class="brief-body">${escapeHtml(body)}</div>
        ${alertsHtml}
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
