# 🚀 Деплой на Render.com - Пошаговая инструкция

## ☁️ Почему Render.com идеален для этого проекта:

- ✅ **Бесплатный план** для старта
- ✅ **Автоматический HTTPS** 
- ✅ **Глобальные URL** типа `https://your-app.onrender.com`
- ✅ **Автодеплой** из GitHub
- ✅ **Готовая поддержка Node.js**

## 📋 Шаги деплоя:

### 1. Подготовка GitHub репозитория

```bash
cd telegram-deposit-bot

# Инициализация Git
git init
git add .
git commit -m "Initial commit: Telegram Deposit Bot"

# Создайте репозиторий на GitHub и подключите
git remote add origin https://github.com/YOUR_USERNAME/telegram-deposit-bot.git
git push -u origin main
```

### 2. Настройка на Render.com

1. **Зайдите на**: https://render.com
2. **Нажмите**: "New" → "Web Service"
3. **Подключите**: свой GitHub репозиторий
4. **Выберите**: `telegram-deposit-bot`

### 3. Конфигурация в Render Dashboard:

**Build Settings:**
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Node Version**: `18`

**Environment Variables:**
```
NODE_ENV = production
PORT = 10000
TELEGRAM_BOT_TOKEN = 8388286726:AAEOdmeuTksTn-UYbSK3Goom5B0rwib_de0
TELEGRAM_CHAT_ID = -1001234567890  ← ЗАМЕНИТЕ НА ВАШ
KEITARO_BASE_URL = https://keitaro.familyteam.top
KEITARO_API_KEY = 5743b46976d8103d1a72270e7d401cde
LOG_LEVEL = info
RATE_LIMIT_MAX_REQUESTS = 100
```

### 4. Деплой

Нажмите **"Create Web Service"** - Render автоматически:
- Склонирует ваш репозиторий
- Установит зависимости
- Запустит приложение
- Предоставит HTTPS URL

## 🔗 Ваш URL для постбеков будет:

```
https://your-app-name.onrender.com/postback
```

### Пример:
```
https://telegram-deposit-bot-abc123.onrender.com/postback
```

## ✅ Проверка после деплоя:

### 1. Здоровье системы:
```
https://your-app-name.onrender.com/health
```

### 2. Тест уведомления:
```bash
curl -X POST https://your-app-name.onrender.com/admin/test-notification
```

### 3. Тест постбека:
```bash
curl "https://your-app-name.onrender.com/postback?subid=test123&status=sale&payout=100.50&geo=US"
```

## 🎯 Настройка в платежном шлюзе:

После успешного деплоя, в настройках вашего платежного шлюза укажите:

```
Webhook URL: https://your-app-name.onrender.com/postback
Method: GET или POST (бот поддерживает оба)
```

## 📊 Мониторинг на Render:

Render предоставляет:
- **Логи в реальном времени**
- **Метрики производительности** 
- **Автоматические перезапуски**
- **Health checks**

## 💰 Стоимость:

- **Free Plan**: 
  - ✅ 512MB RAM
  - ✅ Засыпает через 15 минут бездействия
  - ✅ 750 часов/месяц

- **Starter Plan ($7/мес)**:
  - ✅ 512MB RAM
  - ✅ Не засыпает
  - ✅ Безлимитные часы

## 🔒 Безопасность:

- ✅ **Автоматический HTTPS**
- ✅ **Environment variables** в зашифрованном виде
- ✅ **DDoS защита**
- ✅ **Rate limiting** встроен в бот

## 📱 Готово к работе!

После деплоя ваш бот будет:
- ✅ Доступен 24/7 по HTTPS URL
- ✅ Принимать постбеки от платежных шлюзов
- ✅ Отправлять уведомления в Telegram
- ✅ Автоматически обновляться при push в GitHub

**URL для настройки в шлюзе:** `https://your-app-name.onrender.com/postback`