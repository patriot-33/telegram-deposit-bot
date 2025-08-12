/**
 * Telegram Bot Service
 * Senior PM: Complete bot with polling, user management, and broadcasting
 */

const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/config');
const logger = require('../utils/logger');
const UserManagerService = require('./userManager.service');
const { MESSAGE_TEMPLATES } = require('../config/constants');
const { NotificationLog } = require('../models');

class TelegramBotService {
  constructor() {
    this.bot = null;
    this.isInitialized = false;
    this.lastBroadcastStats = {
      total: 0,
      success: 0,
      failed: 0
    };
  }
  
  /**
   * Initialize bot with polling or webhook
   */
  async initialize() {
    try {
      if (this.isInitialized) {
        return true;
      }
      
      // AGGRESSIVE cleanup to stop all conflicting bot instances
      try {
        logger.info('🔧 AGGRESSIVE cleanup of Telegram bot conflicts...');
        
        // Step 1: Force webhook to disable all polling instances
        logger.info('Step 1: Setting temporary webhook to stop polling conflicts');
        const setWebhook = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://httpbin.org/post',  // Temporary dummy webhook
            drop_pending_updates: true
          })
        });
        const setResult = await setWebhook.json();
        logger.info('Temporary webhook set', { success: setResult.ok });
        
        // Step 2: Wait for all polling to stop
        logger.info('Step 2: Waiting for polling instances to stop...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Step 3: Delete webhook to enable polling
        logger.info('Step 3: Deleting webhook to enable polling');
        const deleteWebhook = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/deleteWebhook?drop_pending_updates=true`, {
          method: 'POST'
        });
        const deleteResult = await deleteWebhook.json();
        logger.info('Webhook deleted', { success: deleteResult.ok });
        
        // Step 4: Final wait before starting polling
        logger.info('Step 4: Final cleanup delay...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        logger.info('✅ AGGRESSIVE cleanup completed');
        
      } catch (error) {
        logger.warn('Failed to cleanup bot state', { error: error.message });
      }
      
      const options = {
        polling: config.bot.pollingEnabled,
        webHook: config.bot.webhookMode,
        request: {
          agentOptions: {
            keepAlive: true,
            family: 4
          }
        }
      };
      
      this.bot = new TelegramBot(config.telegram.botToken, options);
      
      if (config.bot.webhookMode && config.bot.webhookUrl) {
        // Set webhook for Telegram
        await this.bot.setWebHook(config.bot.webhookUrl);
        this.setupWebhookHandlers();
        logger.info('✅ Telegram bot initialized with webhook', { 
          url: config.bot.webhookUrl 
        });
      } else if (config.bot.pollingEnabled) {
        this.setupPollingHandlers();
        logger.info('✅ Telegram bot initialized with polling');
      } else {
        this.setupPollingHandlers(); // Fallback to polling handlers for webhook mode
        logger.info('✅ Telegram bot initialized (handlers only)');
      }
      
      this.isInitialized = true;
      return true;
      
    } catch (error) {
      logger.error('❌ Failed to initialize Telegram bot', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Setup webhook handlers (no-op - handled by main Express server)
   */
  setupWebhookHandlers() {
    logger.info('📱 Telegram bot webhook handlers configured (integrated with main server)');
  }
  
  /**
   * Setup polling event handlers
   */
  setupPollingHandlers() {
    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      await this.handleStartCommand(msg);
    });
    
    // Handle /help command
    this.bot.onText(/\/help/, async (msg) => {
      await this.handleHelpCommand(msg);
    });
    
    // Handle /status command (owners only)
    this.bot.onText(/\/status/, async (msg) => {
      await this.handleStatusCommand(msg);
    });
    
    // Handle /users command (owners only)
    this.bot.onText(/\/users/, async (msg) => {
      await this.handleUsersCommand(msg);
    });
    
    // Handle /requests command (owners only)
    this.bot.onText(/\/requests/, async (msg) => {
      await this.handleRequestsCommand(msg);
    });
    
    // Handle /ban command (owners only)
    this.bot.onText(/\/ban (.+)/, async (msg, match) => {
      await this.handleBanCommand(msg, match[1]);
    });
    
    // Handle /unban command (owners only)
    this.bot.onText(/\/unban (.+)/, async (msg, match) => {
      await this.handleUnbanCommand(msg, match[1]);
    });
    
    // Handle callback queries (inline buttons)
    this.bot.on('callback_query', async (callbackQuery) => {
      await this.handleCallbackQuery(callbackQuery);
    });
    
    // Error handling
    this.bot.on('error', (error) => {
      logger.error('Telegram bot error', {
        error: error.message,
        code: error.code
      });
    });
    
    // Polling error handling with conflict resolution
    this.bot.on('polling_error', async (error) => {
      logger.error('Telegram polling error', {
        error: error.message,
        code: error.code
      });
      
      // If it's a 409 conflict, try to resolve it
      if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
        logger.warn('🔧 Attempting to resolve 409 polling conflict...');
        
        try {
          // Force set and then delete webhook to clear conflicts
          await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: 'https://httpbin.org/post',
              drop_pending_updates: true
            })
          });
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/deleteWebhook?drop_pending_updates=true`, {
            method: 'POST'
          });
          
          logger.info('✅ Conflict resolution attempt completed');
        } catch (resolveError) {
          logger.warn('Failed to resolve polling conflict', { error: resolveError.message });
        }
      }
    });
    
    logger.info('📱 Telegram bot polling handlers configured');
  }
  
  /**
   * Handle /start command
   */
  async handleStartCommand(msg) {
    const user = msg.from;
    const chatId = msg.chat.id;
    
    try {
      logger.info('Start command received', {
        userId: user.id,
        username: user.username,
        chatType: msg.chat.type
      });
      
      // Only allow private chats
      if (msg.chat.type !== 'private') {
        return;
      }
      
      // Create or update user
      const dbUser = await UserManagerService.createOrUpdateUser(user);
      
      if (UserManagerService.isOwner(user.id)) {
        // Owner welcome message
        const message = `👑 *Добро пожаловать, Владелец!*\n\n` +
                       `Доступные команды:\n` +
                       `/status - Статистика пользователей\n` +
                       `/users - Список пользователей\n` +
                       `/requests - Заявки на вступление\n` +
                       `/ban <user_id> - Заблокировать пользователя\n` +
                       `/unban <user_id> - Разблокировать пользователя\n\n` +
                       `Бот готов к работе! 🚀`;
        
        await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
      } else if (dbUser.status === 'approved') {
        // Approved user message
        const message = `✅ *Добро пожаловать!*\n\n` +
                       `Ваш доступ к боту одобрен.\n` +
                       `Вы будете получать уведомления о депозитах.\n\n` +
                       `Используйте /help для получения справки.`;
        
        await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
      } else if (dbUser.status === 'pending') {
        // Pending user - create join request
        const requestResult = await UserManagerService.createJoinRequest(user);
        
        if (requestResult.success) {
          const message = `📝 *Заявка отправлена*\n\n` +
                         `Ваша заявка на доступ к боту отправлена владельцам.\n` +
                         `Ожидайте подтверждения.\n\n` +
                         `*Информация о вас:*\n` +
                         `👤 Имя: ${user.first_name || 'Не указано'} ${user.last_name || ''}\n` +
                         `🔖 Ник: @${user.username || 'Не указан'}\n` +
                         `🆔 ID: \`${user.id}\``;
          
          await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
          
          // Notify owners about new request
          await this.notifyOwnersAboutNewRequest(user, requestResult.request);
          
        } else {
          await this.sendMessage(chatId, requestResult.message);
        }
        
      } else if (dbUser.status === 'rejected') {
        const message = `❌ *Доступ отклонен*\n\n` +
                       `К сожалению, ваша заявка на доступ к боту была отклонена.`;
        
        await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
      } else if (dbUser.status === 'banned') {
        const message = `🚫 *Доступ заблокирован*\n\n` +
                       `Ваш доступ к боту заблокирован.`;
        
        await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
      
    } catch (error) {
      logger.error('Error handling start command', {
        userId: user.id,
        error: error.message
      });
      
      await this.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  }
  
  /**
   * Handle /help command
   */
  async handleHelpCommand(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    if (msg.chat.type !== 'private') return;
    
    let message = `ℹ️ *Справка по боту*\n\n`;
    
    if (UserManagerService.isOwner(user.id)) {
      message += `*Команды владельца:*\n` +
                `/status - Статистика пользователей\n` +
                `/users - Список пользователей\n` +
                `/requests - Заявки на вступление\n` +
                `/ban <user_id> - Заблокировать пользователя\n` +
                `/unban <user_id> - Разблокировать пользователя\n\n` +
                `*Общие команды:*\n` +
                `/help - Эта справка\n\n` +
                `Бот автоматически отправляет уведомления о депозитах всем одобренным пользователям.`;
    } else {
      message += `*Доступные команды:*\n` +
                `/help - Эта справка\n\n` +
                `Бот отправляет уведомления о депозитах.\n` +
                `Если у вас нет доступа, отправьте /start для подачи заявки.`;
    }
    
    await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }
  
  /**
   * Handle /status command (owners only)
   */
  async handleStatusCommand(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    if (msg.chat.type !== 'private') return;
    
    if (!UserManagerService.isOwner(user.id)) {
      await this.sendMessage(chatId, '❌ Команда доступна только владельцам');
      return;
    }
    
    try {
      const stats = await UserManagerService.getUserStats();
      
      const message = `📊 *Статистика пользователей*\n\n` +
                     `👥 Всего пользователей: ${stats.total}\n` +
                     `✅ Одобрено: ${stats.approved}\n` +
                     `⏳ Ожидает: ${stats.pending}\n` +
                     `❌ Отклонено: ${stats.rejected}\n` +
                     `🚫 Заблокировано: ${stats.banned}\n` +
                     `👑 Владельцев: ${stats.owners}\n\n` +
                     `📝 Новых заявок: ${stats.pendingRequests}\n\n` +
                     `📈 Последняя рассылка:\n` +
                     `└ Отправлено: ${this.lastBroadcastStats.success}/${this.lastBroadcastStats.total}`;
      
      await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      logger.error('Error handling status command', {
        userId: user.id,
        error: error.message
      });
      await this.sendMessage(chatId, '❌ Ошибка получения статистики');
    }
  }
  
  /**
   * Handle /requests command (owners only)
   */
  async handleRequestsCommand(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    if (msg.chat.type !== 'private') return;
    
    if (!UserManagerService.isOwner(user.id)) {
      await this.sendMessage(chatId, '❌ Команда доступна только владельцам');
      return;
    }
    
    try {
      const requests = await UserManagerService.getPendingRequests();
      
      if (requests.length === 0) {
        await this.sendMessage(chatId, '✅ Нет новых заявок');
        return;
      }
      
      for (const request of requests) {
        const message = `📝 *Новая заявка*\n\n` +
                       `👤 Имя: ${request.first_name || 'Не указано'} ${request.last_name || ''}\n` +
                       `🔖 Ник: @${request.username || 'Не указан'}\n` +
                       `🆔 ID: \`${request.user_id}\`\n` +
                       `📅 Дата: ${request.created_at.toLocaleDateString('ru-RU')}\n` +
                       `${request.message ? `💬 Сообщение: ${request.message}` : ''}`;
        
        const keyboard = {
          inline_keyboard: [
            [
              { text: '✅ Одобрить', callback_data: `approve_${request.id}` },
              { text: '❌ Отклонить', callback_data: `reject_${request.id}` }
            ]
          ]
        };
        
        await this.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
      
    } catch (error) {
      logger.error('Error handling requests command', {
        userId: user.id,
        error: error.message
      });
      await this.sendMessage(chatId, '❌ Ошибка получения заявок');
    }
  }
  
  /**
   * Handle callback queries (inline buttons)
   */
  async handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    try {
      if (!UserManagerService.isOwner(userId)) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ Недостаточно прав',
          show_alert: true
        });
        return;
      }
      
      const [action, requestId] = data.split('_');
      
      if (action === 'approve' || action === 'reject') {
        const result = await UserManagerService.processJoinRequest(
          parseInt(requestId),
          action,
          userId
        );
        
        if (result.success) {
          // Update message
          const newMessage = callbackQuery.message.text + 
                           `\n\n${action === 'approve' ? '✅' : '❌'} ${result.message}`;
          
          await this.bot.editMessageText(newMessage, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            parse_mode: 'Markdown'
          });
          
          // Notify user about decision
          if (result.user) {
            await this.notifyUserAboutDecision(result.user, result.action);
          }
          
          await this.bot.answerCallbackQuery(callbackQuery.id, {
            text: result.message
          });
          
        } else {
          await this.bot.answerCallbackQuery(callbackQuery.id, {
            text: result.message,
            show_alert: true
          });
        }
      }
      
    } catch (error) {
      logger.error('Error handling callback query', {
        userId,
        data,
        error: error.message
      });
      
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Произошла ошибка',
        show_alert: true
      });
    }
  }
  
  /**
   * Handle /ban command (owners only)
   */
  async handleBanCommand(msg, userIdStr) {
    const chatId = msg.chat.id;
    const ownerId = msg.from.id;
    
    if (msg.chat.type !== 'private') return;
    
    if (!UserManagerService.isOwner(ownerId)) {
      await this.sendMessage(chatId, '❌ Команда доступна только владельцам');
      return;
    }
    
    try {
      const userId = parseInt(userIdStr);
      if (isNaN(userId)) {
        await this.sendMessage(chatId, '❌ Неверный формат ID пользователя');
        return;
      }
      
      const result = await UserManagerService.banUser(userId, ownerId);
      
      if (result.success) {
        const message = `🚫 Пользователь заблокирован\n\n` +
                       `ID: \`${userId}\`\n` +
                       `Ник: @${result.user.username || 'Не указан'}`;
        
        await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
        // Notify banned user
        try {
          await this.sendMessage(userId, '🚫 Ваш доступ к боту заблокирован.');
        } catch (e) {
          // User might have blocked the bot
        }
        
      } else {
        await this.sendMessage(chatId, `❌ ${result.message}`);
      }
      
    } catch (error) {
      logger.error('Error handling ban command', {
        ownerId,
        userIdStr,
        error: error.message
      });
      await this.sendMessage(chatId, '❌ Ошибка блокировки пользователя');
    }
  }
  
  /**
   * Handle /unban command (owners only)
   */
  async handleUnbanCommand(msg, userIdStr) {
    const chatId = msg.chat.id;
    const ownerId = msg.from.id;
    
    if (msg.chat.type !== 'private') return;
    
    if (!UserManagerService.isOwner(ownerId)) {
      await this.sendMessage(chatId, '❌ Команда доступна только владельцам');
      return;
    }
    
    try {
      const userId = parseInt(userIdStr);
      if (isNaN(userId)) {
        await this.sendMessage(chatId, '❌ Неверный формат ID пользователя');
        return;
      }
      
      const result = await UserManagerService.unbanUser(userId, ownerId);
      
      if (result.success) {
        const message = `✅ Пользователь разблокирован\n\n` +
                       `ID: \`${userId}\`\n` +
                       `Ник: @${result.user.username || 'Не указан'}`;
        
        await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
        // Notify unbanned user
        try {
          await this.sendMessage(userId, '✅ Ваш доступ к боту восстановлен!');
        } catch (e) {
          // User might have blocked the bot
        }
        
      } else {
        await this.sendMessage(chatId, `❌ ${result.message}`);
      }
      
    } catch (error) {
      logger.error('Error handling unban command', {
        ownerId,
        userIdStr,
        error: error.message
      });
      await this.sendMessage(chatId, '❌ Ошибка разблокировки пользователя');
    }
  }
  
  /**
   * Send deposit notification to all approved users
   */
  async sendDepositNotification(depositData) {
    try {
      logger.info('📱 Starting deposit notification broadcast', {
        subid1: depositData.subid1,
        payout: depositData.payout,
        geo: depositData.geo
      });
      
      const users = await UserManagerService.getApprovedUsers();
      const message = this._formatDepositMessage(depositData);
      
      let successCount = 0;
      let failedCount = 0;
      
      // Send to all approved users
      for (const user of users) {
        try {
          await this.sendMessage(user.id, message, { parse_mode: 'HTML' });
          successCount++;
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
          
        } catch (error) {
          failedCount++;
          logger.warn('Failed to send notification to user', {
            userId: user.id,
            username: user.username,
            error: error.message
          });
        }
      }
      
      // Update stats
      this.lastBroadcastStats = {
        total: users.length,
        success: successCount,
        failed: failedCount
      };
      
      // Log notification
      await NotificationLog.create({
        type: 'deposit',
        recipient_count: users.length,
        success_count: successCount,
        failed_count: failedCount,
        message_text: message,
        metadata: depositData
      });
      
      logger.info('✅ Deposit notification broadcast completed', {
        total: users.length,
        success: successCount,
        failed: failedCount,
        payout: depositData.payout
      });
      
      return {
        success: true,
        stats: {
          total: users.length,
          success: successCount,
          failed: failedCount
        }
      };
      
    } catch (error) {
      logger.error('❌ Failed to send deposit notification', {
        error: error.message,
        depositData
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Format deposit message
   */
  _formatDepositMessage(data) {
    try {
      let message = MESSAGE_TEMPLATES.DEPOSIT_NOTIFICATION;
      
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
      
      Object.entries(replacements).forEach(([placeholder, value]) => {
        message = message.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
      });
      
      message += `\n\n<i>🕒 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`;
      
      return message;
    } catch (error) {
      logger.error('Error formatting deposit message', {
        error: error.message,
        data
      });
      
      return `🥳 Новый депозит!\n\nПлательщик: ${data.subid1 || 'N/A'}\nСумма: ${this._formatPayout(data.payout)}\nИсточник: ${data.traffic_source_name || 'N/A'}`;
    }
  }
  
  /**
   * Notify owners about new join request
   */
  async notifyOwnersAboutNewRequest(user, request) {
    try {
      const message = `🔔 *Новая заявка на доступ*\n\n` +
                     `👤 Имя: ${user.first_name || 'Не указано'} ${user.last_name || ''}\n` +
                     `🔖 Ник: @${user.username || 'Не указан'}\n` +
                     `🆔 ID: \`${user.id}\`\n` +
                     `📅 Дата: ${new Date().toLocaleDateString('ru-RU')}\n\n` +
                     `Используйте /requests для обработки заявок.`;
      
      for (const ownerId of config.owners) {
        try {
          await this.sendMessage(ownerId, message, { parse_mode: 'Markdown' });
        } catch (error) {
          logger.warn('Failed to notify owner about new request', {
            ownerId,
            error: error.message
          });
        }
      }
    } catch (error) {
      logger.error('Error notifying owners about new request', {
        userId: user.id,
        error: error.message
      });
    }
  }
  
  /**
   * Notify user about approval/rejection decision
   */
  async notifyUserAboutDecision(user, action) {
    try {
      let message;
      
      if (action === 'approved') {
        message = `✅ *Поздравляем!*\n\n` +
                 `Ваша заявка на доступ к боту одобрена.\n` +
                 `Теперь вы будете получать уведомления о депозитах.\n\n` +
                 `Добро пожаловать! 🎉`;
      } else {
        message = `❌ *Заявка отклонена*\n\n` +
                 `К сожалению, ваша заявка на доступ к боту была отклонена.`;
      }
      
      await this.sendMessage(user.id, message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      logger.warn('Failed to notify user about decision', {
        userId: user.id,
        action,
        error: error.message
      });
    }
  }
  
  /**
   * Send message with retry logic
   */
  async sendMessage(chatId, message, options = {}) {
    const maxRetries = 3;
    const retryDelay = 1000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.bot.sendMessage(chatId, message, options);
        return result;
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        
        if (isLastAttempt) {
          throw error;
        }
        
        logger.warn(`Message send attempt ${attempt} failed`, {
          chatId,
          error: error.message,
          attempt
        });
        
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }
  
  /**
   * Health check
   */
  async checkHealth() {
    try {
      if (!this.bot) {
        return {
          healthy: false,
          error: 'Bot not initialized'
        };
      }
      
      const startTime = Date.now();
      const botInfo = await this.bot.getMe();
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        botInfo: {
          username: botInfo.username,
          firstName: botInfo.first_name,
          id: botInfo.id
        },
        responseTime,
        isPolling: config.bot.pollingEnabled,
        lastBroadcast: this.lastBroadcastStats
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
  
  /**
   * Send test message to owners
   */
  async sendTestMessage() {
    try {
      const message = `🧪 <b>Тест системы</b>\n\n` +
                     `Бот работает корректно!\n\n` +
                     `<i>Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`;
      
      let successCount = 0;
      
      for (const ownerId of config.owners) {
        try {
          await this.sendMessage(ownerId, message, { parse_mode: 'HTML' });
          successCount++;
        } catch (error) {
          logger.warn('Failed to send test message to owner', {
            ownerId,
            error: error.message
          });
        }
      }
      
      return {
        success: successCount > 0,
        sent: successCount,
        total: config.owners.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Utility methods
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
  
  _formatPayout(payout) {
    try {
      const amount = parseFloat(payout) || 0;
      return `$${amount.toFixed(2)}`;
    } catch (error) {
      return '$0.00';
    }
  }
}

// Create singleton instance
const telegramBotService = new TelegramBotService();

module.exports = telegramBotService;