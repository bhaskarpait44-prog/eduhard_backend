'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add unique index on (school_id, isbn) where isbn is not null and is_deleted is false
    await queryInterface.addIndex('library_books', ['school_id', 'isbn'], {
      unique: true,
      name: 'idx_library_books_school_isbn_unique',
      where: {
        isbn: { [Sequelize.Op.ne]: null },
        is_deleted: false
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('library_books', 'idx_library_books_school_isbn_unique');
  }
};
