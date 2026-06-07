'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('audit_logs');
    if (!tableInfo.school_id) {
      await queryInterface.addColumn('audit_logs', 'school_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'schools', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }

    // Disable immutability trigger for backfill
    await queryInterface.sequelize.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable;`);

    // Attempt to backfill school_id from users table where possible
    await queryInterface.sequelize.query(`
      UPDATE audit_logs al
      SET school_id = u.school_id
      FROM users u
      WHERE al.changed_by = u.id AND al.school_id IS NULL;
    `);

    // Re-enable trigger
    await queryInterface.sequelize.query(`ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable;`);

    // Add index for performance
    await queryInterface.addIndex('audit_logs', ['school_id', 'created_at'], {
      name: 'idx_audit_logs_school_time',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('audit_logs', 'idx_audit_logs_school_time');
    await queryInterface.removeColumn('audit_logs', 'school_id');
  },
};
