'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_logs', {
      id: {
        type          : Sequelize.BIGINT,
        autoIncrement : true,
        primaryKey    : true,
        allowNull     : false,
      },
      table_name: {
        type      : Sequelize.STRING(100),
        allowNull : false,
        comment   : 'Which table was changed (e.g. "students")',
      },
      record_id: {
        type      : Sequelize.INTEGER,
        allowNull : false,
        comment   : 'PK of the changed row in table_name',
      },
      field_name: {
        type      : Sequelize.STRING(100),
        allowNull : false,
        comment   : 'Which column was changed',
      },
      old_value: {
        type      : Sequelize.TEXT,
        allowNull : true,
        comment   : 'Serialized previous value (null for INSERT)',
      },
      new_value: {
        type      : Sequelize.TEXT,
        allowNull : true,
        comment   : 'Serialized new value (null for DELETE)',
      },
      changed_by: {
        type      : Sequelize.INTEGER,
        allowNull : true,
        comment   : 'FK to users.id',
      },
      reason: {
        type      : Sequelize.STRING(500),
        allowNull : true,
        comment   : 'Why the change was made',
      },
      ip_address: {
        type      : Sequelize.STRING(45),
        allowNull : true,
      },
      device_info: {
        type      : Sequelize.STRING(300),
        allowNull : true,
        comment   : 'User-Agent or device identifier from request headers',
      },
      created_at: {
        type         : Sequelize.DATE,
        allowNull    : false,
        defaultValue : Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('audit_logs', ['table_name', 'record_id'], {
      name: 'idx_audit_table_record',
    });

    await queryInterface.addIndex('audit_logs', ['changed_by', 'created_at'], {
      name: 'idx_audit_user_time',
    });

    // Immutability trigger
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION fn_audit_logs_immutable()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION
          'audit_logs is immutable. UPDATE and DELETE are not permitted. (operation: %, id: %)',
          TG_OP, OLD.id
          USING ERRCODE = 'restrict_violation';
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_audit_logs_immutable
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_immutable();
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;`
    );
    await queryInterface.sequelize.query(
      `DROP FUNCTION IF EXISTS fn_audit_logs_immutable;`
    );
    await queryInterface.dropTable('audit_logs');
  },
};
