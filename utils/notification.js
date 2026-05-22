'use strict';

const { Expo } = require('expo-server-sdk');
const firebase = require('./firebase');
const expo = new Expo();
const sequelize = require('../config/database');

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
        } else if (firebase.fcmEnabled) {
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
      if (fcmTokens.length > 0 && firebase.fcmEnabled) {
        console.log(`[Notification] Sending FCM to ${fcmTokens.length} tokens. Title: "${title}"`);
        
        let successCount = 0;
        let failureCount = 0;

        const sendPromises = fcmTokens.map(async (fcmToken, idx) => {
          const message = {
            token: fcmToken,
            notification: {
              title: String(title || ''),
              body: String(content || ''),
            },
            data: {
              title: String(title || ''),
              body: String(content || ''),
              ...Object.keys(data).reduce((acc, key) => {
                acc[key] = String(data[key]);
                return acc;
              }, {}),
              type: String(type),
            },
            android: {
              priority: 'high',
              ttl: 3600000,
              notification: {
                channelId: 'high_importance_channel',
                priority: 'high',
                visibility: 'public',
                sound: 'default',
              },
            },
            apns: {
              headers: { 'apns-priority': '10' },
              payload: {
                aps: {
                  contentAvailable: true,
                  sound: 'default',
                  alert: { title: String(title || ''), body: String(content || '') },
                },
              },
            },
          };

          try {
            await firebase.admin.messaging().send(message);
            successCount++;
          } catch (error) {
            failureCount++;
            console.error(`[Notification] FCM Token Error [${idx}]: ${fcmToken.substring(0, 10)}...`, error.message);
          }
        });

        await Promise.all(sendPromises);
        console.log(`[Notification] FCM Result: Success=${successCount}, Failure=${failureCount}`);
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
