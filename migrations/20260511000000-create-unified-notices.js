'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notices', {
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
        onDelete: 'CASCADE',
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      posted_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      posted_by_role: {
        type: Sequelize.ENUM('admin', 'teacher', 'accountant'),
        allowNull: false,
      },
      audience: {
        type: Sequelize.ENUM('school_wide', 'class', 'section', 'student'),
        allowNull: false,
      },
      target_class_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'classes', key: 'id' },
        onDelete: 'CASCADE',
      },
      target_section_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'sections', key: 'id' },
        onDelete: 'CASCADE',
      },
      target_student_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'students', key: 'id' },
        onDelete: 'CASCADE',
      },
      priority: {
        type: Sequelize.ENUM('normal', 'urgent', 'info'),
        allowNull: false,
        defaultValue: 'normal',
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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

    await queryInterface.addIndex('notices', ['school_id']);
    await queryInterface.addIndex('notices', ['audience']);
    await queryInterface.addIndex('notices', ['target_class_id']);
    await queryInterface.addIndex('notices', ['target_section_id']);
    await queryInterface.addIndex('notices', ['target_student_id']);

    await queryInterface.createTable('notice_reads', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      notice_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'notices', key: 'id' },
        onDelete: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'students', key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addConstraint('notice_reads', {
      fields: ['notice_id', 'student_id'],
      type: 'unique',
      name: 'notice_reads_notice_student_unique'
    });
    await queryInterface.addConstraint('notice_reads', {
      fields: ['notice_id', 'user_id'],
      type: 'unique',
      name: 'notice_reads_notice_user_unique'
    });

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
        references: { model: 'notices', key: 'id' },
        onDelete: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'id' },
        onDelete: 'CASCADE',
      },
      pinned_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addConstraint('notice_pins', {
      fields: ['notice_id', 'student_id'],
      type: 'unique',
      name: 'notice_pins_notice_student_unique'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notice_pins');
    await queryInterface.dropTable('notice_reads');
    await queryInterface.dropTable('notices');
  },
};
