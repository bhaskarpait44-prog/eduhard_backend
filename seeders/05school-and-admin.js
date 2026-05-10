'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // ── 1. School ────────────────────────────────────────────────────────
    const [existingSchools] = await queryInterface.sequelize.query(
      `SELECT id FROM schools WHERE email = 'admin@greenwoodacademy.edu.in' LIMIT 1;`
    );

    let schoolId;
    if (existingSchools.length === 0) {
      await queryInterface.bulkInsert('schools', [{
        name        : 'Greenwood Academy',
        branch_name : 'Main Campus',
        address     : '12 Education Lane, Guwahati, Assam 781001',
        phone       : '+91-361-2345678',
        email       : 'admin@greenwoodacademy.edu.in',
        is_active   : true,
        created_at  : now,
        updated_at  : now,
      }]);

      const [schools] = await queryInterface.sequelize.query(
        `SELECT id FROM schools WHERE email = 'admin@greenwoodacademy.edu.in' LIMIT 1;`
      );
      schoolId = schools[0].id;
    } else {
      schoolId = existingSchools[0].id;
    }

    // ── 2. Admin User ────────────────────────────────────────────────────
    const [existingUsers] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE email = 'admin@greenwoodacademy.edu.in' LIMIT 1;`
    );

    if (existingUsers.length === 0) {
      const hash = await bcrypt.hash('Admin@1234', 12);
      await queryInterface.bulkInsert('users', [{
        school_id     : schoolId,
        name          : 'System Admin',
        email         : 'admin@greenwoodacademy.edu.in',
        password_hash : hash,
        role          : 'admin',
        is_active     : true,
        created_at    : now,
        updated_at    : now,
      }]);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('users', { email: 'admin@greenwoodacademy.edu.in' }, {});
    await queryInterface.bulkDelete('schools', { email: 'admin@greenwoodacademy.edu.in' }, {});
  },
};