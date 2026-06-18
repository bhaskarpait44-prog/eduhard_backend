'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('academic_events', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      school_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'schools',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'sessions',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      event_type: {
        type: Sequelize.ENUM('exam', 'holiday', 'fee_deadline', 'meeting', 'sports', 'cultural', 'result', 'other'),
        allowNull: false
      },
      start_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      end_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      start_time: {
        type: Sequelize.TIME,
        allowNull: true
      },
      end_time: {
        type: Sequelize.TIME,
        allowNull: true
      },
      is_all_day: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      audience: {
        type: Sequelize.ENUM('everyone', 'students', 'teachers', 'parents', 'staff'),
        allowNull: false,
        defaultValue: 'everyone'
      },
      target_class_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'classes',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      color: {
        type: Sequelize.STRING(7),
        allowNull: true
      },
      is_published: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      notify_on_publish: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      updated_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('academic_events', ['school_id', 'session_id']);
    await queryInterface.addIndex('academic_events', ['school_id', 'start_date', 'end_date']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('academic_events');
    // Types (Enums) are usually not dropped automatically in some dialects (like Postgres)
    // but Sequelize CLI handles it if defined correctly. 
    // However, if we want to be explicit:
    // await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_academic_events_event_type";');
    // await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_academic_events_audience";');
  }
};
