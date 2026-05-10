'use strict';

/**
 * Migration: create_student_profiles
 *
 * Implements Slowly Changing Dimension Type 2 (SCD-2) versioning.
 * Every profile change creates a NEW row rather than overwriting.
 * This gives a complete, queryable history of every profile state.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('student_profiles', {
      id: {
        type          : Sequelize.INTEGER,
        autoIncrement : true,
        primaryKey    : true,
        allowNull     : false,
      },

      student_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        references : { model: 'students', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'RESTRICT',
        comment    : 'FK to students — many profile versions per student',
      },

      // ── Contact & Address ──────────────────────────────────────────────
      address: {
        type      : Sequelize.TEXT,
        allowNull : true,
      },
      city: {
        type      : Sequelize.STRING(100),
        allowNull : true,
      },
      state: {
        type      : Sequelize.STRING(100),
        allowNull : true,
      },
      pincode: {
        type      : Sequelize.STRING(10),
        allowNull : true,
      },
      phone: {
        type      : Sequelize.STRING(20),
        allowNull : true,
        comment   : 'Student or family primary contact number',
      },
      email: {
        type      : Sequelize.STRING(150),
        allowNull : true,
      },

      // ── Father ────────────────────────────────────────────────────────
      father_name: {
        type      : Sequelize.STRING(150),
        allowNull : true,
      },
      father_phone: {
        type      : Sequelize.STRING(20),
        allowNull : true,
      },
      father_occupation: {
        type      : Sequelize.STRING(150),
        allowNull : true,
      },

      // ── Mother ────────────────────────────────────────────────────────
      mother_name: {
        type      : Sequelize.STRING(150),
        allowNull : true,
      },
      mother_phone: {
        type      : Sequelize.STRING(20),
        allowNull : true,
      },
      mother_email: {
        type      : Sequelize.STRING(150),
        allowNull : true,
      },

      // ── Emergency & Medical ───────────────────────────────────────────
      emergency_contact: {
        type      : Sequelize.STRING(20),
        allowNull : true,
        comment   : 'Phone number to call in an emergency',
      },
      blood_group: {
        type      : Sequelize.ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown'),
        allowNull : true,
      },
      medical_notes: {
        type      : Sequelize.TEXT,
        allowNull : true,
        comment   : 'Allergies, chronic conditions, medication — visible to staff',
      },

      // ── Photo ─────────────────────────────────────────────────────────
      photo_path: {
        type      : Sequelize.STRING(500),
        allowNull : true,
        comment   : 'Relative path or object-storage key (e.g. uploads/students/42.jpg)',
      },

      // ── SCD-2 Versioning Columns ──────────────────────────────────────
      valid_from: {
        type      : Sequelize.DATEONLY,
        allowNull : false,
        comment   : 'Date this version became active',
      },
      valid_to: {
        type      : Sequelize.DATEONLY,
        allowNull : true,
        comment   : 'Date this version was superseded. NULL = still current.',
      },
      is_current: {
        type         : Sequelize.BOOLEAN,
        allowNull    : false,
        defaultValue : true,
        comment      : 'Denormalized shortcut — always matches (valid_to IS NULL)',
      },

      // ── Change Tracking ───────────────────────────────────────────────
      changed_by: {
        type      : Sequelize.INTEGER,
        allowNull : true,
        references : { model: 'users', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'SET NULL',
        comment    : 'FK to users.id — who created this version',
      },
      change_reason: {
        type      : Sequelize.STRING(500),
        allowNull : true,
        comment   : 'Why this version was created (min 10 chars enforced in app layer)',
      },

      created_at: {
        type         : Sequelize.DATE,
        allowNull    : false,
        defaultValue : Sequelize.literal('CURRENT_TIMESTAMP'),
        comment      : 'When this version row was inserted — immutable',
      },
    });

    // ── Indexes ────────────────────────────────────────────────────────────

    // Most common query: "get current profile for student X"
    await queryInterface.addIndex('student_profiles', ['student_id', 'is_current'], {
      name: 'idx_profiles_student_current',
    });

    // Point-in-time query: "what did this profile look like on date D?"
    await queryInterface.addIndex('student_profiles', ['student_id', 'valid_from', 'valid_to'], {
      name: 'idx_profiles_student_validity',
    });

    // Enforce: only ONE is_current=true row per student at any time
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX idx_profiles_one_current_per_student
      ON student_profiles (student_id)
      WHERE is_current = true;
    `);

    // ── DB-level immutability trigger ─────────────────────────────────────
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION fn_student_profiles_guard()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION
            'student_profiles rows cannot be deleted. Record id=% is permanent history.',
            OLD.id
            USING ERRCODE = 'restrict_violation';
        END IF;

        IF TG_OP = 'UPDATE' THEN
          IF OLD.address           IS DISTINCT FROM NEW.address           OR
             OLD.city              IS DISTINCT FROM NEW.city              OR
             OLD.state             IS DISTINCT FROM NEW.state             OR
             OLD.pincode           IS DISTINCT FROM NEW.pincode           OR
             OLD.phone             IS DISTINCT FROM NEW.phone             OR
             OLD.email             IS DISTINCT FROM NEW.email             OR
             OLD.father_name       IS DISTINCT FROM NEW.father_name       OR
             OLD.father_phone      IS DISTINCT FROM NEW.father_phone      OR
             OLD.father_occupation IS DISTINCT FROM NEW.father_occupation OR
             OLD.mother_name       IS DISTINCT FROM NEW.mother_name       OR
             OLD.mother_phone      IS DISTINCT FROM NEW.mother_phone      OR
             OLD.mother_email      IS DISTINCT FROM NEW.mother_email      OR
             OLD.emergency_contact IS DISTINCT FROM NEW.emergency_contact OR
             OLD.blood_group       IS DISTINCT FROM NEW.blood_group       OR
             OLD.medical_notes     IS DISTINCT FROM NEW.medical_notes     OR
             OLD.photo_path        IS DISTINCT FROM NEW.photo_path        OR
             OLD.valid_from        IS DISTINCT FROM NEW.valid_from        OR
             OLD.student_id        IS DISTINCT FROM NEW.student_id        OR
             OLD.changed_by        IS DISTINCT FROM NEW.changed_by        OR
             OLD.change_reason     IS DISTINCT FROM NEW.change_reason     OR
             OLD.created_at        IS DISTINCT FROM NEW.created_at
          THEN
            RAISE EXCEPTION
              'student_profiles data columns are immutable. Create a new version instead. (record id=%)',
              OLD.id
              USING ERRCODE = 'restrict_violation';
          END IF;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_student_profiles_guard
      BEFORE UPDATE OR DELETE ON student_profiles
      FOR EACH ROW EXECUTE FUNCTION fn_student_profiles_guard();
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_student_profiles_guard ON student_profiles;`);
    await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS fn_student_profiles_guard;`);
    await queryInterface.dropTable('student_profiles');
  },
};
