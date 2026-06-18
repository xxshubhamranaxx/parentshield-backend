const { query } = require('../config/db');
const { getCache, setCache } = require('../config/redis');

async function requireDeviceAuth(req, res, next) {
  try {
    const deviceUid = req.headers['x-device-uid'];
    if (!deviceUid) {
      return res.status(401).json({ error: 'Device authentication required' });
    }

    const cacheKey = `device:${deviceUid}`;
    let device = await getCache(cacheKey);

    if (!device) {
      const result = await query(
        'SELECT id, parent_id, device_uid, is_paired, is_active, consent_given FROM child_devices WHERE device_uid = $1 AND is_active = TRUE',
        [deviceUid]
      );
      if (!result.rows.length) {
        return res.status(401).json({ error: 'Unknown device' });
      }
      device = result.rows[0];
      await setCache(cacheKey, device, 60);
    }

    if (!device.is_paired) {
      return res.status(403).json({ error: 'Device not paired' });
    }

    await query(
      'UPDATE child_devices SET last_seen_at = NOW() WHERE id = $1',
      [device.id]
    );

    req.device = device;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireDeviceAuth };
