'use strict';

/**
 * Migration: fix_homework_teacher_foreign_key
 * 
 * Corrects the foreign key constraint on the teacher_id column in the homework table.
 * It was incorrectly referencing the 'users' table instead of the 'teachers' table.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // 1. Remove the incorrect constraint(s)
      // We try both the standard name and the one reported in the error message
      const potentialConstraints = [
        'homework_teacher_id_fkey',
        'homework_teacher-idf_key', // Reported by user
        'homework_teacher_id_users_fkey'
      ];

      for (const name of potentialConstraints) {
        await queryInterface.removeConstraint('homework', name, { transaction, logging: false })
          .catch(() => {}); // Ignore if not found
      }

      // 2. Add the correct constraint referencing the 'teachers' table
      await queryInterface.addConstraint('homework', {
        fields: ['teacher_id'],
        type: 'foreign key',
        name: 'homework_teacher_id_fkey',
        references: {
          table: 'teachers',
          field: 'id'
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction
      });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Revert back to referencing 'users'
      await queryInterface.removeConstraint('homework', 'homework_teacher_id_fkey', { transaction, logging: false })
        .catch(() => {});

      await queryInterface.addConstraint('homework', {
        fields: ['teacher_id'],
        type: 'foreign key',
        name: 'homework_teacher_id_fkey',
        references: {
          table: 'users',
          field: 'id'
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction
      });
    });
  }
};
