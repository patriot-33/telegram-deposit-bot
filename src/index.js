/**
 * Main Application Entry Point
 * Senior PM: Production-ready Express server with comprehensive middleware
 * 
 * RENDER.COM SHUTDOWN ANALYSIS SYSTEM:
 * - Comprehensive SIGTERM logging with platform-specific analysis
 * - Pattern detection for 10-15 minute rotation cycles
 * - Memory usage correlation and OOM killer analysis
 * - Activity-based shutdown hypothesis generation
 * - Enhanced health check (<25ms response) to prevent timeouts
 * - Dual keep-alive system (internal + external pings)
 * - Resource monitoring with automatic garbage collection
 * - Diagnostic recommendations for Render support tickets
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
const auditScheduler = require('./services/auditScheduler.service');

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
    
    // Simple keep-alive endpoint for Render.com
    this.app.get('/ping', (req, res) => {
      res.status(200).send('pong');
    });
    
    // Enhanced alive check with detailed info
    this.app.get('/alive', (req, res) => {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const memUsage = process.memoryUsage();
      
      res.status(200).json({
        status: 'alive',
        pid: process.pid,
        uptime,
        uptimeMinutes: Math.floor(uptime / 60),
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024)
        },
        lastActivity: this.lastActivity,
        processedDeposits: this.processedDeposits,
        timestamp: new Date().toISOString(),
        moscowTime: new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
      });
    });
    
    // Health check endpoints
    this.app.get('/health', WebhookController.healthCheck);
    this.app.get('/admin/health-detailed', WebhookController.detailedHealthCheck);
    
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
    
    // Fallback mechanism monitoring endpoint
    this.app.get('/admin/fallback-stats', this.getFallbackStats.bind(this));
    
    // Deposit audit endpoints
    this.app.post('/admin/audit-deposits', this.auditDeposits.bind(this));
    this.app.get('/admin/audit-deposit/:subid', this.auditSpecificDeposit.bind(this));
    this.app.get('/admin/audit-scheduler', this.getAuditSchedulerStats.bind(this));
    
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
    
    // System signal handlers with IMMEDIATE logging (no buffers)
    process.on('SIGTERM', () => {
      const startShutdownTime = Date.now();
      const memUsage = process.memoryUsage();
      const uptime = process.uptime();
      const uptimeMinutes = Math.floor(uptime / 60);
      
      // IMMEDIATE console output - bypass logger buffers
      console.log('\n🚨🚨🚨 SIGTERM DETECTED - IMMEDIATE LOG 🚨🚨🚨');
      console.log(`Uptime: ${Math.floor(uptime)}s (${uptimeMinutes}m)`);
      console.log(`Memory: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
      console.log(`PID: ${process.pid}`);
      console.log(`Time: ${new Date().toISOString()}`);
      
      // Force immediate flush
      process.stdout.write(`\n🚨 SIGTERM - PID ${process.pid} - ${uptimeMinutes}m - ${Math.round(memUsage.rss/1024/1024)}MB\n`);
      
      // CRITICAL: Log to external system IMMEDIATELY
      try {
        const payload = {
          timestamp: new Date().toISOString(),
          event: 'SIGTERM_RECEIVED',
          pid: process.pid,
          uptime: Math.floor(uptime),
          uptimeMinutes,
          memory: Math.round(memUsage.rss / 1024 / 1024),
          renderService: process.env.RENDER_SERVICE_ID
        };
        console.log('📡 EXTERNAL_LOG: SIGTERM_RECEIVED', payload);
        
        // TODO: Send to webhook.site or similar external service
        // fetch('https://webhook.site/your-url', { method: 'POST', body: JSON.stringify(payload) });
      } catch (extError) {
        console.log(`❌ External SIGTERM log failed: ${extError.message}`);
      }
      
      // Enhanced logging with Render-specific analysis
      logger.error('🚨 SIGTERM RECEIVED - Render.com Analysis', {
        signal: 'SIGTERM',
        uptime: Math.floor(uptime),
        uptimeMinutes,
        memory: {
          rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
          external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
        },
        pid: process.pid,
        renderPlan: 'Starter (Paid)',
        nodeVersion: process.version,
        platform: process.platform,
        env: process.env.NODE_ENV,
        renderRegion: process.env.RENDER_SERVICE_REGION || 'unknown',
        renderServiceId: process.env.RENDER_SERVICE_ID || 'unknown',
        timestamp: new Date().toISOString(),
        moscowTime: new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
        processedDeposits: this.processedDeposits,
        lastActivity: this.lastActivity
      });
      
      // Enhanced pattern analysis with Render-specific insights
      let terminationCategory;
      let renderAnalysis;
      
      if (uptime < 300) {
        terminationCategory = '🚨 CRITICAL: Early termination (<5 min)';
        renderAnalysis = 'Likely: startup failure, health check timeout, or deployment rollback';
      } else if (uptime < 600) {
        terminationCategory = '⚠️ WARNING: Short lifespan (<10 min)';
        renderAnalysis = 'Possible: health check failures, memory spikes, or container restart policy';
      } else if (uptime < 900) {
        terminationCategory = '📊 INFO: Medium lifespan (10-15 min)';
        renderAnalysis = 'Possible: rolling deployment, platform maintenance, or resource rebalancing';
      } else if (uptime < 1800) {
        terminationCategory = '✅ NORMAL: Acceptable lifespan (15-30 min)';
        renderAnalysis = 'Likely: scheduled restart, rolling deployment, or routine maintenance';
      } else {
        terminationCategory = '✅ HEALTHY: Long lifespan (>30 min)';
        renderAnalysis = 'Likely: planned deployment or routine platform operations';
      }
      
      logger.error(terminationCategory, {
        analysis: renderAnalysis,
        uptimeCategory: terminationCategory.split(':')[0].trim(),
        renderHypothesis: this._analyzeRenderShutdown(uptime, memUsage),
        recommendedActions: this._getShutdownRecommendations(uptime, memUsage)
      });
      
      // Additional diagnostics for Render platform
      logger.error('🔍 RENDER DIAGNOSTICS', {
        environmentVariables: {
          renderService: !!process.env.RENDER_SERVICE_ID,
          renderRegion: process.env.RENDER_SERVICE_REGION,
          renderExternal: !!process.env.RENDER_EXTERNAL_URL,
          nodeEnv: process.env.NODE_ENV,
          port: process.env.PORT
        },
        systemResources: {
          cpuUsage: process.cpuUsage(),
          resourceUsage: process.resourceUsage ? process.resourceUsage() : 'not available',
          loadAvg: require('os').loadavg(),
          freeMem: `${Math.round(require('os').freemem() / 1024 / 1024)}MB`,
          totalMem: `${Math.round(require('os').totalmem() / 1024 / 1024)}MB`
        },
        processInfo: {
          argv: process.argv.slice(2), // Hide sensitive paths
          execPath: process.execPath.split('/').pop(), // Just filename
          title: process.title,
          versions: process.versions
        }
      });
      
      this.shutdown('SIGTERM');
    });
    
    process.on('SIGINT', () => {
      console.log('\n🛑 SIGINT received - Manual termination');
      process.stdout.write(`\n🛑 SIGINT - PID ${process.pid} - ${Math.floor(process.uptime())}s\n`);
      
      logger.error('📤 SIGINT received - Manual termination', {
        uptime: process.uptime(), 
        memory: process.memoryUsage(),
        pid: process.pid,
        reason: 'SIGINT - manual stop or Ctrl+C'
      });
      this.shutdown('SIGINT');
    });
    
    // Monitor for potential SIGKILL (can't catch it, but detect disappearance)
    let lastAliveCheck = Date.now();
    const aliveMonitor = setInterval(() => {
      const now = Date.now();
      const gap = now - lastAliveCheck;
      
      // If there's a significant gap, process might have been killed and restarted
      if (gap > 45000) { // 45 second gap
        console.log(`\n⚠️ PROCESS GAP DETECTED: ${gap}ms - possible SIGKILL/restart`);
        process.stdout.write(`\n⚠️ GAP: ${gap}ms - PID ${process.pid}\n`);
      }
      
      lastAliveCheck = now;
    }, 15000); // Check every 15 seconds
    
    // COMPLETE SIGNAL DETECTION MATRIX
    const logSignal = (signalName, reason) => {
      console.log(`\n📤 ${signalName} RECEIVED`);
      process.stdout.write(`\n📤 ${signalName} - PID ${process.pid} - ${Math.floor(process.uptime())}s\n`);
      
      // External log
      try {
        console.log(`📡 EXTERNAL_LOG: ${signalName}_RECEIVED`, {
          timestamp: new Date().toISOString(),
          signal: signalName,
          pid: process.pid,
          uptime: Math.floor(process.uptime()),
          reason
        });
      } catch (e) {
        console.log(`❌ External ${signalName} log failed`);
      }
      
      logger.error(`📤 ${signalName} received`, {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
        reason
      });
    };

    process.on('SIGHUP', () => {
      logSignal('SIGHUP', 'Process restart signal');
      this.shutdown('SIGHUP');
    });
    
    process.on('SIGUSR1', () => {
      logSignal('SIGUSR1', 'User-defined signal 1');
      this.shutdown('SIGUSR1');
    });
    
    process.on('SIGUSR2', () => {
      logSignal('SIGUSR2', 'User-defined signal 2');  
      this.shutdown('SIGUSR2');
    });
    
    process.on('SIGQUIT', () => {
      logSignal('SIGQUIT', 'Quit signal');
      this.shutdown('SIGQUIT');
    });
    
    // Note: SIGKILL cannot be caught, but we'll detect disappearance
    
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
   * Get fallback mechanism statistics
   */
  async getFallbackStats(req, res) {
    try {
      // Import WebhookController to get cache stats
      const WebhookController = require('./controllers/webhook.controller');
      
      const stats = {
        fallbackMechanism: {
          enabled: true,
          version: '2.0.0',
          features: [
            'Retry mechanism with 30s delay',
            'Known FB source mapping',
            'Duplicate prevention cache',
            'Enhanced logging'
          ]
        },
        cache: {
          totalCachedSubIds: WebhookController.getCacheSize ? WebhookController.getCacheSize() : 'N/A',
          cacheTTL: '24 hours',
          cleanupInterval: '1 hour'
        },
        knownFBSources: Object.keys(require('./config/constants').KNOWN_FB_POSTBACK_SOURCES),
        mappedSources: Object.entries(require('./config/constants').KNOWN_FB_POSTBACK_SOURCES).map(([key, value]) => ({
          postbackSource: key,
          trafficSourceName: value.name,
          trafficSourceId: value.traffic_source_id
        })),
        retryConfiguration: {
          retryDelay: '30 seconds',
          maxRetries: 1,
          fallbackAfterRetryFails: true
        },
        monitoring: {
          endpoint: '/admin/fallback-stats',
          testScript: 'test_fallback_mechanism.js'
        },
        timestamp: new Date().toISOString()
      };
      
      res.json(stats);
    } catch (error) {
      logger.error('Error getting fallback stats', { error: error.message });
      res.status(500).json({
        error: 'Failed to get fallback statistics',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Audit deposits - compare Keitaro deposits with sent notifications
   */
  async auditDeposits(req, res) {
    try {
      const { dateFrom, dateTo } = req.body;
      
      // Validate dates
      if (!dateFrom || !dateTo) {
        return res.status(400).json({
          error: 'dateFrom and dateTo are required',
          example: {
            dateFrom: '2025-08-29',
            dateTo: '2025-08-29'
          },
          timestamp: new Date().toISOString()
        });
      }
      
      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
        return res.status(400).json({
          error: 'Invalid date format, use YYYY-MM-DD',
          timestamp: new Date().toISOString()
        });
      }
      
      logger.info('🔍 Starting deposit audit', { dateFrom, dateTo });
      
      // Run audit using DepositAuditService
      const DepositAuditService = require('./services/depositAudit.service');
      const auditResults = await DepositAuditService.auditDeposits(dateFrom, dateTo);
      
      logger.info('✅ Deposit audit completed', {
        auditId: auditResults.audit.auditId,
        missingDeposits: auditResults.statistics.missingNotifications,
        successRate: auditResults.statistics.successRate
      });
      
      res.json(auditResults);
      
    } catch (error) {
      logger.error('❌ Deposit audit failed', {
        error: error.message,
        stack: error.stack
      });
      
      res.status(500).json({
        error: 'Audit failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Audit specific deposit by SubID
   */
  async auditSpecificDeposit(req, res) {
    try {
      const { subid } = req.params;
      
      if (!subid) {
        return res.status(400).json({
          error: 'SubID is required',
          timestamp: new Date().toISOString()
        });
      }
      
      logger.info('🔍 Auditing specific deposit', { subid });
      
      const DepositAuditService = require('./services/depositAudit.service');
      const auditResult = await DepositAuditService.auditSpecificDeposit(subid);
      
      res.json({
        audit: {
          subid,
          timestamp: new Date().toISOString()
        },
        result: auditResult
      });
      
    } catch (error) {
      logger.error('❌ Specific deposit audit failed', {
        subid: req.params.subid,
        error: error.message
      });
      
      res.status(500).json({
        error: 'Specific audit failed',
        message: error.message,
        subid: req.params.subid,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get audit scheduler statistics
   */
  async getAuditSchedulerStats(req, res) {
    try {
      const schedulerStats = auditScheduler.getSchedulerStats();
      
      res.json({
        auditScheduler: {
          ...schedulerStats,
          description: 'Автоматический планировщик аудита депозитов',
          features: [
            'Ежедневный аудит в 09:00 MSK',
            'Еженедельный отчет в воскресенье 10:00 MSK', 
            'Экстренная проверка каждые 4 часа',
            'Автоматические уведомления в Telegram',
            'История аудитов и трендовый анализ'
          ]
        },
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error getting audit scheduler stats', { error: error.message });
      res.status(500).json({
        error: 'Failed to get scheduler statistics',
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
      
      // Start automatic audit scheduler
      logger.info('📅 Starting audit scheduler...');
      auditScheduler.start();
      
      // Start server
      this.server = this.app.listen(config.port, () => {
        // Enhanced startup diagnostics for Render.com
        const renderDiagnostics = {
          isRender: !!process.env.RENDER_SERVICE_ID,
          serviceId: process.env.RENDER_SERVICE_ID,
          region: process.env.RENDER_SERVICE_REGION,
          externalUrl: process.env.RENDER_EXTERNAL_URL,
          port: config.port,
          nodeEnv: config.env,
          plan: 'Starter (Paid)', // Known from user
          memoryLimit: '512MB', // Render Starter limit
          currentMemory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`
        };
        
        logger.info('🚀 Telegram Deposit Bot started successfully', {
          port: config.port,
          environment: config.env,
          pid: process.pid,
          version: '1.0.0',
          fbSources: trafficSourceValidation.stats.fbSourcesCount,
          nonFbSources: trafficSourceValidation.stats.nonFbSourcesCount,
          renderDiagnostics
        });
        
        // Render-specific startup warnings
        if (renderDiagnostics.isRender) {
          logger.warn('🔍 RENDER STARTUP ANALYSIS', {
            expectedIssues: [
              '10-15 minute SIGTERM cycles observed on Starter plan',
              'Health check timeouts may cause restarts',
              'Container rotation policy may apply even on paid plans'
            ],
            mitigations: [
              'Ultra-fast health check endpoint (<25ms)',
              'Enhanced SIGTERM logging and analysis',
              'Memory monitoring with GC triggers',
              'Dual keep-alive mechanisms (internal + external)',
              'Comprehensive diagnostic logging'
            ],
            monitoringEnabled: {
              heartbeat: '30 seconds',
              resourceCheck: '2 minutes',
              memoryGC: 'when >400MB',
              keepAlive: 'dual (internal + external)',
              shutdownAnalysis: 'comprehensive'
            }
          });
        }
        
        logger.info('📋 Available endpoints:');
        logger.info('   GET  /                      - API information');
        logger.info('   GET  /ping                 - Simple keep-alive');
        logger.info('   GET  /alive                - Enhanced process info');
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
        logger.info('   GET  /admin/fallback-stats - Fallback mechanism statistics');
        logger.info('   POST /admin/audit-deposits - Audit deposits for date range');
        logger.info('   GET  /admin/audit-deposit/:subid - Audit specific deposit');
        logger.info('');
        logger.info('🤖 Telegram Bot Features:');
        logger.info('   📱 User management with approval system');
        logger.info('   🔔 Broadcast notifications to approved users');
        logger.info('   👑 Owner commands for user management');
        logger.info(`   📊 ${config.owners.length} owner(s) configured`);
      });
      
      // EXTERNAL MONITORING - Send data outside Render ecosystem
      const externalLog = async (event, data) => {
        try {
          const payload = {
            timestamp: new Date().toISOString(),
            event,
            pid: process.pid,
            uptime: Math.floor(process.uptime()),
            ...data
          };
          
          // Send to webhook.site for external logging (replace with actual URL)
          // await fetch('https://webhook.site/your-unique-url', {
          //   method: 'POST',
          //   headers: { 'Content-Type': 'application/json' },
          //   body: JSON.stringify(payload),
          //   timeout: 5000
          // });
          
          console.log(`📡 EXTERNAL_LOG: ${event}`, payload);
        } catch (error) {
          console.log(`❌ External log failed: ${error.message}`);
        }
      };
      
      // Log startup to external system
      externalLog('PROCESS_START', {
        serviceId: process.env.RENDER_SERVICE_ID,
        renderRegion: process.env.RENDER_SERVICE_REGION
      });
      
      // Setup aggressive resource monitoring for Render.com + External logging
      setInterval(async () => {
        try {
          // Get memory and CPU usage
          const memUsage = process.memoryUsage();
          const uptime = process.uptime();
          
          // Check for dangerous memory levels (Render Free Tier ~512MB)
          const rssInMB = Math.round(memUsage.rss / 1024 / 1024);
          const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
          
          const memoryWarning = rssInMB > 400 ? '🚨 HIGH MEMORY' : rssInMB > 300 ? '⚠️ MEMORY WARNING' : '✅ MEMORY OK';
          
          logger.warn(`📊 Resource Check - ${memoryWarning}`, {
            uptime: Math.floor(uptime),
            memory: {
              rss: `${rssInMB}MB`,
              heapUsed: `${heapUsedMB}MB`,
              heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
              external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
            },
            limits: {
              renderFreeLimit: '512MB',
              dangerThreshold: '400MB',
              warningThreshold: '300MB'
            },
            pid: process.pid,
            version: process.version,
            platform: process.platform
          });
          
          // If memory is dangerously high, force garbage collection
          if (rssInMB > 400 && global.gc) {
            logger.error('🚨 FORCING GARBAGE COLLECTION - Memory critical!');
            global.gc();
          }
          
          // Log to external system every cycle
          externalLog('HEARTBEAT', {
            memory: {
              rss: rssInMB,
              heapUsed: heapUsedMB
            },
            memoryStatus: memoryWarning.includes('HIGH') ? 'HIGH' : memoryWarning.includes('WARNING') ? 'WARNING' : 'OK'
          });

          // Enhanced keep-alive for Render.com
          fetch(`http://localhost:${config.port}/ping`, {
            timeout: 2000,
            headers: { 'User-Agent': 'KeepAlive/1.0' }
          }).catch(() => {}); // Ignore errors, just keep alive
          
          // Additional external keep-alive (if configured)
          if (process.env.RENDER_EXTERNAL_URL) {
            fetch(`${process.env.RENDER_EXTERNAL_URL}/ping`, {
              timeout: 3000,
              headers: { 'User-Agent': 'ExternalKeepAlive/1.0' }
            }).catch(() => {}); // External ping to prevent idle
          }
            
        } catch (error) {
          logger.error('Resource monitoring error', { error: error.message });
        }
      }, 2 * 60 * 1000); // Every 2 minutes (more frequent)
      
      // Dead man's switch - heartbeat every 30 seconds
      let lastHeartbeat = Date.now();
      setInterval(() => {
        try {
          const now = Date.now();
          const timeSinceLastBeat = now - lastHeartbeat;
          lastHeartbeat = now;
          
          logger.info('💓 Heartbeat alive', {
            uptime: Math.floor(process.uptime()),
            timeSinceLastBeat,
            pid: process.pid,
            memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`
          });
          
          // If gap is too long, something killed the process
          if (timeSinceLastBeat > 45000) {
            logger.error('🚨 HEARTBEAT GAP DETECTED - Process was killed/frozen!', {
              gapDuration: timeSinceLastBeat,
              expectedInterval: 30000
            });
          }
          
        } catch (error) {
          logger.error('Heartbeat error', { error: error.message });
        }
      }, 30 * 1000); // Every 30 seconds
      
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
   * Analyze Render.com shutdown patterns
   */
  _analyzeRenderShutdown(uptime, memUsage) {
    const uptimeMinutes = Math.floor(uptime / 60);
    const rssInMB = Math.round(memUsage.rss / 1024 / 1024);
    
    // Pattern analysis based on observations
    const patterns = [];
    
    // Time-based patterns
    if (uptimeMinutes >= 10 && uptimeMinutes <= 15) {
      patterns.push('SUSPECTED: 10-15 minute rotation policy (even on paid)');
    }
    
    if (uptimeMinutes % 5 === 0) {
      patterns.push('TIMING: Shutdown at 5-minute interval suggests scheduled operation');
    }
    
    // Memory-based patterns
    if (rssInMB < 150) {
      patterns.push('MEMORY: Low memory usage rules out OOM killer');
    } else if (rssInMB > 400) {
      patterns.push('MEMORY: High memory usage might trigger container restart');
    }
    
    // Activity-based patterns
    if (!this.lastActivity) {
      patterns.push('ACTIVITY: No recent activity recorded');
    } else {
      const lastActivityTime = new Date(this.lastActivity).getTime();
      const timeSinceActivity = Date.now() - lastActivityTime;
      if (timeSinceActivity > 5 * 60 * 1000) {
        patterns.push('ACTIVITY: No activity in >5 minutes might trigger idle shutdown');
      }
    }
    
    return patterns.length > 0 ? patterns : ['No clear pattern detected'];
  }
  
  /**
   * Get shutdown recommendations based on analysis
   */
  _getShutdownRecommendations(uptime, memUsage) {
    const uptimeMinutes = Math.floor(uptime / 60);
    const recommendations = [];
    
    if (uptimeMinutes < 10) {
      recommendations.push('Check Render service logs for startup issues');
      recommendations.push('Verify health check endpoint responds quickly');
      recommendations.push('Review deployment settings');
    } else if (uptimeMinutes >= 10 && uptimeMinutes <= 15) {
      recommendations.push('Contact Render support - unexpected behavior on paid plan');
      recommendations.push('Consider upgrading to Standard plan');
      recommendations.push('Implement external process monitoring');
    } else {
      recommendations.push('Monitor for patterns in shutdown timing');
      recommendations.push('Check for Render platform announcements');
    }
    
    recommendations.push('Enable external health monitoring service');
    recommendations.push('Set up alerts for service downtime');
    
    return recommendations;
  }
  
  /**
   * Graceful shutdown with detailed diagnostics and immediate logging
   */
  async shutdown(signal) {
    const shutdownStart = Date.now();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const memUsage = process.memoryUsage();
    
    // IMMEDIATE console logging
    console.log(`\n🚨 SHUTDOWN INITIATED - Signal: ${signal}`);
    console.log(`Shutdown started at: ${new Date().toISOString()}`);
    process.stdout.write(`\n🚨 SHUTDOWN: ${signal} - ${uptime}s - PID ${process.pid}\n`);
    
    // Force flush all logs immediately
    if (logger && logger.end) {
      logger.end();
    }
    
    // Stop audit scheduler
    try {
      logger.info('📅 Stopping audit scheduler...');
      auditScheduler.stop();
    } catch (error) {
      logger.warn('Failed to stop audit scheduler', { error: error.message });
    }

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