'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('student_remarks', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teachers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'Teacher who created the remark',
      },
      enrollment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'enrollments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'Enrollment context for class/section at the time of remark',
      },
      remark_type: {
        type: Sequelize.ENUM(
          'academic',
          'behavioral',
          'achievement',
          'health',
          'parent_communication',
          'general'
        ),
        allowNull: false,
      },
      remark_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      visibility: {
        type: Sequelize.ENUM('private', 'share_parent', 'share_student'),
        allowNull: false,
        defaultValue: 'private',
      },
      is_edited: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      edited_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('student_remarks', ['student_id', 'is_deleted', 'created_at'], {
      name: 'idx_student_remarks_student_active_created',
    });

    await queryInterface.addIndex('student_remarks', ['teacher_id', 'is_deleted', 'created_at'], {
      name: 'idx_student_remarks_teacher_active_created',
    });

    await queryInterface.addIndex('student_remarks', ['enrollment_id', 'remark_type', 'is_deleted'], {
      name: 'idx_student_remarks_enrollment_type',
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE student_remarks
      ADD CONSTRAINT chk_student_remarks_edit_timestamp
      CHECK (
        (is_edited = false AND edited_at IS NULL)
        OR
        (is_edited = true AND edited_at IS NOT NULL)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE student_remarks
      DROP CONSTRAINT IF EXISTS chk_student_remarks_edit_timestamp;
    `);
    await queryInterface.dropTable('student_remarks');
  },
};