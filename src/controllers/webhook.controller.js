/**
 * Webhook Controller
 * Senior PM: Enterprise-grade postback processing with comprehensive validation
 */

const Joi = require('joi');
const logger = require('../utils/logger');
const { ERROR_CODES, POSTBACK_STATUS, KNOWN_FB_POSTBACK_SOURCES } = require('../config/constants');
const keitaroService = require('../services/keitaro.service');
const telegramBotService = require('../services/telegramBot.service');
const trafficSourceService = require('../services/trafficSource.service');

// Postback validation schema
const postbackSchema = Joi.object({
  subid: Joi.string().required(),
  status: Joi.string().required(),
  payout: Joi.number().positive().optional(),
  geo: Joi.string().length(2).optional()
}).unknown(true); // Allow additional fields

// Cache to prevent duplicate processing of same SubID
// Using Map for better performance and automatic cleanup
const processedSubIdsCache = new Map();
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour cleanup
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours TTL

// Cleanup cache periodically
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [subId, timestamp] of processedSubIdsCache.entries()) {
    if (now - timestamp > CACHE_TTL) {
      processedSubIdsCache.delete(subId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} expired SubIDs from cache`);
  }
}, CACHE_CLEANUP_INTERVAL);

class WebhookController {
  /**
   * Process incoming postback
   * Main entry point for deposit notifications
   */
  static async processPostback(req, res) {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // FORCE CONSOLE LOG for Render visibility
    console.log('\n🔄🔄🔄 POSTBACK PROCESSING 🔄🔄🔄');
    console.log(`RequestID: ${requestId}`);
    console.log(`Query: ${JSON.stringify(req.query)}`);
    console.log(`IP: ${req.ip}`);
    console.log(`Time: ${new Date().toISOString()}`);
    
    logger.info('🔄 Processing postback', {
      requestId,
      query: req.query,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    try {
      // 0. Check cache to prevent duplicate processing
      const subIdFromQuery = req.query.subid;
      if (subIdFromQuery && processedSubIdsCache.has(subIdFromQuery)) {
        const cachedTime = processedSubIdsCache.get(subIdFromQuery);
        const ageMinutes = Math.floor((Date.now() - cachedTime) / (1000 * 60));
        
        logger.info('⚠️ Duplicate SubID detected - skipping processing', {
          requestId,
          subid: subIdFromQuery,
          cachedAgo: `${ageMinutes} minutes`,
          reason: 'Already processed recently'
        });
        
        return WebhookController._sendResponse(res, 200, {
          message: 'Duplicate SubID - already processed',
          subid: subIdFromQuery,
          cachedAgo: `${ageMinutes} minutes`,
          requestId
        });
      }

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
      
      // 2. Check if status should be processed using universal deposit detection
      const statusValidation = WebhookController._validateDepositStatus(postbackData.status);
      if (!statusValidation.isValid) {
        logger.info('⏭️ Ignoring postback - invalid status', {
          requestId,
          status: postbackData.status,
          reason: statusValidation.reason,
          subid: postbackData.subid
        });
        
        return WebhookController._sendResponse(res, 200, {
          message: 'Postback ignored - invalid status',
          status: postbackData.status,
          reason: statusValidation.reason,
          requestId
        });
      }
      
      // 3. Get click data from Keitaro reports with timeout protection
      let clickData;
      try {
        const startTime = Date.now();
        clickData = await Promise.race([
          keitaroService.getClickById(postbackData.subid),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Keitaro API timeout after 15s')), 15000)
          )
        ]);
        
        const responseTime = Date.now() - startTime;
        logger.info('⏱️ Keitaro API response time', { responseTime, subid: postbackData.subid });
        
      } catch (error) {
        logger.error('❌ Keitaro API failed or timeout', {
          requestId,
          subid: postbackData.subid,
          error: error.message,
          isTimeout: error.message.includes('timeout')
        });
        
        // For timeout/error, ignore the postback to prevent hanging
        return WebhookController._sendResponse(res, 200, {
          message: 'Postback ignored - Keitaro API unavailable',
          subid: postbackData.subid,
          error: error.message,
          requestId
        });
      }
      
      if (!clickData) {
        logger.info('⚠️ No conversion found on first attempt, trying retry with delay', {
          requestId,
          subid: postbackData.subid,
          reason: 'First API call returned null - possible indexing delay',
          postbackFrom: postbackData.from
        });
        
        // Wait 30 seconds for Keitaro to potentially index the conversion
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Retry Keitaro API call
        try {
          clickData = await keitaroService.getClickById(postbackData.subid);
          logger.info('🔄 Retry API call completed', {
            requestId,
            subid: postbackData.subid,
            retrySuccess: !!clickData
          });
        } catch (retryError) {
          logger.error('❌ Retry API call failed', {
            requestId,
            subid: postbackData.subid,
            retryError: retryError.message
          });
        }
        
        // If still no data after retry, use fallback mechanism
        if (!clickData) {
          logger.info('🔄 Activating fallback mechanism after retry failed', {
            requestId,
            subid: postbackData.subid,
            postbackFrom: postbackData.from
          });
          
          const fallbackResult = await WebhookController._processFallbackDeposit(postbackData, requestId);
          
          if (fallbackResult.processed) {
            // Add SubID to cache after successful fallback processing
            processedSubIdsCache.set(postbackData.subid, Date.now());
            
            logger.info('✅ Fallback processing successful', {
              requestId,
              subid: postbackData.subid,
              fallbackUsed: true,
              cachedForDuplicatePrevention: true
            });
            return WebhookController._sendResponse(res, 200, fallbackResult.response);
          } else {
            logger.info('⏭️ Fallback declined to process - ignoring postback', {
              requestId,
              subid: postbackData.subid,
              fallbackReason: fallbackResult.reason
            });
            return WebhookController._sendResponse(res, 200, {
              message: 'Postback ignored after retry and fallback',
              subid: postbackData.subid,
              reason: fallbackResult.reason,
              requestId
            });
          }
        } else {
          logger.info('✅ Retry successful - continuing with retrieved data', {
            requestId,
            subid: postbackData.subid,
            retryWorked: true
          });
        }
      }
      
      logger.info('✅ Real click data retrieved from Keitaro', {
        requestId,
        subid: postbackData.subid,
        trafficSourceId: clickData.traffic_source_id,
        trafficSourceName: clickData.traffic_source_name,
        country: clickData.country,
        campaignName: clickData.campaign_name,
        offerName: clickData.offer_name
      });
      
      // 4. Check if traffic source is FB
      const trafficSourceId = clickData.traffic_source_id;
      const trafficSourceName = clickData.traffic_source_name;
      const isFBSource = trafficSourceService.isFBSource(trafficSourceId);
      
      logger.info('🔍 Traffic source validation', {
        requestId,
        trafficSourceId,
        trafficSourceName,
        isFBSource,
        subid: postbackData.subid
      });
      
      if (!isFBSource) {
        logger.info('⏭️ Ignoring postback - non-FB source', {
          requestId,
          trafficSourceId,
          trafficSourceName,
          subid: postbackData.subid
        });
        
        return WebhookController._sendResponse(res, 200, {
          message: 'Postback ignored - non-FB source',
          trafficSourceId,
          trafficSourceName,
          requestId
        });
      }
      
      // 5. Get additional data for notification
      const enrichedData = await WebhookController._enrichDepositData(postbackData, clickData);
      
      // 6. Send Telegram notification
      const notificationResult = await telegramBotService.sendDepositNotification(enrichedData);
      
      if (notificationResult.success) {
        // Add SubID to cache after successful processing
        processedSubIdsCache.set(postbackData.subid, Date.now());
        
        logger.info('✅ Deposit notification sent successfully', {
          requestId,
          subid: postbackData.subid,
          payout: postbackData.payout,
          processingTime: Date.now() - startTime,
          cachedForDuplicatePrevention: true
        });
        
        return WebhookController._sendResponse(res, 200, {
          message: 'Deposit notification sent successfully',
          requestId,
          broadcastStats: notificationResult.stats
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
      
      // Send error notification to owners
      try {
        const config = require('../config/config');
        const errorMessage = `❌ <b>Ошибка обработки постбека</b>\n\n` +
                           `Ошибка: ${error.message}\n` +
                           `SubID: ${req.query.subid || 'unknown'}\n` +
                           `ID запроса: ${requestId}\n\n` +
                           `<i>Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`;
        
        for (const ownerId of config.owners) {
          try {
            await telegramBotService.sendMessage(ownerId, errorMessage, { parse_mode: 'HTML' });
          } catch (msgError) {
            logger.warn(`Failed to send error notification to owner ${ownerId}`, { msgError });
          }
        }
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
   * Enrich deposit data with information from Keitaro reports
   */
  static async _enrichDepositData(postbackData, clickData) {
    try {
      logger.info('🔄 Enriching deposit data with real Keitaro data', {
        subid: postbackData.subid,
        clickDataFields: Object.keys(clickData || {})
      });
      
      return {
        // ID баера (из Sub ID 1 в Keitaro)
        subid1: clickData.sub_id_1 || 'N/A',
        
        // ГЕО (из country в Keitaro, не из postback)
        geo: clickData.country || postbackData.geo || 'N/A',
        
        // Доход (из postback)
        payout: postbackData.payout || clickData.revenue || 0,
        
        // Реальные данные из Keitaro reports
        traffic_source_name: clickData.traffic_source_name || trafficSourceService.getSourceName(clickData.traffic_source_id) || 'N/A',
        offer_name: clickData.offer_name || 'N/A',
        campaign_name: clickData.campaign_name || 'N/A',
        subid2: clickData.sub_id_2 || 'N/A',
        subid4: clickData.sub_id_4 || 'N/A', // Creative
        
        // System data
        timestamp: new Date().toISOString(),
        traffic_source_id: clickData.traffic_source_id,
        
        // Debug info
        clickId: postbackData.subid,
        rawClickData: clickData
      };
    } catch (error) {
      logger.warn('Failed to enrich deposit data', { error: error.message });
      
      // Return minimal data if enrichment fails
      return {
        subid1: clickData?.sub_id_1 || 'N/A',
        geo: clickData?.country || postbackData.geo || 'N/A', 
        payout: postbackData.payout || 0,
        traffic_source_name: clickData?.traffic_source_name || 'N/A',
        offer_name: clickData?.offer_name || 'N/A',
        campaign_name: clickData?.campaign_name || 'N/A',
        subid2: clickData?.sub_id_2 || 'N/A',
        subid4: clickData?.sub_id_4 || 'N/A',
        timestamp: new Date().toISOString(),
        traffic_source_id: clickData?.traffic_source_id || 0
      };
    }
  }
  
  /**
   * Universal deposit status validation
   */
  static _validateDepositStatus(status) {
    const statusLower = status.toLowerCase();
    
    // First check for rejection keywords (highest priority)
    const hasRejectionKeyword = POSTBACK_STATUS.REJECTION_KEYWORDS.some(keyword => 
      statusLower.includes(keyword.toLowerCase())
    );
    
    if (hasRejectionKeyword) {
      return {
        isValid: false,
        reason: 'contains_rejection_keyword'
      };
    }
    
    // Check for lead/registration keywords (ignore completely)
    const hasLeadKeyword = POSTBACK_STATUS.LEAD_KEYWORDS.some(keyword => 
      statusLower.includes(keyword.toLowerCase())
    );
    
    if (hasLeadKeyword && !statusLower.includes('dep') && !statusLower.includes('sale')) {
      return {
        isValid: false,
        reason: 'is_lead_or_registration'
      };
    }
    
    // Check for deposit keywords
    const hasDepositKeyword = POSTBACK_STATUS.DEPOSIT_KEYWORDS.some(keyword => 
      statusLower.includes(keyword.toLowerCase())
    );
    
    if (hasDepositKeyword) {
      return {
        isValid: true,
        reason: 'contains_deposit_keyword'
      };
    }
    
    // Fallback to legacy exact match
    if (POSTBACK_STATUS.EXACT_VALID_STATUSES.includes(status)) {
      return {
        isValid: true,
        reason: 'exact_match_legacy'
      };
    }
    
    return {
      isValid: false,
      reason: 'no_deposit_indicators'
    };
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
   * Health check endpoint - Ultra-optimized for Render.com
   */
  static async healthCheck(req, res) {
    // Ultra-fast health check - respond in <50ms to prevent Render timeouts
    const startTime = Date.now();
    
    try {
      // Minimal health indicators
      const uptime = Math.floor(process.uptime());
      const rssInMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
      
      // Determine status instantly
      let status = 'healthy';
      let warnings = [];
      
      // Critical thresholds for immediate response
      if (rssInMB > 450) { // Approaching 512MB limit
        status = 'warning';
        warnings.push('Memory approaching limit');
      }
      
      if (uptime < 30) {
        warnings.push('Recent startup');
      }
      
      const responseTime = Date.now() - startTime;
      
      // Always return 200 OK for Render - let it decide based on response time
      res.status(200).json({
        status,
        uptime,
        memory: `${rssInMB}MB`,
        warnings: warnings.length > 0 ? warnings : undefined,
        pid: process.pid,
        rt: responseTime, // Abbreviated for speed
        ts: Date.now() // Timestamp as number for speed
      });
      
      // Log only if response is slow (debug purposes)
      if (responseTime > 25) {
        logger.warn('Health check slow response', {
          responseTime,
          target: '<25ms',
          status,
          uptime
        });
      }
      
    } catch (error) {
      // Even errors should return 200 with error info
      const responseTime = Date.now() - startTime;
      
      res.status(200).json({
        status: 'error',
        error: error.message,
        uptime: Math.floor(process.uptime()),
        rt: responseTime,
        ts: Date.now()
      });
      
      logger.error('Health check exception', { error: error.message, responseTime });
    }
  }
  
  /**
   * Detailed health check endpoint for monitoring
   */
  static async detailedHealthCheck(req, res) {
    try {
      // Check Keitaro API connectivity
      const keitaroStatus = await keitaroService.checkHealth();
      
      // Check Telegram Bot API connectivity  
      const telegramStatus = await telegramBotService.checkHealth();
      
      // Add database health check
      const { checkDatabaseHealth } = require('../models');
      const dbStatus = await checkDatabaseHealth();
      
      const isHealthy = keitaroStatus.healthy && telegramStatus.healthy && dbStatus.healthy;
      
      return res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          keitaro: keitaroStatus,
          telegram: telegramStatus,
          database: dbStatus
        }
      });
    } catch (error) {
      logger.error('Detailed health check failed', { error: error.message });
      
      return res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      });
    }
  }

  /**
   * Process deposit using postback data when Keitaro API is unavailable
   * Evidence-based fallback for real deposit notifications
   */
  static async _processFallbackDeposit(postbackData, requestId) {
    try {
      logger.info('🔄 Processing fallback deposit from postback data', {
        requestId,
        subid: postbackData.subid,
        from: postbackData.from,
        payout: postbackData.payout
      });

      // 1. Detect FB source from postback 'from' parameter using known sources mapping
      const fromParam = (postbackData.from || '').toLowerCase();
      const knownFBSource = KNOWN_FB_POSTBACK_SOURCES[fromParam];
      
      if (!knownFBSource) {
        logger.info('⏭️ Fallback ignored - unknown or non-FB source', {
          requestId,
          from: postbackData.from,
          subid: postbackData.subid,
          availableSources: Object.keys(KNOWN_FB_POSTBACK_SOURCES)
        });
        
        return {
          processed: false,
          reason: `Unknown postback source: ${postbackData.from}. Known FB sources: ${Object.keys(KNOWN_FB_POSTBACK_SOURCES).join(', ')}`
        };
      }

      logger.info('✅ Known FB source detected in postback - proceeding with fallback', {
        requestId,
        from: postbackData.from,
        mappedSource: knownFBSource.name,
        trafficSourceId: knownFBSource.traffic_source_id,
        subid: postbackData.subid
      });

      // 2. Create enriched data from postback using known source mapping
      const enrichedData = {
        subid1: postbackData.subid.slice(0, 8), // Extract buyer ID from SubID
        geo: postbackData.geo || 'Unknown', // Use postback geo if available
        payout: parseFloat(postbackData.payout) || 0,
        traffic_source_name: knownFBSource.name,
        offer_name: 'Unknown Offer (Fallback)',
        campaign_name: 'Unknown Campaign (Fallback)',
        subid2: 'Unknown (Fallback)',
        subid4: 'Unknown (Fallback)',
        timestamp: new Date().toISOString(),
        traffic_source_id: knownFBSource.traffic_source_id,
        clickId: postbackData.subid,
        fallbackUsed: true // Flag to indicate this is fallback data
      };

      // 3. Send Telegram notification
      const telegramBotService = require('../services/telegramBot.service');
      const notificationResult = await telegramBotService.sendDepositNotification(enrichedData);

      if (notificationResult.success) {
        logger.info('✅ Fallback deposit notification sent successfully', {
          requestId,
          subid: postbackData.subid,
          payout: postbackData.payout,
          from: postbackData.from
        });

        return {
          processed: true,
          response: {
            message: 'Fallback deposit notification sent successfully',
            requestId,
            fallbackUsed: true,
            broadcastStats: notificationResult.stats
          }
        };
      } else {
        logger.error('❌ Failed to send fallback Telegram notification', {
          requestId,
          error: notificationResult.error,
          subid: postbackData.subid
        });

        return {
          processed: false,
          reason: `Telegram notification failed: ${notificationResult.error}`
        };
      }

    } catch (error) {
      logger.error('💥 Error in fallback deposit processing', {
        requestId,
        error: error.message,
        stack: error.stack,
        subid: postbackData.subid
      });

      return {
        processed: false,
        reason: `Fallback processing error: ${error.message}`
      };
    }
  }
}

module.exports = WebhookController;