/**
 * Test script for Fallback Mechanism
 * Tests all scenarios: success, retry success, fallback success, duplicate prevention
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

// Test cases covering all scenarios
const testCases = [
  {
    name: 'Known FB Source - should trigger fallback',
    params: {
      from: 'bettitltr',
      status: 'dep',
      subid: 'test_fallback_001',
      payout: 60,
      currency: 'usd'
    },
    expectedResult: 'fallback_success'
  },
  {
    name: 'Unknown source - should be ignored in fallback',
    params: {
      from: 'unknown_source',
      status: 'dep', 
      subid: 'test_fallback_002',
      payout: 50,
      currency: 'usd'
    },
    expectedResult: 'fallback_ignored'
  },
  {
    name: 'Duplicate SubID - should prevent duplicate processing',
    params: {
      from: 'bettitltr',
      status: 'dep',
      subid: 'test_fallback_001', // Same as first test
      payout: 60,
      currency: 'usd'
    },
    expectedResult: 'duplicate_prevention'
  },
  {
    name: 'PWA Partners source - should trigger fallback',
    params: {
      from: 'pwa.partners',
      status: 'dep',
      subid: 'test_fallback_003',
      payout: 75,
      currency: 'usd'
    },
    expectedResult: 'fallback_success'
  },
  {
    name: 'Invalid status - should be ignored',
    params: {
      from: 'bettitltr',
      status: 'reg', // Registration, not deposit
      subid: 'test_fallback_004',
      payout: 60,
      currency: 'usd'
    },
    expectedResult: 'status_ignored'
  }
];

async function runTest(testCase) {
  console.log(`\n🧪 Testing: ${testCase.name}`);
  console.log(`   Params: ${JSON.stringify(testCase.params)}`);
  
  try {
    const response = await axios.get(`${BASE_URL}/postback`, {
      params: testCase.params,
      timeout: 120000 // 2 minute timeout for retry mechanism
    });
    
    console.log(`   ✅ Status: ${response.status}`);
    console.log(`   📝 Response: ${JSON.stringify(response.data, null, 2)}`);
    
    // Analyze response to determine result type
    let actualResult = 'unknown';
    if (response.data.message?.includes('Fallback')) {
      actualResult = 'fallback_success';
    } else if (response.data.message?.includes('duplicate') || response.data.message?.includes('already processed')) {
      actualResult = 'duplicate_prevention';
    } else if (response.data.message?.includes('ignored') && response.data.reason?.includes('status')) {
      actualResult = 'status_ignored';
    } else if (response.data.message?.includes('ignored')) {
      actualResult = 'fallback_ignored';
    } else if (response.data.message?.includes('successfully')) {
      actualResult = 'regular_success';
    }
    
    console.log(`   🎯 Expected: ${testCase.expectedResult}, Got: ${actualResult}`);
    
    if (actualResult === testCase.expectedResult) {
      console.log(`   ✅ TEST PASSED`);
      return true;
    } else {
      console.log(`   ❌ TEST FAILED`);
      return false;
    }
    
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    if (error.response) {
      console.log(`   📝 Error Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting Fallback Mechanism Tests');
  console.log('=====================================');
  
  let passed = 0;
  let total = testCases.length;
  
  // Check if server is running
  try {
    await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    console.log('✅ Server is running');
  } catch (error) {
    console.log('❌ Server is not running! Start the bot first.');
    process.exit(1);
  }
  
  // Run all tests
  for (const testCase of testCases) {
    const success = await runTest(testCase);
    if (success) passed++;
    
    // Wait between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n📊 TEST RESULTS');
  console.log('================');
  console.log(`✅ Passed: ${passed}/${total}`);
  console.log(`❌ Failed: ${total - passed}/${total}`);
  console.log(`📈 Success Rate: ${Math.round(passed/total * 100)}%`);
  
  if (passed === total) {
    console.log('\n🎉 ALL TESTS PASSED! Fallback mechanism is working correctly.');
  } else {
    console.log('\n⚠️ Some tests failed. Check the logs above for details.');
  }
}

// Additional utility functions
async function testCacheCleanup() {
  console.log('\n🧹 Testing Cache Cleanup (requires waiting)');
  console.log('This test would require waiting for cache TTL...');
  // This would need longer testing periods
}

async function testRetryMechanism() {
  console.log('\n🔄 Testing Retry Mechanism');
  console.log('This test requires mocking Keitaro API failures...');
  // This would need API mocking
}

if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  runAllTests,
  runTest,
  testCases
};