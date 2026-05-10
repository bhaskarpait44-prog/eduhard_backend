'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('schools', 'logo_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn('schools', 'principal_name', {
      type: Sequelize.STRING(150),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('schools', 'logo_url');
    await queryInterface.removeColumn('schools', 'principal_name');
  },
};
