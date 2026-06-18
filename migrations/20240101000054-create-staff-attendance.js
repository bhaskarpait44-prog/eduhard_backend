'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('staff_attendance', {
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
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'teachers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('present', 'absent', 'late', 'half_day', 'leave'),
        allowNull: false,
        defaultValue: 'present',
      },
      remarks: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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

    await queryInterface.addIndex('staff_attendance', ['school_id', 'date']);
    
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.addIndex('staff_attendance', ['user_id', 'date'], {
        unique: true,
        name: 'idx_staff_attendance_user_date_unique',
        where: { user_id: { [Sequelize.Op.ne]: null } }
      });

      await queryInterface.addIndex('staff_attendance', ['teacher_id', 'date'], {
        unique: true,
        name: 'idx_staff_attendance_teacher_date_unique',
        where: { teacher_id: { [Sequelize.Op.ne]: null } }
      });
    } else {
      await queryInterface.addIndex('staff_attendance', ['user_id', 'date'], {
        unique: true,
        name: 'idx_staff_attendance_user_date_unique'
      });

      await queryInterface.addIndex('staff_attendance', ['teacher_id', 'date'], {
        unique: true,
        name: 'idx_staff_attendance_teacher_date_unique'
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('staff_attendance');
  },
};
