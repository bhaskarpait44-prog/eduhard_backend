'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('student_health_profiles', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      student_id: { type: Sequelize.INTEGER, allowNull: false, unique: true, references: { model: 'students', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      blood_group: { type: Sequelize.STRING(10), allowNull: true },
      height_cm: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      weight_kg: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      allergies: { type: Sequelize.TEXT, allowNull: true },
      medical_conditions: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('student_vaccinations', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      student_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'students', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      vaccine_name: { type: Sequelize.STRING(150), allowNull: false },
      date_administered: { type: Sequelize.DATEONLY, allowNull: true },
      next_due_date: { type: Sequelize.DATEONLY, allowNull: true },
      remarks: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('student_health_incidents', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      student_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'students', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      incident_date: { type: Sequelize.DATEONLY, allowNull: false },
      incident_time: { type: Sequelize.TIME, allowNull: true },
      type: { type: Sequelize.ENUM('injury', 'illness', 'other'), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      action_taken: { type: Sequelize.TEXT, allowNull: true },
      reported_by: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('student_health_incidents');
    await queryInterface.dropTable('student_vaccinations');
    await queryInterface.dropTable('student_health_profiles');
  },
};
