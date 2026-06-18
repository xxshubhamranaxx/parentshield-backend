const { Pool } = require('pg');
const { logger } = require('./logger');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'parentshield',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: false,
});

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error:', err);
});

async function connectDB() {
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
  logger.info('✅ PostgreSQL connected');
}

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    logger.error(`Query error: ${text}`, err);
    throw err;
  }
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction, connectDB };
