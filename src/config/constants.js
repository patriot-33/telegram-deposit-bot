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

// Postback Status Configuration
const POSTBACK_STATUS = {
  VALID_STATUSES: ['sale', 'dep', 'deposit', 'first_dep_confirmed', 'dep_confirmed'],
  IGNORE_STATUSES: ['lead', 'click', 'impression', 'reg', 'registration', 'reg_confirmed', 'reg_rejected', 'dep_rejected', 'first_dep_rejected']
};

// Telegram Message Templates
const MESSAGE_TEMPLATES = {
  DEPOSIT_NOTIFICATION: `Ура, пришел деп! 🥳

Источник: FB
ID баера: {subid1}
ГЕО: {geo}
Источник в КТ: {traffic_source_name}
Оффер: {offer_name}
Кампания: {campaign_name}
Subid2: {subid2}
Креатив: {subid4}
Доход: {payout}`,

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
      TRAFFIC_SOURCES: '/traffic_sources'
    },
    TIMEOUT: 10000,
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

// Error Codes
const ERROR_CODES = {
  INVALID_POSTBACK: 'INVALID_POSTBACK',
  KEITARO_API_ERROR: 'KEITARO_API_ERROR',
  CLICK_NOT_FOUND: 'CLICK_NOT_FOUND',
  NON_FB_SOURCE: 'NON_FB_SOURCE',
  INVALID_STATUS: 'INVALID_STATUS',
  TELEGRAM_ERROR: 'TELEGRAM_ERROR',
  SYSTEM_ERROR: 'SYSTEM_ERROR'
};

module.exports = {
  TRAFFIC_SOURCES,
  POSTBACK_STATUS,
  MESSAGE_TEMPLATES,
  API_CONFIG,
  LIMITS,
  ERROR_CODES
};