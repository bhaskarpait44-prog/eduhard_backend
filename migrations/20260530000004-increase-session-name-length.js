'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('sessions', 'name', {
      type: Sequelize.STRING(100),
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('sessions', 'name', {
      type: Sequelize.STRING(20),
      allowNull: false,
    });
  },
};
