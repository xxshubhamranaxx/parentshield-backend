const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { requireAuth, requireDeviceOwnership } = require('../middleware/auth');

const router = express.Router();

router.get('/:deviceId/screen-time', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM screen_time_rules WHERE device_id = $1 ORDER BY created_at DESC', [req.params.deviceId]);
    res.json({ rules: result.rows });
  } catch (err) { next(err); }
});

router.post('/:deviceId/screen-time', requireAuth, requireDeviceOwnership, [
  body('rule_name').trim().notEmpty(),
  body('allowed_start').matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
  body('allowed_end').matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { rule_name, day_of_week, allowed_start, allowed_end, daily_limit_minutes } = req.body;
    const result = await query(
      'INSERT INTO screen_time_rules (device_id, rule_name, day_of_week, allowed_start, allowed_end, daily_limit_minutes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.deviceId, rule_name, day_of_week, allowed_start, allowed_end, daily_limit_minutes || null]
    );
    res.status(201).json({ rule: result.rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:deviceId/screen-time/:ruleId', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    await query('DELETE FROM screen_time_rules WHERE id = $1 AND device_id = $2', [req.params.ruleId, req.params.deviceId]);
    res.json({ message: 'Rule deleted' });
  } catch (err) { next(err); }
});

router.get('/:deviceId/apps', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM app_rules WHERE device_id = $1 ORDER BY app_name ASC', [req.params.deviceId]);
    res.json({ rules: result.rows });
  } catch (err) { next(err); }
});

router.post('/:deviceId/apps', requireAuth, requireDeviceOwnership, [
  body('package_name').notEmpty().trim(),
  body('rule_type').isIn(['block', 'allow', 'time_limit']),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { package_name, app_name, rule_type, daily_limit_minutes } = req.body;
    const result = await query(
      `INSERT INTO app_rules (device_id, package_name, app_name, rule_type, daily_limit_minutes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (device_id, package_name) DO UPDATE SET rule_type=$4, daily_limit_minutes=$5, updated_at=NOW()
       RETURNING *`,
      [req.params.deviceId, package_name, app_name, rule_type, daily_limit_minutes || null]
    );
    await query(
      'INSERT INTO activity_logs (device_id, parent_id, event_type, event_source, metadata) VALUES ($1,$2,$3,$4,$5)',
      [req.params.deviceId, req.parent.id, 'app_rule_set', 'dashboard', JSON.stringify({ package_name, rule_type })]
    );
    res.status(201).json({ rule: result.rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:deviceId/apps/:ruleId', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    await query('DELETE FROM app_rules WHERE id = $1 AND device_id = $2', [req.params.ruleId, req.params.deviceId]);
    res.json({ message: 'App rule removed' });
  } catch (err) { next(err); }
});

router.get('/:deviceId/websites', requireAuth, requireDeviceOwnership, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM website_rules WHERE device_id = $1 ORDER BY domain ASC', [req.params.deviceId]);
    res.json({ rules: result.rows });
  } catch (err) { next(err); }
});

router.post('/:deviceId/websites', requireAuth, requireDeviceOwnership, [
  body('domain').trim().notEmpty(),
  body('rule_type').isIn(['block', 'allow']),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { domain, rule_type, category } = req.body;
    const normalized = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    const result = await query(
      `INSERT INTO website_rules (device_id, domain, rule_type, category) VALUES ($1,$2,$3,$4)
       ON CONFLICT (device_id, domain) DO UPDATE SET rule_type=$3, category=$4
       RETURNING *`,
      [req.params.deviceId, normalized, rule_type, category || null]
    );
    res.status(201).json({ rule: result.rows[0] });
  } catch (err) { next(err); }
});

router.get('/:deviceId/all', async (req, res, next) => {
  try {
    const [st, ar, wr] = await Promise.all([
      query('SELECT * FROM screen_time_rules WHERE device_id=$1 AND is_active=TRUE', [req.params.deviceId]),
      query('SELECT * FROM app_rules WHERE device_id=$1 AND is_active=TRUE', [req.params.deviceId]),
      query('SELECT * FROM website_rules WHERE device_id=$1 AND is_active=TRUE', [req.params.deviceId]),
    ]);
    res.json({ screen_time_rules: st.rows, app_rules: ar.rows, website_rules: wr.rows, synced_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

module.exports = router;
