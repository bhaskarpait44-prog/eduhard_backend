'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('applications', 'reviewed_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addColumn('applications', 'reviewed_at', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('applications', 'remarks', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('applications', 'remarks');
    await queryInterface.removeColumn('applications', 'reviewed_at');
    await queryInterface.removeColumn('applications', 'reviewed_by');
  }
};
