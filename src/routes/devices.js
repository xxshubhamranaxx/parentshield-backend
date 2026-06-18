const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { requireAuth, requireDeviceOwnership } = require('../middleware/auth');
const { sendPushNotification } = require('../config/firebase');
const crypto = require('crypto');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT cd.id, cd.device_name, cd.child_name, cd.child_age,
         cd.device_model, cd.is_paired, cd.consent_given, cd.last_seen_at, cd.created_at,
         ds.battery_level, ds.is_charging, ds.network_type,
         ds.screen_on, ds.current_app, ds.screen_time_today_seconds
       FROM child_devices cd
       LEFT JOIN device_status ds ON ds.device_id = cd.id
       WHERE cd.parent_id = $1 AND cd.is_active = TRUE
       ORDER BY cd.created_at DESC`,
      [req.parent.id]
    );
    res.json({ devices: result.rows });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, [
  body('device_name').trim().isLength({ min: 1, max: 100 }),
  body('child_name').trim().isLength({ min: 1, max: 100 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { device_name, child_name, child_age } = req.body;
    const pairingCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const pairingExpires = new Date(Date.now() + 30 * 60 * 1000);

    const result = await query(
      `INSERT INTO child_devices (parent_id, device_name, child_name, child_age, pairing_code, pairing_expires_at, device_uid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, device_name, child_name, pairing_code, pairing_expires_at`,
      [req.parent.id, device_name, child_name, child_age || null, pairingCode, pairingExpires, `pending_${uuidv4()}`]
    );

    res.status(201).json({ message: 'Device created', device: result.rows[0] });
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT cd.*, ds.battery_level, ds.is_charging, ds.network_type,
         ds.wifi_ssid, ds.screen_on, ds.current_app, ds.screen_time_today_seconds
       FROM child_devices cd
       LEFT JOIN device_status ds ON ds.device_id = cd.id
       WHERE cd.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
    res.json({ device: result.rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    await query('UPDATE child_devices SET is_active = FALSE WHERE id = $1', [req.params.id]);
    res.json({ message: 'Device removed' });
  } catch (err) { next(err); }
});

router.post('/:deviceId/lock', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const device = await query('SELECT fcm_token, child_name FROM child_devices WHERE id = $1', [req.params.deviceId]);
    await query(
      'INSERT INTO activity_logs (device_id, parent_id, event_type, event_source) VALUES ($1, $2, $3, $4)',
      [req.params.deviceId, req.parent.id, 'screen_lock', 'dashboard']
    );
    res.json({ message: 'Lock command sent' });
  } catch (err) { next(err); }
});

router.post('/:deviceId/unlock', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    await query(
      'INSERT INTO activity_logs (device_id, parent_id, event_type, event_source) VALUES ($1, $2, $3, $4)',
      [req.params.deviceId, req.parent.id, 'screen_unlock', 'dashboard']
    );
    res.json({ message: 'Unlock command sent' });
  } catch (err) { next(err); }
});

router.post('/pair', async (req, res, next) => {
  try {
    const { pairing_code, device_uid, device_model, android_version, app_version } = req.body;
    if (!pairing_code || !device_uid) return res.status(400).json({ error: 'pairing_code and device_uid required' });

    const result = await query(
      'SELECT id, pairing_expires_at, is_paired FROM child_devices WHERE pairing_code = $1 AND is_active = TRUE',
      [pairing_code.toUpperCase()]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Invalid pairing code' });
    const device = result.rows[0];
    if (device.is_paired) return res.status(409).json({ error: 'Already paired' });
    if (new Date() > new Date(device.pairing_expires_at)) return res.status(410).json({ error: 'Pairing code expired' });

    await query(
      'UPDATE child_devices SET device_uid=$1, device_model=$2, android_version=$3, app_version=$4, is_paired=TRUE, pairing_code=NULL WHERE id=$5',
      [device_uid, device_model, android_version, app_version, device.id]
    );

    res.json({ message: 'Device paired', device_id: device.id });
  } catch (err) { next(err); }
});

module.exports = router;
