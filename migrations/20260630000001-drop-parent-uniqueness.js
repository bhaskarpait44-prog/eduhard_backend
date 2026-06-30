'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const fields = [
      'parent_email', 'father_phone', 'mother_phone', 
      'guardian_phone', 'mother_email', 'father_aadhar', 'mother_aadhar', 'guardian_aadhar'
    ];

    for (const f of fields) {
      await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_profiles_${f}_unique;`);
    }
  },

  down: async (queryInterface, Sequelize) => {
    const fields = [
      'parent_email', 'father_phone', 'mother_phone', 
      'guardian_phone', 'mother_email', 'father_aadhar', 'mother_aadhar', 'guardian_aadhar'
    ];

    for (const f of fields) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX idx_profiles_${f}_unique 
        ON student_profiles (${f}) 
        WHERE is_current = true AND ${f} IS NOT NULL AND ${f} <> '';
      `);
    }
  }
};
