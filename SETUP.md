# 🚀 Телеграм Бот для Депозитов - Инструкция по настройке

## 📋 Требования

- **Node.js 18+** 
- **npm 8+**
- **Доступ к Keitaro API**: `https://keitaro.familyteam.top`
- **Telegram Bot Token**: `8388286726:AAEOdmeuTksTn-UYbSK3Goom5B0rwib_de0`

## 🔧 Настройка за 5 минут

### 1. Настройка Telegram Chat ID

**ВАЖНО:** Вам нужно настроить `TELEGRAM_CHAT_ID` в файле `.env`

#### Как получить Chat ID:

**Вариант 1 - Через @userinfobot:**
1. Найдите бота `@userinfobot` в Telegram
2. Отправьте ему `/start`
3. Скопируйте ваш User ID

**Вариант 2 - Через группу:**
1. Создайте группу и добавьте туда бота
2. Отправьте сообщение в группу
3. Перейдите по ссылке: `https://api.telegram.org/bot8388286726:AAEOdmeuTksTn-UYbSK3Goom5B0rwib_de0/getUpdates`
4. Найдите "chat":{"id":-1001234567890} в ответе
5. Используйте это значение как CHAT_ID

### 2. Обновите .env файл

Откройте файл `.env` и замените:

```bash
TELEGRAM_CHAT_ID=-1001234567890  # ← ЗАМЕНИТЕ НА ВАШ CHAT_ID
```

### 3. Запуск

```bash
cd telegram-deposit-bot
./start.sh
```

## ✅ Проверка работы

### 1. Проверьте здоровье системы:
```bash
curl http://localhost:3000/health
```

### 2. Отправьте тестовое уведомление:
```bash
curl -X POST http://localhost:3000/admin/test-notification
```

### 3. Протестируйте постбек:
```bash
curl "http://localhost:3000/postback?subid=test123&status=sale&payout=100.50&geo=US"
```

## 🌐 Настройка Webhook URL

После запуска бота, настройте в вашем платежном шлюзе URL для постбеков:

```
http://your-server-domain.com:3000/postback
```

Или для продакшена с Nginx:
```
https://your-domain.com/postback
```

## 📊 Мониторинг

### Логи:
```bash
tail -f logs/app.log        # Все события
tail -f logs/error.log      # Только ошибки  
tail -f logs/deposits.log   # Депозитные события
```

### Статистика:
```bash
curl http://localhost:3000/admin/stats
```

### Информация о источниках трафика:
```bash
curl http://localhost:3000/admin/traffic-sources
```

## 🚨 Важные настройки

### FB Sources (15 источников):
```
ID: 3,4,5,6,7,8,9,10,11,12,13,14,15,16,17
```

### NON-FB Sources (игнорируются):
```
ID: 2 (Google)
```

### Обрабатываемые статусы:
```
- "sale" ✅ (обрабатывается)
- "lead", "click", "impression" ❌ (игнорируется)
```

## 🔒 Безопасность

- **Rate Limit**: 100 запросов / 15 минут
- **Input Validation**: Полная валидация всех данных
- **Error Handling**: Обработка всех ошибок
- **Logging**: Подробные логи всех операций

## 📞 Поддержка

При возникновении проблем:

1. **Проверьте логи** в папке `logs/`
2. **Тест здоровья**: `curl http://localhost:3000/health`
3. **Тест уведомлений**: `curl -X POST http://localhost:3000/admin/test-notification`

### Частые проблемы:

**Проблема**: Бот не отправляет сообщения
**Решение**: Проверьте TELEGRAM_CHAT_ID и убедитесь что бот добавлен в чат

**Проблема**: Keitaro API недоступен
**Решение**: Проверьте подключение к `https://keitaro.familyteam.top`

**Проблема**: Неизвестный источник трафика
**Решение**: Проверьте логи, возможно появился новый источник

## 🎯 Готово к продакшену!

Бот полностью настроен и готов к работе с:
- ✅ 15 FB источников трафика
- ✅ Интеграцией с Keitaro
- ✅ Telegram уведомлениями
- ✅ Enterprise-grade логированием
- ✅ Мониторингом и метриками