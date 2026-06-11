'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addConstraint('sessions', {
        fields: ['created_by'],
        type: 'foreign key',
        name: 'fk_sessions_created_by',
        references: {
          table: 'users',
          field: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      });
    } catch (e) { console.log('Constraint fk_sessions_created_by may already exist'); }
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeConstraint('sessions', 'fk_sessions_created_by');
    } catch (e) {}
  }
};
