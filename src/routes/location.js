const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireDeviceOwnership } = require('../middleware/auth');

const router = express.Router();

router.get('/:deviceId/latest', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT latitude, longitude, accuracy_meters, address, recorded_at FROM location_logs WHERE device_id=$1 ORDER BY recorded_at DESC LIMIT 1',
      [req.params.deviceId]
    );
    res.json({ location: result.rows[0] || null });
  } catch (err) { next(err); }
});

router.get('/:deviceId/history', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const result = await query(
      `SELECT latitude, longitude, accuracy_meters, address, recorded_at FROM location_logs
       WHERE device_id=$1 AND recorded_at >= NOW() - INTERVAL '${hours} hours'
       ORDER BY recorded_at DESC LIMIT 200`,
      [req.params.deviceId]
    );
    res.json({ history: result.rows });
  } catch (err) { next(err); }
});

router.post('/:deviceId/request', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    await query(
      'INSERT INTO activity_logs (device_id, parent_id, event_type, event_source) VALUES ($1,$2,$3,$4)',
      [req.params.deviceId, req.parent.id, 'location_requested', 'dashboard']
    );
    res.json({ message: 'Location request sent' });
  } catch (err) { next(err); }
});

module.exports = router;
