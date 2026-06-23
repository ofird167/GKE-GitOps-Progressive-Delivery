const assert = require('assert');
const { formatAge } = require('./server');

try {
  console.log('Running formatAge tests...');
  assert.strictEqual(formatAge(1000), '1s');
  assert.strictEqual(formatAge(60000), '1m');
  assert.strictEqual(formatAge(3600000), '1h0m');
  assert.strictEqual(formatAge(3660000), '1h1m');
  console.log('All tests passed successfully!');
  process.exit(0);
} catch (err) {
  console.error('Test suite failed:', err.message);
  process.exit(1);
}
