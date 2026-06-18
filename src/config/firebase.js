const { logger } = require('./logger');

function initFirebase() {
  logger.warn('⚠️  Firebase not configured — push notifications disabled');
}

async function sendPushNotification(fcmToken, title, body, data = {}) {
  logger.info(`[PUSH MOCK] To: ${fcmToken} | ${title}: ${body}`);
  return null;
}

module.exports = { initFirebase, sendPushNotification };
