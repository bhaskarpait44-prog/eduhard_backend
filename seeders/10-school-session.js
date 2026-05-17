'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    
    // 1. School
    await queryInterface.bulkInsert('schools', [{
      id: 1,
      name: 'Greenwood Academy',
      branch_name: 'Main Campus',
      address: '12 Education Lane, Guwahati, Assam 781001',
      phone: '+91-361-2345678',
      email: 'admin@greenwoodacademy.edu.in',
      is_active: true,
      created_at: now,
      updated_at: now,
    }], { ignoreDuplicates: true });

    // 2. Admin User
    const hash = await bcrypt.hash('Admin@1234', 12);
    await queryInterface.bulkInsert('users', [{
      school_id: 1,
      name: 'System Admin',
      email: 'admin@greenwoodacademy.edu.in',
      password_hash: hash,
      role: 'admin',
      is_active: true,
      created_at: now,
      updated_at: now,
    }], { ignoreDuplicates: true });

    // 3. Session
    await queryInterface.bulkInsert('sessions', [{
      id: 1,
      school_id: 1,
      name: '2024-2025',
      start_date: '2024-04-01',
      end_date: '2025-03-31',
      status: 'active',
      is_current: true,
      created_at: now,
      updated_at: now,
    }], { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    // Preserving users and schools as per user request
    await queryInterface.bulkDelete('sessions', null, {});
  }
};
