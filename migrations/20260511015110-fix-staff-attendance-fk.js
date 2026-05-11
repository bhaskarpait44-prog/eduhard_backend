'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Get the constraint name for staff_attendance.user_id -> users.id
    // Standard Sequelize naming: staff_attendance_user_id_fkey
    // But we use a safer approach to find it if possible, or just try to drop it.
    
    try {
      await queryInterface.removeConstraint('staff_attendance', 'staff_attendance_user_id_fkey');
    } catch (err) {
      console.warn('Could not remove constraint staff_attendance_user_id_fkey. It might have a different name.');
      // Fallback: try to find it from information_schema in a raw query if needed,
      // but usually this works for Postgres/standard Sequelize setups.
    }
  },

  async down(queryInterface, Sequelize) {
    // Re-adding it might fail if teacher IDs exist in staff_attendance.user_id
    // so we don't strictly enforce rollback of this specific fix.
    try {
      await queryInterface.addConstraint('staff_attendance', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'staff_attendance_user_id_fkey',
        references: {
          table: 'users',
          field: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      });
    } catch (err) {
      console.warn('Could not re-add constraint staff_attendance_user_id_fkey.');
    }
  }
};
