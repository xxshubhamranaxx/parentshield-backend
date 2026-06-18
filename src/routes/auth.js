const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { delCache } = require('../config/redis');
const { logger } = require('../config/logger');

const router = express.Router();

function generateTokens(parentId) {
  const jti = uuidv4();
  const accessToken = jwt.sign(
    { sub: parentId, jti, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const refreshToken = jwt.sign(
    { sub: parentId, jti, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' }
  );
  return { accessToken, refreshToken, jti };
}

router.post('/register', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('full_name').trim().isLength({ min: 2 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, full_name, phone } = req.body;
    const existing = await query('SELECT id FROM parents WHERE email = $1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO parents (email, password_hash, full_name, phone) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name',
      [email, passwordHash, full_name, phone || null]
    );

    res.status(201).json({ message: 'Account created', parent: result.rows[0] });
  } catch (err) { next(err); }
});

router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const result = await query(
      'SELECT id, email, password_hash, full_name, is_active FROM parents WHERE email = $1',
      [email]
    );

    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const parent = result.rows[0];
    if (!parent.is_active) return res.status(403).json({ error: 'Account disabled' });

    const match = await bcrypt.compare(password, parent.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const { accessToken, refreshToken, jti } = generateTokens(parent.id);
    const tokenHash = crypto.createHash('sha256').update(jti).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      'INSERT INTO parent_sessions (parent_id, token_hash, ip_address, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [parent.id, tokenHash, req.ip, req.get('user-agent'), expiresAt]
    );
    await query('UPDATE parents SET last_login_at = NOW() WHERE id = $1', [parent.id]);

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 900,
      parent: { id: parent.id, email: parent.email, full_name: parent.full_name },
    });
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await query('UPDATE parent_sessions SET revoked = TRUE WHERE token_hash = $1', [req.tokenHash]);
    await delCache(`session:${req.tokenHash}`);
    res.json({ message: 'Logged out' });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, phone, telegram_chat_id, created_at FROM parents WHERE id = $1',
      [req.parent.id]
    );
    res.json({ parent: result.rows[0] });
  } catch (err) { next(err); }
});

router.post('/link-telegram', requireAuth, async (req, res, next) => {
  try {
    const { telegram_chat_id } = req.body;
    await query(
      'UPDATE parents SET telegram_chat_id = $1, telegram_verified = TRUE WHERE id = $2',
      [telegram_chat_id, req.parent.id]
    );
    res.json({ message: 'Telegram linked' });
  } catch (err) { next(err); }
});

module.exports = router;
