'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let fcmEnabled = false;

function initializeFirebase() {
  if (admin.apps.length > 0) return admin.app();

  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, '../config/firebase-service-account.json');
    
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      fcmEnabled = true;
      console.log('[Firebase] Admin initialized via environment variable.');
    } else if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      fcmEnabled = true;
      console.log(`[Firebase] Admin initialized via file: ${serviceAccountPath}`);
    } else {
      console.warn('[Firebase] Admin NOT initialized. Push notifications will be skipped.');
    }
  } catch (error) {
    console.error('[Firebase] Error initializing Admin SDK:', error.message);
  }

  return admin;
}

module.exports = {
  initializeFirebase,
  admin,
  get fcmEnabled() { return fcmEnabled; }
};
