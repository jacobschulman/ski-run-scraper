// Debug Menu for Ski Conditions PWA
// Activated via ?debug=true URL parameter

(function() {
  'use strict';

  // ============================================
  // Default Settings
  // ============================================

  const DEFAULT_SETTINGS = {
    dailyBriefs: true,         // Show morning brief widget (default ON)
    liveLiftData: true,        // Show lifts tab with real-time data (default ON)
    datePicker: false,         // Show date navigation controls
    briefDismissable: true,    // Show X button on brief (default ON)
    showIkonResorts: true,     // Include Ikon resorts in index
    showVailResorts: true,     // Include Vail resorts in index
    showIncompleteData: false  // Show resorts missing terrain/snow/lifts
  };

  const STORAGE_KEY = 'ski-debug-settings';

  // ============================================
  // Debug State
  // ============================================

  let isDebugMode = false;
  let settings = { ...DEFAULT_SETTINGS };

  // Expose settings globally
  window.debugSettings = settings;

  // ============================================
  // Initialize
  // ============================================

  function init() {
    // Check for debug mode
    const urlParams = new URLSearchParams(window.location.search);
    isDebugMode = urlParams.get('debug') === 'true';

    // Load saved settings
    loadSettings();

    // Apply settings to page
    applySettings();

    // If debug mode, show the panel trigger
    if (isDebugMode) {
      createDebugTrigger();
      setupBottomSheet();
    }

    console.log('[Debug] Mode:', isDebugMode ? 'ON' : 'OFF', 'Settings:', settings);
  }

  // ============================================
  // Settings Management
  // ============================================

  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        settings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (e) {
      console.warn('[Debug] Failed to load settings:', e);
    }
    window.debugSettings = settings;
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      window.debugSettings = settings;
    } catch (e) {
      console.warn('[Debug] Failed to save settings:', e);
    }
  }

  function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applySettings();

    // Dispatch event for other scripts to react
    window.dispatchEvent(new CustomEvent('debugSettingsChanged', {
      detail: { key, value, settings }
    }));
  }

  // ============================================
  // Apply Settings to Page
  // ============================================

  function applySettings() {
    const body = document.body;

    // Date picker visibility
    const dateNav = document.getElementById('dateNav');
    if (dateNav) {
      dateNav.style.display = settings.datePicker ? 'flex' : 'none';
    }

    // Lifts tab visibility
    const liftsTab = document.getElementById('liftsTab');
    if (liftsTab) {
      liftsTab.style.display = settings.liveLiftData ? 'flex' : 'none';
    }

    // Brief widget - handled by resort.js based on settings.dailyBriefs

    // Add CSS classes for styling hooks
    body.classList.toggle('debug-briefs-on', settings.dailyBriefs);
    body.classList.toggle('debug-lifts-on', settings.liveLiftData);
    body.classList.toggle('debug-date-on', settings.datePicker);
  }

  // ============================================
  // Debug Trigger Button
  // ============================================

  function createDebugTrigger() {
    const trigger = document.createElement('button');
    trigger.className = 'debug-trigger';
    trigger.innerHTML = '⚙';
    trigger.setAttribute('aria-label', 'Open debug menu');
    trigger.onclick = openBottomSheet;

    document.body.appendChild(trigger);
  }

  // ============================================
  // Bottom Sheet
  // ============================================

  let bottomSheet = null;
  let backdrop = null;

  function setupBottomSheet() {
    // Create backdrop
    backdrop = document.createElement('div');
    backdrop.className = 'bottom-sheet-backdrop';
    backdrop.onclick = closeBottomSheet;

    // Create bottom sheet
    bottomSheet = document.createElement('div');
    bottomSheet.className = 'bottom-sheet';
    bottomSheet.innerHTML = `
      <div class="bottom-sheet-handle" onclick="closeBottomSheet()"></div>
      <h3 class="bottom-sheet-title">Debug Settings</h3>
      <div class="debug-options">
        ${createToggle('dailyBriefs', 'Daily Briefs', 'Show morning brief widget on Overview')}
        ${createToggle('liveLiftData', 'Live Lift Data', 'Show Lifts tab with real-time wait times')}
        ${createToggle('datePicker', 'Date Picker', 'Show date navigation controls')}
        <div class="debug-divider"></div>
        ${createToggle('briefDismissable', 'Brief Dismissable', 'Show X button on morning brief')}
        <div class="debug-divider"></div>
        ${createToggle('showIkonResorts', 'Show Ikon Resorts', 'Include Ikon resorts in index')}
        ${createToggle('showVailResorts', 'Show Vail Resorts', 'Include Vail resorts in index')}
        ${createToggle('showIncompleteData', 'Show Incomplete Data', 'Show resorts missing terrain/snow/lifts')}
      </div>
      <div class="debug-footer">
        <button class="debug-reset-btn" onclick="resetDebugSettings()">Reset to Defaults</button>
        <div class="debug-version">Debug Mode Active</div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(bottomSheet);

    // Setup toggle handlers
    bottomSheet.querySelectorAll('.debug-toggle-input').forEach(input => {
      input.addEventListener('change', (e) => {
        updateSetting(e.target.dataset.key, e.target.checked);
        if (typeof hapticFeedback === 'function') {
          hapticFeedback('selection');
        }
      });
    });

    // Handle swipe down to close
    let startY = 0;
    bottomSheet.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });

    bottomSheet.addEventListener('touchmove', (e) => {
      const diff = e.touches[0].clientY - startY;
      if (diff > 50) {
        closeBottomSheet();
      }
    }, { passive: true });
  }

  function createToggle(key, label, description) {
    const checked = settings[key] ? 'checked' : '';
    return `
      <label class="debug-toggle">
        <div class="debug-toggle-info">
          <span class="debug-toggle-label">${label}</span>
          <span class="debug-toggle-desc">${description}</span>
        </div>
        <div class="debug-toggle-switch">
          <input type="checkbox" class="debug-toggle-input" data-key="${key}" ${checked}>
          <span class="debug-toggle-slider"></span>
        </div>
      </label>
    `;
  }

  window.openBottomSheet = function() {
    if (!bottomSheet || !backdrop) return;

    backdrop.classList.add('visible');
    bottomSheet.classList.add('open');

    // Update toggle states
    bottomSheet.querySelectorAll('.debug-toggle-input').forEach(input => {
      input.checked = settings[input.dataset.key];
    });

    if (typeof hapticFeedback === 'function') {
      hapticFeedback('light');
    }
  };

  window.closeBottomSheet = function() {
    if (!bottomSheet || !backdrop) return;

    backdrop.classList.remove('visible');
    bottomSheet.classList.remove('open');
  };

  window.resetDebugSettings = function() {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    applySettings();

    // Update toggles
    if (bottomSheet) {
      bottomSheet.querySelectorAll('.debug-toggle-input').forEach(input => {
        input.checked = settings[input.dataset.key];
      });
    }

    if (typeof showToast === 'function') {
      showToast('Settings reset to defaults', 'info');
    }
  };

  // ============================================
  // Utility: Check if Feature is Enabled
  // ============================================

  window.isFeatureEnabled = function(feature) {
    return settings[feature] === true;
  };

  // ============================================
  // Initialize on DOM Ready
  // ============================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
