/**
 * PlexMCP Analytics - In-House Website Analytics
 * A lightweight, privacy-focused analytics solution.
 *
 * Features:
 * - No cookies required (uses sessionStorage/localStorage)
 * - Respects Do Not Track header
 * - GDPR-friendly (no third-party data sharing)
 * - SPA navigation support
 * - Custom event tracking
 * - Scroll depth and time on page tracking
 *
 * Usage:
 * - Automatic page view tracking on load
 * - Custom events: window.plexAnalytics.track('event_name', { data: 'value' })
 */
(function(window, document) {
  'use strict';

  // Configuration
  var CONFIG = {
    endpoint: '/api/v1/analytics/collect',
    sessionTimeout: 30 * 60 * 1000, // 30 minutes
    heartbeatInterval: 30 * 1000,   // 30 seconds for time tracking
    debug: false
  };

  // Session management using sessionStorage (no cookies)
  function getOrCreateSession() {
    var stored = null;
    try {
      stored = sessionStorage.getItem('_plex_session');
    } catch (e) {
      // sessionStorage not available
    }

    if (stored) {
      try {
        var data = JSON.parse(stored);
        if (Date.now() - data.lastActive < CONFIG.sessionTimeout) {
          data.lastActive = Date.now();
          sessionStorage.setItem('_plex_session', JSON.stringify(data));
          return data;
        }
      } catch (e) {
        // Invalid JSON, create new session
      }
    }

    // Create new session
    var visitorId = null;
    try {
      visitorId = localStorage.getItem('_plex_visitor');
    } catch (e) {
      // localStorage not available
    }

    if (!visitorId) {
      visitorId = generateUUID();
      try {
        localStorage.setItem('_plex_visitor', visitorId);
      } catch (e) {
        // localStorage not available
      }
    }

    var newSession = {
      sessionId: generateUUID(),
      visitorId: visitorId,
      lastActive: Date.now(),
      pageLoadTime: Date.now()
    };

    try {
      sessionStorage.setItem('_plex_session', JSON.stringify(newSession));
    } catch (e) {
      // sessionStorage not available
    }

    return newSession;
  }

  // Generate UUID v4
  function generateUUID() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Extract UTM parameters from URL
  function getUtmParams() {
    var params = {};
    var search = window.location.search;
    if (!search) return params;

    var utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    var urlParams = new URLSearchParams(search);

    utmKeys.forEach(function(key) {
      var value = urlParams.get(key);
      if (value) {
        params[key] = value;
      }
    });

    return params;
  }

  // Calculate scroll depth (0-100)
  function getScrollDepth() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var scrollHeight = document.documentElement.scrollHeight;
    var clientHeight = document.documentElement.clientHeight;

    if (scrollHeight <= clientHeight) return 100;

    var scrollPercent = (scrollTop / (scrollHeight - clientHeight)) * 100;
    return Math.min(100, Math.round(scrollPercent));
  }

  // Track maximum scroll depth
  var maxScrollDepth = 0;
  function trackScrollDepth() {
    var current = getScrollDepth();
    if (current > maxScrollDepth) {
      maxScrollDepth = current;
    }
  }

  // Send data to analytics endpoint
  function send(data, callback) {
    // Check Do Not Track
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') {
      if (CONFIG.debug) console.log('[PlexAnalytics] DNT enabled, not tracking');
      return;
    }

    var payload = JSON.stringify(data);

    // Use sendBeacon for reliable delivery on page unload
    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      var success = navigator.sendBeacon(CONFIG.endpoint, blob);
      if (success && callback) callback();
      return;
    }

    // Fallback to fetch
    fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).then(function(response) {
      if (callback) callback();
    }).catch(function(error) {
      if (CONFIG.debug) console.error('[PlexAnalytics] Error:', error);
    });
  }

  // Track page view
  var lastPage = null;
  var pageStartTime = Date.now();

  function trackPageView(options) {
    // Skip tracking for admin pages and API endpoints
    if (!shouldTrack()) {
      if (CONFIG.debug) console.log('[PlexAnalytics] Skipping page view for:', window.location.pathname);
      return;
    }

    options = options || {};
    var session = getOrCreateSession();
    var currentPage = window.location.href;

    // Send exit event for previous page
    if (lastPage && lastPage !== currentPage) {
      var timeOnPage = Math.round((Date.now() - pageStartTime) / 1000);
      send({
        session_id: session.sessionId,
        visitor_id: session.visitorId,
        url: lastPage,
        time_on_page: timeOnPage,
        scroll_depth: maxScrollDepth,
        event_name: 'page_exit'
      });
    }

    // Reset tracking for new page
    maxScrollDepth = 0;
    pageStartTime = Date.now();
    lastPage = currentPage;

    // Build page view payload
    var payload = {
      session_id: session.sessionId,
      visitor_id: session.visitorId,
      url: currentPage,
      title: document.title,
      referrer: document.referrer || null,
      screen_width: window.screen.width,
      screen_height: window.screen.height
    };

    // Add UTM params
    var utmParams = getUtmParams();
    Object.keys(utmParams).forEach(function(key) {
      payload[key] = utmParams[key];
    });

    send(payload, function() {
      if (CONFIG.debug) console.log('[PlexAnalytics] Page view tracked:', currentPage);
    });
  }

  // Track custom event
  function trackEvent(eventName, eventData) {
    if (!eventName) return;

    var session = getOrCreateSession();
    var payload = {
      session_id: session.sessionId,
      visitor_id: session.visitorId,
      url: window.location.href,
      event_name: eventName,
      event_data: eventData || null
    };

    send(payload, function() {
      if (CONFIG.debug) console.log('[PlexAnalytics] Event tracked:', eventName, eventData);
    });
  }

  // Intercept SPA navigation
  function setupSPATracking() {
    // Track popstate (back/forward)
    window.addEventListener('popstate', function() {
      setTimeout(trackPageView, 0);
    });

    // Intercept pushState
    var originalPushState = history.pushState;
    history.pushState = function() {
      originalPushState.apply(this, arguments);
      setTimeout(trackPageView, 0);
    };

    // Intercept replaceState
    var originalReplaceState = history.replaceState;
    history.replaceState = function() {
      originalReplaceState.apply(this, arguments);
      setTimeout(trackPageView, 0);
    };
  }

  // Setup event listeners
  function setup() {
    // Track scroll depth
    window.addEventListener('scroll', trackScrollDepth, { passive: true });

    // Track page visibility changes (tab switching)
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        // User is leaving, send final metrics
        var session = getOrCreateSession();
        var timeOnPage = Math.round((Date.now() - pageStartTime) / 1000);
        send({
          session_id: session.sessionId,
          visitor_id: session.visitorId,
          url: window.location.href,
          time_on_page: timeOnPage,
          scroll_depth: maxScrollDepth,
          event_name: 'page_visibility_hidden'
        });
      }
    });

    // Track before unload
    window.addEventListener('beforeunload', function() {
      var session = getOrCreateSession();
      var timeOnPage = Math.round((Date.now() - pageStartTime) / 1000);
      send({
        session_id: session.sessionId,
        visitor_id: session.visitorId,
        url: window.location.href,
        time_on_page: timeOnPage,
        scroll_depth: maxScrollDepth,
        event_name: 'page_unload'
      });
    });

    // Setup SPA tracking
    setupSPATracking();
  }

  // Auto-track common events
  function setupAutoTracking() {
    // Track clicks on external links
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a');
      if (link && link.hostname !== window.location.hostname) {
        trackEvent('outbound_link', {
          url: link.href,
          text: link.textContent.trim().substring(0, 100)
        });
      }
    });

    // Track form submissions
    document.addEventListener('submit', function(e) {
      var form = e.target;
      trackEvent('form_submit', {
        form_id: form.id || null,
        form_action: form.action || null
      });
    });

    // Track file downloads
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a');
      if (link) {
        var href = link.href || '';
        var downloadExtensions = ['.pdf', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.csv'];
        var isDownload = downloadExtensions.some(function(ext) {
          return href.toLowerCase().endsWith(ext);
        });
        if (isDownload) {
          trackEvent('file_download', {
            url: href,
            filename: href.split('/').pop()
          });
        }
      }
    });
  }

  // Check if current page should be tracked
  function shouldTrack() {
    var path = window.location.pathname;

    // Don't track admin pages
    if (path.startsWith('/admin')) {
      if (CONFIG.debug) console.log('[PlexAnalytics] Skipping admin page:', path);
      return false;
    }

    // Don't track API endpoints
    if (path.startsWith('/api')) {
      if (CONFIG.debug) console.log('[PlexAnalytics] Skipping API endpoint:', path);
      return false;
    }

    return true;
  }

  // Initialize on page load
  function init() {
    // Skip tracking for admin pages and API endpoints
    if (!shouldTrack()) {
      if (CONFIG.debug) console.log('[PlexAnalytics] Tracking disabled for this page');
      return;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        setup();
        setupAutoTracking();
        trackPageView();
      });
    } else {
      setup();
      setupAutoTracking();
      trackPageView();
    }
  }

  // Public API
  window.plexAnalytics = {
    track: trackEvent,
    pageView: trackPageView,
    getSession: getOrCreateSession,
    debug: function(enable) {
      CONFIG.debug = enable !== false;
    }
  };

  // Start
  init();

})(window, document);
