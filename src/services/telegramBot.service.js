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
      
      // Clean initialization for webhook mode
      if (config.bot.webhookMode) {
        logger.info('🔧 Initializing webhook mode...');
        
        // Clear any existing polling conflicts for webhook mode
        try {
          await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/deleteWebhook?drop_pending_updates=true`, {
            method: 'POST'
          });
          logger.info('✅ Cleared any existing webhooks/polling conflicts');
        } catch (error) {
          logger.warn('Failed to clear existing webhooks', { error: error.message });
        }
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
                       `/ban <user\\_id> - Заблокировать пользователя\n` +
                       `/unban <user\\_id> - Разблокировать пользователя\n\n` +
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
          // Escape Markdown special characters in user data
          const firstName = this._escapeMarkdown(user.first_name || 'Не указано');
          const lastName = this._escapeMarkdown(user.last_name || '');
          const username = this._escapeMarkdown(user.username || 'Не указан');
          
          const message = `📝 *Заявка отправлена*\n\n` +
                         `Ваша заявка на доступ к боту отправлена владельцам.\n` +
                         `Ожидайте подтверждения.\n\n` +
                         `*Информация о вас:*\n` +
                         `👤 Имя: ${firstName} ${lastName}\n` +
                         `🔖 Ник: @${username}\n` +
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
                `/ban <user\\_id> - Заблокировать пользователя\n` +
                `/unban <user\\_id> - Разблокировать пользователя\n\n` +
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
   * Handle /users command (owners only)
   */
  async handleUsersCommand(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    if (msg.chat.type !== 'private') return;
    
    if (!UserManagerService.isOwner(user.id)) {
      await this.sendMessage(chatId, '❌ Команда доступна только владельцам');
      return;
    }
    
    try {
      const users = await UserManagerService.getAllUsers();
      
      if (users.length === 0) {
        await this.sendMessage(chatId, '📭 Пользователей не найдено');
        return;
      }
      
      // Group users by status
      const groupedUsers = {
        approved: users.filter(u => u.status === 'approved'),
        pending: users.filter(u => u.status === 'pending'),
        rejected: users.filter(u => u.status === 'rejected'),
        banned: users.filter(u => u.status === 'banned')
      };
      
      let message = `👥 *Управление пользователями* (${users.length} всего)\n\n`;
      
      // Approved users
      if (groupedUsers.approved.length > 0) {
        message += `✅ *Одобренные (${groupedUsers.approved.length}):*\n`;
        for (const u of groupedUsers.approved.slice(0, 10)) {
          const roleEmoji = u.role === 'owner' ? '👑' : '👤';
          const displayName = this._escapeMarkdown(u.username || u.first_name || String(u.id));
          message += `${roleEmoji} @${displayName} (ID: ${u.id})\n`;
        }
        if (groupedUsers.approved.length > 10) {
          message += `... и еще ${groupedUsers.approved.length - 10}\n`;
        }
        message += '\n';
      }
      
      // Pending users  
      if (groupedUsers.pending.length > 0) {
        message += `⏳ *Ожидают (${groupedUsers.pending.length}):*\n`;
        for (const u of groupedUsers.pending.slice(0, 5)) {
          const displayName = this._escapeMarkdown(u.username || u.first_name || String(u.id));
          message += `👤 @${displayName} (ID: ${u.id})\n`;
        }
        if (groupedUsers.pending.length > 5) {
          message += `... и еще ${groupedUsers.pending.length - 5}\n`;
        }
        message += '\n';
      }
      
      // Banned users
      if (groupedUsers.banned.length > 0) {
        message += `🚫 *Заблокированные (${groupedUsers.banned.length}):*\n`;
        for (const u of groupedUsers.banned.slice(0, 5)) {
          const displayName = this._escapeMarkdown(u.username || u.first_name || String(u.id));
          message += `🚫 @${displayName} (ID: ${u.id})\n`;
        }
        if (groupedUsers.banned.length > 5) {
          message += `... и еще ${groupedUsers.banned.length - 5}\n`;
        }
        message += '\n';
      }
      
      // Management buttons
      const keyboard = {
        inline_keyboard: [
          [
            { text: '👥 Управление пользователями', callback_data: 'manage_users' },
            { text: '🚫 Управление банами', callback_data: 'manage_bans' }
          ],
          [
            { text: '📊 Полная статистика', callback_data: 'users_stats' }
          ]
        ]
      };
      
      await this.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      
    } catch (error) {
      logger.error('Error handling users command', {
        userId: user.id,
        error: error.message
      });
      await this.sendMessage(chatId, '❌ Ошибка получения списка пользователей');
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
        // Escape Markdown special characters in user data
        const firstName = this._escapeMarkdown(request.first_name || 'Не указано');
        const lastName = this._escapeMarkdown(request.last_name || '');
        const username = this._escapeMarkdown(request.username || 'Не указан');
        const userMessage = request.message ? this._escapeMarkdown(request.message) : '';
        
        const message = `📝 *Новая заявка*\n\n` +
                       `👤 Имя: ${firstName} ${lastName}\n` +
                       `🔖 Ник: @${username}\n` +
                       `🆔 ID: \`${request.user_id}\`\n` +
                       `📅 Дата: ${request.created_at.toLocaleDateString('ru-RU')}\n` +
                       `${userMessage ? `💬 Сообщение: ${userMessage}` : ''}`;
        
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
      
      // Handle different callback patterns
      if (data.startsWith('approve_') || data.startsWith('reject_')) {
        const [action, requestId] = data.split('_');
        const result = await UserManagerService.processJoinRequest(
          parseInt(requestId),
          action,
          userId
        );
        
        if (result.success) {
          // Update message with proper escaping
          const statusEmoji = action === 'approve' ? '✅' : '❌';
          const statusMessage = this._escapeMarkdown(`${statusEmoji} ${result.message}`);
          const newMessage = callbackQuery.message.text + `\n\n${statusMessage}`;
          
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
      } else if (data === 'manage_users') {
        // Show user management options
        await this.showUserManagement(chatId);
        await this.bot.answerCallbackQuery(callbackQuery.id);
        
      } else if (data === 'manage_bans') {
        // Show ban management options
        await this.showBanManagement(chatId);
        await this.bot.answerCallbackQuery(callbackQuery.id);
        
      } else if (data === 'users_stats') {
        // Show detailed user statistics
        await this.showUserStats(chatId);
        await this.bot.answerCallbackQuery(callbackQuery.id);
        
      } else if (data.startsWith('ban_user_')) {
        const targetUserId = data.split('_')[2];
        const result = await UserManagerService.banUser(parseInt(targetUserId), userId);
        
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: result.message,
          show_alert: true
        });
        
        if (result.success) {
          await this.showBanManagement(chatId);
        }
        
      } else if (data.startsWith('unban_user_')) {
        const targetUserId = data.split('_')[2];
        const result = await UserManagerService.unbanUser(parseInt(targetUserId), userId);
        
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: result.message,
          show_alert: true
        });
        
        if (result.success) {
          await this.showBanManagement(chatId);
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
        const username = this._escapeMarkdown(result.user.username || 'Не указан');
        const message = `🚫 Пользователь заблокирован\n\n` +
                       `ID: \`${userId}\`\n` +
                       `Ник: @${username}`;
        
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
        const username = this._escapeMarkdown(result.user.username || 'Не указан');
        const message = `✅ Пользователь разблокирован\n\n` +
                       `ID: \`${userId}\`\n` +
                       `Ник: @${username}`;
        
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
        '{clickId}': this._escapeHtml(data.clickId || 'N/A'),
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
      // Escape Markdown special characters in user data
      const firstName = this._escapeMarkdown(user.first_name || 'Не указано');
      const lastName = this._escapeMarkdown(user.last_name || '');
      const username = this._escapeMarkdown(user.username || 'Не указан');
      
      const message = `🔔 *Новая заявка на доступ*\n\n` +
                     `👤 Имя: ${firstName} ${lastName}\n` +
                     `🔖 Ник: @${username}\n` +
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
  
  _escapeMarkdown(text) {
    if (typeof text !== 'string') {
      return String(text || '');
    }
    
    // Escape special Markdown characters
    return text
      .replace(/\\/g, '\\\\')  // Backslash must be escaped first
      .replace(/\*/g, '\\*')   // Asterisk
      .replace(/_/g, '\\_')    // Underscore
      .replace(/\[/g, '\\[')   // Square brackets
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')   // Parentheses
      .replace(/\)/g, '\\)')
      .replace(/~/g, '\\~')    // Tilde
      .replace(/`/g, '\\`')    // Backtick
      .replace(/>/g, '\\>')    // Greater than
      .replace(/#/g, '\\#')    // Hash
      .replace(/\+/g, '\\+')   // Plus
      .replace(/-/g, '\\-')    // Minus
      .replace(/=/g, '\\=')    // Equals
      .replace(/\|/g, '\\|')   // Pipe
      .replace(/\{/g, '\\{')   // Curly braces
      .replace(/\}/g, '\\}')
      .replace(/\./g, '\\.')   // Period
      .replace(/!/g, '\\!');   // Exclamation
  }
  
  _formatPayout(payout) {
    try {
      const amount = parseFloat(payout) || 0;
      return `$${amount.toFixed(2)}`;
    } catch (error) {
      return '$0.00';
    }
  }

  /**
   * Show user management interface
   */
  async showUserManagement(chatId) {
    try {
      const users = await UserManagerService.getAllUsers();
      const approvedUsers = users.filter(u => u.status === 'approved' && u.role !== 'owner');
      
      if (approvedUsers.length === 0) {
        await this.sendMessage(chatId, '📭 Нет пользователей для управления');
        return;
      }
      
      let message = `👥 *Управление пользователями*\n\n`;
      message += `Выберите пользователя для действий:\n\n`;
      
      const keyboard = {
        inline_keyboard: []
      };
      
      // Show first 8 users with buttons
      for (let i = 0; i < Math.min(approvedUsers.length, 8); i++) {
        const user = approvedUsers[i];
        const rawName = user.username ? `@${user.username}` : (user.first_name || `ID: ${user.id}`);
        const displayName = this._escapeMarkdown(rawName);
        
        keyboard.inline_keyboard.push([
          { text: `🚫 Забанить ${displayName}`, callback_data: `ban_user_${user.id}` }
        ]);
      }
      
      if (approvedUsers.length > 8) {
        message += `\n_Показаны первые 8 из ${approvedUsers.length} пользователей_`;
      }
      
      await this.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      
    } catch (error) {
      logger.error('Error showing user management', { error: error.message });
      await this.sendMessage(chatId, '❌ Ошибка загрузки управления пользователями');
    }
  }

  /**
   * Show ban management interface
   */
  async showBanManagement(chatId) {
    try {
      const users = await UserManagerService.getAllUsers();
      const bannedUsers = users.filter(u => u.status === 'banned');
      
      if (bannedUsers.length === 0) {
        await this.sendMessage(chatId, '✅ Нет заблокированных пользователей');
        return;
      }
      
      let message = `🚫 *Заблокированные пользователи*\n\n`;
      
      const keyboard = {
        inline_keyboard: []
      };
      
      // Show all banned users with unban buttons
      for (const user of bannedUsers) {
        const rawName = user.username ? `@${user.username}` : (user.first_name || `ID: ${user.id}`);
        const displayName = this._escapeMarkdown(rawName);
        message += `🚫 ${displayName} (ID: ${user.id})\n`;
        
        keyboard.inline_keyboard.push([
          { text: `✅ Разблокировать ${displayName}`, callback_data: `unban_user_${user.id}` }
        ]);
      }
      
      await this.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      
    } catch (error) {
      logger.error('Error showing ban management', { error: error.message });
      await this.sendMessage(chatId, '❌ Ошибка загрузки управления банами');
    }
  }

  /**
   * Show detailed user statistics
   */
  async showUserStats(chatId) {
    try {
      const stats = await UserManagerService.getUserStats();
      const users = await UserManagerService.getAllUsers();
      
      // Calculate additional stats
      const recentUsers = users.filter(u => {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return new Date(u.created_at) > dayAgo;
      }).length;
      
      const activeUsers = users.filter(u => {
        if (!u.last_activity) return false;
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return new Date(u.last_activity) > weekAgo;
      }).length;
      
      const message = `📊 *Детальная статистика пользователей*\n\n` +
                     `👥 Всего пользователей: *${stats.total}*\n` +
                     `✅ Одобрено: *${stats.approved}*\n` +
                     `⏳ Ожидают: *${stats.pending}*\n` +
                     `❌ Отклонено: *${stats.rejected}*\n` +
                     `🚫 Заблокировано: *${stats.banned}*\n` +
                     `👑 Владельцы: *${stats.owners}*\n\n` +
                     `📈 *Активность:*\n` +
                     `🆕 Новых за 24ч: *${recentUsers}*\n` +
                     `🔥 Активных за неделю: *${activeUsers}*\n` +
                     `📝 Заявок на рассмотрении: *${stats.pendingRequests}*\n\n` +
                     `📅 Данные актуальны на: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;
      
      await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      logger.error('Error showing user stats', { error: error.message });
      await this.sendMessage(chatId, '❌ Ошибка загрузки статистики');
    }
  }
}

// Create singleton instance
const telegramBotService = new TelegramBotService();

module.exports = telegramBotService;