'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Add guardian_email column to student_profiles
    await queryInterface.addColumn('student_profiles', 'guardian_email', {
      type: Sequelize.STRING(150),
      allowNull: true
    });

    // 2. Update Postgres trigger function fn_student_profiles_guard
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
             OLD.mother_occupation IS DISTINCT FROM NEW.mother_occupation OR
             OLD.parent_email      IS DISTINCT FROM NEW.parent_email      OR
             OLD.emergency_contact IS DISTINCT FROM NEW.emergency_contact OR
             OLD.blood_group       IS DISTINCT FROM NEW.blood_group       OR
             OLD.medical_notes     IS DISTINCT FROM NEW.medical_notes     OR
             OLD.photo_path        IS DISTINCT FROM NEW.photo_path        OR
             OLD.valid_from        IS DISTINCT FROM NEW.valid_from        OR
             OLD.student_id        IS DISTINCT FROM NEW.student_id        OR
             OLD.changed_by        IS DISTINCT FROM NEW.changed_by        OR
             OLD.change_reason     IS DISTINCT FROM NEW.change_reason     OR
             OLD.created_at        IS DISTINCT FROM NEW.created_at        OR
             OLD.village           IS DISTINCT FROM NEW.village           OR
             OLD.police_station    IS DISTINCT FROM NEW.police_station    OR
             OLD.post_office       IS DISTINCT FROM NEW.post_office       OR
             OLD.district          IS DISTINCT FROM NEW.district          OR
             OLD.nationality       IS DISTINCT FROM NEW.nationality       OR
             OLD.religion          IS DISTINCT FROM NEW.religion          OR
             OLD.caste             IS DISTINCT FROM NEW.caste             OR
             OLD.mother_tongue     IS DISTINCT FROM NEW.mother_tongue     OR
             OLD.identification_marks IS DISTINCT FROM NEW.identification_marks OR
             OLD.is_hostel         IS DISTINCT FROM NEW.is_hostel         OR
             OLD.medium            IS DISTINCT FROM NEW.medium            OR
             OLD.pen_no            IS DISTINCT FROM NEW.pen_no            OR
             OLD.apaar_id          IS DISTINCT FROM NEW.apaar_id          OR
             OLD.prev_attendance_days IS DISTINCT FROM NEW.prev_attendance_days OR
             OLD.distance_km       IS DISTINCT FROM NEW.distance_km       OR
             OLD.father_qualification IS DISTINCT FROM NEW.father_qualification OR
             OLD.father_aadhar     IS DISTINCT FROM NEW.father_aadhar     OR
             OLD.father_annual_income IS DISTINCT FROM NEW.father_annual_income OR
             OLD.mother_qualification IS DISTINCT FROM NEW.mother_qualification OR
             OLD.mother_aadhar     IS DISTINCT FROM NEW.mother_aadhar     OR
             OLD.mother_annual_income IS DISTINCT FROM NEW.mother_annual_income OR
             OLD.guardian_name     IS DISTINCT FROM NEW.guardian_name     OR
             OLD.guardian_relation  IS DISTINCT FROM NEW.guardian_relation  OR
             OLD.guardian_phone     IS DISTINCT FROM NEW.guardian_phone     OR
             OLD.guardian_occupation IS DISTINCT FROM NEW.guardian_occupation OR
             OLD.guardian_qualification IS DISTINCT FROM NEW.guardian_qualification OR
             OLD.guardian_aadhar    IS DISTINCT FROM NEW.guardian_aadhar    OR
             OLD.guardian_email     IS DISTINCT FROM NEW.guardian_email     OR
             OLD.is_permanent_same  IS DISTINCT FROM NEW.is_permanent_same  OR
             OLD.perm_address       IS DISTINCT FROM NEW.perm_address       OR
             OLD.perm_village       IS DISTINCT FROM NEW.perm_village       OR
             OLD.perm_police_station IS DISTINCT FROM NEW.perm_police_station OR
             OLD.perm_post_office   IS DISTINCT FROM NEW.perm_post_office   OR
             OLD.perm_district      IS DISTINCT FROM NEW.perm_district      OR
             OLD.perm_city          IS DISTINCT FROM NEW.perm_city          OR
             OLD.perm_state         IS DISTINCT FROM NEW.perm_state         OR
             OLD.perm_pincode       IS DISTINCT FROM NEW.perm_pincode
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
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('student_profiles', 'guardian_email');
  }
};
