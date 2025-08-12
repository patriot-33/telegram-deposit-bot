/**
 * Webhook Controller
 * Senior PM: Enterprise-grade postback processing with comprehensive validation
 */

const Joi = require('joi');
const logger = require('../utils/logger');
const { ERROR_CODES, POSTBACK_STATUS } = require('../config/constants');
const keitaroService = require('../services/keitaro.service');
const telegramService = require('../services/telegram.service');
const trafficSourceService = require('../services/trafficSource.service');

// Postback validation schema
const postbackSchema = Joi.object({
  subid: Joi.string().required(),
  status: Joi.string().required(),
  payout: Joi.number().positive().optional(),
  geo: Joi.string().length(2).optional()
}).unknown(true); // Allow additional fields

class WebhookController {
  /**
   * Process incoming postback
   * Main entry point for deposit notifications
   */
  static async processPostback(req, res) {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('🔄 Processing postback', {
      requestId,
      query: req.query,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    try {
      // 1. Validate postback data
      const validationResult = await WebhookController._validatePostback(req.query);
      if (!validationResult.isValid) {
        return WebhookController._sendResponse(res, 400, {
          error: ERROR_CODES.INVALID_POSTBACK,
          message: validationResult.error,
          requestId
        });
      }
      
      const postbackData = validationResult.data;
      
      // 2. Check if status should be processed
      if (!POSTBACK_STATUS.VALID_STATUSES.includes(postbackData.status)) {
        logger.info('⏭️ Ignoring postback - invalid status', {
          requestId,
          status: postbackData.status,
          subid: postbackData.subid
        });
        
        return WebhookController._sendResponse(res, 200, {
          message: 'Postback ignored - invalid status',
          status: postbackData.status,
          requestId
        });
      }
      
      // 3. Get click data from Keitaro
      const clickData = await keitaroService.getClickById(postbackData.subid);
      if (!clickData) {
        logger.warn('⚠️ Click not found in Keitaro', {
          requestId,
          subid: postbackData.subid
        });
        
        return WebhookController._sendResponse(res, 404, {
          error: ERROR_CODES.CLICK_NOT_FOUND,
          message: 'Click not found in Keitaro',
          requestId
        });
      }
      
      // 4. Check if traffic source is FB
      const isFBSource = trafficSourceService.isFBSource(clickData.traffic_source_id);
      if (!isFBSource) {
        logger.info('⏭️ Ignoring postback - non-FB source', {
          requestId,
          trafficSourceId: clickData.traffic_source_id,
          subid: postbackData.subid
        });
        
        return WebhookController._sendResponse(res, 200, {
          message: 'Postback ignored - non-FB source',
          trafficSourceId: clickData.traffic_source_id,
          requestId
        });
      }
      
      // 5. Get additional data for notification
      const enrichedData = await WebhookController._enrichDepositData(postbackData, clickData);
      
      // 6. Send Telegram notification
      const notificationResult = await telegramService.sendDepositNotification(enrichedData);
      
      if (notificationResult.success) {
        logger.info('✅ Deposit notification sent successfully', {
          requestId,
          subid: postbackData.subid,
          payout: postbackData.payout,
          processingTime: Date.now() - startTime
        });
        
        return WebhookController._sendResponse(res, 200, {
          message: 'Deposit notification sent successfully',
          requestId,
          telegramMessageId: notificationResult.messageId
        });
      } else {
        logger.error('❌ Failed to send Telegram notification', {
          requestId,
          error: notificationResult.error,
          subid: postbackData.subid
        });
        
        return WebhookController._sendResponse(res, 500, {
          error: ERROR_CODES.TELEGRAM_ERROR,
          message: 'Failed to send notification',
          requestId
        });
      }
      
    } catch (error) {
      logger.error('💥 Critical error processing postback', {
        requestId,
        error: error.message,
        stack: error.stack,
        query: req.query
      });
      
      // Send error notification to Telegram
      try {
        await telegramService.sendErrorNotification({
          error: error.message,
          subid: req.query.subid || 'unknown',
          timestamp: new Date().toISOString(),
          requestId
        });
      } catch (telegramError) {
        logger.error('Failed to send error notification', { telegramError });
      }
      
      return WebhookController._sendResponse(res, 500, {
        error: ERROR_CODES.SYSTEM_ERROR,
        message: 'Internal server error',
        requestId
      });
    }
  }
  
  /**
   * Validate postback data
   */
  static async _validatePostback(query) {
    try {
      const { error, value } = postbackSchema.validate(query);
      
      if (error) {
        return {
          isValid: false,
          error: error.details.map(d => d.message).join(', ')
        };
      }
      
      return {
        isValid: true,
        data: value
      };
    } catch (error) {
      return {
        isValid: false,
        error: 'Validation failed'
      };
    }
  }
  
  /**
   * Enrich deposit data with additional information from Keitaro
   */
  static async _enrichDepositData(postbackData, clickData) {
    try {
      // Get campaign data
      const campaignData = await keitaroService.getCampaignById(clickData.campaign_id);
      
      // Get offer data
      const offerData = await keitaroService.getOfferById(clickData.offer_id);
      
      // Get traffic source name
      const trafficSourceName = trafficSourceService.getSourceName(clickData.traffic_source_id);
      
      return {
        // Postback data
        subid1: clickData.sub_id_1 || 'N/A',
        geo: postbackData.geo || clickData.country || 'N/A',
        payout: postbackData.payout || 0,
        
        // Keitaro data
        traffic_source_name: trafficSourceName,
        offer_name: offerData?.name || 'N/A',
        campaign_name: campaignData?.name || 'N/A',
        subid2: clickData.sub_id_2 || 'N/A',
        subid4: clickData.sub_id_4 || 'N/A', // Creative
        
        // System data
        timestamp: new Date().toISOString(),
        traffic_source_id: clickData.traffic_source_id
      };
    } catch (error) {
      logger.warn('Failed to enrich deposit data', { error: error.message });
      
      // Return minimal data if enrichment fails
      return {
        subid1: clickData.sub_id_1 || 'N/A',
        geo: postbackData.geo || 'N/A',
        payout: postbackData.payout || 0,
        traffic_source_name: trafficSourceService.getSourceName(clickData.traffic_source_id),
        offer_name: 'N/A',
        campaign_name: 'N/A',
        subid2: clickData.sub_id_2 || 'N/A',
        subid4: clickData.sub_id_4 || 'N/A',
        timestamp: new Date().toISOString(),
        traffic_source_id: clickData.traffic_source_id
      };
    }
  }
  
  /**
   * Send standardized response
   */
  static _sendResponse(res, statusCode, data) {
    return res.status(statusCode).json({
      timestamp: new Date().toISOString(),
      ...data
    });
  }
  
  /**
   * Health check endpoint
   */
  static async healthCheck(req, res) {
    try {
      // Check Keitaro API connectivity
      const keitaroStatus = await keitaroService.checkHealth();
      
      // Check Telegram Bot API connectivity  
      const telegramStatus = await telegramService.checkHealth();
      
      const isHealthy = keitaroStatus.healthy && telegramStatus.healthy;
      
      return res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          keitaro: keitaroStatus,
          telegram: telegramStatus
        }
      });
    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      
      return res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      });
    }
  }
}

module.exports = WebhookController;