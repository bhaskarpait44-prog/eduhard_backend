'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Teacher notice reads
    await queryInterface.createTable('teacher_notice_reads', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      notice_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teacher_notices', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('teacher_notice_reads', ['notice_id', 'user_id'], {
      name: 'idx_teacher_notice_reads_notice_user',
      unique: true,
    });

    // Student notice reads
    await queryInterface.createTable('student_notice_reads', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      notice_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teacher_notices', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('student_notice_reads', ['notice_id', 'student_id'], {
      name: 'idx_student_notice_reads_notice_student',
      unique: true,
    });

    // Notice pins
    await queryInterface.createTable('notice_pins', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      notice_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teacher_notices', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      pinned_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
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

    await queryInterface.addIndex('notice_pins', ['notice_id', 'student_id'], {
      name: 'idx_notice_pins_notice_student',
      unique: true,
    });

    await queryInterface.addIndex('notice_pins', ['student_id', 'pinned_at'], {
      name: 'idx_notice_pins_student_pinned_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notice_pins');
    await queryInterface.dropTable('student_notice_reads');
    await queryInterface.dropTable('teacher_notice_reads');
  },
};
