'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('library_issues', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      school_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'schools', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      book_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'library_books', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      borrower_type: { type: Sequelize.ENUM('student', 'staff'), allowNull: false },
      borrower_id: { type: Sequelize.INTEGER, allowNull: false },
      issue_date: { type: Sequelize.DATEONLY, allowNull: false },
      due_date: { type: Sequelize.DATEONLY, allowNull: false },
      return_date: { type: Sequelize.DATEONLY, allowNull: true },
      status: { type: Sequelize.ENUM('issued', 'returned', 'overdue'), allowNull: false, defaultValue: 'issued' },
      fine_amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      fine_status: { type: Sequelize.ENUM('none', 'pending', 'paid', 'waived'), allowNull: false, defaultValue: 'none' },
      fine_remarks: { type: Sequelize.TEXT, allowNull: true },
      issued_by: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('library_issues', ['school_id']);
    await queryInterface.addIndex('library_issues', ['book_id']);
    await queryInterface.addIndex('library_issues', ['borrower_id', 'borrower_type']);
    await queryInterface.addIndex('library_issues', ['status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('library_issues');
  },
};
