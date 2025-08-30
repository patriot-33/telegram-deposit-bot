/**
 * Deposit Audit Service
 * Compares Keitaro deposits with bot notifications to find missing deposits
 */

const logger = require('../utils/logger');
const keitaroService = require('./keitaro.service');
const trafficSourceService = require('./trafficSource.service');
const { KNOWN_FB_POSTBACK_SOURCES } = require('../config/constants');

class DepositAuditService {
  
  /**
   * Main audit function - compares Keitaro deposits with bot notifications
   * @param {string} dateFrom - Start date (YYYY-MM-DD)
   * @param {string} dateTo - End date (YYYY-MM-DD) 
   * @returns {Object} Audit results with missing deposits and statistics
   */
  static async auditDeposits(dateFrom, dateTo) {
    const auditStartTime = Date.now();
    
    logger.info('🔍 Starting deposit audit', {
      dateFrom,
      dateTo
    });
    
    try {
      // 1. Get all deposits from Keitaro for the period
      const keitaroDeposits = await this._getKeitaroDeposits(dateFrom, dateTo);
      
      // 2. Filter only FB deposits
      const fbDeposits = this._filterFBDeposits(keitaroDeposits);
      
      // 3. Get sent notifications from database for the period
      const sentNotifications = await this._getSentNotifications(dateFrom, dateTo);
      
      // 4. Compare with sent notifications
      const auditResults = this._compareDeposits(fbDeposits, sentNotifications);
      
      // 5. Add metadata and statistics
      const finalResults = {
        audit: {
          period: { from: dateFrom, to: dateTo },
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - auditStartTime,
          auditId: `audit_${Date.now()}`
        },
        statistics: {
          totalKeitaroDeposits: keitaroDeposits.length,
          fbDepositsCount: fbDeposits.length,
          sentNotificationsCount: sentNotifications.notifications?.length || 0,
          extractedSubIds: sentNotifications.subIds?.length || 0,
          missingNotifications: auditResults.missing.length,
          foundNotifications: auditResults.found.length,
          successRate: fbDeposits.length > 0 
            ? Math.round((fbDeposits.length - auditResults.missing.length) / fbDeposits.length * 100) 
            : 100
        },
        results: auditResults,
        recommendations: this._generateRecommendations(auditResults)
      };
      
      logger.info('✅ Deposit audit completed', {
        auditId: finalResults.audit.auditId,
        totalFBDeposits: fbDeposits.length,
        sentNotifications: sentNotifications.notifications?.length || 0,
        extractedSubIds: sentNotifications.subIds?.length || 0,
        foundNotifications: auditResults.found.length,
        missingNotifications: auditResults.missing.length,
        successRate: `${finalResults.statistics.successRate}%`
      });
      
      return finalResults;
      
    } catch (error) {
      logger.error('❌ Deposit audit failed', {
        error: error.message,
        stack: error.stack,
        dateFrom,
        dateTo
      });
      throw error;
    }
  }
  
  /**
   * Get all deposits from Keitaro for specified period
   */
  static async _getKeitaroDeposits(dateFrom, dateTo) {
    logger.info('📊 Fetching deposits from Keitaro API', { dateFrom, dateTo });
    
    try {
      // Use Keitaro conversions endpoint to get all conversions
      const conversions = await keitaroService.getConversionsForPeriod(dateFrom, dateTo);
      
      if (!conversions || conversions.length === 0) {
        logger.warn('⚠️ No conversions found in Keitaro for period', { dateFrom, dateTo });
        return [];
      }
      
      // Filter only sale/deposit status conversions (already filtered in getConversionsForPeriod)
      // Additional filtering for deposit-specific statuses
      const deposits = conversions.filter(conversion => {
        const status = (conversion.status || '').toLowerCase();
        return status === 'sale' || status === 'lead' || status.includes('dep') || 
               status.includes('deposit') || status === 'confirmed' || status === 'approved';
      });
      
      logger.info('✅ Keitaro deposits retrieved', {
        totalConversions: conversions.length,
        deposits: deposits.length
      });
      
      return deposits;
      
    } catch (error) {
      logger.error('❌ Failed to get Keitaro deposits', { error: error.message });
      throw new Error(`Keitaro API error: ${error.message}`);
    }
  }
  
  /**
   * Filter deposits to include only FB sources
   */
  static _filterFBDeposits(deposits) {
    const fbDeposits = deposits.filter(deposit => {
      // Use trafficSourceId from the new standardized format
      const trafficSourceId = deposit.trafficSourceId || deposit.traffic_source_id;
      return trafficSourceService.isFBSource(trafficSourceId);
    });
    
    logger.info('🎯 FB deposits filtered', {
      totalDeposits: deposits.length,
      fbDeposits: fbDeposits.length,
      filterRate: deposits.length > 0 ? `${Math.round(fbDeposits.length / deposits.length * 100)}%` : '0%'
    });
    
    return fbDeposits;
  }
  
  /**
   * Get sent notifications from database for specified period
   */
  static async _getSentNotifications(dateFrom, dateTo) {
    logger.info('📋 Fetching sent notifications from database', { dateFrom, dateTo });
    
    try {
      const { NotificationLog } = require('../models');
      const { Op } = require('sequelize');
      
      const notifications = await NotificationLog.findAll({
        where: {
          type: 'deposit',
          created_at: {
            [Op.between]: [
              new Date(dateFrom + 'T00:00:00.000Z'),
              new Date(dateTo + 'T23:59:59.999Z')
            ]
          },
          success_count: {
            [Op.gt]: 0  // Only successful notifications
          }
        },
        order: [['created_at', 'DESC']]
      });
      
      // Extract SubIDs from metadata
      const subIds = [];
      notifications.forEach(notification => {
        const metadata = notification.metadata || {};
        
        // Extract SubID from various fields
        if (metadata.clickId) {
          subIds.push({
            subid: metadata.clickId,
            sentAt: notification.created_at,
            recipients: notification.recipient_count,
            success: notification.success_count
          });
        } else if (metadata.subid) {
          subIds.push({
            subid: metadata.subid,
            sentAt: notification.created_at,
            recipients: notification.recipient_count,
            success: notification.success_count
          });
        } else if (metadata.sub_id) {
          subIds.push({
            subid: metadata.sub_id,
            sentAt: notification.created_at,
            recipients: notification.recipient_count,
            success: notification.success_count
          });
        }
        
        // For regular notifications, we might need to reconstruct SubID from subid1
        // This is tricky because subid1 is only first 8 chars, we can't reconstruct full SubID
        // We'll handle this in the comparison logic instead
      });
      
      logger.info('✅ Sent notifications retrieved', {
        totalNotifications: notifications.length,
        subIdsExtracted: subIds.length
      });
      
      return {
        notifications,
        subIds
      };
      
    } catch (error) {
      logger.error('❌ Failed to get sent notifications', { error: error.message });
      throw new Error(`Database error: ${error.message}`);
    }
  }
  
  /**
   * Compare Keitaro deposits with sent notifications
   */
  static _compareDeposits(keitaroDeposits, sentNotifications) {
    // Create sets for quick lookup
    const sentSubIds = new Set(sentNotifications.subIds?.map(n => n.subid) || []);
    const sentSubId1s = new Set(); // First 8 chars of subids for partial matching
    
    // Also create a set of subid1 values from notifications for regular notifications
    sentNotifications.notifications?.forEach(notification => {
      const metadata = notification.metadata || {};
      if (metadata.subid1) {
        sentSubId1s.add(metadata.subid1);
      }
    });
    
    const missing = [];
    const found = [];
    
    for (const deposit of keitaroDeposits) {
      // Use standardized format from getConversionsForPeriod
      const subId = deposit.subId || deposit.sub_id || deposit.subid || deposit.click_id;
      
      if (!subId) {
        logger.warn('⚠️ Deposit without SubID found', { deposit });
        continue;
      }
      
      // Check exact SubID match first (for fallback notifications)
      let notificationFound = sentSubIds.has(subId);
      
      // If not found by exact match, check by subid1 (first 8 chars for regular notifications)
      if (!notificationFound) {
        const subId1 = subId.slice(0, 8);
        notificationFound = sentSubId1s.has(subId1);
      }
      
      if (notificationFound) {
        found.push({
          subid: subId,
          status: 'sent',
          deposit
        });
      } else {
        missing.push({
          subid: subId,
          status: 'missing',
          deposit,
          reason: this._determineMissingReason(deposit)
        });
      }
    }
    
    return { missing, found };
  }
  
  /**
   * Determine why a deposit might be missing
   */
  static _determineMissingReason(deposit) {
    const reasons = [];
    
    // Check if traffic source is properly mapped (use standardized format)
    const trafficSourceId = deposit.trafficSourceId || deposit.traffic_source_id;
    if (!trafficSourceService.isFBSource(trafficSourceId)) {
      reasons.push('Non-FB traffic source');
    }
    
    // Check if we have postback source mapping
    const hasKnownPostbackSource = Object.values(KNOWN_FB_POSTBACK_SOURCES)
      .some(source => source.traffic_source_id === trafficSourceId);
    
    if (!hasKnownPostbackSource) {
      reasons.push('No postback source mapping');
    }
    
    // Check timing - deposits very recent might still be processing
    const depositTime = new Date(deposit.datetime || deposit.postbackDatetime || deposit.created_at || deposit.timestamp);
    const now = new Date();
    const ageMinutes = (now - depositTime) / (1000 * 60);
    
    if (ageMinutes < 5) {
      reasons.push('Too recent (< 5 min)');
    }
    
    return reasons.length > 0 ? reasons.join(', ') : 'Unknown - likely postback not received';
  }
  
  /**
   * Generate recommendations based on audit results
   */
  static _generateRecommendations(auditResults) {
    const recommendations = [];
    
    if (auditResults.missing.length === 0) {
      recommendations.push({
        type: 'success',
        message: '✅ All FB deposits have notifications sent - system working perfectly!'
      });
      return recommendations;
    }
    
    // Analyze missing deposits by reason
    const reasonStats = {};
    auditResults.missing.forEach(item => {
      const reason = item.reason;
      reasonStats[reason] = (reasonStats[reason] || 0) + 1;
    });
    
    // Generate specific recommendations
    for (const [reason, count] of Object.entries(reasonStats)) {
      if (reason.includes('postback not received')) {
        recommendations.push({
          type: 'action',
          priority: 'high',
          message: `🚨 ${count} deposits likely missing postbacks - check payment system integration`,
          action: 'Check payment system webhook configuration'
        });
      } else if (reason.includes('postback source mapping')) {
        recommendations.push({
          type: 'config',
          priority: 'medium', 
          message: `⚙️ ${count} deposits from unmapped postback sources - consider adding to KNOWN_FB_POSTBACK_SOURCES`,
          action: 'Review and add missing postback source mappings'
        });
      } else if (reason.includes('Too recent')) {
        recommendations.push({
          type: 'info',
          priority: 'low',
          message: `⏳ ${count} very recent deposits - may still be processing`,
          action: 'Re-run audit in 10 minutes'
        });
      }
    }
    
    return recommendations;
  }
  
  /**
   * Get audit summary for a specific SubID
   */
  static async auditSpecificDeposit(subId) {
    logger.info('🔍 Auditing specific deposit', { subId });
    
    try {
      // Get deposit from Keitaro
      const depositData = await keitaroService.getClickById(subId);
      
      if (!depositData) {
        return {
          subid: subId,
          status: 'not_found_in_keitaro',
          message: 'SubID not found in Keitaro conversions'
        };
      }
      
      // Check if it's FB source
      const isFB = trafficSourceService.isFBSource(depositData.traffic_source_id);
      
      // Check notification logs - look for subid in metadata
      const { NotificationLog } = require('../models');
      const { Op } = require('sequelize');
      
      const notificationSent = await NotificationLog.findOne({
        where: {
          [Op.or]: [
            // Check for clickId in metadata (fallback notifications)
            {
              metadata: {
                clickId: subId
              }
            },
            // Check for subid1 containing this subid (regular notifications)
            // SubID format: first 8 chars used as subid1 (buyer ID)
            {
              metadata: {
                subid1: subId.slice(0, 8)
              }
            },
            // Also check if any field in metadata contains the full subid
            {
              [Op.or]: [
                { 'metadata.clickId': subId },
                { 'metadata.subid': subId },
                { 'metadata.sub_id': subId }
              ]
            }
          ]
        },
        order: [['created_at', 'DESC']]
      });
      
      return {
        subid: subId,
        status: notificationSent ? 'notification_sent' : 'notification_missing',
        deposit: depositData,
        isFBSource: isFB,
        notification: notificationSent ? {
          sentAt: notificationSent.created_at,
          recipients: notificationSent.recipient_count,
          success: notificationSent.success_count
        } : null
      };
      
    } catch (error) {
      logger.error('❌ Failed to audit specific deposit', { subId, error: error.message });
      return {
        subid: subId,
        status: 'error',
        error: error.message
      };
    }
  }
}

module.exports = DepositAuditService;