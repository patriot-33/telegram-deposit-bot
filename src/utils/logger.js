/**
 * Logger Utility
 * Senior PM: Enterprise-grade logging with structured output
 */

const winston = require('winston');
const path = require('path');
const config = require('../config/config');

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// Create transports
const transports = [];

// Console transport (always enabled)
transports.push(
  new winston.transports.Console({
    format: config.env === 'development' ? consoleFormat : logFormat,
    level: config.logging.level
  })
);

// File transports (if enabled)
if (config.logging.fileEnabled) {
  // All logs file
  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'app.log'),
      format: logFormat,
      level: config.logging.level,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    })
  );
  
  // Error logs file
  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      format: logFormat,
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    })
  );
  
  // Deposits logs file (for business tracking)
  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'deposits.log'),
      format: logFormat,
      level: 'info',
      maxsize: 50485760, // 50MB
      maxFiles: 10,
      tailable: true
    })
  );
}

// Create logger
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
  // Handle uncaught exceptions and rejections
  handleExceptions: true,
  handleRejections: true
});

// Add custom methods for business events
logger.deposit = function(message, meta = {}) {
  this.info(`[DEPOSIT] ${message}`, {
    ...meta,
    event: 'deposit',
    timestamp: new Date().toISOString()
  });
};

logger.postback = function(message, meta = {}) {
  this.info(`[POSTBACK] ${message}`, {
    ...meta,
    event: 'postback',
    timestamp: new Date().toISOString()
  });
};

logger.keitaro = function(message, meta = {}) {
  this.debug(`[KEITARO] ${message}`, {
    ...meta,
    service: 'keitaro',
    timestamp: new Date().toISOString()
  });
};

logger.telegram = function(message, meta = {}) {
  this.info(`[TELEGRAM] ${message}`, {
    ...meta,
    service: 'telegram',
    timestamp: new Date().toISOString()
  });
};

logger.security = function(message, meta = {}) {
  this.warn(`[SECURITY] ${message}`, {
    ...meta,
    event: 'security',
    timestamp: new Date().toISOString()
  });
};

logger.performance = function(message, meta = {}) {
  this.info(`[PERFORMANCE] ${message}`, {
    ...meta,
    event: 'performance',
    timestamp: new Date().toISOString()
  });
};

// Startup information
logger.info('📝 Logger initialized', {
  level: config.logging.level,
  fileEnabled: config.logging.fileEnabled,
  environment: config.env,
  transports: transports.length
});

// Export logger
module.exports = logger;