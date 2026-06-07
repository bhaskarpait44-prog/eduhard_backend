'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Add Aadhar to Students (Primary Identifier)
    await queryInterface.addColumn('students', 'aadhar_no', {
      type: Sequelize.STRING(20),
      allowNull: true,
      unique: false // Not unique because multiple students might share (rare/error case) or be null
    });

    // 2. Expand Student Profiles (Versioned Data)
    const profileColumns = {
      village: { type: Sequelize.STRING(150), allowNull: true },
      police_station: { type: Sequelize.STRING(150), allowNull: true },
      post_office: { type: Sequelize.STRING(150), allowNull: true },
      district: { type: Sequelize.STRING(100), allowNull: true },
      whatsapp_no: { type: Sequelize.STRING(20), allowNull: true },
      nationality: { type: Sequelize.STRING(50), allowNull: true, defaultValue: 'Indian' },
      religion: { type: Sequelize.STRING(50), allowNull: true },
      caste: { type: Sequelize.ENUM('OBC', 'ST', 'SC', 'Gen'), allowNull: true },
      mother_tongue: { type: Sequelize.STRING(50), allowNull: true },
      identification_marks: { type: Sequelize.TEXT, allowNull: true },
      is_hostel: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false },
      medium: { type: Sequelize.ENUM('English', 'Assamese'), allowNull: true },
      pen_no: { type: Sequelize.STRING(50), allowNull: true },
      apaar_id: { type: Sequelize.STRING(50), allowNull: true },
      prev_attendance_days: { type: Sequelize.INTEGER, allowNull: true },
      distance_km: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      
      // Expanded Parent/Guardian info
      father_qualification: { type: Sequelize.STRING(150), allowNull: true },
      father_aadhar: { type: Sequelize.STRING(20), allowNull: true },
      father_annual_income: { type: Sequelize.STRING(50), allowNull: true },
      
      mother_qualification: { type: Sequelize.STRING(150), allowNull: true },
      mother_aadhar: { type: Sequelize.STRING(20), allowNull: true },
      mother_annual_income: { type: Sequelize.STRING(50), allowNull: true },
      
      guardian_name: { type: Sequelize.STRING(150), allowNull: true },
      guardian_relation: { type: Sequelize.STRING(50), allowNull: true },
      guardian_phone: { type: Sequelize.STRING(20), allowNull: true },
      guardian_occupation: { type: Sequelize.STRING(150), allowNull: true },
      guardian_qualification: { type: Sequelize.STRING(150), allowNull: true },
      guardian_aadhar: { type: Sequelize.STRING(20), allowNull: true },
      guardian_annual_income: { type: Sequelize.STRING(50), allowNull: true }
    };

    for (const [col, spec] of Object.entries(profileColumns)) {
      await queryInterface.addColumn('student_profiles', col, spec);
    }

    // 3. Create Previous Academic Records Table
    await queryInterface.createTable('student_previous_academic_records', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      school_name: { type: Sequelize.STRING(255), allowNull: false },
      location: { type: Sequelize.STRING(255), allowNull: true },
      class_name: { type: Sequelize.STRING(50), allowNull: false },
      year_of_study: { type: Sequelize.STRING(20), allowNull: true },
      percentage_grade: { type: Sequelize.STRING(50), allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE },
      updated_at: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.addIndex('student_previous_academic_records', ['student_id']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('student_previous_academic_records');
    
    const profileCols = [
      'village', 'police_station', 'post_office', 'district', 'whatsapp_no',
      'nationality', 'religion', 'caste', 'mother_tongue', 'identification_marks',
      'is_hostel', 'medium', 'pen_no', 'apaar_id', 'prev_attendance_days', 'distance_km',
      'father_qualification', 'father_aadhar', 'father_annual_income',
      'mother_qualification', 'mother_aadhar', 'mother_annual_income',
      'guardian_name', 'guardian_relation', 'guardian_phone', 'guardian_occupation',
      'guardian_qualification', 'guardian_aadhar', 'guardian_annual_income'
    ];

    for (const col of profileCols) {
      await queryInterface.removeColumn('student_profiles', col);
    }

    await queryInterface.removeColumn('students', 'aadhar_no');
    
    // Note: We might need to drop the ENUM types manually depending on the DB (Postgres specifically)
    // await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_student_profiles_caste";');
    // await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_student_profiles_medium";');
  }
};
