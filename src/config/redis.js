const { createClient } = require('redis');
const { logger } = require('./logger');

let client;

async function connectRedis() {
  client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });
  client.on('error', (err) => logger.error('Redis error:', err));
  await client.connect();
  logger.info('✅ Redis connected');
}

async function setCache(key, value, ttlSeconds = 300) {
  await client.setEx(key, ttlSeconds, JSON.stringify(value));
}

async function getCache(key) {
  const val = await client.get(key);
  return val ? JSON.parse(val) : null;
}

async function delCache(key) {
  await client.del(key);
}

async function delCachePattern(pattern) {
  const keys = await client.keys(pattern);
  if (keys.length > 0) await client.del(keys);
}

module.exports = { connectRedis, setCache, getCache, delCache, delCachePattern };
