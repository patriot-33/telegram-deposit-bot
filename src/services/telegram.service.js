/**
 * Telegram Service
 * Senior PM: Enterprise-grade Telegram Bot API integration
 */

const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/config');
const logger = require('../utils/logger');
const { MESSAGE_TEMPLATES, API_CONFIG, ERROR_CODES } = require('../config/constants');

class TelegramService {
  constructor() {
    this.botToken = config.telegram.botToken;
    this.chatId = config.telegram.chatId;
    this.timeout = API_CONFIG.TELEGRAM.TIMEOUT;
    
    // Initialize Telegram Bot
    try {
      this.bot = new TelegramBot(this.botToken, {
        polling: false, // We don't need polling for webhook-only mode
        request: {
          agentOptions: {
            keepAlive: true,
            family: 4
          }
        }
      });
      
      logger.info('✅ Telegram bot initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize Telegram bot', {
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Send deposit notification to Telegram
   * Core notification function
   */
  async sendDepositNotification(depositData) {
    try {
      logger.info('📱 Sending deposit notification', {
        subid1: depositData.subid1,
        payout: depositData.payout,
        geo: depositData.geo,
        trafficSource: depositData.traffic_source_name
      });
      
      const message = this._formatDepositMessage(depositData);
      
      const result = await this._sendMessageWithRetry(message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      
      logger.info('✅ Deposit notification sent successfully', {
        messageId: result.message_id,
        chatId: result.chat.id,
        payout: depositData.payout
      });
      
      return {
        success: true,
        messageId: result.message_id,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ Failed to send deposit notification', {
        error: error.message,
        depositData: depositData
      });
      
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Send error notification to Telegram
   */
  async sendErrorNotification(errorData) {
    try {
      logger.info('⚠️ Sending error notification', {
        error: errorData.error,
        subid: errorData.subid
      });
      
      const message = this._formatErrorMessage(errorData);
      
      const result = await this._sendMessageWithRetry(message, {
        parse_mode: 'HTML'
      });
      
      logger.info('✅ Error notification sent', {
        messageId: result.message_id
      });
      
      return {
        success: true,
        messageId: result.message_id
      };
    } catch (error) {
      logger.error('❌ Failed to send error notification', {
        error: error.message,
        originalError: errorData.error
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Send system status notification
   */
  async sendSystemStatus(statusData) {
    try {
      logger.info('📊 Sending system status');
      
      const message = this._formatSystemStatusMessage(statusData);
      
      const result = await this._sendMessageWithRetry(message, {
        parse_mode: 'HTML'
      });
      
      logger.info('✅ System status sent', {
        messageId: result.message_id
      });
      
      return {
        success: true,
        messageId: result.message_id
      };
    } catch (error) {
      logger.error('❌ Failed to send system status', {
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Format deposit message according to specification
   */
  _formatDepositMessage(data) {
    try {
      // Use template and replace placeholders
      let message = MESSAGE_TEMPLATES.DEPOSIT_NOTIFICATION;
      
      // Replace all placeholders
      const replacements = {
        '{subid1}': this._escapeHtml(data.subid1 || 'N/A'),
        '{geo}': this._escapeHtml(data.geo || 'N/A'),
        '{traffic_source_name}': this._escapeHtml(data.traffic_source_name || 'N/A'),
        '{offer_name}': this._escapeHtml(data.offer_name || 'N/A'),
        '{campaign_name}': this._escapeHtml(data.campaign_name || 'N/A'),
        '{subid2}': this._escapeHtml(data.subid2 || 'N/A'),
        '{subid4}': this._escapeHtml(data.subid4 || 'N/A'),
        '{payout}': this._formatPayout(data.payout)
      };
      
      // Apply replacements
      Object.entries(replacements).forEach(([placeholder, value]) => {
        message = message.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
      });
      
      // Add timestamp for tracking
      message += `\n\n<i>🕒 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`;
      
      return message;
    } catch (error) {
      logger.error('Error formatting deposit message', {
        error: error.message,
        data
      });
      
      // Fallback simple message
      return `🥳 Новый депозит!\n\nПлательщик: ${data.subid1 || 'N/A'}\nСумма: ${this._formatPayout(data.payout)}\nИсточник: ${data.traffic_source_name || 'N/A'}`;
    }
  }
  
  /**
   * Format error message
   */
  _formatErrorMessage(errorData) {
    try {
      let message = MESSAGE_TEMPLATES.ERROR_NOTIFICATION;
      
      const replacements = {
        '{timestamp}': new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
        '{error}': this._escapeHtml(errorData.error || 'Unknown error'),
        '{subid}': this._escapeHtml(errorData.subid || 'N/A')
      };
      
      Object.entries(replacements).forEach(([placeholder, value]) => {
        message = message.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
      });
      
      return message;
    } catch (error) {
      return `⚠️ Ошибка системы: ${errorData.error || 'Unknown error'}`;
    }
  }
  
  /**
   * Format system status message
   */
  _formatSystemStatusMessage(statusData) {
    try {
      let message = MESSAGE_TEMPLATES.SYSTEM_STATUS;
      
      const replacements = {
        '{uptime}': this._formatUptime(statusData.uptime || 0),
        '{processed_deposits}': statusData.processed_deposits || 0,
        '{last_activity}': statusData.last_activity || 'N/A'
      };
      
      Object.entries(replacements).forEach(([placeholder, value]) => {
        message = message.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
      });
      
      return message;
    } catch (error) {
      return '📊 Система работает нормально';
    }
  }
  
  /**
   * Send message with retry logic
   */
  async _sendMessageWithRetry(message, options = {}) {
    const maxAttempts = API_CONFIG.TELEGRAM.RETRY_ATTEMPTS;
    const retryDelay = API_CONFIG.TELEGRAM.RETRY_DELAY;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug(`Sending Telegram message (attempt ${attempt}/${maxAttempts})`);
        
        const result = await this.bot.sendMessage(this.chatId, message, {
          ...options,
          timeout: this.timeout
        });
        
        return result;
      } catch (error) {
        const isLastAttempt = attempt === maxAttempts;
        
        logger.warn(`Telegram send attempt ${attempt} failed`, {
          error: error.message,
          code: error.code,
          isLastAttempt
        });
        
        if (isLastAttempt) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }
  
  /**
   * Escape HTML characters for Telegram
   */
  _escapeHtml(text) {
    if (typeof text !== 'string') {
      return String(text || '');
    }
    
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  
  /**
   * Format payout amount
   */
  _formatPayout(payout) {
    try {
      const amount = parseFloat(payout) || 0;
      return `$${amount.toFixed(2)}`;
    } catch (error) {
      return '$0.00';
    }
  }
  
  /**
   * Format uptime
   */
  _formatUptime(seconds) {
    try {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      
      if (days > 0) {
        return `${days}д ${hours}ч ${minutes}м`;
      } else if (hours > 0) {
        return `${hours}ч ${minutes}м`;
      } else {
        return `${minutes}м`;
      }
    } catch (error) {
      return 'N/A';
    }
  }
  
  /**
   * Health check for Telegram Bot API
   */
  async checkHealth() {
    try {
      logger.debug('Checking Telegram Bot API health');
      
      const startTime = Date.now();
      
      // Get bot info to check API connectivity
      const botInfo = await this.bot.getMe();
      
      const responseTime = Date.now() - startTime;
      
      logger.info('Telegram Bot API health check passed', {
        botUsername: botInfo.username,
        responseTime
      });
      
      return {
        healthy: true,
        botInfo: {
          username: botInfo.username,
          firstName: botInfo.first_name,
          id: botInfo.id
        },
        responseTime,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Telegram Bot API health check failed', {
        error: error.message
      });
      
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Test message sending
   */
  async sendTestMessage() {
    try {
      const testMessage = `🧪 <b>Test Message</b>\n\nBot is working correctly!\n\n<i>Time: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`;
      
      const result = await this._sendMessageWithRetry(testMessage, {
        parse_mode: 'HTML'
      });
      
      logger.info('Test message sent successfully', {
        messageId: result.message_id
      });
      
      return {
        success: true,
        messageId: result.message_id
      };
    } catch (error) {
      logger.error('Failed to send test message', {
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Create singleton instance
const telegramService = new TelegramService();

module.exports = telegramService;