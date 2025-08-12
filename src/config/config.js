/**
 * Application Configuration
 * Senior PM: Environment-based configuration with validation
 */

require('dotenv').config();
const Joi = require('joi');

// Configuration Schema
const configSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('production'),
  
  PORT: Joi.number()
    .positive()
    .default(3000),
  
  // Telegram Configuration
  TELEGRAM_BOT_TOKEN: Joi.string().required(),
  TELEGRAM_CHAT_ID: Joi.string().required(),
  
  // Keitaro Configuration  
  KEITARO_BASE_URL: Joi.string().uri().required(),
  KEITARO_API_KEY: Joi.string().required(),
  
  // Security
  WEBHOOK_SECRET: Joi.string().min(32).optional(),
  RATE_LIMIT_WINDOW_MS: Joi.number().positive().default(900000),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().positive().default(100),
  
  // Redis (Optional)
  REDIS_URL: Joi.string().uri().optional(),
  REDIS_ENABLED: Joi.boolean().default(false),
  
  // Logging
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug')
    .default('info'),
  LOG_FILE_ENABLED: Joi.boolean().default(true)
});

// Validate configuration
const { error, value } = configSchema.validate(process.env, {
  abortEarly: false,
  allowUnknown: true
});

if (error) {
  console.error('❌ Configuration validation failed:');
  error.details.forEach(detail => {
    console.error(`   ${detail.message}`);
  });
  process.exit(1);
}

const config = {
  env: value.NODE_ENV,
  port: value.PORT,
  
  telegram: {
    botToken: value.TELEGRAM_BOT_TOKEN,
    chatId: value.TELEGRAM_CHAT_ID
  },
  
  keitaro: {
    baseUrl: value.KEITARO_BASE_URL,
    apiKey: value.KEITARO_API_KEY
  },
  
  security: {
    webhookSecret: value.WEBHOOK_SECRET,
    rateLimit: {
      windowMs: value.RATE_LIMIT_WINDOW_MS,
      max: value.RATE_LIMIT_MAX_REQUESTS
    }
  },
  
  redis: {
    url: value.REDIS_URL,
    enabled: value.REDIS_ENABLED
  },
  
  logging: {
    level: value.LOG_LEVEL,
    fileEnabled: value.LOG_FILE_ENABLED
  }
};

// Configuration validation
function validateConfig() {
  const required = [
    'telegram.botToken',
    'telegram.chatId',
    'keitaro.baseUrl',
    'keitaro.apiKey'
  ];
  
  const missing = required.filter(path => {
    const keys = path.split('.');
    let value = config;
    for (const key of keys) {
      value = value[key];
      if (!value) return true;
    }
    return false;
  });
  
  if (missing.length > 0) {
    console.error('❌ Missing required configuration:');
    missing.forEach(path => console.error(`   ${path}`));
    process.exit(1);
  }
  
  console.log('✅ Configuration validated successfully');
  
  if (config.env === 'development') {
    console.log('🔧 Running in development mode');
  }
}

// Export configuration
module.exports = {
  ...config,
  validateConfig
};