'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('certificates', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      certificate_no: {
        type: Sequelize.STRING,
        unique: true,
      },
      school_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'schools', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: {
        type: Sequelize.ENUM('transfer', 'bonafide', 'character', 'migration', 'marksheet', 'sports', 'study', 'experience'),
        allowNull: false,
      },
      recipient_type: {
        type: Sequelize.ENUM('student', 'staff'),
        defaultValue: 'student',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'teachers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      issued_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      issued_date: {
        type: Sequelize.DATEONLY,
        defaultValue: Sequelize.NOW,
      },
      extra_data: {
        type: Sequelize.JSON,
      },
      status: {
        type: Sequelize.ENUM('active', 'revoked'),
        defaultValue: 'active',
      },
      pdf_path: {
        type: Sequelize.STRING,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('certificates');
  },
};
