'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('student_achievements', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      achievement_type: {
        type: Sequelize.ENUM(
          'perfect_attendance',
          'top_performer',
          'improvement',
          'attendance_streak',
          'homework_streak'
        ),
        allowNull: false,
      },
      earned_for: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      earned_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
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

    await queryInterface.addIndex('student_achievements', ['student_id', 'session_id', 'earned_at'], {
      name: 'idx_student_achievements_student_session_earned',
    });

    await queryInterface.addIndex(
      'student_achievements',
      ['student_id', 'achievement_type', 'session_id', 'earned_for'],
      {
        name: 'idx_student_achievements_unique_scope',
        unique: true,
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('student_achievements');
  },
};
