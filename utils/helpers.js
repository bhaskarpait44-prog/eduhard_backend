'use strict';

/**
 * Escapes HTML special characters in a string.
 * @param {string} str - The string to escape.
 * @returns {string} - The escaped string.
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"']/g, function(m) {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
      default: return m;
    }
  });
}

module.exports = {
  escapeHtml
};
