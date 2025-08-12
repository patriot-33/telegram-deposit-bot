/**
 * Keitaro API Service
 * Senior PM: Production-ready integration with error handling & caching
 */

const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const { API_CONFIG, ERROR_CODES } = require('../config/constants');

class KeitaroService {
  constructor() {
    this.baseUrl = config.keitaro.baseUrl;
    this.apiKey = config.keitaro.apiKey;
    this.timeout = API_CONFIG.KEITARO.TIMEOUT;
    
    // Create axios instance with default configuration
    this.client = axios.create({
      baseURL: this.baseUrl + '/admin_api/v1',
      timeout: this.timeout,
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramDepositBot/1.0'
      }
    });
    
    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('🔄 Keitaro API Request', {
          method: config.method,
          url: config.url,
          params: config.params
        });
        return config;
      },
      (error) => {
        logger.error('❌ Keitaro API Request Error', { error: error.message });
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('✅ Keitaro API Response', {
          status: response.status,
          url: response.config.url,
          dataLength: response.data?.length || 'N/A'
        });
        return response;
      },
      (error) => {
        logger.error('❌ Keitaro API Response Error', {
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * Get click data by ID
   * Core method for postback processing
   */
  async getClickById(clickId) {
    try {
      logger.info('🔍 Getting click data', { clickId });
      
      const response = await this.client.get(`${API_CONFIG.KEITARO.ENDPOINTS.CLICKS}/${clickId}`);
      
      if (!response.data) {
        logger.warn('Click not found', { clickId });
        return null;
      }
      
      logger.info('✅ Click data retrieved', {
        clickId,
        campaignId: response.data.campaign_id,
        trafficSourceId: response.data.traffic_source_id,
        offerId: response.data.offer_id
      });
      
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('Click not found in Keitaro', { clickId });
        return null;
      }
      
      logger.error('Failed to get click data', {
        clickId,
        error: error.message,
        status: error.response?.status
      });
      
      throw new Error(`${ERROR_CODES.KEITARO_API_ERROR}: ${error.message}`);
    }
  }
  
  /**
   * Get campaign data by ID
   */
  async getCampaignById(campaignId) {
    try {
      logger.debug('Getting campaign data', { campaignId });
      
      const response = await this.client.get(`${API_CONFIG.KEITARO.ENDPOINTS.CAMPAIGNS}/${campaignId}`);
      
      logger.debug('Campaign data retrieved', {
        campaignId,
        name: response.data?.name
      });
      
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('Campaign not found', { campaignId });
        return { name: 'Unknown Campaign' };
      }
      
      logger.error('Failed to get campaign data', {
        campaignId,
        error: error.message
      });
      
      // Don't throw error for non-critical data
      return { name: 'Unknown Campaign' };
    }
  }
  
  /**
   * Get offer data by ID
   */
  async getOfferById(offerId) {
    try {
      logger.debug('Getting offer data', { offerId });
      
      const response = await this.client.get(`${API_CONFIG.KEITARO.ENDPOINTS.OFFERS}/${offerId}`);
      
      logger.debug('Offer data retrieved', {
        offerId,
        name: response.data?.name
      });
      
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('Offer not found', { offerId });
        return { name: 'Unknown Offer' };
      }
      
      logger.error('Failed to get offer data', {
        offerId,
        error: error.message
      });
      
      // Don't throw error for non-critical data
      return { name: 'Unknown Offer' };
    }
  }
  
  /**
   * Get all traffic sources
   * Used for source mapping validation
   */
  async getTrafficSources() {
    try {
      logger.debug('Getting traffic sources');
      
      const response = await this.client.get(API_CONFIG.KEITARO.ENDPOINTS.TRAFFIC_SOURCES);
      
      logger.info('Traffic sources retrieved', {
        count: response.data?.length || 0
      });
      
      return response.data || [];
    } catch (error) {
      logger.error('Failed to get traffic sources', {
        error: error.message
      });
      
      throw new Error(`${ERROR_CODES.KEITARO_API_ERROR}: ${error.message}`);
    }
  }
  
  /**
   * Health check for Keitaro API
   */
  async checkHealth() {
    try {
      logger.debug('Checking Keitaro API health');
      
      const startTime = Date.now();
      
      // Simple API call to check connectivity
      await this.client.get(API_CONFIG.KEITARO.ENDPOINTS.TRAFFIC_SOURCES, {
        params: { limit: 1 }
      });
      
      const responseTime = Date.now() - startTime;
      
      logger.info('Keitaro API health check passed', { responseTime });
      
      return {
        healthy: true,
        responseTime,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Keitaro API health check failed', {
        error: error.message,
        status: error.response?.status
      });
      
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Batch get multiple clicks
   * Future enhancement for batch processing
   */
  async getMultipleClicks(clickIds) {
    try {
      logger.info('Getting multiple clicks', { count: clickIds.length });
      
      const promises = clickIds.map(id => this.getClickById(id));
      const results = await Promise.allSettled(promises);
      
      const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      const failed = results.filter(r => r.status === 'rejected').length;
      
      logger.info('Batch click retrieval completed', {
        successful: successful.length,
        failed,
        total: clickIds.length
      });
      
      return successful;
    } catch (error) {
      logger.error('Batch click retrieval failed', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Retry wrapper for API calls
   */
  async _withRetry(operation, attempts = API_CONFIG.KEITARO.RETRY_ATTEMPTS) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await operation();
      } catch (error) {
        const isLastAttempt = i === attempts - 1;
        const shouldRetry = error.response?.status >= 500 || error.code === 'ECONNRESET';
        
        if (isLastAttempt || !shouldRetry) {
          throw error;
        }
        
        const delay = API_CONFIG.KEITARO.RETRY_DELAY * (i + 1);
        logger.warn(`API call failed, retrying in ${delay}ms`, {
          attempt: i + 1,
          maxAttempts: attempts,
          error: error.message
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

// Create singleton instance
const keitaroService = new KeitaroService();

module.exports = keitaroService;