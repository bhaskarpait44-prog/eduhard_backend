'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('alumni_profiles', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      school_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'schools', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      // Current career
      current_occupation:     { type: Sequelize.ENUM('employed', 'self_employed', 'higher_studies', 'unemployed', 'other'), allowNull: true },
      company_or_institution: { type: Sequelize.STRING(200), allowNull: true },
      job_title:              { type: Sequelize.STRING(150), allowNull: true },
      industry:               { type: Sequelize.STRING(100), allowNull: true },
      // Higher education
      higher_edu_course:      { type: Sequelize.STRING(150), allowNull: true },
      higher_edu_institution: { type: Sequelize.STRING(200), allowNull: true },
      higher_edu_year:        { type: Sequelize.INTEGER,     allowNull: true },
      // Contact (may differ from student record)
      contact_email:          { type: Sequelize.STRING(150), allowNull: true },
      contact_phone:          { type: Sequelize.STRING(20),  allowNull: true },
      current_city:           { type: Sequelize.STRING(100), allowNull: true },
      current_state:          { type: Sequelize.STRING(100), allowNull: true },
      current_country:        { type: Sequelize.STRING(100), allowNull: true, defaultValue: 'India' },
      // Social
      linkedin_url:           { type: Sequelize.STRING(300), allowNull: true },
      // Engagement
      is_mentor_volunteer:    { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      testimonial:            { type: Sequelize.TEXT, allowNull: true },
      is_testimonial_public:  { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // Admin notes
      admin_notes:            { type: Sequelize.TEXT, allowNull: true },
      // Tracking
      profile_updated_at:     { type: Sequelize.DATE, allowNull: true },
      created_by:             { type: Sequelize.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('alumni_profiles', ['school_id'], { name: 'idx_alumni_school_id' });
    await queryInterface.addIndex('alumni_profiles', ['student_id'], { name: 'idx_alumni_student_id', unique: true });
    await queryInterface.addIndex('alumni_profiles', ['school_id', 'current_occupation'], { name: 'idx_alumni_school_occupation' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('alumni_profiles');
  },
};
