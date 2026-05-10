'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('timetable_slots', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      class_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'classes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      section_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sections', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teachers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'subjects', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      day_of_week: {
        type: Sequelize.ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'),
        allowNull: false,
      },
      period_number: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      start_time: {
        type: Sequelize.TIME,
        allowNull: false,
      },
      end_time: {
        type: Sequelize.TIME,
        allowNull: false,
      },
      room_number: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('timetable_slots', ['teacher_id', 'day_of_week', 'is_active'], {
      name: 'idx_timetable_slots_teacher_day_active',
    });

    await queryInterface.addIndex('timetable_slots', ['class_id', 'section_id', 'day_of_week', 'period_number'], {
      name: 'idx_timetable_slots_class_section_day_period',
      unique: true,
    });

    await queryInterface.addIndex('timetable_slots', ['session_id', 'teacher_id', 'day_of_week', 'period_number'], {
      name: 'idx_timetable_slots_session_teacher_day_period',
      unique: true,
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE timetable_slots
      ADD CONSTRAINT chk_timetable_slots_period_positive
      CHECK (period_number >= 1);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE timetable_slots
      ADD CONSTRAINT chk_timetable_slots_time_range
      CHECK (end_time > start_time);
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('timetable_slots');
  },
};
