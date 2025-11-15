// Shared JavaScript for resort grooming reports
// This file should be included after setting RESORT_KEY in the HTML file

let availableDates = [];
let currentDateIndex = 0;
let yesterdayData = null;

async function loadIndex() {
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
        } else {
            showError('No data available for this resort.');
        }
    } catch (error) {
        showError('Failed to load data index: ' + error.message);
    }
}

async function loadDate(date) {
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
        loadWeatherData();

        // Update raw JSON link
        document.getElementById('rawJsonLink').href = filePath;
    } catch (error) {
        showError(`Failed to load data for ${date}: ${error.message}`);
    }
}

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

    let html = '';

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

            html += `<li class="trail-item">`;
            html += `<span class="difficulty-indicator difficulty-${difficulty}"></span>`;
            html += `<span class="trail-name">${escapeHtml(trail.Name)}</span>`;
            html += `<span class="trail-status">`;
            html += `<span class="groomed-badge">✓ Groomed</span>`;
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

    if (html === '') {
        content.innerHTML = '<div class="error">No groomed trails found for this date.</div>';
    } else {
        content.innerHTML = html;
    }
}

function updateNavigation(date) {
    // Update date display
    const dateObj = new Date(date + 'T00:00:00');
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('dateDisplay').textContent = dateObj.toLocaleDateString('en-US', options);

    // Update date picker
    document.getElementById('datePicker').value = date;

    // Update prev/next buttons
    // Previous = go back in time (older, higher index)
    // Next = go forward in time (newer, lower index)
    document.getElementById('prevBtn').disabled = currentDateIndex === availableDates.length - 1;
    document.getElementById('nextBtn').disabled = currentDateIndex === 0;
}

function navigateDate(direction) {
    // direction: -1 = previous (back in time, older, higher index)
    // direction: +1 = next (forward in time, newer, lower index)
    const newIndex = currentDateIndex - direction;
    if (newIndex >= 0 && newIndex < availableDates.length) {
        currentDateIndex = newIndex;
        loadDate(availableDates[currentDateIndex]);
    }
}

function selectDate() {
    const selectedDate = document.getElementById('datePicker').value;
    const index = availableDates.indexOf(selectedDate);
    if (index !== -1) {
        currentDateIndex = index;
        loadDate(availableDates[currentDateIndex]);
    }
}

function openDatePicker() {
    const datePicker = document.getElementById('datePicker');
    datePicker.showPicker();
}

function showError(message) {
    document.getElementById('content').innerHTML =
        `<div class="error"><strong>Error:</strong> ${escapeHtml(message)}</div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function loadWeatherData() {
    try {
        const response = await fetch(`../${RESORT_KEY}/snow/latest.json`);
        if (!response.ok) {
            // No weather data available for this resort
            hideWeatherWidget();
            return;
        }
        const data = await response.json();
        displayWeatherWidget(data);
    } catch (error) {
        // Silently hide weather widget if data not available
        hideWeatherWidget();
    }
}

function displayWeatherWidget(data) {
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

    const html = `
        <div class="weather-summary">
            <div class="weather-item">
                <div class="weather-label">Conditions</div>
                <div class="weather-value">${escapeHtml(conditions)}</div>
            </div>
            <div class="weather-item">
                <div class="weather-label">Base Depth</div>
                <div class="weather-value">${escapeHtml(baseDepth)}</div>
            </div>
            <div class="weather-item">
                <div class="weather-label">24hr Snow</div>
                <div class="weather-value">${escapeHtml(snowfall24h)}</div>
            </div>
            <div class="weather-item">
                <div class="weather-label">Today</div>
                <div class="weather-value">${escapeHtml(todayDesc)}</div>
            </div>
            <div class="weather-item">
                <div class="weather-label">High/Low</div>
                <div class="weather-value">${escapeHtml(todayHigh)} / ${escapeHtml(todayLow)}</div>
            </div>
        </div>
        <a href="snow.html" class="weather-link">View Full Snow Report →</a>
    `;

    widget.innerHTML = html;
    widget.style.display = 'block';
}

function hideWeatherWidget() {
    const widget = document.getElementById('weatherWidget');
    if (widget) {
        widget.style.display = 'none';
    }
}

// Allow Enter/Space to trigger date picker when focused
document.addEventListener('DOMContentLoaded', () => {
    const dateDisplay = document.getElementById('dateDisplay');
    dateDisplay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDatePicker();
        }
    });

    // Initialize on page load
    loadIndex();
});
