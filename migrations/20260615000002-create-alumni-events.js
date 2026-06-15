'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('alumni_events', {
      id:          { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      school_id:   { type: Sequelize.INTEGER, allowNull: false, references: { model: 'schools', key: 'id' }, onDelete: 'CASCADE' },
      title:       { type: Sequelize.STRING(200), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      event_date:  { type: Sequelize.DATEONLY, allowNull: false },
      event_time:  { type: Sequelize.TIME, allowNull: true },
      venue:       { type: Sequelize.STRING(300), allowNull: true },
      type:        { type: Sequelize.ENUM('reunion', 'seminar', 'felicitation', 'networking', 'other'), allowNull: false, defaultValue: 'other' },
      status:      { type: Sequelize.ENUM('upcoming', 'completed', 'cancelled'), allowNull: false, defaultValue: 'upcoming' },
      created_by:  { type: Sequelize.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
      created_at:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('alumni_events', ['school_id', 'event_date'], { name: 'idx_alumni_events_school_date' });
  },
  async down(queryInterface) { await queryInterface.dropTable('alumni_events'); },
};
