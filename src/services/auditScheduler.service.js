/**
 * Audit Scheduler Service
 * Автоматический планировщик аудита депозитов
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const DepositAuditService = require('./depositAudit.service');
const telegramBotService = require('./telegramBot.service');
const config = require('../config/config');

class AuditSchedulerService {
  constructor() {
    this.isRunning = false;
    this.lastAuditTime = null;
    this.auditHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Запуск автоматического планировщика аудита
   */
  start() {
    if (this.isRunning) {
      logger.warn('⚠️ Audit scheduler already running');
      return;
    }

    logger.info('🚀 Starting automatic audit scheduler');

    // Ежедневный аудит в 09:00 по московскому времени
    this.dailyAuditJob = cron.schedule('0 9 * * *', async () => {
      await this.runDailyAudit();
    }, {
      scheduled: true,
      timezone: "Europe/Moscow"
    });

    // Еженедельный подробный аудит в воскресенье в 10:00
    this.weeklyAuditJob = cron.schedule('0 10 * * 0', async () => {
      await this.runWeeklyAudit();
    }, {
      scheduled: true,
      timezone: "Europe/Moscow"
    });

    // Экстренная проверка каждые 4 часа (только если есть критические проблемы)
    this.emergencyCheckJob = cron.schedule('0 */4 * * *', async () => {
      await this.runEmergencyCheck();
    }, {
      scheduled: true,
      timezone: "Europe/Moscow"
    });

    this.isRunning = true;
    logger.info('✅ Audit scheduler started successfully', {
      dailyAudit: '09:00 MSK',
      weeklyAudit: 'Sunday 10:00 MSK', 
      emergencyCheck: 'Every 4 hours'
    });
  }

  /**
   * Остановка планировщика
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('⚠️ Audit scheduler is not running');
      return;
    }

    if (this.dailyAuditJob) this.dailyAuditJob.destroy();
    if (this.weeklyAuditJob) this.weeklyAuditJob.destroy();
    if (this.emergencyCheckJob) this.emergencyCheckJob.destroy();

    this.isRunning = false;
    logger.info('🛑 Audit scheduler stopped');
  }

  /**
   * Ежедневный аудит - проверка вчерашних депозитов
   */
  async runDailyAudit() {
    const auditId = `daily_${Date.now()}`;
    logger.info('📅 Starting daily audit', { auditId });

    try {
      // Аудит вчерашних депозитов
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

      const auditResults = await DepositAuditService.auditDeposits(dateStr, dateStr);
      
      // Сохранить результаты в историю
      this.addToHistory({
        type: 'daily',
        auditId,
        date: dateStr,
        results: auditResults,
        timestamp: new Date()
      });

      // Отправить уведомление администраторам
      await this.sendAuditNotification('daily', auditResults, dateStr);

      logger.info('✅ Daily audit completed', {
        auditId,
        date: dateStr,
        missingDeposits: auditResults.statistics.missingNotifications,
        successRate: auditResults.statistics.successRate
      });

    } catch (error) {
      logger.error('❌ Daily audit failed', {
        auditId,
        error: error.message,
        stack: error.stack
      });

      // Уведомить об ошибке
      await this.sendErrorNotification('daily', error);
    }
  }

  /**
   * Еженедельный аудит - проверка за всю неделю
   */
  async runWeeklyAudit() {
    const auditId = `weekly_${Date.now()}`;
    logger.info('📊 Starting weekly audit', { auditId });

    try {
      // Аудит за последнюю неделю
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1); // Вчера
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7); // Неделю назад

      const dateFrom = startDate.toISOString().split('T')[0];
      const dateTo = endDate.toISOString().split('T')[0];

      const auditResults = await DepositAuditService.auditDeposits(dateFrom, dateTo);
      
      // Сохранить результаты
      this.addToHistory({
        type: 'weekly',
        auditId,
        period: { from: dateFrom, to: dateTo },
        results: auditResults,
        timestamp: new Date()
      });

      // Отправить подробный отчет
      await this.sendWeeklyReport(auditResults, dateFrom, dateTo);

      logger.info('✅ Weekly audit completed', {
        auditId,
        period: `${dateFrom} to ${dateTo}`,
        missingDeposits: auditResults.statistics.missingNotifications,
        successRate: auditResults.statistics.successRate
      });

    } catch (error) {
      logger.error('❌ Weekly audit failed', {
        auditId,
        error: error.message
      });

      await this.sendErrorNotification('weekly', error);
    }
  }

  /**
   * Экстренная проверка - только если есть критические проблемы
   */
  async runEmergencyCheck() {
    // Проверяем только последние 4 часа и только если есть подозрения на проблемы
    const recentHistory = this.auditHistory
      .filter(h => h.type === 'daily' && h.results.statistics.successRate < 95)
      .slice(-2); // Последние 2 дня с проблемами

    if (recentHistory.length < 2) {
      logger.debug('🔍 Emergency check skipped - no recent issues detected');
      return;
    }

    const auditId = `emergency_${Date.now()}`;
    logger.info('🚨 Starting emergency check', { auditId });

    try {
      // Проверяем сегодняшний день
      const today = new Date().toISOString().split('T')[0];
      const auditResults = await DepositAuditService.auditDeposits(today, today);

      if (auditResults.statistics.missingNotifications > 0) {
        // Есть пропущенные депозиты - отправить экстренное уведомление
        await this.sendEmergencyAlert(auditResults, today);
      }

      logger.info('✅ Emergency check completed', {
        auditId,
        missingToday: auditResults.statistics.missingNotifications
      });

    } catch (error) {
      logger.error('❌ Emergency check failed', {
        auditId,
        error: error.message
      });
    }
  }

  /**
   * Отправка уведомления о результатах аудита
   */
  async sendAuditNotification(type, auditResults, date) {
    try {
      const stats = auditResults.statistics;
      const missing = auditResults.results.missing.length;

      let message = `📊 <b>${type === 'daily' ? 'Ежедневный' : 'Еженедельный'} Аудит Депозитов</b>\n\n`;
      message += `📅 Дата: ${date}\n`;
      message += `💰 Всего FB депозитов: ${stats.fbDepositsCount}\n`;
      message += `✅ Уведомления отправлены: ${stats.foundNotifications}\n`;
      
      if (missing > 0) {
        message += `⚠️ <b>Пропущено: ${missing}</b>\n`;
        message += `📈 Успешность: ${stats.successRate}%\n\n`;
        
        // Добавить первые 3 пропущенных депозита
        if (auditResults.results.missing.length > 0) {
          message += `🔍 <b>Пропущенные депозиты:</b>\n`;
          auditResults.results.missing.slice(0, 3).forEach((missing, index) => {
            message += `${index + 1}. ${missing.subid} - ${missing.reason}\n`;
          });
          
          if (auditResults.results.missing.length > 3) {
            message += `... и еще ${auditResults.results.missing.length - 3} депозитов\n`;
          }
        }

        // Добавить рекомендации
        if (auditResults.recommendations.length > 0) {
          message += `\n💡 <b>Рекомендации:</b>\n`;
          auditResults.recommendations.slice(0, 2).forEach((rec, index) => {
            message += `${index + 1}. ${rec.message}\n`;
          });
        }
      } else {
        message += `✅ <b>Все депозиты обработаны успешно!</b>\n`;
        message += `📈 Успешность: 100%\n`;
      }

      message += `\n<i>Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`;

      // Отправить всем владельцам
      for (const ownerId of config.owners) {
        try {
          await telegramBotService.sendMessage(ownerId, message, { parse_mode: 'HTML' });
        } catch (error) {
          logger.warn(`Failed to send audit notification to owner ${ownerId}`, { error: error.message });
        }
      }

    } catch (error) {
      logger.error('Failed to send audit notification', { error: error.message });
    }
  }

  /**
   * Отправка еженедельного отчета
   */
  async sendWeeklyReport(auditResults, dateFrom, dateTo) {
    try {
      const stats = auditResults.statistics;
      
      let message = `📈 <b>Еженедельный Отчет по Депозитам</b>\n\n`;
      message += `📅 Период: ${dateFrom} - ${dateTo}\n`;
      message += `💰 Всего FB депозитов: ${stats.fbDepositsCount}\n`;
      message += `📤 Всего уведомлений: ${stats.sentNotificationsCount}\n`;
      message += `✅ Успешно обработано: ${stats.foundNotifications}\n`;
      message += `⚠️ Пропущено: ${stats.missingNotifications}\n`;
      message += `📊 Общая успешность: ${stats.successRate}%\n\n`;

      // Анализ трендов
      const recentDaily = this.auditHistory
        .filter(h => h.type === 'daily')
        .slice(-7)
        .map(h => h.results.statistics.successRate);
      
      if (recentDaily.length > 0) {
        const avgSuccessRate = Math.round(recentDaily.reduce((a, b) => a + b, 0) / recentDaily.length);
        message += `📈 <b>Тренды:</b>\n`;
        message += `• Средняя успешность за неделю: ${avgSuccessRate}%\n`;
        
        const trend = recentDaily.length > 3 ? 
          (recentDaily.slice(-3).reduce((a, b) => a + b) / 3) - (recentDaily.slice(0, 3).reduce((a, b) => a + b) / 3) :
          0;
        
        if (trend > 2) {
          message += `📈 • Положительная динамика (+${Math.round(trend)}%)\n`;
        } else if (trend < -2) {
          message += `📉 • Отрицательная динамика (${Math.round(trend)}%)\n`;
        } else {
          message += `➡️ • Стабильная работа\n`;
        }
      }

      message += `\n<i>Автоматический отчет - ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`;

      // Отправить владельцам
      for (const ownerId of config.owners) {
        try {
          await telegramBotService.sendMessage(ownerId, message, { parse_mode: 'HTML' });
        } catch (error) {
          logger.warn(`Failed to send weekly report to owner ${ownerId}`);
        }
      }

    } catch (error) {
      logger.error('Failed to send weekly report', { error: error.message });
    }
  }

  /**
   * Экстренное уведомление
   */
  async sendEmergencyAlert(auditResults, date) {
    try {
      const missing = auditResults.results.missing.length;
      
      let message = `🚨 <b>ЭКСТРЕННОЕ УВЕДОМЛЕНИЕ</b>\n\n`;
      message += `⚠️ Обнаружены пропущенные депозиты!\n`;
      message += `📅 Дата: ${date}\n`;
      message += `❌ Пропущено: ${missing} депозитов\n\n`;
      
      message += `🔍 <b>Требуется проверка:</b>\n`;
      auditResults.results.missing.slice(0, 5).forEach((missing, index) => {
        message += `${index + 1}. ${missing.subid} ($${missing.deposit.revenue})\n`;
      });

      message += `\n🔗 Проверить: POST /admin/audit-deposits\n`;
      message += `<i>Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`;

      // Отправить владельцам с высоким приоритетом
      for (const ownerId of config.owners) {
        try {
          await telegramBotService.sendMessage(ownerId, message, { parse_mode: 'HTML' });
        } catch (error) {
          logger.warn(`Failed to send emergency alert to owner ${ownerId}`);
        }
      }

    } catch (error) {
      logger.error('Failed to send emergency alert', { error: error.message });
    }
  }

  /**
   * Уведомление об ошибке аудита
   */
  async sendErrorNotification(auditType, error) {
    try {
      let message = `❌ <b>Ошибка ${auditType} аудита</b>\n\n`;
      message += `🔍 Ошибка: ${error.message}\n`;
      message += `⏰ Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n\n`;
      message += `🔧 Требуется проверка системы аудита`;

      for (const ownerId of config.owners) {
        try {
          await telegramBotService.sendMessage(ownerId, message, { parse_mode: 'HTML' });
        } catch (sendError) {
          logger.warn(`Failed to send error notification to owner ${ownerId}`);
        }
      }

    } catch (error) {
      logger.error('Failed to send error notification', { error: error.message });
    }
  }

  /**
   * Добавить результат в историю
   */
  addToHistory(auditRecord) {
    this.auditHistory.push(auditRecord);
    
    // Ограничить размер истории
    if (this.auditHistory.length > this.maxHistorySize) {
      this.auditHistory = this.auditHistory.slice(-this.maxHistorySize);
    }

    this.lastAuditTime = new Date();
  }

  /**
   * Получить статистику планировщика
   */
  getSchedulerStats() {
    return {
      isRunning: this.isRunning,
      lastAuditTime: this.lastAuditTime,
      auditHistoryCount: this.auditHistory.length,
      recentAudits: this.auditHistory.slice(-5).map(audit => ({
        type: audit.type,
        date: audit.date || audit.period,
        successRate: audit.results.statistics.successRate,
        missingDeposits: audit.results.statistics.missingNotifications,
        timestamp: audit.timestamp
      })),
      nextScheduledAudits: {
        daily: 'Каждый день в 09:00 MSK',
        weekly: 'Воскресенье в 10:00 MSK',
        emergency: 'Каждые 4 часа (при необходимости)'
      }
    };
  }

  /**
   * Ручной запуск аудита
   */
  async runManualAudit(dateFrom, dateTo) {
    const auditId = `manual_${Date.now()}`;
    logger.info('🔧 Starting manual audit', { auditId, dateFrom, dateTo });

    try {
      const auditResults = await DepositAuditService.auditDeposits(dateFrom, dateTo);
      
      this.addToHistory({
        type: 'manual',
        auditId,
        period: { from: dateFrom, to: dateTo },
        results: auditResults,
        timestamp: new Date()
      });

      return auditResults;

    } catch (error) {
      logger.error('❌ Manual audit failed', { auditId, error: error.message });
      throw error;
    }
  }
}

// Создать singleton instance
const auditScheduler = new AuditSchedulerService();

module.exports = auditScheduler;