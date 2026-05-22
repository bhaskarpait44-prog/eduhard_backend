'use strict';

const firebase = require('./firebase');
const sequelize = require('../config/database');
const { logNotification } = require('./notificationLogger');

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
 * Sends push notifications to a list of teachers via their push tokens.
 * @param {Array<number>} teacherIds
 * @param {Object} payload { title, body, data }
 */
async function sendPushToTeachers(teacherIds, { title, body, data = {} }) {
  if (!teacherIds || teacherIds.length === 0) return;

  try {
    const [tokens] = await sequelize.query(`
      SELECT id, token, platform FROM push_tokens
      WHERE teacher_id IN (:teacherIds)
    `, {
      replacements: { teacherIds },
    });

    if (tokens.length === 0) return;

    await dispatchPush(tokens, { title, body, data });
  } catch (error) {
    console.error('[pushNotifier] Error in sendPushToTeachers:', error.message);
  }
}

/**
 * Internal helper to dispatch push via Firebase Admin
 */
async function dispatchPush(tokens, { title, body, data }) {
  logNotification(`Dispatching to ${tokens.length} tokens. Title: "${title}"`);
  
  if (firebase.admin.apps.length === 0) {
    logNotification('WARNING: Firebase Admin not initialized. Skipping push.');
    return;
  }

  let successCount = 0;
  let failureCount = 0;
  const tokensToDelete = [];

  // Send to each token individually to avoid deprecated batch/multicast endpoints
  const sendPromises = tokens.map(async (tokenObj, idx) => {
    const message = {
      token: tokenObj.token,
      notification: {
        title: String(title || 'New Notice'),
        body: String(body || ''),
      },
      data: {
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {}),
        title: String(title || ''),
        body: String(body || ''),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
        },
      },
    };

    try {
      await firebase.admin.messaging().send(message);
      successCount++;
    } catch (error) {
      failureCount++;
      logNotification(`Token Error [${idx}]: ${tokenObj.token.substring(0, 10)}...`, error.message);
      
      const errorCode = error.code;
      if (errorCode === 'messaging/invalid-registration-token' || 
          errorCode === 'messaging/registration-token-not-registered') {
        tokensToDelete.push(tokenObj.id);
      }
    }
  });

  await Promise.all(sendPromises);

  logNotification('FCM Result:', { success: successCount, failure: failureCount });

  if (tokensToDelete.length > 0) {
    try {
      await sequelize.query(`
        DELETE FROM push_tokens WHERE id IN (:ids)
      `, { replacements: { ids: tokensToDelete } });
      logNotification(`Deleted ${tokensToDelete.length} invalid tokens.`);
    } catch (dbErr) {
      console.error('[pushNotifier] Error deleting invalid tokens:', dbErr.message);
    }
  }
}

module.exports = { sendPushToStudents, sendPushToUsers, sendPushToTeachers };
