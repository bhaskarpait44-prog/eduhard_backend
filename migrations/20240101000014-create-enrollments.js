'use strict';

/**
 * Migration: create_enrollments
 *
 * Central fact table for WHERE a student is in WHICH class/section
 * during WHICH session. One row per student per session.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('enrollments', {
      id: {
        type          : Sequelize.INTEGER,
        autoIncrement : true,
        primaryKey    : true,
        allowNull     : false,
      },
      student_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        references : { model: 'students', key: 'id' },
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
      class_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        references : { model: 'classes', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'RESTRICT',
      },
      section_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        references : { model: 'sections', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'RESTRICT',
      },
      roll_number: {
        type      : Sequelize.STRING(20),
        allowNull : true,
        comment   : 'Class roll number assigned for this session',
      },
      stream: {
        type      : Sequelize.STRING(20),
        allowNull : true,
        comment   : 'Optional academic stream such as regular, arts, commerce, or science.',
      },
      joined_date: {
        type      : Sequelize.DATEONLY,
        allowNull : false,
        comment   : 'Actual date student physically joined this class/section',
      },
      joining_type: {
        type      : Sequelize.ENUM('fresh', 'promoted', 'failed', 'transfer_in', 'rejoined'),
        allowNull : false,
      },
      left_date: {
        type      : Sequelize.DATEONLY,
        allowNull : true,
        comment   : 'NULL = still enrolled. Set when enrollment is closed.',
      },
      leaving_type: {
        type      : Sequelize.ENUM('promoted', 'failed', 'transfer_out', 'withdrawn', 'graduated', 'expelled'),
        allowNull : true,
      },
      previous_enrollment_id: {
        type       : Sequelize.INTEGER,
        allowNull  : true,
        references : { model: 'enrollments', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'SET NULL',
        comment    : 'FK to self — points to last session enrollment. Builds history chain.',
      },
      status: {
        type         : Sequelize.ENUM('active', 'inactive'),
        allowNull    : false,
        defaultValue : 'active',
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
    await queryInterface.addIndex('enrollments', ['student_id', 'session_id'], {
      name   : 'idx_enrollments_student_session',
      unique : true,
    });

    await queryInterface.addIndex('enrollments', ['session_id', 'class_id', 'section_id', 'status'], {
      name: 'idx_enrollments_session_class_section',
    });

    await queryInterface.addIndex('enrollments', ['session_id', 'section_id', 'roll_number'], {
      name   : 'idx_enrollments_roll_number',
      unique : true,
    });

    await queryInterface.addIndex('enrollments', ['previous_enrollment_id'], {
      name: 'idx_enrollments_previous',
    });

    // Constraints
    await queryInterface.sequelize.query(`
      ALTER TABLE enrollments
      ADD CONSTRAINT chk_enrollment_leaving_consistency
      CHECK (
        (left_date IS NULL AND leaving_type IS NULL)
        OR
        (left_date IS NOT NULL AND leaving_type IS NOT NULL)
      );

      ALTER TABLE enrollments
      ADD CONSTRAINT chk_enrollments_stream
      CHECK (
        stream IS NULL
        OR stream IN ('regular', 'arts', 'commerce', 'science')
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('enrollments');
  },
};
