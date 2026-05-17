'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('notices');
    if (!table.attachment_path) {
      await queryInterface.addColumn('notices', 'attachment_path', {
        type: Sequelize.STRING(500),
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('notices');
    if (table.attachment_path) {
      await queryInterface.removeColumn('notices', 'attachment_path');
    }
  },
};
