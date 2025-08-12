# 🎯 Telegram Deposit Notification Bot

**Enterprise-grade Telegram bot for FB deposit notifications via Keitaro integration**

## 📋 Overview

Автоматический телеграм-бот для уведомлений о входящих депозитах от FB источников трафика через интеграцию с Keitaro API.

### Основные возможности

- ✅ Прием постбеков от платежных шлюзов
- ✅ Интеграция с Keitaro API для получения данных о кликах
- ✅ Фильтрация FB/NON-FB источников трафика (15 FB источников)
- ✅ Отправка уведомлений в Telegram с детальной информацией
- ✅ Enterprise-grade логирование и мониторинг
- ✅ Обработка только "sale" статусов
- ✅ Полная валидация данных и обработка ошибок

## 🏗️ Архитектура

```
Gateway Postback → Webhook → Keitaro Lookup → FB Filter → Telegram Notification
```

### Технический стек

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **API Integration**: Axios (Keitaro), node-telegram-bot-api
- **Validation**: Joi
- **Logging**: Winston
- **Security**: Helmet, CORS, Rate Limiting

## 🚀 Быстрый запуск

### 1. Установка зависимостей

```bash
cd telegram-deposit-bot
npm install
```

### 2. Настройка конфигурации

Скопируйте `.env.example` в `.env` и настройте параметры:

```bash
cp .env.example .env
```

**Обязательно настройте:**
- `TELEGRAM_CHAT_ID` - ID чата для уведомлений
- При необходимости измените другие параметры

### 3. Запуск

```bash
# Продакшн
npm start

# Разработка (с автоперезапуском)
npm run dev
```

## ⚙️ Конфигурация

### Telegram Bot

1. Создайте бота через @BotFather
2. Получите токен бота (уже указан в .env)
3. Добавьте бота в чат и получите CHAT_ID

### Keitaro Integration

- **URL**: `https://keitaro.familyteam.top`
- **API Key**: `5743b46976d8103d1a72270e7d401cde` (уже настроен)

### FB Traffic Sources (15 источников)

Автоматически определяются по исследованию API:

```javascript
FB_SOURCES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
// MNSTR Apps, ZM Apps, Trident-media.agency, Wildwildapps.net, 
// TDApps, IRENT, PWA Market, BlackApp.dev, Skakapp.com, 
// TG, ASO, InApp, Appsheroes.com, PWA Partners, WWA

NON_FB_SOURCES = [2] // Google (игнорируется)
```

## 📡 API Endpoints

### Основные endpoints

- `GET /` - Информация о приложении
- `GET /health` - Проверка здоровья сервисов
- `GET|POST /postback` - Webhook для приема постбеков

### Администрирование

- `GET /admin/stats` - Статистика приложения
- `GET /admin/test` - Тест всех сервисов
- `POST /admin/test-notification` - Тест отправки уведомлений
- `GET /admin/traffic-sources` - Информация об источниках трафика

## 📱 Формат уведомлений

```
Ура, пришел деп! 🥳

Источник: FB
ID баера: {subid1}
ГЕО: {geo}
Источник в КТ: {traffic_source_name}
Оффер: {offer_name}
Кампания: {campaign_name}
Subid2: {subid2}
Креатив: {subid4}
Доход: {payout}

🕒 12.08.2025, 14:30:25
```

## 🔒 Безопасность

- **Rate Limiting**: 100 запросов/15 минут
- **Input Validation**: Joi схемы для всех данных
- **Error Handling**: Comprehensive error management
- **Security Headers**: Helmet middleware
- **API Key Protection**: Secure Keitaro integration

## 📊 Мониторинг

### Логирование

Logs сохраняются в папку `logs/`:
- `app.log` - все события
- `error.log` - только ошибки
- `deposits.log` - депозитные события

### Health Check

```bash
curl http://localhost:3000/health
```

### Статистика

```bash
curl http://localhost:3000/admin/stats
```

## 🧪 Тестирование

### Тест уведомления

```bash
curl -X POST http://localhost:3000/admin/test-notification
```

### Пример постбека

```bash
curl "http://localhost:3000/postback?subid=click123&status=sale&payout=150.00&geo=TR"
```

## 📈 Production Deployment

### PM2 (рекомендуется)

```bash
npm install -g pm2
pm2 start src/index.js --name "deposit-bot"
pm2 startup
pm2 save
```

### Docker

```bash
# Создание образа
docker build -t telegram-deposit-bot .

# Запуск контейнера
docker run -d \
  --name deposit-bot \
  -p 3000:3000 \
  --env-file .env \
  telegram-deposit-bot
```

### Nginx Proxy

```nginx
location /postback {
    proxy_pass http://localhost:3000/postback;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## 🔧 Troubleshooting

### Частые проблемы

1. **Keitaro API недоступен**
   - Проверьте URL и API ключ
   - Проверьте доступность домена

2. **Telegram не отправляет сообщения**
   - Проверьте токен бота
   - Проверьте CHAT_ID
   - Убедитесь что бот добавлен в чат

3. **Неизвестные источники трафика**
   - Обновите константы FB_SOURCES
   - Проверьте логи для новых источников

### Логи и диагностика

```bash
# Просмотр логов
tail -f logs/app.log
tail -f logs/error.log

# Статистика обработки
curl http://localhost:3000/admin/stats

# Проверка здоровья
curl http://localhost:3000/health
```

## 📝 License

MIT License - FamilyTeam 2025

## 👨‍💻 Senior PM Notes

- **Production Ready**: Enterprise-grade архитектура
- **Scalable**: Готов к высоким нагрузкам
- **Maintainable**: Чистый код с полным покрытием логами
- **Secure**: Защищен от основных угроз
- **Observable**: Полный мониторинг и метрики