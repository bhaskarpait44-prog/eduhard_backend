'use strict';

/**
 * Migration: create_exam_results_and_grading
 *
 * Consolidates exam_results creation, theory/practical components,
 * grading scales, and mark history tracking.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // 1. Create grading_scales table
      await queryInterface.createTable('grading_scales', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        school_id: { 
          type: Sequelize.INTEGER, 
          allowNull: false,
          references : { model: 'schools', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'RESTRICT',
        },
        name: { type: Sequelize.STRING(100), allowNull: false },
        is_default: { type: Sequelize.BOOLEAN, defaultValue: false },
        definition: { type: Sequelize.JSONB, allowNull: false }, // Array of { min: 90, grade: 'A+', point: 4.0, remark: 'Excellent' }
        created_by: { 
          type: Sequelize.INTEGER, 
          allowNull: true,
          references : { model: 'users', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'SET NULL',
        },
        updated_by: { 
          type: Sequelize.INTEGER, 
          allowNull: true,
          references : { model: 'users', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'SET NULL',
        },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      }, { transaction });

      // 2. Create exam_results table
      await queryInterface.createTable('exam_results', {
        id: {
          type          : Sequelize.INTEGER,
          autoIncrement : true,
          primaryKey    : true,
          allowNull     : false,
        },
        exam_id: {
          type       : Sequelize.INTEGER,
          allowNull  : false,
          references : { model: 'exams', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'RESTRICT',
        },
        enrollment_id: {
          type       : Sequelize.INTEGER,
          allowNull  : false,
          references : { model: 'enrollments', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'RESTRICT',
        },
        subject_id: {
          type       : Sequelize.INTEGER,
          allowNull  : false,
          references : { model: 'subjects', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'RESTRICT',
        },
        marks_obtained: {
          type      : Sequelize.DECIMAL(6, 2),
          allowNull : true,
          comment   : 'NULL when is_absent=true',
        },
        theory_marks_obtained: {
          type: Sequelize.DECIMAL(6, 2),
          allowNull: true,
          comment: 'Theory component marks when subject_type is theory or both',
        },
        practical_marks_obtained: {
          type: Sequelize.DECIMAL(6, 2),
          allowNull: true,
          comment: 'Practical component marks when subject_type is practical or both',
        },
        is_absent: {
          type         : Sequelize.BOOLEAN,
          allowNull    : false,
          defaultValue : false,
        },
        grade: {
          type      : Sequelize.STRING(5),
          allowNull : true,
        },
        is_pass: {
          type      : Sequelize.BOOLEAN,
          allowNull : true,
        },
        entered_by: {
          type      : Sequelize.INTEGER,
          allowNull : true,
          references : { model: 'users', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'SET NULL',
        },
        override_by: {
          type      : Sequelize.INTEGER,
          allowNull : true,
          references : { model: 'users', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'SET NULL',
        },
        override_reason: {
          type      : Sequelize.TEXT,
          allowNull : true,
        },
        created_at: {
          type         : Sequelize.DATE,
          allowNull    : false,
          defaultValue : Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updated_at: {
          type         : Sequelize.DATE,
          allowNull    : false,
          defaultValue : Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      }, { transaction });

      // 3. Create mark_histories table
      await queryInterface.createTable('mark_histories', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        exam_id: { 
          type: Sequelize.INTEGER, 
          allowNull: false,
          references : { model: 'exams', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'RESTRICT',
        },
        enrollment_id: { 
          type: Sequelize.INTEGER, 
          allowNull: false,
          references : { model: 'enrollments', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'RESTRICT',
        },
        subject_id: { 
          type: Sequelize.INTEGER, 
          allowNull: false,
          references : { model: 'subjects', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'RESTRICT',
        },
        old_marks_obtained: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        new_marks_obtained: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        old_theory_marks: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        new_theory_marks: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        old_practical_marks: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        new_practical_marks: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        old_is_absent: { type: Sequelize.BOOLEAN, allowNull: true },
        new_is_absent: { type: Sequelize.BOOLEAN, allowNull: true },
        changed_by: { 
          type: Sequelize.INTEGER, 
          allowNull: false,
          references : { model: 'users', key: 'id' },
          onUpdate   : 'CASCADE',
          onDelete   : 'RESTRICT',
        },
        change_reason: { type: Sequelize.TEXT, allowNull: true },
        change_type: { type: Sequelize.ENUM('entry', 'override', 'grace'), defaultValue: 'entry' },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      }, { transaction });

      // Indexes for exam_results
      await queryInterface.addIndex('exam_results', ['exam_id', 'enrollment_id', 'subject_id'], {
        name   : 'idx_exam_results_exam_enrollment_subject',
        unique : true,
        transaction
      });

      await queryInterface.addIndex('exam_results', ['enrollment_id', 'exam_id'], {
        name: 'idx_exam_results_enrollment_exam',
        transaction
      });

      // Constraints
      await queryInterface.sequelize.query(`
        ALTER TABLE exam_results
        ADD CONSTRAINT chk_marks_absent_consistency
        CHECK (
          (is_absent = true  AND marks_obtained IS NULL)
          OR
          (is_absent = false AND marks_obtained >= 0)
        );

        ALTER TABLE exam_results
        ADD CONSTRAINT chk_override_reason_required
        CHECK (
          override_by IS NULL
          OR (override_by IS NOT NULL AND override_reason IS NOT NULL)
        );

        ALTER TABLE exam_results
        ADD CONSTRAINT chk_exam_results_component_marks_non_negative
        CHECK (
          (theory_marks_obtained IS NULL OR theory_marks_obtained >= 0)
          AND
          (practical_marks_obtained IS NULL OR practical_marks_obtained >= 0)
        );
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('mark_histories');
    await queryInterface.dropTable('exam_results');
    await queryInterface.dropTable('grading_scales');
    // Drop enum if necessary (Postgres specific)
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_mark_histories_change_type";');
  },
};
