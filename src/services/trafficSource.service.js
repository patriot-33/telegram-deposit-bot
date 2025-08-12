/**
 * Traffic Source Service
 * Senior PM: FB source identification based on research data
 */

const { TRAFFIC_SOURCES } = require('../config/constants');
const logger = require('../utils/logger');

class TrafficSourceService {
  /**
   * Check if traffic source is FB source
   * Core business logic for deposit filtering
   */
  static isFBSource(trafficSourceId) {
    try {
      const sourceId = parseInt(trafficSourceId);
      const isFB = TRAFFIC_SOURCES.FB_SOURCES.includes(sourceId);
      
      logger.debug('Traffic source check', {
        trafficSourceId: sourceId,
        isFBSource: isFB,
        sourceName: this.getSourceName(sourceId)
      });
      
      return isFB;
    } catch (error) {
      logger.error('Error checking FB source', {
        trafficSourceId,
        error: error.message
      });
      
      // Default to false for safety
      return false;
    }
  }
  
  /**
   * Check if traffic source should be ignored
   */
  static isIgnoredSource(trafficSourceId) {
    try {
      const sourceId = parseInt(trafficSourceId);
      const isIgnored = TRAFFIC_SOURCES.NON_FB_SOURCES.includes(sourceId);
      
      logger.debug('Traffic source ignore check', {
        trafficSourceId: sourceId,
        isIgnored,
        sourceName: this.getSourceName(sourceId)
      });
      
      return isIgnored;
    } catch (error) {
      logger.error('Error checking ignored source', {
        trafficSourceId,
        error: error.message
      });
      
      // Default to true for safety (ignore unknown sources)
      return true;
    }
  }
  
  /**
   * Get traffic source name by ID
   */
  static getSourceName(trafficSourceId) {
    try {
      const sourceId = parseInt(trafficSourceId);
      const sourceName = TRAFFIC_SOURCES.SOURCES_MAP[sourceId];
      
      if (!sourceName) {
        logger.warn('Unknown traffic source ID', { trafficSourceId: sourceId });
        return `Unknown Source (ID: ${sourceId})`;
      }
      
      return sourceName;
    } catch (error) {
      logger.error('Error getting source name', {
        trafficSourceId,
        error: error.message
      });
      
      return `Invalid Source (${trafficSourceId})`;
    }
  }
  
  /**
   * Get all FB sources
   */
  static getAllFBSources() {
    return TRAFFIC_SOURCES.FB_SOURCES.map(id => ({
      id,
      name: this.getSourceName(id)
    }));
  }
  
  /**
   * Get all non-FB sources
   */
  static getAllNonFBSources() {
    return TRAFFIC_SOURCES.NON_FB_SOURCES.map(id => ({
      id,
      name: this.getSourceName(id)
    }));
  }
  
  /**
   * Validate traffic source configuration
   * Used during startup to ensure data integrity
   */
  static validateConfiguration() {
    try {
      logger.info('🔍 Validating traffic source configuration');
      
      const fbSources = TRAFFIC_SOURCES.FB_SOURCES;
      const nonFbSources = TRAFFIC_SOURCES.NON_FB_SOURCES;
      const sourcesMap = TRAFFIC_SOURCES.SOURCES_MAP;
      
      // Check for overlapping sources
      const overlap = fbSources.filter(id => nonFbSources.includes(id));
      if (overlap.length > 0) {
        throw new Error(`Overlapping sources found: ${overlap.join(', ')}`);
      }
      
      // Check if all sources have names
      const allSources = [...fbSources, ...nonFbSources];
      const missingNames = allSources.filter(id => !sourcesMap[id]);
      
      if (missingNames.length > 0) {
        logger.warn('Sources without names found', { missingNames });
      }
      
      // Statistics
      const stats = {
        fbSourcesCount: fbSources.length,
        nonFbSourcesCount: nonFbSources.length,
        totalMappedSources: Object.keys(sourcesMap).length,
        fbSources: this.getAllFBSources(),
        nonFbSources: this.getAllNonFBSources()
      };
      
      logger.info('✅ Traffic source configuration validated', stats);
      
      return {
        valid: true,
        stats,
        issues: missingNames.length > 0 ? [`${missingNames.length} sources without names`] : []
      };
    } catch (error) {
      logger.error('❌ Traffic source configuration validation failed', {
        error: error.message
      });
      
      return {
        valid: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get traffic source statistics
   */
  static getStatistics() {
    try {
      const fbSources = this.getAllFBSources();
      const nonFbSources = this.getAllNonFBSources();
      
      return {
        fb: {
          count: fbSources.length,
          sources: fbSources
        },
        nonFb: {
          count: nonFbSources.length,
          sources: nonFbSources
        },
        total: {
          count: fbSources.length + nonFbSources.length,
          mapped: Object.keys(TRAFFIC_SOURCES.SOURCES_MAP).length
        }
      };
    } catch (error) {
      logger.error('Error getting traffic source statistics', {
        error: error.message
      });
      
      return {
        error: error.message
      };
    }
  }
  
  /**
   * Check if source ID exists in configuration
   */
  static isKnownSource(trafficSourceId) {
    try {
      const sourceId = parseInt(trafficSourceId);
      const isKnown = TRAFFIC_SOURCES.SOURCES_MAP.hasOwnProperty(sourceId);
      
      if (!isKnown) {
        logger.warn('Unknown traffic source detected', {
          trafficSourceId: sourceId
        });
      }
      
      return isKnown;
    } catch (error) {
      logger.error('Error checking known source', {
        trafficSourceId,
        error: error.message
      });
      
      return false;
    }
  }
  
  /**
   * Get source type (FB/NON_FB/UNKNOWN)
   */
  static getSourceType(trafficSourceId) {
    try {
      const sourceId = parseInt(trafficSourceId);
      
      if (TRAFFIC_SOURCES.FB_SOURCES.includes(sourceId)) {
        return 'FB';
      }
      
      if (TRAFFIC_SOURCES.NON_FB_SOURCES.includes(sourceId)) {
        return 'NON_FB';
      }
      
      return 'UNKNOWN';
    } catch (error) {
      logger.error('Error getting source type', {
        trafficSourceId,
        error: error.message
      });
      
      return 'ERROR';
    }
  }
}

module.exports = TrafficSourceService;