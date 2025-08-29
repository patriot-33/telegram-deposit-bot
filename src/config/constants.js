/**
 * Application Constants
 * Senior PM: Centralized configuration based on Keitaro research
 */

// Traffic Sources Configuration (Based on API Research)
const TRAFFIC_SOURCES = {
  FB_SOURCES: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  NON_FB_SOURCES: [2], // Google
  
  // Source ID to Name mapping (for notifications)
  SOURCES_MAP: {
    2: 'Google',
    3: 'MNSTR Apps',
    4: 'ZM Apps',
    5: 'Trident-media.agency',
    6: 'Wildwildapps.net',
    7: 'TDApps',
    8: 'IRENT',
    9: 'PWA Market',
    10: 'BlackApp.dev',
    11: 'Skakapp.com',
    12: 'TG',
    13: 'ASO',
    14: 'InApp',
    15: 'Appsheroes.com',
    16: 'PWA Partners',
    17: 'WWA'
  }
};

// Postback Status Configuration - Universal Deposit Detection
const POSTBACK_STATUS = {
  // Deposit indicators - if status contains any of these, it's considered a deposit
  DEPOSIT_KEYWORDS: [
    'dep', 'deposit', 'sale', 'approved', 'confirmed', 'success', 'complete',
    'paid', 'ftd', 'first_deposit', 'payment', 'purchase', 'conversion'
  ],
  
  // Rejection indicators - if status contains any of these, ignore even if has deposit keywords  
  REJECTION_KEYWORDS: [
    'reject', 'denied', 'cancel', 'fail', 'decline', 'void', 'refund', 'chargeback'
  ],
  
  // Registration/Lead indicators - ignore these completely
  LEAD_KEYWORDS: [
    'lead', 'reg', 'registration', 'click', 'impression', 'install', 'signup', 'view'
  ],
  
  // Legacy exact match for backward compatibility
  EXACT_VALID_STATUSES: ['sale', 'dep', 'deposit', 'first_dep_confirmed', 'dep_confirmed'],
  EXACT_IGNORE_STATUSES: ['lead', 'click', 'impression', 'reg', 'registration']
};

// Telegram Message Templates
const MESSAGE_TEMPLATES = {
  DEPOSIT_NOTIFICATION: `🥳 <b>Новый депозит!</b>

💰 <b>Доход:</b> {payout}
🆔 <b>ID баера:</b> {subid1}
🌍 <b>ГЕО:</b> {geo}

📊 <b>Детали:</b>
🎯 Оффер: {offer_name}
📈 Кампания: {campaign_name}
🔗 Источник: {traffic_source_name}
🎨 Креатив: {subid4}
📋 SubID2: {subid2}`,

  ERROR_NOTIFICATION: `⚠️ Ошибка обработки постбека
Время: {timestamp}
Ошибка: {error}
Subid: {subid}`,

  SYSTEM_STATUS: `📊 Статус системы
Время работы: {uptime}
Обработано депозитов: {processed_deposits}
Последняя активность: {last_activity}`
};

// API Configuration
const API_CONFIG = {
  KEITARO: {
    ENDPOINTS: {
      CLICKS: '/clicks',
      CAMPAIGNS: '/campaigns', 
      OFFERS: '/offers',
      TRAFFIC_SOURCES: '/traffic_sources',
      CONVERSIONS: '/conversions',
      REPORTS: '/reports'
    },
    TIMEOUT: 5000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000
  },
  
  TELEGRAM: {
    TIMEOUT: 5000,
    RETRY_ATTEMPTS: 2,
    RETRY_DELAY: 500
  }
};

// Application Limits
const LIMITS = {
  MAX_POSTBACK_SIZE: '1mb',
  MAX_MESSAGE_LENGTH: 4096,
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100
  }
};

// Known FB Postback Sources Configuration
// Maps postback 'from' parameter to Keitaro traffic source data
const KNOWN_FB_POSTBACK_SOURCES = {
  'bettitltr': { 
    name: 'WWA (BettiltTR)', 
    traffic_source_id: 17, 
    description: 'WWA via BettiltTR postbacks' 
  },
  'pwa.partners': { 
    name: 'PWA Partners', 
    traffic_source_id: 16, 
    description: 'PWA Partners direct postbacks' 
  },
  'pinco.partners': { 
    name: 'PWA Partners (PINCO)', 
    traffic_source_id: 16, 
    description: 'PWA Partners via PINCO postbacks' 
  },
  'wwapps': { 
    name: 'WWA', 
    traffic_source_id: 17, 
    description: 'WWA direct postbacks' 
  },
  'wwa': { 
    name: 'WWA', 
    traffic_source_id: 17, 
    description: 'WWA short form postbacks' 
  },
  'skakapp.com': { 
    name: 'Skakapp.com', 
    traffic_source_id: 11, 
    description: 'Skakapp direct postbacks' 
  },
  'skakapp': { 
    name: 'Skakapp.com', 
    traffic_source_id: 11, 
    description: 'Skakapp short form postbacks' 
  }
};

// Retry configuration for Keitaro API eventual consistency delays
const RETRY_CONFIG = {
  DELAYS: [30000, 60000, 120000], // 30 seconds, 1 minute, 2 minutes  
  MAX_RETRIES: 3,
  TOTAL_MAX_WAIT_TIME: 210000, // 3.5 minutes total
  BACKOFF_TYPE: 'exponential',
  DESCRIPTION: 'Handles eventual consistency delays in Keitaro API responses'
};

// Error Codes
const ERROR_CODES = {
  INVALID_POSTBACK: 'INVALID_POSTBACK',
  KEITARO_API_ERROR: 'KEITARO_API_ERROR',
  CLICK_NOT_FOUND: 'CLICK_NOT_FOUND',
  NON_FB_SOURCE: 'NON_FB_SOURCE',
  INVALID_STATUS: 'INVALID_STATUS',
  TELEGRAM_ERROR: 'TELEGRAM_ERROR',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  FALLBACK_USED: 'FALLBACK_USED'
};

module.exports = {
  TRAFFIC_SOURCES,
  POSTBACK_STATUS,
  MESSAGE_TEMPLATES,
  API_CONFIG,
  LIMITS,
  ERROR_CODES,
  KNOWN_FB_POSTBACK_SOURCES,
  RETRY_CONFIG
};