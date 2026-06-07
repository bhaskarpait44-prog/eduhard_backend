'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION fn_students_audit()
      RETURNS TRIGGER AS $$
      DECLARE
        v_changed_by  INTEGER;
        v_reason      TEXT;
        v_ip          TEXT;
        v_device      TEXT;
      BEGIN
        BEGIN
          v_changed_by := current_setting('app.changed_by', true)::INTEGER;
        EXCEPTION WHEN OTHERS THEN
          v_changed_by := NULL;
        END;

        BEGIN
          v_reason := current_setting('app.change_reason', true);
        EXCEPTION WHEN OTHERS THEN
          v_reason := NULL;
        END;

        BEGIN
          v_ip := current_setting('app.ip_address', true);
        EXCEPTION WHEN OTHERS THEN
          v_ip := NULL;
        END;

        BEGIN
          v_device := current_setting('app.device_info', true);
        EXCEPTION WHEN OTHERS THEN
          v_device := NULL;
        END;

        IF OLD.first_name IS DISTINCT FROM NEW.first_name THEN
          INSERT INTO audit_logs
            (table_name, record_id, school_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, NEW.school_id, 'first_name', OLD.first_name, NEW.first_name,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.last_name IS DISTINCT FROM NEW.last_name THEN
          INSERT INTO audit_logs
            (table_name, record_id, school_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, NEW.school_id, 'last_name', OLD.last_name, NEW.last_name,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.date_of_birth IS DISTINCT FROM NEW.date_of_birth THEN
          INSERT INTO audit_logs
            (table_name, record_id, school_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, NEW.school_id, 'date_of_birth',
             OLD.date_of_birth::TEXT, NEW.date_of_birth::TEXT,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.gender IS DISTINCT FROM NEW.gender THEN
          INSERT INTO audit_logs
            (table_name, record_id, school_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, NEW.school_id, 'gender', OLD.gender::TEXT, NEW.gender::TEXT,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.admission_no IS DISTINCT FROM NEW.admission_no THEN
          INSERT INTO audit_logs
            (table_name, record_id, school_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, NEW.school_id, 'admission_no', OLD.admission_no, NEW.admission_no,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.is_deleted IS DISTINCT FROM NEW.is_deleted THEN
          INSERT INTO audit_logs
            (table_name, record_id, school_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, NEW.school_id, 'is_deleted',
             OLD.is_deleted::TEXT, NEW.is_deleted::TEXT,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
          INSERT INTO audit_logs
            (table_name, record_id, school_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, NEW.school_id, 'is_active',
             OLD.is_active::TEXT, NEW.is_active::TEXT,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  },

  async down(queryInterface) {
    // Revert to original (no school_id in insert)
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION fn_students_audit()
      RETURNS TRIGGER AS $$
      DECLARE
        v_changed_by  INTEGER;
        v_reason      TEXT;
        v_ip          TEXT;
        v_device      TEXT;
      BEGIN
        BEGIN
          v_changed_by := current_setting('app.changed_by', true)::INTEGER;
        EXCEPTION WHEN OTHERS THEN
          v_changed_by := NULL;
        END;

        BEGIN
          v_reason := current_setting('app.change_reason', true);
        EXCEPTION WHEN OTHERS THEN
          v_reason := NULL;
        END;

        BEGIN
          v_ip := current_setting('app.ip_address', true);
        EXCEPTION WHEN OTHERS THEN
          v_ip := NULL;
        END;

        BEGIN
          v_device := current_setting('app.device_info', true);
        EXCEPTION WHEN OTHERS THEN
          v_device := NULL;
        END;

        IF OLD.first_name IS DISTINCT FROM NEW.first_name THEN
          INSERT INTO audit_logs
            (table_name, record_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, 'first_name', OLD.first_name, NEW.first_name,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.last_name IS DISTINCT FROM NEW.last_name THEN
          INSERT INTO audit_logs
            (table_name, record_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, 'last_name', OLD.last_name, NEW.last_name,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.date_of_birth IS DISTINCT FROM NEW.date_of_birth THEN
          INSERT INTO audit_logs
            (table_name, record_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, 'date_of_birth',
             OLD.date_of_birth::TEXT, NEW.date_of_birth::TEXT,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.gender IS DISTINCT FROM NEW.gender THEN
          INSERT INTO audit_logs
            (table_name, record_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, 'gender', OLD.gender::TEXT, NEW.gender::TEXT,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.admission_no IS DISTINCT FROM NEW.admission_no THEN
          INSERT INTO audit_logs
            (table_name, record_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, 'admission_no', OLD.admission_no, NEW.admission_no,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.is_deleted IS DISTINCT FROM NEW.is_deleted THEN
          INSERT INTO audit_logs
            (table_name, record_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, 'is_deleted',
             OLD.is_deleted::TEXT, NEW.is_deleted::TEXT,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
          INSERT INTO audit_logs
            (table_name, record_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('students', NEW.id, 'is_active',
             OLD.is_active::TEXT, NEW.is_active::TEXT,
             v_changed_by, v_reason, v_ip, v_device, NOW());
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  },
};
