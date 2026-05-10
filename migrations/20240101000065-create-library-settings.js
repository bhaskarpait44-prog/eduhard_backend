'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('library_settings', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      school_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'schools', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      fine_per_day: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 2 },
      max_books_per_borrower: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
      max_issue_days: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 14 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('library_settings', ['school_id'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('library_settings');
  },
};
