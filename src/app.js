require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { logger } = require('./config/logger');
const { connectDB } = require('./config/db');
const { connectRedis } = require('./config/redis');
const { initFirebase } = require('./config/firebase');

const authRoutes     = require('./routes/auth');
const deviceRoutes   = require('./routes/devices');
const rulesRoutes    = require('./routes/rules');
const reportsRoutes  = require('./routes/reports');
const locationRoutes = require('./routes/location');
const syncRoutes     = require('./routes/deviceSync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  methods: ['GET','POST','PUT','DELETE','PATCH'],
  allowedHeaders: ['Content-Type','Authorization','X-Device-Token','X-Device-UID'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ParentShield API', version: '1.0.0' });
});

app.use('/api/auth',     authRoutes);
app.use('/api/devices',  deviceRoutes);
app.use('/api/rules',    rulesRoutes);
app.use('/api/reports',  reportsRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/sync',     syncRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  try {
    await connectDB();
    await connectRedis();
    initFirebase();
    app.listen(PORT, () => logger.info(`✅ ParentShield API running on port ${PORT}`));
  } catch (err) {
    logger.error('❌ Startup failed:', err);
    process.exit(1);
  }
}

start();
module.exports = app;
