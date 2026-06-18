const express = require('express');
const { query } = require('../config/db');
const { requireDeviceAuth } = require('../middleware/deviceAuth');
const { syncLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/status', syncLimiter, requireDeviceAuth, async (req, res, next) => {
  try {
    const { battery_level, is_charging, network_type, wifi_ssid, screen_on, current_app, screen_time_today_seconds, fcm_token } = req.body;
    await query(
      `INSERT INTO device_status (device_id, battery_level, is_charging, network_type, wifi_ssid, screen_on, current_app, screen_time_today_seconds, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (device_id) DO UPDATE SET battery_level=$2, is_charging=$3, network_type=$4, wifi_ssid=$5, screen_on=$6, current_app=$7, screen_time_today_seconds=$8, updated_at=NOW()`,
      [req.device.id, battery_level, is_charging, network_type, wifi_ssid, screen_on, current_app, screen_time_today_seconds || 0]
    );
    if (fcm_token) await query('UPDATE child_devices SET fcm_token=$1 WHERE id=$2', [fcm_token, req.device.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/usage', syncLimiter, requireDeviceAuth, async (req, res, next) => {
  try {
    const { usage_date, apps } = req.body;
    if (!Array.isArray(apps) || !usage_date) return res.status(400).json({ error: 'usage_date and apps required' });
    for (const app of apps) {
      await query(
        `INSERT INTO app_usage_logs (device_id, package_name, app_name, usage_date, foreground_time_seconds, launch_count, last_used_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (device_id, package_name, usage_date) DO UPDATE SET foreground_time_seconds=$5, launch_count=$6, last_used_at=NOW(), updated_at=NOW()`,
        [req.device.id, app.package_name, app.app_name, usage_date, app.foreground_time_seconds || 0, app.launch_count || 0]
      );
    }
    res.json({ ok: true, synced: apps.length });
  } catch (err) { next(err); }
});

router.post('/location', syncLimiter, requireDeviceAuth, async (req, res, next) => {
  try {
    const { latitude, longitude, accuracy_meters, recorded_at } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ error: 'latitude and longitude required' });
    await query(
      'INSERT INTO location_logs (device_id, latitude, longitude, accuracy_meters, recorded_at) VALUES ($1,$2,$3,$4,$5)',
      [req.device.id, latitude, longitude, accuracy_meters || null, recorded_at ? new Date(recorded_at) : new Date()]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/consent', requireDeviceAuth, async (req, res, next) => {
  try {
    const { consent_given_by } = req.body;
    await query(
      'UPDATE child_devices SET consent_given=TRUE, consent_given_at=NOW(), consent_given_by=$1 WHERE id=$2',
      [consent_given_by || 'device_user', req.device.id]
    );
    await query(
      'INSERT INTO activity_logs (device_id, event_type, event_source) VALUES ($1,$2,$3)',
      [req.device.id, 'consent_given', 'app']
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
