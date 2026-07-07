'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const safeDropConstraint = async (table, constraint) => {
      try {
        await queryInterface.removeConstraint(table, constraint);
      } catch (e) {
        console.log(`Skipping: Constraint ${constraint} on ${table} not found.`);
      }
    };

    const safeRemoveIndex = async (table, index) => {
      try {
        await queryInterface.removeIndex(table, index);
      } catch (e) {
        console.log(`Skipping: Index ${index} on ${table} not found.`);
      }
    };

    const safeAddIndex = async (table, fields, options) => {
      try {
        await queryInterface.addIndex(table, fields, options);
      } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
          throw e;
        } else {
          console.log(`Skipping: Index ${options.name} on ${table} already exists.`);
        }
      }
    };

    // 1. Remove old unique constraint that caused collisions
    await safeRemoveIndex('staff_attendance', 'idx_staff_attendance_user_date_unique');
    await safeDropConstraint('staff_attendance', 'idx_staff_attendance_user_date_unique');

    // 2. Make user_id nullable and add teacher_id
    await queryInterface.changeColumn('staff_attendance', 'user_id', {
      type: Sequelize.INTEGER,
      allowNull: true
    });

    await queryInterface.addColumn('staff_attendance', 'teacher_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'teachers', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }).catch(e => console.log('teacher_id might already exist in staff_attendance'));

    // 3. Create new non-colliding unique indexes
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await safeAddIndex('staff_attendance', ['user_id', 'date'], {
        unique: true,
        name: 'idx_staff_attendance_user_date_unique',
        where: { user_id: { [Sequelize.Op.ne]: null } }
      });

      await safeAddIndex('staff_attendance', ['teacher_id', 'date'], {
        unique: true,
        name: 'idx_staff_attendance_teacher_date_unique',
        where: { teacher_id: { [Sequelize.Op.ne]: null } }
      });
    } else {
      // For non-postgres dialects, we add regular indexes. 
      // Note: This won't prevent collisions if both user_id and teacher_id are null,
      // but those fields are usually populated in this application's logic.
      await safeAddIndex('staff_attendance', ['user_id', 'date'], {
        unique: true,
        name: 'idx_staff_attendance_user_date_unique'
      });

      await safeAddIndex('staff_attendance', ['teacher_id', 'date'], {
        unique: true,
        name: 'idx_staff_attendance_teacher_date_unique'
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // Standard cleanup
    await queryInterface.removeIndex('staff_attendance', 'idx_staff_attendance_teacher_date_unique');
    await queryInterface.removeColumn('staff_attendance', 'teacher_id');
  }
};
