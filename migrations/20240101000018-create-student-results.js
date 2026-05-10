'use strict';

/**
 * Migration: create_student_results
 *
 * Aggregate result per student per session.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('student_results', {
      id: {
        type          : Sequelize.INTEGER,
        autoIncrement : true,
        primaryKey    : true,
        allowNull     : false,
      },
      enrollment_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        unique     : true,
        references : { model: 'enrollments', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'RESTRICT',
      },
      session_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        references : { model: 'sessions', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'RESTRICT',
      },
      total_marks: {
        type      : Sequelize.DECIMAL(8, 2),
        allowNull : false,
      },
      marks_obtained: {
        type      : Sequelize.DECIMAL(8, 2),
        allowNull : false,
      },
      percentage: {
        type      : Sequelize.DECIMAL(5, 2),
        allowNull : false,
      },
      grade: {
        type      : Sequelize.STRING(5),
        allowNull : false,
      },
      result: {
        type      : Sequelize.ENUM('pass', 'fail', 'compartment', 'detained'),
        allowNull : false,
      },
      compartment_subjects: {
        type         : Sequelize.JSON,
        allowNull    : true,
        defaultValue : null,
      },
      is_promoted: {
        type         : Sequelize.BOOLEAN,
        allowNull    : false,
        defaultValue : false,
      },
      promotion_override_by: {
        type      : Sequelize.INTEGER,
        allowNull : true,
        references : { model: 'users', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'SET NULL',
      },
      promotion_override_reason: {
        type      : Sequelize.TEXT,
        allowNull : true,
      },
      is_locked: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      locked_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      locked_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references : { model: 'users', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'SET NULL',
      },
      grace_marks_info: {
        type: Sequelize.JSONB,
        allowNull: true
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
    });

    await queryInterface.addIndex('student_results', ['session_id', 'result'], {
      name: 'idx_student_results_session_result',
    });

    await queryInterface.addIndex('student_results', ['session_id', 'is_promoted'], {
      name: 'idx_student_results_session_promoted',
    });

    // Constraints
    await queryInterface.sequelize.query(`
      ALTER TABLE student_results
      ADD CONSTRAINT chk_promotion_override_reason
      CHECK (
        promotion_override_by IS NULL
        OR (promotion_override_by IS NOT NULL AND promotion_override_reason IS NOT NULL)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('student_results');
  },
};
