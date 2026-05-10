'use strict';

/**
 * Migration: create_exams
 *
 * An exam is a session-level event covering one class.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('exams', {
      id: {
        type          : Sequelize.INTEGER,
        autoIncrement : true,
        primaryKey    : true,
        allowNull     : false,
      },
      session_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        references : { model: 'sessions', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'RESTRICT',
      },
      class_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        references : { model: 'classes', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'RESTRICT',
      },
      name: {
        type      : Sequelize.STRING(150),
        allowNull : false,
        comment   : 'e.g. "Term 1 Examination", "Final Examination 2024-25"',
      },
      exam_type: {
        type      : Sequelize.ENUM('term', 'midterm', 'final', 'compartment'),
        allowNull : false,
      },
      start_date: {
        type      : Sequelize.DATEONLY,
        allowNull : false,
      },
      end_date: {
        type      : Sequelize.DATEONLY,
        allowNull : false,
      },
      total_marks: {
        type      : Sequelize.DECIMAL(8, 2),
        allowNull : false,
        comment   : 'Aggregate total across all subjects in this exam',
      },
      passing_marks: {
        type      : Sequelize.DECIMAL(8, 2),
        allowNull : false,
        comment   : 'Minimum aggregate to be considered for pass',
      },
      weightage: {
        type: Sequelize.DECIMAL(5, 2),
        defaultValue: 100.00,
        allowNull: false
      },
      publish_controls: {
        type: Sequelize.JSONB,
        defaultValue: {},
        allowNull: false
      },
      status: {
        type         : Sequelize.ENUM('upcoming', 'ongoing', 'completed'),
        allowNull    : false,
        defaultValue : 'upcoming',
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

    // Indexes
    await queryInterface.addIndex('exams', ['session_id', 'class_id', 'name'], {
      name   : 'idx_exams_session_class_name',
      unique : true,
    });

    await queryInterface.addIndex('exams', ['session_id', 'class_id', 'status'], {
      name: 'idx_exams_session_class_status',
    });

    // Constraints
    await queryInterface.sequelize.query(`
      ALTER TABLE exams
      ADD CONSTRAINT chk_exam_dates
      CHECK (end_date >= start_date);

      ALTER TABLE exams
      ADD CONSTRAINT chk_exam_passing_lte_total
      CHECK (passing_marks <= total_marks);
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('exams');
  },
};
