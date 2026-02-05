/**
 * Data Source Configuration Manager
 * Manages toggling between different data sources for all dashboards
 */

const DATA_SOURCES = {
  LOCAL: {
    id: 'local',
    name: 'Local (ski-run-scraper)',
    description: 'Data from this repository',
    baseUrl: '..',
    requiresCors: false
  },
  GITHUB: {
    id: 'github',
    name: 'GitHub (ski-run-scraper-data)',
    description: 'Data from ski-run-scraper-data repository',
    baseUrl: 'https://raw.githubusercontent.com/jacobschulman/ski-run-scraper-data/main',
    requiresCors: false
  },
  HETZNER: {
    id: 'hetzner',
    name: 'Hetzner Server',
    description: 'Data from Hetzner production server',
    baseUrl: 'http://46.62.169.104:3000',
    requiresCors: true
  }
};

const STORAGE_KEY = 'ski-dashboard-data-source';
const DEFAULT_SOURCE = 'local';

class DataSourceManager {
  constructor() {
    this.currentSource = this.loadSourcePreference();
    this.listeners = [];
  }

  /**
   * Load user's data source preference from localStorage
   */
  loadSourcePreference() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && DATA_SOURCES[saved.toUpperCase()]) {
        return saved;
      }
    } catch (e) {
      console.warn('Failed to load data source preference:', e);
    }
    return DEFAULT_SOURCE;
  }

  /**
   * Save user's data source preference to localStorage
   */
  saveSourcePreference(sourceId) {
    try {
      localStorage.setItem(STORAGE_KEY, sourceId);
    } catch (e) {
      console.warn('Failed to save data source preference:', e);
    }
  }

  /**
   * Get current data source configuration
   */
  getCurrentSource() {
    const sourceKey = this.currentSource.toUpperCase();
    return DATA_SOURCES[sourceKey] || DATA_SOURCES.LOCAL;
  }

  /**
   * Set current data source
   */
  setCurrentSource(sourceId) {
    const sourceKey = sourceId.toUpperCase();
    if (!DATA_SOURCES[sourceKey]) {
      console.error(`Unknown data source: ${sourceId}`);
      return false;
    }

    this.currentSource = sourceId;
    this.saveSourcePreference(sourceId);
    this.notifyListeners();
    return true;
  }

  /**
   * Get all available data sources
   */
  getAllSources() {
    return Object.values(DATA_SOURCES);
  }

  /**
   * Build a full URL for a data file
   * @param {string} path - Relative path from root (e.g., 'data/vail/terrain/2026-01-28.json' or 'config.json')
   */
  buildDataUrl(path) {
    const source = this.getCurrentSource();

    // Remove leading slash or './' if present
    const cleanPath = path.replace(/^\.?\/?/, '');

    // For local source, use relative path
    if (source.id === 'local') {
      return `${source.baseUrl}/${cleanPath}`;
    }

    // For remote sources, build full URL
    return `${source.baseUrl}/${cleanPath}`;
  }

  /**
   * Fetch data from current source
   * @param {string} path - Relative path from root (e.g., 'data/vail/terrain/2026-01-28.json')
   * @param {object} options - Fetch options
   */
  async fetchData(path, options = {}) {
    // Always fetch config.json from local source (it's the source of truth)
    // Only data files come from the selected data source
    const isConfig = path === 'config.json' || path === '../config.json';
    const source = isConfig ? DATA_SOURCES.LOCAL : this.getCurrentSource();

    // Build URL using the appropriate source
    const cleanPath = path.replace(/^\.?\/?/, '');
    const url = source.id === 'local' ? `${source.baseUrl}/${cleanPath}` : `${source.baseUrl}/${cleanPath}`;

    // Add CORS mode for remote sources if needed
    if (source.requiresCors && !options.mode) {
      options.mode = 'cors';
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Failed to fetch from ${source.name}:`, error);
      throw new Error(`Failed to load data from ${source.name}: ${error.message}`);
    }
  }

  /**
   * Register a listener for data source changes
   * @param {function} callback - Called when data source changes
   */
  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Notify all listeners of data source change
   */
  notifyListeners() {
    const source = this.getCurrentSource();
    this.listeners.forEach(callback => {
      try {
        callback(source);
      } catch (e) {
        console.error('Error in data source change listener:', e);
      }
    });
  }
}

// Create singleton instance
const dataSourceManager = new DataSourceManager();

// Export for use in dashboards
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { dataSourceManager, DATA_SOURCES };
}
