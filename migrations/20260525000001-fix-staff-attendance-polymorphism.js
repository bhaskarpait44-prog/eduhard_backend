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
  },

  async down(queryInterface, Sequelize) {
    // Standard cleanup
    await queryInterface.removeIndex('staff_attendance', 'idx_staff_attendance_teacher_date_unique');
    await queryInterface.removeColumn('staff_attendance', 'teacher_id');
  }
};
