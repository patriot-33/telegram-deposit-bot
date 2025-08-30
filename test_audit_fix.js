/**
 * Test script to diagnose and fix audit system
 */

const logger = require('./src/utils/logger');

async function testAuditEndpoint() {
  console.log('🔍 Testing Keitaro API endpoints for audit...\n');
  
  try {
    // Load dependencies
    const keitaroService = require('./src/services/keitaro.service');
    const config = require('./src/config/config');
    
    console.log('📋 Configuration:');
    console.log('- Base URL:', config.keitaro.baseUrl);
    console.log('- API URL:', config.keitaro.baseUrl + '/admin_api/v1');
    console.log('- API Key:', config.keitaro.apiKey ? '✅ Set' : '❌ Missing');
    console.log('\n');
    
    // Test 1: Check basic connectivity
    console.log('Test 1: Basic API connectivity');
    try {
      const testClick = await keitaroService.getClickById('test123');
      console.log('✅ API is accessible');
    } catch (error) {
      console.log('⚠️ Basic API test returned:', error.message);
    }
    console.log('\n');
    
    // Test 2: Try different conversion endpoints
    console.log('Test 2: Testing conversion endpoints');
    
    // Calculate dates for yesterday
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const dateFrom = yesterday.toISOString().split('T')[0];
    const dateTo = today.toISOString().split('T')[0];
    
    console.log(`- Testing period: ${dateFrom} to ${dateTo}`);
    
    // Test the conversions endpoint
    try {
      const conversions = await keitaroService.getConversionsForPeriod(dateFrom, dateTo);
      console.log(`✅ Conversions endpoint works! Found ${conversions.length} conversions`);
      
      if (conversions.length > 0) {
        console.log('\nSample conversion:');
        const sample = conversions[0];
        console.log('- SubID:', sample.subId);
        console.log('- Status:', sample.status);
        console.log('- Traffic Source:', sample.trafficSourceName);
        console.log('- Revenue:', sample.revenue);
      }
    } catch (error) {
      console.log('❌ Conversions endpoint failed:', error.message);
      
      // Try alternative approach
      console.log('\nTrying alternative endpoint...');
      
      // Direct API call to check available endpoints
      const axios = require('axios');
      try {
        // Try to get API info
        const response = await axios.get(config.keitaro.baseUrl + '/admin_api/v1', {
          headers: {
            'Api-Key': config.keitaro.apiKey
          }
        });
        console.log('API Info:', response.data);
      } catch (apiError) {
        console.log('API Info request failed:', apiError.message);
      }
    }
    console.log('\n');
    
    // Test 3: Run actual audit
    console.log('Test 3: Running deposit audit');
    try {
      const depositAuditService = require('./src/services/depositAudit.service');
      const auditResults = await depositAuditService.auditDeposits(dateFrom, dateTo);
      
      console.log('✅ Audit completed successfully!');
      console.log('\nAudit Results:');
      console.log('- Total Keitaro deposits:', auditResults.statistics.totalKeitaroDeposits);
      console.log('- FB deposits:', auditResults.statistics.fbDepositsCount);
      console.log('- Sent notifications:', auditResults.statistics.sentNotificationsCount);
      console.log('- Missing notifications:', auditResults.statistics.missingNotifications);
      console.log('- Success rate:', auditResults.statistics.successRate + '%');
      
      if (auditResults.results.missing.length > 0) {
        console.log('\nMissing deposits:');
        auditResults.results.missing.slice(0, 5).forEach(missing => {
          console.log(`- SubID: ${missing.subid}, Reason: ${missing.reason}`);
        });
      }
    } catch (auditError) {
      console.log('❌ Audit failed:', auditError.message);
    }
    
  } catch (error) {
    console.error('💥 Critical error:', error.message);
    console.error(error.stack);
  }
}

// Run test
testAuditEndpoint().catch(console.error);