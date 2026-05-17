'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    
    // 1. Classes
    await queryInterface.bulkInsert('classes', [
      { id: 1, school_id: 1, name: '9', stream: 'regular', order_number: 9, is_active: true, created_at: now, updated_at: now },
      { id: 2, school_id: 1, name: '10', stream: 'regular', order_number: 10, is_active: true, created_at: now, updated_at: now },
      { id: 3, school_id: 1, name: '11', stream: 'science', order_number: 11, is_active: true, created_at: now, updated_at: now },
      { id: 4, school_id: 1, name: '12', stream: 'science', order_number: 12, is_active: true, created_at: now, updated_at: now }
    ], { ignoreDuplicates: true });

    // 2. Sections
    await queryInterface.bulkInsert('sections', [
      { id: 1, class_id: 1, name: 'A', capacity: 40, is_active: true, created_at: now, updated_at: now },
      { id: 2, class_id: 2, name: 'A', capacity: 40, is_active: true, created_at: now, updated_at: now },
      { id: 3, class_id: 3, name: 'A', capacity: 40, is_active: true, created_at: now, updated_at: now },
      { id: 4, class_id: 4, name: 'A', capacity: 40, is_active: true, created_at: now, updated_at: now }
    ], { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('sections', null, {});
    await queryInterface.bulkDelete('classes', null, {});
  }
};
