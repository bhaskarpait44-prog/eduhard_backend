'use strict';

/**
 * Migration: fix_exam_subjects_foreign_keys
 * 
 * Removes the foreign key constraints on fields that can store either
 * Teacher IDs or User IDs in the exam_subjects table.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Standard Sequelize constraint names: [table]_[column]_fkey
      const constraints = [
        'exam_subjects_submitted_by_fkey',
        'exam_subjects_assigned_teacher_id_fkey',
        'exam_subjects_reviewed_by_fkey',
        'exam_subjects_created_by_fkey',
        'exam_subjects_updated_by_fkey'
      ];

      for (const constraint of constraints) {
        await queryInterface.removeConstraint('exam_subjects', constraint, { transaction })
          .catch(e => console.log(`Constraint ${constraint} not found, skipping.`));
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Re-add constraints referencing 'users' table
      // Note: This might fail if the data already contains Teacher IDs
      
      await queryInterface.addConstraint('exam_subjects', {
        fields: ['submitted_by'],
        type: 'foreign key',
        name: 'exam_subjects_submitted_by_fkey',
        references: { table: 'users', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      }).catch(e => console.log('Could not re-add submitted_by constraint.'));

      await queryInterface.addConstraint('exam_subjects', {
        fields: ['assigned_teacher_id'],
        type: 'foreign key',
        name: 'exam_subjects_assigned_teacher_id_fkey',
        references: { table: 'users', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      }).catch(e => console.log('Could not re-add assigned_teacher_id constraint.'));
      
      // ... adding back others if needed, but usually down migrations are for rollback
    });
  }
};
