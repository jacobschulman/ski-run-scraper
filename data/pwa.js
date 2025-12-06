// PWA Utilities for Ski Conditions
// Handles: Service Worker, Toasts, Haptics, Pull-to-Refresh, Gestures

(function() {
  'use strict';

  // ============================================
  // Service Worker Registration
  // ============================================

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('../sw.js')
        .then((registration) => {
          console.log('[PWA] Service Worker registered:', registration.scope);

          // Check for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('Update available! Refresh to update.', 'info', 5000);
              }
            });
          });
        })
        .catch((error) => {
          console.log('[PWA] Service Worker registration failed:', error);
        });
    });
  }

  // ============================================
  // Toast Notifications
  // ============================================

  window.showToast = function(message, type = 'info', duration = 3000) {
    // Remove any existing toasts
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      info: 'ℹ️',
      success: '✓',
      warning: '⚠️',
      error: '✕'
    };

    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
    `;

    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.classList.add('toast-visible');
      });
    });

    // Auto dismiss
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);

    return toast;
  };

  // ============================================
  // Haptic Feedback
  // ============================================

  window.hapticFeedback = function(style = 'light') {
    // Try Vibration API
    if ('vibrate' in navigator) {
      const patterns = {
        light: [10],
        medium: [20],
        heavy: [40],
        success: [10, 50, 20],
        error: [50, 30, 50, 30, 50],
        selection: [5]
      };
      navigator.vibrate(patterns[style] || patterns.light);
    }
  };

  // ============================================
  // Pull-to-Refresh
  // ============================================

  let pullStartY = 0;
  let pullMoveY = 0;
  let isPulling = false;
  let pullIndicator = null;

  function initPullToRefresh() {
    pullIndicator = document.getElementById('pullIndicator');
    if (!pullIndicator) return;

    const container = document.body;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
  }

  function handleTouchStart(e) {
    if (window.scrollY === 0) {
      pullStartY = e.touches[0].pageY;
      isPulling = true;
    }
  }

  function handleTouchMove(e) {
    if (!isPulling || !pullIndicator) return;

    pullMoveY = e.touches[0].pageY;
    const pullDistance = pullMoveY - pullStartY;

    if (pullDistance > 0 && window.scrollY === 0) {
      e.preventDefault();

      const progress = Math.min(pullDistance / 80, 1);
      const translateY = Math.min(pullDistance * 0.5, 60);

      pullIndicator.style.transform = `translateY(${translateY}px)`;
      pullIndicator.style.opacity = progress;

      if (progress >= 1) {
        pullIndicator.classList.add('pull-ready');
      } else {
        pullIndicator.classList.remove('pull-ready');
      }
    }
  }

  async function handleTouchEnd() {
    if (!isPulling || !pullIndicator) return;

    const pullDistance = pullMoveY - pullStartY;
    isPulling = false;

    if (pullDistance > 80) {
      // Trigger refresh
      pullIndicator.classList.add('pull-refreshing');
      hapticFeedback('medium');

      try {
        await refreshData();
        showToast('Updated!', 'success');
      } catch (error) {
        showToast('Update failed', 'error');
      }
    }

    // Reset indicator
    pullIndicator.style.transform = 'translateY(-60px)';
    pullIndicator.style.opacity = '0';
    pullIndicator.classList.remove('pull-ready', 'pull-refreshing');

    pullStartY = 0;
    pullMoveY = 0;
  }

  // Placeholder for refresh - override in page
  window.refreshData = async function() {
    // Override this in individual pages
    location.reload();
  };

  // ============================================
  // Swipe Gestures for Date Navigation
  // ============================================

  let swipeStartX = 0;
  let swipeStartY = 0;

  function initSwipeGestures() {
    const container = document.querySelector('.container');
    if (!container) return;

    container.addEventListener('touchstart', (e) => {
      swipeStartX = e.touches[0].clientX;
      swipeStartY = e.touches[0].clientY;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      const diffX = e.changedTouches[0].clientX - swipeStartX;
      const diffY = e.changedTouches[0].clientY - swipeStartY;

      // Only trigger if horizontal swipe is dominant
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 80) {
        // Check if debug date picker is enabled
        if (typeof window.debugSettings !== 'undefined' && window.debugSettings.datePicker) {
          if (diffX > 0) {
            // Swipe right = go back (previous day)
            if (typeof navigateDate === 'function') {
              navigateDate(-1);
              hapticFeedback('light');
            }
          } else {
            // Swipe left = go forward (next day)
            if (typeof navigateDate === 'function') {
              navigateDate(1);
              hapticFeedback('light');
            }
          }
        }
      }
    }, { passive: true });
  }

  // ============================================
  // iOS Safe Area Handling
  // ============================================

  function initSafeAreas() {
    // Add CSS custom properties for safe areas
    const root = document.documentElement;

    // These are set via CSS env() but we can also access via JS if needed
    const safeAreaTop = getComputedStyle(root).getPropertyValue('--sat') || '0px';
    const safeAreaBottom = getComputedStyle(root).getPropertyValue('--sab') || '0px';

    // Add class if in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true) {
      document.body.classList.add('standalone-mode');
    }
  }

  // ============================================
  // Online/Offline Status
  // ============================================

  function initOnlineStatus() {
    function updateOnlineStatus() {
      if (navigator.onLine) {
        document.body.classList.remove('offline');
        // Don't show toast on initial load
        if (document.body.classList.contains('was-offline')) {
          showToast('Back online', 'success');
          document.body.classList.remove('was-offline');
        }
      } else {
        document.body.classList.add('offline', 'was-offline');
        showToast('You are offline', 'warning', 5000);
      }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Initial check (don't show toast)
    if (!navigator.onLine) {
      document.body.classList.add('offline');
    }
  }

  // ============================================
  // Ripple Effect for Buttons/Cards
  // ============================================

  function initRippleEffect() {
    document.addEventListener('click', (e) => {
      const target = e.target.closest('.ripple, .nav-tab, .lift-card, .leaderboard-item');
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const ripple = document.createElement('span');
      ripple.className = 'ripple-effect';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';

      target.appendChild(ripple);

      setTimeout(() => ripple.remove(), 600);
    });
  }

  // ============================================
  // Utilities
  // ============================================

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // Initialize on DOM Ready
  // ============================================

  function init() {
    initPullToRefresh();
    initSwipeGestures();
    initSafeAreas();
    initOnlineStatus();
    initRippleEffect();

    console.log('[PWA] Utilities initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
