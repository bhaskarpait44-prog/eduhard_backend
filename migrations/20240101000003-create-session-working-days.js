'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('session_working_days', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      monday: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      tuesday: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      wednesday: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      thursday: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      friday: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      saturday: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      sunday: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('session_working_days');
  },
};
