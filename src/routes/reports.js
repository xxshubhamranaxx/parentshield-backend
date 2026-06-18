const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireDeviceOwnership } = require('../middleware/auth');

const router = express.Router();

router.get('/:deviceId/usage', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const usageDate = req.query.date || new Date().toISOString().split('T')[0];
    const result = await query(
      'SELECT package_name, app_name, foreground_time_seconds, launch_count, last_used_at FROM app_usage_logs WHERE device_id=$1 AND usage_date=$2 ORDER BY foreground_time_seconds DESC',
      [req.params.deviceId, usageDate]
    );
    res.json({ usage_date: usageDate, apps: result.rows });
  } catch (err) { next(err); }
});

router.get('/:deviceId/usage/weekly', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT usage_date, SUM(foreground_time_seconds) as total_screen_seconds, COUNT(DISTINCT package_name) as unique_apps
       FROM app_usage_logs WHERE device_id=$1 AND usage_date >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY usage_date ORDER BY usage_date DESC`,
      [req.params.deviceId]
    );
    res.json({ weekly_usage: result.rows });
  } catch (err) { next(err); }
});

router.get('/:deviceId/activity', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await query(
      'SELECT event_type, event_source, metadata, created_at FROM activity_logs WHERE device_id=$1 ORDER BY created_at DESC LIMIT $2',
      [req.params.deviceId, limit]
    );
    res.json({ logs: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
