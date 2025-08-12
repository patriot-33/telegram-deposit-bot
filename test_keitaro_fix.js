/**
 * LOCAL TEST for Keitaro API Fix
 * Testing conversions/log endpoint based on creative-keitaro-bot implementation
 */

const axios = require('axios');

// Configuration
const KEITARO_BASE_URL = 'https://keitaro.familyteam.top';
const KEITARO_API_KEY = '5743b46976d8103d1a72270e7d401cde';

// Test SubID from real postback in Render logs 
const TEST_SUBID = '3h6okavdij7m'; // Real deposit from pinco.partners, $110, status: "dep"

class KeitaroTestClient {
  constructor() {
    this.client = axios.create({
      baseURL: KEITARO_BASE_URL + '/admin_api/v1',
      timeout: 15000,
      headers: {
        'Api-Key': KEITARO_API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramDepositBot/1.0'
      }
    });
  }

  /**
   * NEW IMPLEMENTATION: Get click data using conversions/log endpoint
   * Based on creative-keitaro-bot evidence
   */
  async getClickByIdNew(clickId) {
    try {
      console.log(`🔍 Testing NEW implementation for clickId: ${clickId}`);
      
      // Method 1: First get some conversions to understand structure
      console.log('📞 Getting sample conversions to understand structure...');
      const sampleResponse = await this.client.post('/conversions/log', {
        limit: 5,
        columns: ['sub_id_1', 'sub_id_2', 'sub_id_4', 'country', 'status', 'revenue', 'ts_id', 'click_id', 'postback_datetime']
      });

      console.log('✅ Sample conversions response:', {
        status: sampleResponse.status,
        dataKeys: Object.keys(sampleResponse.data || {}),
        total: sampleResponse.data?.total,
        sampleRows: sampleResponse.data?.rows?.slice(0, 2) // Show first 2 rows
      });

      // Method 2: Try to find our specific sub_id (this is the actual SubID)
      console.log('📞 Searching for specific sub_id...');
      const conversionsResponse = await this.client.post('/conversions/log', {
        limit: 100,
        columns: ['sub_id_1', 'sub_id_2', 'sub_id_4', 'country', 'status', 'revenue', 'ts_id', 'click_id', 'postback_datetime', 'sub_id'],
        filters: [
          {
            name: 'sub_id',
            operator: 'EQUALS',
            expression: clickId
          }
        ]
      });

      console.log('✅ Conversions/log response:', {
        status: conversionsResponse.status,
        dataKeys: Object.keys(conversionsResponse.data || {}),
        dataLength: conversionsResponse.data?.rows?.length || conversionsResponse.data?.length || 'N/A'
      });

      // Try different response formats
      let conversions = conversionsResponse.data?.rows || conversionsResponse.data?.data || conversionsResponse.data?.result || conversionsResponse.data || [];
      
      if (Array.isArray(conversions) && conversions.length > 0) {
        const conversion = conversions[0];
        console.log('🎯 Found conversion data:', conversion);
        
        return {
          sub_id_1: conversion.sub_id_1,
          sub_id_2: conversion.sub_id_2,
          sub_id_4: conversion.sub_id_4,
          country: conversion.country,
          traffic_source_id: conversion.ts_id,
          revenue: conversion.revenue,
          status: conversion.status,
          click_id: conversion.click_id,
          postback_datetime: conversion.postback_datetime,
          source: 'conversions/log'
        };
      }

      // Method 2: Try report/build endpoint as fallback
      console.log('📞 Trying report/build endpoint as fallback...');
      const reportResponse = await this.client.post('/report/build', {
        metrics: ['clicks', 'conversions', 'revenue'],
        columns: ['sub_id_1', 'sub_id_2', 'sub_id_4', 'country', 'traffic_source_id'],
        filters: [
          {
            name: 'click_id',
            operator: 'EQUALS',
            expression: clickId
          }
        ],
        limit: 100
      });

      console.log('✅ Report/build response:', {
        status: reportResponse.status,
        dataKeys: Object.keys(reportResponse.data || {}),
        dataLength: reportResponse.data?.rows?.length || reportResponse.data?.length || 'N/A'
      });

      let reportData = reportResponse.data?.rows || reportResponse.data?.data || reportResponse.data?.result || reportResponse.data || [];
      
      if (Array.isArray(reportData) && reportData.length > 0) {
        const report = reportData[0];
        console.log('🎯 Found report data:', report);
        
        return {
          sub_id_1: report.sub_id_1,
          sub_id_2: report.sub_id_2,
          sub_id_4: report.sub_id_4,
          country: report.country,
          traffic_source_id: report.traffic_source_id,
          clicks: report.clicks,
          conversions: report.conversions,
          revenue: report.revenue,
          source: 'report/build'
        };
      }

      console.log('❌ No data found in both endpoints');
      return null;

    } catch (error) {
      console.error('💥 Error in NEW implementation:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url
      });
      return null;
    }
  }

  /**
   * Test available endpoints to understand API structure
   */
  async testEndpoints() {
    console.log('\n🧪 Testing available endpoints...');
    
    const endpoints = [
      '/traffic_sources',
      '/campaigns', 
      '/offers',
      '/conversions/log',
      '/report/build'
    ];

    for (const endpoint of endpoints) {
      try {
        console.log(`\n📞 Testing ${endpoint}...`);
        
        let response;
        if (endpoint === '/conversions/log' || endpoint === '/report/build') {
          // POST endpoints
          response = await this.client.post(endpoint, {
            limit: 1,
            columns: ['sub_id_1']
          });
        } else {
          // GET endpoints
          response = await this.client.get(endpoint, {
            params: { limit: 1 }
          });
        }
        
        console.log(`✅ ${endpoint}: ${response.status}, data keys:`, Object.keys(response.data || {}));
        
      } catch (error) {
        console.log(`❌ ${endpoint}: ${error.response?.status || error.message}`);
      }
    }
  }
}

async function runTests() {
  console.log('🚀 Starting Keitaro API Fix Local Testing');
  console.log('=' .repeat(60));
  
  const client = new KeitaroTestClient();
  
  // Test 1: Check available endpoints
  await client.testEndpoints();
  
  console.log('\n' + '='.repeat(60));
  console.log('🎯 MAIN TEST: Searching for click data');
  console.log('=' .repeat(60));
  
  // Test 2: Try to get click data with new implementation
  const result = await client.getClickByIdNew(TEST_SUBID);
  
  if (result) {
    console.log('\n🎉 SUCCESS! Found click data:', result);
    console.log('\n📊 EVIDENCE:');
    console.log('- API endpoint works:', result.source);
    console.log('- SubID found:', TEST_SUBID);
    console.log('- Traffic source ID:', result.traffic_source_id);
    console.log('- Country:', result.country);
    console.log('- Sub IDs:', { sub_id_1: result.sub_id_1, sub_id_2: result.sub_id_2, sub_id_4: result.sub_id_4 });
  } else {
    console.log('\n❌ FAILED: No click data found for SubID:', TEST_SUBID);
    console.log('\n🔍 Next steps: Try with different SubID or check API documentation');
  }
}

// Run the test
runTests().catch(console.error);