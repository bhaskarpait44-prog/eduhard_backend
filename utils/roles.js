'use strict';

function normalizeUserRole(role) {
  return role === 'super_admin' ? 'admin' : role;
}

module.exports = { normalizeUserRole };
