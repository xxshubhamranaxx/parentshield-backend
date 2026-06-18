const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { getCache, setCache } = require('../config/redis');
const crypto = require('crypto');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const tokenHash = crypto.createHash('sha256').update(decoded.jti).digest('hex');
    const cacheKey = `session:${tokenHash}`;
    let sessionData = await getCache(cacheKey);

    if (!sessionData) {
      const result = await query(
        'SELECT id, revoked FROM parent_sessions WHERE token_hash = $1',
        [tokenHash]
      );
      if (!result.rows.length || result.rows[0].revoked) {
        return res.status(401).json({ error: 'Session revoked' });
      }
      sessionData = result.rows[0];
      await setCache(cacheKey, sessionData, 300);
    }

    if (sessionData.revoked) {
      return res.status(401).json({ error: 'Session revoked' });
    }

    const parentCacheKey = `parent:${decoded.sub}`;
    let parent = await getCache(parentCacheKey);

    if (!parent) {
      const result = await query(
        'SELECT id, email, full_name, is_active FROM parents WHERE id = $1',
        [decoded.sub]
      );
      if (!result.rows.length || !result.rows[0].is_active) {
        return res.status(401).json({ error: 'Account not found' });
      }
      parent = result.rows[0];
      await setCache(parentCacheKey, parent, 300);
    }

    req.parent = parent;
    req.tokenHash = tokenHash;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    next(err);
  }
}

async function requireDeviceOwnership(req, res, next) {
  try {
    const deviceId = req.params.deviceId || req.params.id;
    if (!deviceId) return next();
    const result = await query(
      'SELECT id FROM child_devices WHERE id = $1 AND parent_id = $2 AND is_active = TRUE',
      [deviceId, req.parent.id]
    );
    if (!result.rows.length) {
      return res.status(403).json({ error: 'Device not found or access denied' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireDeviceOwnership };
