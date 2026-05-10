'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('teacher_notices', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teachers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      class_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'classes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      section_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'sections', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'subjects', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      target_student_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      target_teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'teachers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      category: {
        type: Sequelize.ENUM('general', 'homework', 'exam', 'event', 'holiday', 'fee', 'other'),
        allowNull: false,
        defaultValue: 'general',
      },
      target_scope: {
        type: Sequelize.ENUM(
          'teachers', 
          'my_class_only', 
          'specific_section', 
          'all_students', 
          'specific_student', 
          'specific_teacher', 
          'specific_subject', 
          'whole_class', 
          'whole_school'
        ),
        allowNull: false,
      },
      attachment_path: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      publish_date: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      expiry_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('teacher_notices', ['teacher_id', 'publish_date'], {
      name: 'idx_teacher_notices_teacher_publish',
    });

    await queryInterface.addIndex('teacher_notices', ['target_scope', 'class_id', 'section_id', 'is_active'], {
      name: 'idx_teacher_notices_target_scope',
    });

    await queryInterface.addIndex('teacher_notices', ['target_student_id', 'is_active'], {
      name: 'idx_teacher_notices_target_student',
    });

    await queryInterface.addIndex('teacher_notices', ['target_teacher_id', 'is_active'], {
      name: 'idx_teacher_notices_target_teacher',
    });

    await queryInterface.addIndex('teacher_notices', ['subject_id', 'is_active'], {
      name: 'idx_teacher_notices_subject',
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_notices
      ADD CONSTRAINT chk_teacher_notices_expiry
      CHECK (expiry_date IS NULL OR expiry_date >= publish_date);
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('teacher_notices');
  },
};
