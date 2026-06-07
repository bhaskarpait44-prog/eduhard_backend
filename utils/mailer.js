'use strict';

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465', 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    // Do not fail on invalid certs in dev, but keep it strict in prod
    rejectUnauthorized: process.env.NODE_ENV !== 'development'
  }
});

console.log(`[Mailer] Initialized with host: ${process.env.SMTP_HOST}, port: ${process.env.SMTP_PORT}, user: ${process.env.SMTP_USER}`);

// Verify connection configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('[Mailer] SMTP Connection Error:', error);
  } else {
    console.log('[Mailer] SMTP Server is ready to take messages');
  }
});

/**
 * Send an email
 * @param {Object} options - { to, subject, text, html, attachments }
 */
async function sendEmail({ to, subject, text, html, attachments }) {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'EduCore'}" <${process.env.SMTP_FROM_EMAIL}>`,
      to,
      subject,
      text,
      html,
      attachments,
    });
    console.log('[Mailer] Email sent: %s', info.messageId);
    return info;
  } catch (error) {
    console.error('[Mailer] Error sending email:', error);
    // In development, we don't want to crash if SMTP is not configured
    if (process.env.NODE_ENV === 'development') {
      console.log('--- DEVELOPMENT MODE: EMAIL CONTENT ---');
      console.log('To:', to);
      console.log('Subject:', subject);
      console.log('Body:', text);
      console.log('---------------------------------------');
      return { messageId: 'dev-mode-placeholder' };
    }
    throw error;
  }
}

module.exports = {
  sendEmail,
};
