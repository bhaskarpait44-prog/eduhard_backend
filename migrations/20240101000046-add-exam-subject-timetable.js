'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('exam_subjects', 'exam_date', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    }).catch((error) => {
      if (!/already exists/i.test(error.message)) throw error;
    });

    await queryInterface.addColumn('exam_subjects', 'start_time', {
      type: Sequelize.TIME,
      allowNull: true,
    }).catch((error) => {
      if (!/already exists/i.test(error.message)) throw error;
    });

    await queryInterface.addColumn('exam_subjects', 'end_time', {
      type: Sequelize.TIME,
      allowNull: true,
    }).catch((error) => {
      if (!/already exists/i.test(error.message)) throw error;
    });

    await queryInterface.addColumn('exam_subjects', 'invigilator_teacher_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'teachers', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }).catch((error) => {
      if (!/already exists/i.test(error.message)) throw error;
    });

    await queryInterface.addIndex('exam_subjects', ['exam_date', 'invigilator_teacher_id'], {
      name: 'idx_exam_subjects_date_invigilator',
    }).catch((error) => {
      if (!/already exists/i.test(error.message)) throw error;
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('exam_subjects', 'idx_exam_subjects_date_invigilator').catch(() => {});
    await queryInterface.removeColumn('exam_subjects', 'invigilator_teacher_id').catch(() => {});
    await queryInterface.removeColumn('exam_subjects', 'end_time').catch(() => {});
    await queryInterface.removeColumn('exam_subjects', 'start_time').catch(() => {});
    await queryInterface.removeColumn('exam_subjects', 'exam_date').catch(() => {});
  },
};
