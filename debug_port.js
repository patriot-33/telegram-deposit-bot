/**
 * PORT DEBUGGING - Deploy this to see exact port configuration
 */

console.log('🔍 PORT DEBUGGING ANALYSIS');
console.log('========================');
console.log('process.env.PORT:', process.env.PORT);
console.log('process.env.NODE_ENV:', process.env.NODE_ENV);
console.log('process.env.RENDER_SERVICE_ID:', process.env.RENDER_SERVICE_ID);
console.log('process.env.RENDER_EXTERNAL_URL:', process.env.RENDER_EXTERNAL_URL);

// Load config
require('dotenv').config();
const config = require('./src/config/config');
console.log('config.port:', config.port);

// Test server
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({
    message: 'Port debug',
    processEnvPort: process.env.PORT,
    configPort: config.port,
    actualPort: req.get('host')
  });
});

const server = app.listen(config.port, () => {
  console.log('✅ Server started on port:', server.address().port);
  console.log('Config says port:', config.port);
  console.log('Process env PORT:', process.env.PORT);
});