'use strict';

const admin = require('firebase-admin');
const sequelize = require('../config/database');

/**
 * Sends push notifications to a list of students via their push tokens.
 * @param {Array<number>} studentIds 
 * @param {Object} payload { title, body, data }
 */
async function sendPushToStudents(studentIds, { title, body, data = {} }) {
  if (!studentIds || studentIds.length === 0) return;

  try {
    // 1. Query push_tokens WHERE student_id IN (studentIds)
    const [tokens] = await sequelize.query(`
      SELECT id, token, platform FROM push_tokens
      WHERE student_id IN (:studentIds)
    `, {
      replacements: { studentIds },
    });

    if (tokens.length === 0) return;

    await dispatchPush(tokens, { title, body, data });
  } catch (error) {
    console.error('[pushNotifier] Error in sendPushToStudents:', error.message);
  }
}

/**
 * Sends push notifications to a list of users via their push tokens.
 * @param {Array<number>} userIds 
 * @param {Object} payload { title, body, data }
 */
async function sendPushToUsers(userIds, { title, body, data = {} }) {
  if (!userIds || userIds.length === 0) return;

  try {
    // 1. Query push_tokens WHERE user_id IN (userIds)
    const [tokens] = await sequelize.query(`
      SELECT id, token, platform FROM push_tokens
      WHERE user_id IN (:userIds)
    `, {
      replacements: { userIds },
    });

    if (tokens.length === 0) return;

    await dispatchPush(tokens, { title, body, data });
  } catch (error) {
    console.error('[pushNotifier] Error in sendPushToUsers:', error.message);
  }
}

/**
 * Internal helper to dispatch push via Firebase Admin
 */
async function dispatchPush(tokens, { title, body, data }) {
  // Check if Firebase is initialized
  if (admin.apps.length === 0) {
    console.warn('[pushNotifier] Firebase Admin not initialized. Skipping push.');
    return;
  }

  const fcmTokens = tokens.map(t => t.token);
  
  const message = {
    notification: { title, body },
    data: Object.keys(data).reduce((acc, key) => {
      acc[key] = String(data[key]);
      return acc;
    }, {}),
    tokens: fcmTokens,
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    
    if (response.failureCount > 0) {
      const tokensToDelete = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          // Delete token if it's invalid or unregistered
          if (errorCode === 'messaging/invalid-registration-token' || 
              errorCode === 'messaging/registration-token-not-registered') {
            tokensToDelete.push(tokens[idx].id);
          }
        }
      });

      if (tokensToDelete.length > 0) {
        await sequelize.query(`
          DELETE FROM push_tokens WHERE id IN (:ids)
        `, { replacements: { ids: tokensToDelete } });
        console.log(`[pushNotifier] Deleted ${tokensToDelete.length} invalid tokens.`);
      }
    }
    
    console.log(`[pushNotifier] Successfully sent push to ${response.successCount} devices.`);
  } catch (error) {
    console.error('[pushNotifier] FCM Multicast Error:', error.message);
  }
}

module.exports = { sendPushToStudents, sendPushToUsers };
