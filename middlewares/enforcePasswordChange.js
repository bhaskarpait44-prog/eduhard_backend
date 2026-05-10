'use strict';

/**
 * Middleware to enforce password change if force_password_change is true.
 * Should be applied after the authenticate middleware.
 */
const enforcePasswordChange = (req, res, next) => {
  // Skip for student role (if not implemented for them) 
  // or if the user doesn't have the flag
  if (req.user && req.user.role !== 'student' && req.user.force_password_change) {
    // Allow the password change request itself
    const isChangePasswordRoute = req.path === '/auth/change-password' || 
                                 (req.method === 'PATCH' && req.path.includes('/profile')); // Adjust based on where they change password
    
    if (!isChangePasswordRoute) {
      return res.status(403).json({
        success: false,
        message: 'Password change required.',
        errors: ['You must change your password before accessing other features.'],
        force_password_change: true
      });
    }
  }
  next();
};

module.exports = enforcePasswordChange;
