'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
        constraint_name text;
      BEGIN
        FOR constraint_name IN
          SELECT tc.constraint_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name
           AND kcu.table_schema = tc.table_schema
           AND kcu.table_name = tc.table_name
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = current_schema()
            AND tc.table_name = 'notices'
            AND kcu.column_name = 'posted_by_user_id'
            AND ccu.table_name = 'users'
        LOOP
          EXECUTE format('ALTER TABLE notices DROP CONSTRAINT IF EXISTS %I', constraint_name);
        END LOOP;
      END $$;
    `);
  },

  async down() {
    // Intentionally left empty. Re-adding the original FK would break teacher notices,
    // because teacher posters are stored with teachers.id, not users.id.
  },
};
