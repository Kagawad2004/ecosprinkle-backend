/**
 * 🧪 VERIFICATION SCRIPT: Device ID Normalization in routes/devices.js
 * 
 * This script verifies that all device ID normalization calls have been
 * properly updated in the routes/devices.js file.
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying Device ID Normalization Implementation\n');
console.log('=' .repeat(60));

// Read the routes/devices.js file
const routesFilePath = path.join(__dirname, 'routes', 'devices.js');
const routesContent = fs.readFileSync(routesFilePath, 'utf8');

// Check 1: Verify normalizeDeviceId function exists
console.log('\n✅ Check 1: Verify normalizeDeviceId() function exists');
const hasFunctionDefinition = routesContent.includes('function normalizeDeviceId(deviceId)');
console.log(hasFunctionDefinition ? '   ✅ PASS: Function defined' : '   ❌ FAIL: Function not found');

// Check 2: Verify NO remaining toLowerCase() calls for device IDs
console.log('\n✅ Check 2: Verify NO remaining toLowerCase() device ID calls');
const hasLowercaseCalls = /normalizedDeviceId\s*=\s*.*\.toLowerCase\(\)/g.test(routesContent);
console.log(!hasLowercaseCalls ? '   ✅ PASS: No toLowerCase() found' : '   ❌ FAIL: Still using toLowerCase()');

// Check 3: Count normalizeDeviceId() usages
console.log('\n✅ Check 3: Count normalizeDeviceId() usages');
const normalizeRegex = /normalizeDeviceId\(/g;
const matches = routesContent.match(normalizeRegex);
const usageCount = matches ? matches.length - 1 : 0; // -1 for function definition itself
console.log(`   Found ${usageCount} usages (expected: 8)`);
console.log(usageCount === 8 ? '   ✅ PASS: Correct number of usages' : `   ⚠️  WARNING: Expected 8, found ${usageCount}`);

// Check 4: Verify specific endpoint updates
console.log('\n✅ Check 4: Verify specific critical endpoints updated');

const endpointChecks = [
  {
    name: 'POST /provision-started',
    pattern: /POST \/provision-started.*\n.*\n.*normalizeDeviceId\(deviceId\)/s,
    line: 48
  },
  {
    name: 'POST /:deviceId/reset-wifi',
    pattern: /POST \/:deviceId\/reset-wifi.*\n.*\n.*normalizeDeviceId\(deviceId\)/s,
    line: 82
  },
  {
    name: 'POST /register',
    pattern: /POST \/register.*\n[\s\S]{0,500}normalizeDeviceId\(deviceId\)/,
    line: 120
  },
  {
    name: 'POST /:deviceId/pump/:action',
    pattern: /POST \/:deviceId\/pump\/:action.*\n[\s\S]{0,500}normalizeDeviceId\(req\.params\.deviceId\)/,
    line: 934
  }
];

let allEndpointsCorrect = true;
endpointChecks.forEach(check => {
  const found = check.pattern.test(routesContent);
  console.log(`   ${found ? '✅' : '❌'} ${check.name} (line ~${check.line})`);
  if (!found) allEndpointsCorrect = false;
});

// Check 5: Verify prefix stripping logic
console.log('\n✅ Check 5: Verify prefix stripping logic in function');
const hasEsp32PrefixRemoval = routesContent.includes(".replace(/^esp32-/, '')");
const hasEcosprinklePrefixRemoval = routesContent.includes(".replace(/^ecosprinkle-/, '')");
const hasLengthCheck = routesContent.includes('if (normalized.length > 6)');

console.log(hasEsp32PrefixRemoval ? '   ✅ PASS: esp32- prefix removal found' : '   ❌ FAIL: Missing esp32- prefix removal');
console.log(hasEcosprinklePrefixRemoval ? '   ✅ PASS: ecosprinkle- prefix removal found' : '   ❌ FAIL: Missing ecosprinkle- prefix removal');
console.log(hasLengthCheck ? '   ✅ PASS: Length check (>6 chars) found' : '   ❌ FAIL: Missing length check');

// Final Summary
console.log('\n' + '='.repeat(60));
console.log('📊 VERIFICATION SUMMARY\n');

const allChecksPassed = 
  hasFunctionDefinition &&
  !hasLowercaseCalls &&
  usageCount === 8 &&
  allEndpointsCorrect &&
  hasEsp32PrefixRemoval &&
  hasEcosprinklePrefixRemoval &&
  hasLengthCheck;

if (allChecksPassed) {
  console.log('🎉 ALL CHECKS PASSED!');
  console.log('✅ Device ID normalization is correctly implemented');
  console.log('✅ Ready for backend restart and deployment');
  console.log('\nNext Steps:');
  console.log('1. Restart backend: cd backend && npm start');
  console.log('2. Re-provision device via Flutter app');
  console.log('3. Verify pump control works with both ID formats\n');
  process.exit(0);
} else {
  console.log('❌ SOME CHECKS FAILED');
  console.log('⚠️  Please review the failed checks above');
  console.log('⚠️  Fix any issues before deploying\n');
  process.exit(1);
}
