'use strict';

/**
 * Generates HTML for a password reset email.
 * @param {Object} data - { name, resetUrl, appName }
 * @returns {string} - HTML string.
 */
function generateResetPasswordHtml({ name, resetUrl, appName }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Helvetica', 'Arial', sans-serif; color: #333; margin: 0; padding: 0; background-color: #f8fafc; }
        .wrapper { width: 100%; padding: 40px 0; }
        .container { max-width: 600px; margin: auto; background: #ffffff; padding: 40px; border-radius: 24px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { width: 48px; height: 48px; background: #0ea5e9; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: bold; margin-bottom: 15px; }
        
        h1 { font-size: 22px; font-weight: bold; color: #0f172a; margin-bottom: 10px; text-align: center; }
        p { font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 20px; }
        
        .button-container { text-align: center; margin: 35px 0; }
        .button { background-color: #0ea5e9; color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: bold; font-size: 15px; display: inline-block; transition: background 0.2s; }
        
        .divider { height: 1px; background: #e2e8f0; margin: 30px 0; }
        .footer { text-align: center; font-size: 12px; color: #94a3b8; }
        .link-text { word-break: break-all; color: #0ea5e9; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="container">
          <div class="header">
            <div class="logo">E</div>
            <h1>Reset Your Password</h1>
          </div>
          
          <p>Hello ${name},</p>
          <p>We received a request to reset the password for your ${appName} account. Click the button below to choose a new password:</p>
          
          <div class="button-container">
            <a href="${resetUrl}" class="button">Reset Password</a>
          </div>
          
          <p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
          <p>This link will expire in 1 hour for your security.</p>
          
          <div class="divider"></div>
          
          <p style="font-size: 13px;">If you're having trouble clicking the button, copy and paste the link below into your web browser:</p>
          <p class="link-text">${resetUrl}</p>
          
          <div class="footer">
            &copy; ${new Date().getFullYear()} ${appName}. All rights reserved.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = { generateResetPasswordHtml };
