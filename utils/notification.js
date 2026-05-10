'use strict';

const { Expo } = require('expo-server-sdk');
const admin = require('firebase-admin');
const expo = new Expo();
const sequelize = require('../config/database');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
let fcmEnabled = false;
try {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, '../config/firebase-service-account.json');
  
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    fcmEnabled = true;
    console.log('[Notification] Firebase Admin initialized via environment variable.');
  } else if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    fcmEnabled = true;
    console.log(`[Notification] Firebase Admin initialized via file: ${serviceAccountPath}`);
  } else {
    console.warn('[Notification] Firebase Admin NOT initialized. FCM notifications will be skipped. Please provide FIREBASE_SERVICE_ACCOUNT or config/firebase-service-account.json');
  }
} catch (error) {
  console.error('[Notification] Error initializing Firebase Admin:', error.message);
}

async function sendNotification({ userId = null, studentId = null, teacherId = null, title, content, type = 'notice', data = {} }) {
  try {
    // 1. Save to database
    const [[notification]] = await sequelize.query(`
      INSERT INTO notifications (user_id, student_id, teacher_id, title, content, type, data, is_read, created_at, updated_at)
      VALUES (:userId, :studentId, :teacherId, :title, :content, :type, :data, false, NOW(), NOW())
      RETURNING id;
    `, {
      replacements: {
        userId,
        studentId,
        teacherId,
        title,
        content,
        type,
        data: JSON.stringify(data),
      },
    });

    // 2. Fetch push tokens
    const [tokens] = await sequelize.query(`
      SELECT token FROM push_tokens
      WHERE (:userId::int IS NULL OR user_id = :userId)
        AND (:studentId::int IS NULL OR student_id = :studentId)
        AND (:teacherId::int IS NULL OR teacher_id = :teacherId);
    `, {
      replacements: { userId, studentId, teacherId },
    });

    if (tokens.length > 0) {
      const expoMessages = [];
      const fcmTokens = [];

      for (let pushToken of tokens) {
        if (Expo.isExpoPushToken(pushToken.token)) {
          expoMessages.push({
            to: pushToken.token,
            sound: 'default',
            title: title,
            body: content,
            data: { ...data, type },
          });
        } else if (fcmEnabled) {
          // Assume anything else is FCM if Firebase is enabled
          fcmTokens.push(pushToken.token);
        } else {
          console.warn(`[Notification] Token ${pushToken.token} ignored. Not an Expo token and FCM is not enabled.`);
        }
      }

      // Send via Expo
      if (expoMessages.length > 0) {
        const chunks = expo.chunkPushNotifications(expoMessages);
        for (let chunk of chunks) {
          try {
            await expo.sendPushNotificationsAsync(chunk);
          } catch (error) {
            console.error('[Expo Push Error]', error);
          }
        }
      }

      // Send via FCM
      if (fcmTokens.length > 0 && fcmEnabled) {
        const message = {
          notification: {
            title: title,
            body: content,
          },
          data: {
            ...Object.keys(data).reduce((acc, key) => {
              acc[key] = String(data[key]); // FCM data values must be strings
              return acc;
            }, {}),
            type: String(type),
          },
          android: {
            priority: 'high',
            notification: {
              channelId: 'high_importance_channel',
              visibility: 'public',
              priority: 'high',
            },
          },
          apns: {
            payload: {
              aps: {
                contentAvailable: true,
                sound: 'default',
              },
            },
          },
          tokens: fcmTokens,
        };

        try {
          const response = await admin.messaging().sendEachForMulticast(message);
          if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                failedTokens.push(fcmTokens[idx]);
                console.error(`[FCM Error] Token ${fcmTokens[idx]} failed:`, resp.error);
              }
            });
            // Optional: Remove invalid tokens from DB
          }
        } catch (error) {
          console.error('[FCM Multicast Error]', error);
        }
      }
    }

    // 3. Mark as sent in DB
    await sequelize.query(`
      UPDATE notifications SET sent_at = NOW() WHERE id = :id;
    `, { replacements: { id: notification.id } });

    return notification.id;
  } catch (error) {
    console.error('[Notification Error]', error);
    return null;
  }
}

async function notifyClass(classId, sectionId, title, content, type = 'notice', data = {}) {
  const [students] = await sequelize.query(`
    SELECT student_id FROM enrollments
    WHERE class_id = :classId
      AND (:sectionId::int IS NULL OR section_id = :sectionId)
      AND status = 'active';
  `, { replacements: { classId, sectionId: sectionId || null } });

  const promises = students.map((s) => sendNotification({ studentId: s.student_id, title, content, type, data }));
  return Promise.all(promises);
}

async function notifyAllStudents(schoolId, title, content, type = 'notice', data = {}) {
  const [students] = await sequelize.query(`
    SELECT id FROM students
    WHERE school_id = :schoolId AND is_deleted = false;
  `, { replacements: { schoolId } });

  const promises = students.map((s) => sendNotification({ studentId: s.id, title, content, type, data }));
  return Promise.all(promises);
}

async function notifyAllTeachers(schoolId, title, content, type = 'notice', data = {}) {
  const [teachers] = await sequelize.query(`
    SELECT id FROM teachers
    WHERE school_id = :schoolId AND is_active = true AND is_deleted = false;
  `, { replacements: { schoolId } });

  const promises = teachers.map((t) => sendNotification({ teacherId: t.id, title, content, type, data }));
  return Promise.all(promises);
}

async function notifySubject(subjectId, title, content, type = 'notice', data = {}) {
  const [students] = await sequelize.query(`
    SELECT student_id FROM student_subjects
    WHERE subject_id = :subjectId AND is_active = true;
  `, { replacements: { subjectId } });

  const promises = students.map((s) => sendNotification({ studentId: s.student_id, title, content, type, data }));
  return Promise.all(promises);
}

module.exports = {
  sendNotification,
  notifyClass,
  notifyAllStudents,
  notifyAllTeachers,
  notifySubject,
};
