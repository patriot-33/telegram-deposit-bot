/**
 * Main Application Entry Point
 * Senior PM: Production-ready Express server with comprehensive middleware
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import configuration and utilities
const config = require('./config/config');
const logger = require('./utils/logger');
const WebhookController = require('./controllers/webhook.controller');
const trafficSourceService = require('./services/trafficSource.service');

// Import services for health checks
const keitaroService = require('./services/keitaro.service');
const telegramBotService = require('./services/telegramBot.service');

// Import database models
const { initializeDatabase, checkDatabaseHealth } = require('./models');

class TelegramDepositBot {
  constructor() {
    this.app = express();
    this.server = null;
    this.startTime = Date.now();
    this.processedDeposits = 0;
    this.lastActivity = null;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }
  
  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Trust proxy (for Render.com and other reverse proxies)
    this.app.set('trust proxy', 1);
    
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable for API-only server
      crossOriginEmbedderPolicy: false
    }));
    
    // CORS middleware
    this.app.use(cors({
      origin: config.env === 'production' ? false : true,
      credentials: false
    }));
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.security.rateLimit.windowMs,
      max: config.security.rateLimit.max,
      message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded'
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health' || req.path === '/';
      }
    });
    
    this.app.use(limiter);
    
    // Body parsing middleware
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    
    // Request logging middleware
    this.app.use((req, res, next) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      req.requestId = requestId;
      
      logger.info('📥 Incoming request', {
        requestId,
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentLength: req.get('Content-Length') || 0
      });
      
      // Track last activity
      this.lastActivity = new Date().toISOString();
      
      next();
    });
  }
  
  /**
   * Setup application routes
   */
  setupRoutes() {
    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Telegram Deposit Bot',
        version: '1.0.0',
        status: 'running',
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        environment: config.env,
        timestamp: new Date().toISOString()
      });
    });
    
    // Health check endpoint
    this.app.get('/health', WebhookController.healthCheck);
    
    // Postback webhook endpoint
    this.app.get('/postback', WebhookController.processPostback);
    this.app.post('/postback', WebhookController.processPostback);
    
    // Telegram webhook endpoint (for webhook mode)
    this.app.post('/telegram/webhook', async (req, res) => {
      try {
        logger.info('📨 Telegram webhook received', {
          update_id: req.body.update_id,
          type: req.body.message ? 'message' : req.body.callback_query ? 'callback_query' : 'other'
        });
        
        const update = req.body;
        
        // Handle message updates
        if (update.message) {
          await this.handleTelegramMessage(update.message);
        }
        
        // Handle callback query updates (inline buttons)
        if (update.callback_query) {
          await telegramBotService.handleCallbackQuery(update.callback_query);
        }
        
        res.status(200).json({ ok: true });
      } catch (error) {
        logger.error('Telegram webhook handler error', {
          error: error.message,
          update: req.body
        });
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    
    // Admin endpoints (for monitoring)
    this.app.get('/admin/stats', this.getStats.bind(this));
    this.app.get('/admin/test', this.testServices.bind(this));
    this.app.post('/admin/test-notification', this.testNotification.bind(this));
    this.app.post('/admin/setup-webhook', this.setupWebhook.bind(this));
    this.app.get('/admin/webhook-info', this.getWebhookInfo.bind(this));
    
    // Traffic sources info endpoint
    this.app.get('/admin/traffic-sources', this.getTrafficSources.bind(this));
    
    // 404 handler
    this.app.use('*', (req, res) => {
      logger.warn('📍 Route not found', {
        method: req.method,
        url: req.url,
        ip: req.ip
      });
      
      res.status(404).json({
        error: 'Route not found',
        method: req.method,
        url: req.url,
        timestamp: new Date().toISOString()
      });
    });
  }
  
  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // Global error handler
    this.app.use((error, req, res, next) => {
      logger.error('💥 Unhandled application error', {
        requestId: req.requestId,
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method
      });
      
      res.status(500).json({
        error: 'Internal server error',
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      });
    });
    
    // Process error handlers with detailed logging
    process.on('uncaughtException', (error) => {
      logger.error('🚨 Uncaught Exception - FATAL', {
        error: error.message,
        stack: error.stack,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid
      });
      
      // Graceful shutdown
      this.shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('🚨 Unhandled Rejection - FATAL', {
        reason: reason?.message || reason,
        stack: reason?.stack,
        promise: promise.toString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid
      });
      
      // Graceful shutdown
      this.shutdown('unhandledRejection');
    });
    
    // System signal handlers with detailed logging
    process.on('SIGTERM', () => {
      logger.error('📤 SIGTERM received - Render is terminating process', {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
        reason: 'SIGTERM - likely resource limit or platform restart'
      });
      this.shutdown('SIGTERM');
    });
    
    process.on('SIGINT', () => {
      logger.error('📤 SIGINT received - Manual termination', {
        uptime: process.uptime(), 
        memory: process.memoryUsage(),
        pid: process.pid,
        reason: 'SIGINT - manual stop or Ctrl+C'
      });
      this.shutdown('SIGINT');
    });
    
    // Additional Render.com specific signals
    process.on('SIGHUP', () => {
      logger.error('📤 SIGHUP received - Process restart signal', {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
        reason: 'SIGHUP - process restart requested'
      });
      this.shutdown('SIGHUP');
    });
    
    // Memory/resource warnings
    process.on('warning', (warning) => {
      logger.warn('⚠️ Node.js Warning', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      });
    });
  }
  
  /**
   * Handle Telegram message (webhook mode)
   */
  async handleTelegramMessage(msg) {
    try {
      // Handle different message types
      if (msg.text) {
        const text = msg.text.trim();
        
        if (text.startsWith('/start')) {
          await telegramBotService.handleStartCommand(msg);
        } else if (text.startsWith('/help')) {
          await telegramBotService.handleHelpCommand(msg);
        } else if (text.startsWith('/status')) {
          await telegramBotService.handleStatusCommand(msg);
        } else if (text.startsWith('/users')) {
          await telegramBotService.handleUsersCommand(msg);
        } else if (text.startsWith('/requests')) {
          await telegramBotService.handleRequestsCommand(msg);
        } else if (text.startsWith('/ban ')) {
          const match = text.match(/\/ban (.+)/);
          if (match) {
            await telegramBotService.handleBanCommand(msg, match[1]);
          }
        } else if (text.startsWith('/unban ')) {
          const match = text.match(/\/unban (.+)/);
          if (match) {
            await telegramBotService.handleUnbanCommand(msg, match[1]);
          }
        }
      }
    } catch (error) {
      logger.error('Telegram message handling error', {
        error: error.message,
        message: msg
      });
    }
  }
  
  /**
   * Get application statistics
   */
  async getStats(req, res) {
    try {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const trafficSourceStats = trafficSourceService.getStatistics();
      
      const stats = {
        application: {
          name: 'Telegram Deposit Bot',
          version: '1.0.0',
          environment: config.env,
          uptime,
          startTime: new Date(this.startTime).toISOString(),
          processedDeposits: this.processedDeposits,
          lastActivity: this.lastActivity
        },
        trafficSources: trafficSourceStats,
        system: {
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          memory: process.memoryUsage(),
          pid: process.pid
        }
      };
      
      res.json(stats);
    } catch (error) {
      logger.error('Error getting stats', { error: error.message });
      res.status(500).json({
        error: 'Failed to get statistics',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Test all services
   */
  async testServices(req, res) {
    try {
      logger.info('🧪 Testing all services');
      
      const results = {
        keitaro: await keitaroService.checkHealth(),
        telegram: await telegramBotService.checkHealth(),
        database: await checkDatabaseHealth(),
        trafficSources: trafficSourceService.validateConfiguration()
      };
      
      const allHealthy = results.keitaro.healthy && 
                        results.telegram.healthy && 
                        results.database.healthy &&
                        results.trafficSources.valid;
      
      res.status(allHealthy ? 200 : 503).json({
        status: allHealthy ? 'healthy' : 'unhealthy',
        services: results,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error testing services', { error: error.message });
      res.status(500).json({
        error: 'Service test failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Test notification sending
   */
  async testNotification(req, res) {
    try {
      logger.info('🧪 Sending test notification to owners');
      
      const result = await telegramBotService.sendTestMessage();
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Test notification sent to owners',
          sent: result.sent,
          total: result.total,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Error sending test notification', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Setup Telegram webhook manually
   */
  async setupWebhook(req, res) {
    try {
      logger.info('🔧 Manual webhook setup requested');
      
      const webhookUrl = config.bot.webhookUrl;
      if (!webhookUrl) {
        return res.status(400).json({
          error: 'Webhook URL not configured',
          timestamp: new Date().toISOString()
        });
      }
      
      // Set webhook using direct API call
      const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          drop_pending_updates: true
        })
      });
      
      const result = await response.json();
      
      if (result.ok) {
        logger.info('✅ Webhook setup successful', { url: webhookUrl });
        res.json({
          success: true,
          message: 'Webhook setup successful',
          url: webhookUrl,
          result: result,
          timestamp: new Date().toISOString()
        });
      } else {
        logger.error('❌ Webhook setup failed', { error: result });
        res.status(500).json({
          success: false,
          error: 'Webhook setup failed',
          details: result,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      logger.error('Error setting up webhook', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Get webhook information
   */
  async getWebhookInfo(req, res) {
    try {
      logger.info('🔍 Getting webhook info');
      
      // Get webhook info using direct API call
      const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/getWebhookInfo`);
      const result = await response.json();
      
      if (result.ok) {
        res.json({
          success: true,
          webhookInfo: result.result,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to get webhook info',
          details: result,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      logger.error('Error getting webhook info', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Get traffic sources information
   */
  async getTrafficSources(req, res) {
    try {
      const stats = trafficSourceService.getStatistics();
      res.json({
        ...stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error getting traffic sources', { error: error.message });
      res.status(500).json({
        error: 'Failed to get traffic sources',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Start the server
   */
  async start() {
    try {
      // Validate configuration
      config.validateConfig();
      
      // Initialize database
      logger.info('🔄 Initializing database...');
      await initializeDatabase();
      
      // Initialize Telegram bot
      logger.info('🤖 Initializing Telegram bot...');
      await telegramBotService.initialize();
      
      // Validate traffic sources configuration
      const trafficSourceValidation = trafficSourceService.validateConfiguration();
      if (!trafficSourceValidation.valid) {
        throw new Error(`Traffic source configuration invalid: ${trafficSourceValidation.error}`);
      }
      
      // Start server
      this.server = this.app.listen(config.port, () => {
        logger.info('🚀 Telegram Deposit Bot started successfully', {
          port: config.port,
          environment: config.env,
          pid: process.pid,
          version: '1.0.0',
          fbSources: trafficSourceValidation.stats.fbSourcesCount,
          nonFbSources: trafficSourceValidation.stats.nonFbSourcesCount
        });
        
        logger.info('📋 Available endpoints:');
        logger.info('   GET  /                      - API information');
        logger.info('   GET  /health               - Health check');
        logger.info('   GET  /postback             - Postback webhook');
        logger.info('   POST /postback             - Postback webhook');
        logger.info('   POST /telegram/webhook     - Telegram webhook');
        logger.info('   GET  /admin/stats          - Application statistics');
        logger.info('   GET  /admin/test           - Service health test');
        logger.info('   POST /admin/test-notification - Test Telegram notification');
        logger.info('   POST /admin/setup-webhook  - Setup Telegram webhook manually');
        logger.info('   GET  /admin/webhook-info   - Get current webhook info');
        logger.info('   GET  /admin/traffic-sources - Traffic sources info');
        logger.info('');
        logger.info('🤖 Telegram Bot Features:');
        logger.info('   📱 User management with approval system');
        logger.info('   🔔 Broadcast notifications to approved users');
        logger.info('   👑 Owner commands for user management');
        logger.info(`   📊 ${config.owners.length} owner(s) configured`);
      });
      
      // Setup resource monitoring and keep-alive for Render.com
      setInterval(() => {
        try {
          // Get memory and CPU usage
          const memUsage = process.memoryUsage();
          const uptime = process.uptime();
          
          logger.info('📊 System resources', {
            uptime: Math.floor(uptime),
            memory: {
              rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
              heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
              heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
              external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
            },
            pid: process.pid,
            version: process.version,
            platform: process.platform
          });
          
          // Self-ping to prevent hibernation on Render free tier
          fetch(`http://localhost:${config.port}/health`)
            .catch(() => {}); // Ignore errors, just keep alive
            
        } catch (error) {
          logger.error('Resource monitoring error', { error: error.message });
        }
      }, 5 * 60 * 1000); // Every 5 minutes
      
      // Test services on startup
      setTimeout(async () => {
        try {
          const keitaroHealth = await keitaroService.checkHealth();
          const telegramHealth = await telegramBotService.checkHealth();
          const dbHealth = await checkDatabaseHealth();
          
          if (keitaroHealth.healthy && telegramHealth.healthy && dbHealth.healthy) {
            logger.info('✅ All services are healthy and ready');
            
            // Send startup notification to owners
            const startupResult = await telegramBotService.sendTestMessage();
            logger.info('📱 Startup notification sent to owners', {
              sent: startupResult.sent,
              total: startupResult.total
            });
          } else {
            logger.warn('⚠️ Some services are not healthy:');
            logger.warn(`   Keitaro: ${keitaroHealth.healthy ? '✅' : '❌'}`);
            logger.warn(`   Telegram: ${telegramHealth.healthy ? '✅' : '❌'}`);
            logger.warn(`   Database: ${dbHealth.healthy ? '✅' : '❌'}`);
          }
        } catch (error) {
          logger.error('Startup health check failed', { error: error.message });
        }
      }, 3000);
      
    } catch (error) {
      logger.error('💥 Failed to start server', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    }
  }
  
  /**
   * Graceful shutdown with detailed diagnostics
   */
  async shutdown(signal) {
    const shutdownStart = Date.now();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const memUsage = process.memoryUsage();
    
    logger.error(`🚨 SHUTDOWN INITIATED - Signal: ${signal}`, {
      signal,
      uptime,
      startTime: new Date(this.startTime).toISOString(),
      processedDeposits: this.processedDeposits,
      lastActivity: this.lastActivity,
      memory: {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
      },
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform
    });
    
    if (this.server) {
      this.server.close(() => {
        logger.error('🛑 HTTP server closed - sending notifications');
        
        // Enhanced shutdown notification with diagnostics
        const shutdownMessage = `🛑 <b>Бот завершает работу</b>\n\n` +
                               `🚨 <b>Причина:</b> ${signal}\n` +
                               `⏱️ Время работы: ${uptime} сек\n` +
                               `📊 Обработано депозитов: ${this.processedDeposits}\n` +
                               `🕒 Последняя активность: ${this.lastActivity || 'Нет данных'}\n` +
                               `💾 Память: ${Math.round(memUsage.rss / 1024 / 1024)}MB\n` +
                               `🔧 PID: ${process.pid}\n\n` +
                               `<i>Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`;
        
        const promises = config.owners.map(ownerId => 
          telegramBotService.sendMessage(ownerId, shutdownMessage, { parse_mode: 'HTML' })
            .catch(err => logger.warn(`Failed to send shutdown notification to ${ownerId}`, { error: err.message }))
        );
        
        Promise.allSettled(promises).finally(() => {
          const shutdownTime = Date.now() - shutdownStart;
          logger.error(`💀 SHUTDOWN COMPLETED - Duration: ${shutdownTime}ms`);
          process.exit(0);
        });
      });
      
      // Force shutdown after 8 seconds (shorter timeout)
      setTimeout(() => {
        logger.error('💥 FORCE SHUTDOWN - Timeout reached after 8s');
        process.exit(1);
      }, 8000);
    } else {
      logger.error('💀 IMMEDIATE EXIT - No server to close');
      process.exit(0);
    }
  }
}

// Create and start application
const app = new TelegramDepositBot();

// Start server if this file is run directly
if (require.main === module) {
  app.start();
}

module.exports = app;