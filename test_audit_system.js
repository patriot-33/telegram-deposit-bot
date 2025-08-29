/**
 * Test script for Deposit Audit System
 * Tests audit endpoints and shows example usage
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testAuditSystem() {
  console.log('🧪 Testing Deposit Audit System');
  console.log('=====================================');
  
  // Check if server is running
  try {
    await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    console.log('✅ Server is running');
  } catch (error) {
    console.log('❌ Server is not running! Start the bot first.');
    process.exit(1);
  }
  
  // Test 1: Audit deposits for today
  console.log('\n1️⃣ Testing audit for today\'s deposits...');
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    const response = await axios.post(`${BASE_URL}/admin/audit-deposits`, {
      dateFrom: today,
      dateTo: today
    }, {
      timeout: 60000 // 1 minute timeout
    });
    
    console.log('✅ Audit completed successfully');
    console.log('📊 Statistics:', JSON.stringify(response.data.statistics, null, 2));
    
    if (response.data.results.missing.length > 0) {
      console.log('⚠️ Missing deposits found:', response.data.results.missing.length);
      response.data.results.missing.forEach((missing, index) => {
        console.log(`   ${index + 1}. SubID: ${missing.subid} - Reason: ${missing.reason}`);
      });
    } else {
      console.log('✅ No missing deposits - system working perfectly!');
    }
    
    if (response.data.recommendations.length > 0) {
      console.log('💡 Recommendations:');
      response.data.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec.message}`);
        if (rec.action) console.log(`      Action: ${rec.action}`);
      });
    }
    
  } catch (error) {
    console.log('❌ Audit failed:', error.message);
    if (error.response?.data) {
      console.log('Error details:', JSON.stringify(error.response.data, null, 2));
    }
  }
  
  // Test 2: Audit specific deposits that we know were missed
  console.log('\n2️⃣ Testing audit for specific missed deposits...');
  const missedDeposits = ['1n88iildmflp', '1pib8qhdmglc', '234iuopdmges'];
  
  for (const subid of missedDeposits) {
    try {
      const response = await axios.get(`${BASE_URL}/admin/audit-deposit/${subid}`, {
        timeout: 30000
      });
      
      console.log(`✅ SubID ${subid}:`, response.data.result.status);
      if (response.data.result.deposit) {
        console.log(`   - Revenue: ${response.data.result.deposit.revenue}`);
        console.log(`   - Traffic Source: ${response.data.result.deposit.traffic_source_name}`);
        console.log(`   - Is FB Source: ${response.data.result.isFBSource}`);
      }
      
    } catch (error) {
      console.log(`❌ Failed to audit SubID ${subid}:`, error.message);
    }
  }
  
  // Test 3: Audit for yesterday (to show larger dataset)
  console.log('\n3️⃣ Testing audit for yesterday\'s deposits...');
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const response = await axios.post(`${BASE_URL}/admin/audit-deposits`, {
      dateFrom: yesterdayStr,
      dateTo: yesterdayStr
    }, {
      timeout: 60000
    });
    
    console.log(`✅ Yesterday (${yesterdayStr}) audit completed`);
    console.log('📊 Statistics:', JSON.stringify(response.data.statistics, null, 2));
    
  } catch (error) {
    console.log('❌ Yesterday audit failed:', error.message);
  }
  
  console.log('\n🎉 Audit system testing completed!');
  console.log('\n📋 How to use the audit system:');
  console.log('   1. POST /admin/audit-deposits with dateFrom and dateTo');
  console.log('   2. GET /admin/audit-deposit/:subid for specific SubID');
  console.log('   3. Check response for missing deposits and recommendations');
  console.log('\n📝 Example curl commands:');
  console.log(`curl -X POST ${BASE_URL}/admin/audit-deposits \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"dateFrom": "2025-08-29", "dateTo": "2025-08-29"}'`);
  console.log('');
  console.log(`curl ${BASE_URL}/admin/audit-deposit/1n88iildmflp`);
}

if (require.main === module) {
  testAuditSystem().catch(console.error);
}

module.exports = { testAuditSystem };