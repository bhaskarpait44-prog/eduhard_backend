'use strict';

/**
 * Migration: fix_payroll_foreign_keys
 * 
 * Removes the foreign key constraints on user_id in salary_structures and payrolls tables.
 * Adds teacher_id columns to properly distinguish between users and teachers.
 */

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

    // 1. Drop old constraints/indexes from salary_structures
    await safeDropConstraint('salary_structures', 'salary_structures_user_id_fkey');
    await safeDropConstraint('salary_structures', 'salary_structures_user_id_key');
    await safeDropConstraint('salary_structures', 'salary_structures_user_id_school_id_key');
    await safeRemoveIndex('salary_structures', 'idx_salary_structures_user');
    await safeRemoveIndex('salary_structures', 'idx_salary_structures_teacher');

    // 2. Drop old constraints/indexes from payrolls
    await safeDropConstraint('payrolls', 'payrolls_user_id_fkey');
    await safeRemoveIndex('payrolls', 'idx_payrolls_user_month_year');
    await safeRemoveIndex('payrolls', 'idx_payrolls_user');
    await safeRemoveIndex('payrolls', 'idx_payrolls_teacher');

    // 3. Columns (should already exist but let's be safe)
    await queryInterface.changeColumn('salary_structures', 'user_id', { type: Sequelize.INTEGER, allowNull: true }).catch(() => {});
    await queryInterface.addColumn('salary_structures', 'teacher_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'teachers', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }).catch(() => {});

    await queryInterface.changeColumn('payrolls', 'user_id', { type: Sequelize.INTEGER, allowNull: true }).catch(() => {});
    await queryInterface.addColumn('payrolls', 'teacher_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'teachers', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }).catch(() => {});

    // 4. Create standard unique indexes (NO WHERE CLAUSE)
    // These will work for ON CONFLICT (col1, col2, ...)
    await queryInterface.addIndex('salary_structures', ['school_id', 'user_id'], {
      unique: true,
      name: 'idx_salary_structures_user'
    });
    await queryInterface.addIndex('salary_structures', ['school_id', 'teacher_id'], {
      unique: true,
      name: 'idx_salary_structures_teacher'
    });

    await queryInterface.addIndex('payrolls', ['user_id', 'month', 'year'], {
      unique: true,
      name: 'idx_payrolls_user'
    });
    await queryInterface.addIndex('payrolls', ['teacher_id', 'month', 'year'], {
      unique: true,
      name: 'idx_payrolls_teacher'
    });
  },

  async down(queryInterface, Sequelize) {
    // down migration logic here if needed
  }
};
