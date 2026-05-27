'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('library_reservations', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      school_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'schools', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      book_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'library_books', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      borrower_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      borrower_type: {
        type: Sequelize.ENUM('student', 'staff'),
        allowNull: false
      },
      reservation_date: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      status: {
        type: Sequelize.ENUM('pending', 'ready', 'completed', 'cancelled', 'expired'),
        allowNull: false,
        defaultValue: 'pending'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('library_reservations', ['school_id']);
    await queryInterface.addIndex('library_reservations', ['book_id']);
    await queryInterface.addIndex('library_reservations', ['status']);
    await queryInterface.addIndex('library_reservations', ['borrower_id', 'borrower_type']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('library_reservations');
  }
};
