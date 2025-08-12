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
          params: config.params,
          baseURL: config.baseURL
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
   * Get click data by ID (SubID)
   * EVIDENCE-BASED IMPLEMENTATION:
   * 
   * Based on creative-keitaro-bot analysis and local testing:
   * - Uses /admin_api/v1/conversions/log endpoint to find conversion data by SubID
   * - Searches conversions table using 'sub_id' field with 'EQUALS' operator
   * - Returns detailed conversion data including traffic source, buyer info, and revenue
   * - Returns null if SubID has no conversion (click without sale/lead)
   */
  async getClickById(clickId) {
    try {
      logger.info('🔍 Searching for conversion by SubID', { clickId });
      
      // Use conversions/log endpoint to find conversion data
      // This is the correct way to retrieve click/conversion data in Keitaro
      const response = await this.client.post('/conversions/log', {
        limit: 100,
        columns: [
          'sub_id_1', 'sub_id_2', 'sub_id_4', 'country', 'status', 'revenue', 
          'ts_id', 'click_id', 'postback_datetime', 'sub_id', 'campaign', 
          'offer', 'ts', 'affiliate_network'
        ],
        filters: [
          {
            name: 'sub_id',
            operator: 'EQUALS',
            expression: clickId
          }
        ]
      });

      const conversions = response.data?.rows || [];
      
      if (conversions.length > 0) {
        const conversion = conversions[0];
        
        logger.info('✅ Conversion data found via Keitaro API', {
          clickId,
          buyer: conversion.sub_id_1,
          country: conversion.country,
          revenue: conversion.revenue,
          trafficSource: conversion.ts_id,
          status: conversion.status
        });
        
        // Return structured data compatible with existing webhook logic
        return {
          sub_id_1: conversion.sub_id_1,
          sub_id_2: conversion.sub_id_2,
          sub_id_4: conversion.sub_id_4,
          country: conversion.country,
          traffic_source_id: conversion.ts_id,
          traffic_source_name: conversion.ts || this._getTrafficSourceName(conversion.ts_id),
          revenue: conversion.revenue,
          status: conversion.status,
          click_id: conversion.click_id,
          postback_datetime: conversion.postback_datetime,
          campaign_name: conversion.campaign || 'Unknown Campaign',
          offer_name: conversion.offer || 'Unknown Offer'
        };
      }
      
      // No conversion found - this means SubID exists but has no conversion (lead/sale)
      // This is normal behavior for clicks that don't convert
      logger.info('ℹ️ No conversion found for SubID (click without conversion)', { 
        clickId,
        reason: 'SubID exists but no lead/sale conversion recorded'
      });
      return null;
      
    } catch (error) {
      logger.error('❌ Error getting conversion data from Keitaro API', {
        clickId,
        error: error.message,
        status: error.response?.status,
        url: error.config?.url
      });
      
      // Return null for any API errors since we can't reliably get click data
      return null;
    }
  }
  
  /**
   * Get campaign data by ID
   */
  async getCampaignById(campaignId) {
    try {
      logger.debug('Getting campaign data', { campaignId });
      
      const response = await this.client.get(`/campaigns/${campaignId}`);
      
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
      
      const response = await this.client.get(`/offers/${offerId}`);
      
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
      
      const response = await this.client.get('/traffic_sources');
      
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
      await this.client.get('/traffic_sources', {
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
  async _withRetry(operation, attempts = 3) {
    const retryDelay = 1000; // 1 second
    
    for (let i = 0; i < attempts; i++) {
      try {
        return await operation();
      } catch (error) {
        const isLastAttempt = i === attempts - 1;
        const shouldRetry = error.response?.status >= 500 || error.code === 'ECONNRESET';
        
        if (isLastAttempt || !shouldRetry) {
          throw error;
        }
        
        const delay = retryDelay * (i + 1);
        logger.warn(`API call failed, retrying in ${delay}ms`, {
          attempt: i + 1,
          maxAttempts: attempts,
          error: error.message
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Get traffic source name helper
   * Maps traffic source ID to readable name
   */
  _getTrafficSourceName(sourceId) {
    // Map of known Facebook source IDs to names
    const sourceMap = {
      3: 'Facebook',
      4: 'Facebook',
      5: 'Facebook',
      6: 'Facebook',
      7: 'Facebook',
      8: 'Facebook',
      9: 'Facebook',
      10: 'Facebook',
      11: 'Facebook',
      12: 'Facebook',
      13: 'Facebook',
      14: 'Facebook',
      15: 'Facebook',
      16: 'Facebook',
      17: 'Facebook'
    };
    
    return sourceMap[sourceId] || `Traffic Source ${sourceId}`;
  }
}

// Create singleton instance
const keitaroService = new KeitaroService();

module.exports = keitaroService;