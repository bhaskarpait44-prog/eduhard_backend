'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('chat_conversations', {
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
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      enrollment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'enrollments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'subjects', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      is_class_teacher_chat: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      last_message_at: {
        type: Sequelize.DATE,
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

    await queryInterface.createTable('chat_messages', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      conversation_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'chat_conversations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      sender_role: {
        type: Sequelize.ENUM('teacher', 'student'),
        allowNull: false,
      },
      sender_teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'teachers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      sender_student_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      message_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('chat_conversations', ['teacher_id', 'last_message_at'], {
      name: 'idx_chat_conversations_teacher_last_message',
    });

    await queryInterface.addIndex('chat_conversations', ['student_id', 'last_message_at'], {
      name: 'idx_chat_conversations_student_last_message',
    });

    await queryInterface.addIndex('chat_conversations', ['enrollment_id', 'teacher_id', 'subject_id'], {
      name: 'idx_chat_conversations_enrollment_teacher_subject',
    });

    await queryInterface.addIndex('chat_messages', ['conversation_id', 'created_at'], {
      name: 'idx_chat_messages_conversation_created',
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE chat_messages
      ADD CONSTRAINT chk_chat_messages_sender_consistency
      CHECK (
        (sender_role = 'teacher' AND sender_teacher_id IS NOT NULL AND sender_student_id IS NULL)
        OR
        (sender_role = 'student' AND sender_student_id IS NOT NULL AND sender_teacher_id IS NULL)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE chat_messages
      DROP CONSTRAINT IF EXISTS chk_chat_messages_sender_consistency;
    `);
    await queryInterface.dropTable('chat_messages');
    await queryInterface.dropTable('chat_conversations');
  },
};
