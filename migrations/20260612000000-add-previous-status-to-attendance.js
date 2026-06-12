'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('attendance', 'previous_status', {
      type      : Sequelize.STRING(20),
      allowNull : true,
      comment   : 'Stores original attendance status before it was overridden by a retroactive holiday. Used for restoration.',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('attendance', 'previous_status');
  }
};
