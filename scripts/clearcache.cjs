const path = require('path');
const { redis } = require(path.join(__dirname, '..', 'config', 'db'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
async function clear() {
  await redis.connect();
  await redis.flushall();
  console.log('Cleared all Redis cache');
  await redis.disconnect();
}
clear().catch(e => { console.error(e); process.exit(1); });
