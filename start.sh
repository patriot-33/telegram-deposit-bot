#!/bin/bash

# Telegram Deposit Bot Startup Script
# Senior PM: Production-ready startup with error handling

echo "🚀 Starting Telegram Deposit Bot..."

# Check Node.js version
NODE_VERSION=$(node --version)
echo "📦 Node.js version: $NODE_VERSION"

# Check if required environment variables are set
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo "⚠️  TELEGRAM_BOT_TOKEN not set, loading from .env"
fi

if [ -z "$TELEGRAM_CHAT_ID" ]; then
    echo "⚠️  TELEGRAM_CHAT_ID not set, loading from .env"
fi

# Create logs directory
mkdir -p logs
echo "📝 Logs directory created"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
fi

# Run configuration validation
echo "🔧 Validating configuration..."
node -e "
const config = require('./src/config/config');
try {
    config.validateConfig();
    console.log('✅ Configuration valid');
} catch (error) {
    console.error('❌ Configuration error:', error.message);
    process.exit(1);
}
"

if [ $? -ne 0 ]; then
    echo "❌ Configuration validation failed"
    exit 1
fi

# Start the application
echo "🎯 Starting Telegram Deposit Bot..."
if [ "$NODE_ENV" = "development" ]; then
    npm run dev
else
    npm start
fi