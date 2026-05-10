'use strict';

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send an email
 * @param {Object} options - { to, subject, text, html }
 */
async function sendEmail({ to, subject, text, html }) {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'EduCore'}" <${process.env.SMTP_FROM_EMAIL}>`,
      to,
      subject,
      text,
      html,
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
