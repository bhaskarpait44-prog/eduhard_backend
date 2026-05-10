'use strict';

/**
 * Migration: fix_exam_results_foreign_keys
 * 
 * Removes the foreign key constraints on entered_by, override_by, and changed_by
 * columns in exam_results and mark_histories tables.
 * 
 * Reason: These fields can store IDs from either the 'users' table or 'teachers' table,
 * but were previously constrained to only reference 'users'.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // 1. Drop constraints from exam_results
      // Sequelize usually names these [table]_[column]_fkey
      await queryInterface.removeConstraint('exam_results', 'exam_results_entered_by_fkey', { transaction }).catch(e => console.log('Constraint exam_results_entered_by_fkey not found, skipping.'));
      await queryInterface.removeConstraint('exam_results', 'exam_results_override_by_fkey', { transaction }).catch(e => console.log('Constraint exam_results_override_by_fkey not found, skipping.'));

      // 2. Drop constraints from mark_histories
      await queryInterface.removeConstraint('mark_histories', 'mark_histories_changed_by_fkey', { transaction }).catch(e => console.log('Constraint mark_histories_changed_by_fkey not found, skipping.'));
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // 1. Add constraints back to exam_results
      await queryInterface.addConstraint('exam_results', {
        fields: ['entered_by'],
        type: 'foreign key',
        name: 'exam_results_entered_by_fkey',
        references: {
          table: 'users',
          field: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('exam_results', {
        fields: ['override_by'],
        type: 'foreign key',
        name: 'exam_results_override_by_fkey',
        references: {
          table: 'users',
          field: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      });

      // 2. Add constraints back to mark_histories
      await queryInterface.addConstraint('mark_histories', {
        fields: ['changed_by'],
        type: 'foreign key',
        name: 'mark_histories_changed_by_fkey',
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
