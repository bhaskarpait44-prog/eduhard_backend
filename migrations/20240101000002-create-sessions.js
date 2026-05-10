'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sessions', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      school_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'schools', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      name: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      start_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('upcoming', 'active', 'locked', 'closed', 'archived'),
        allowNull: false,
        defaultValue: 'upcoming',
      },
      is_current: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('sessions', ['school_id', 'status'], {
      name: 'idx_sessions_school_status',
    });

    await queryInterface.addIndex('sessions', ['school_id'], {
      name: 'idx_sessions_school_id',
    });

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX idx_sessions_one_current_per_school
      ON sessions (school_id)
      WHERE is_current = true;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sessions');
  },
};
