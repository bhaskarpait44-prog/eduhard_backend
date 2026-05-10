'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE exam_subject_review_status_enum AS ENUM ('draft', 'submitted', 'approved', 'rejected');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryInterface.createTable('exam_subjects', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      exam_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'exams', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'subjects', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      subject_type: {
        type: Sequelize.ENUM('theory', 'practical', 'both'),
        allowNull: false,
        defaultValue: 'theory',
      },
      theory_total_marks: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: true,
      },
      theory_passing_marks: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: true,
      },
      practical_total_marks: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: true,
      },
      practical_passing_marks: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: true,
      },
      combined_total_marks: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: false,
      },
      combined_passing_marks: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: false,
      },
      assigned_teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      review_status: {
        type: Sequelize.ENUM('draft', 'submitted', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'draft',
      },
      submitted_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      submitted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      reviewed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reviewed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      review_note: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      updated_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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

    await queryInterface.addIndex('exam_subjects', ['exam_id', 'subject_id'], {
      name: 'idx_exam_subjects_exam_subject',
      unique: true,
    });

    await queryInterface.addIndex('exam_subjects', ['exam_id', 'review_status'], {
      name: 'idx_exam_subjects_exam_review_status',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('exam_subjects');
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS exam_subject_review_status_enum;`);
  },
};
