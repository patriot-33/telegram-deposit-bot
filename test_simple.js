/**
 * SIMPLE TEST - Direct API call without dependencies
 */

const axios = require('axios');

const KEITARO_BASE_URL = 'https://keitaro.familyteam.top';
const KEITARO_API_KEY = '5743b46976d8103d1a72270e7d401cde';
const TEST_SUBID = '3h6okavdij7m';

async function testNewImplementation() {
  console.log('🧪 Testing New Keitaro Implementation');
  console.log('=' .repeat(50));
  
  const client = axios.create({
    baseURL: KEITARO_BASE_URL + '/admin_api/v1',
    timeout: 15000,
    headers: {
      'Api-Key': KEITARO_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  try {
    console.log(`🔍 Searching conversion for SubID: ${TEST_SUBID}`);
    
    const response = await client.post('/conversions/log', {
      limit: 100,
      columns: [
        'sub_id_1', 'sub_id_2', 'sub_id_4', 'country', 'status', 'revenue',
        'ts_id', 'click_id', 'postback_datetime', 'sub_id', 'campaign',
        'offer', 'ts', 'affiliate_network'
      ],
      filters: [
        {
          name: 'sub_id',
          operator: 'EQUALS',
          expression: TEST_SUBID
        }
      ]
    });

    const conversions = response.data?.rows || [];

    if (conversions.length > 0) {
      const conversion = conversions[0];
      
      console.log('\n🎉 SUCCESS! Data structure returned:');
      
      const result = {
        sub_id_1: conversion.sub_id_1,
        sub_id_2: conversion.sub_id_2,
        sub_id_4: conversion.sub_id_4,
        country: conversion.country,
        traffic_source_id: conversion.ts_id,
        traffic_source_name: conversion.ts || `Traffic Source ${conversion.ts_id}`,
        revenue: conversion.revenue,
        status: conversion.status,
        click_id: conversion.click_id,
        postback_datetime: conversion.postback_datetime,
        campaign_name: conversion.campaign || 'Unknown Campaign',
        offer_name: conversion.offer || 'Unknown Offer'
      };
      
      console.log(JSON.stringify(result, null, 2));
      
      console.log('\n✅ VERIFICATION CHECKS:');
      console.log('- Buyer ID (sub_id_1):', result.sub_id_1 ? '✅' : '❌');
      console.log('- Country:', result.country ? '✅' : '❌'); 
      console.log('- Traffic Source ID:', result.traffic_source_id ? '✅' : '❌');
      console.log('- Revenue:', result.revenue ? '✅' : '❌');
      console.log('- Compatible structure:', '✅');
      
      // Check if FB source (should be 3-17, not 2)
      const isFBSource = result.traffic_source_id >= 3 && result.traffic_source_id <= 17;
      console.log('- Is FB source:', isFBSource ? '✅' : `❌ (${result.traffic_source_id} = Google)`);
      
    } else {
      console.log('\n❌ No conversion found');
    }
    
  } catch (error) {
    console.error('\n💥 ERROR:', error.message);
    console.error('Status:', error.response?.status);
  }
}

testNewImplementation().catch(console.error);