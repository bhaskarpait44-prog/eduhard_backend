'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('library_books', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      school_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'schools', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      title: { type: Sequelize.STRING(255), allowNull: false },
      author: { type: Sequelize.STRING(255), allowNull: false },
      publisher: { type: Sequelize.STRING(255), allowNull: true },
      isbn: { type: Sequelize.STRING(50), allowNull: true },
      category: { 
        type: Sequelize.ENUM('fiction', 'non_fiction', 'science', 'mathematics', 'history', 'geography', 'literature', 'reference', 'magazine', 'other'), 
        allowNull: false,
        defaultValue: 'other'
      },
      total_copies: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      available_copies: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      shelf_location: { type: Sequelize.STRING(100), allowNull: true },
      publication_year: { type: Sequelize.INTEGER, allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      is_deleted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('library_books', ['school_id']);
    await queryInterface.addIndex('library_books', ['isbn']);
    await queryInterface.addIndex('library_books', ['category']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('library_books');
    // Note: Enum types might need to be dropped manually in some DBs if they are custom types, 
    // but Sequelize usually handles this if they are defined inline in PostgreSQL.
  },
};
