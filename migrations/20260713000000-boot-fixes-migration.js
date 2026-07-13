'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { sequelize } = queryInterface;
    
    const applyFix = async (query) => {
      try {
        await sequelize.query(query);
      } catch (e) {
        // Safe to ignore if it already exists in the target database
        if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
          throw e;
        }
      }
    };

    // Notice audiences
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'teachers'");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'parents'");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'accountants'");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'librarians'");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'receptionists'");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'specific_teacher'");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'subject_wise'");

    // Notice posted by roles
    await applyFix("ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'super_admin'");
    await applyFix("ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'accountant'");
    await applyFix("ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'staff'");

    // Target columns for notices
    await applyFix('ALTER TABLE notices ADD COLUMN IF NOT EXISTS target_teacher_id INTEGER');
    await applyFix('ALTER TABLE notices ADD COLUMN IF NOT EXISTS target_subject_id INTEGER');
    await applyFix('ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_school_wide BOOLEAN DEFAULT FALSE');
    await applyFix('ALTER TABLE notices ADD COLUMN IF NOT EXISTS attachment_path VARCHAR(500)');

    // Table: notice_reads
    await applyFix(`
      CREATE TABLE IF NOT EXISTS notice_reads (
        id SERIAL PRIMARY KEY,
        notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await applyFix('ALTER TABLE notice_reads ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id) ON DELETE CASCADE');
    await applyFix('CREATE UNIQUE INDEX IF NOT EXISTS notice_reads_notice_teacher_unique ON notice_reads (notice_id, teacher_id)');

    // Table: teacher_notice_reads
    await applyFix(`
      CREATE TABLE IF NOT EXISTS teacher_notice_reads (
        id SERIAL PRIMARY KEY,
        notice_id INTEGER NOT NULL REFERENCES teacher_notices(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await applyFix('ALTER TABLE teacher_notice_reads ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id) ON DELETE CASCADE');
    await applyFix('CREATE UNIQUE INDEX IF NOT EXISTS teacher_notice_reads_notice_teacher_unique ON teacher_notice_reads (notice_id, teacher_id)');

    // Clean up absolute paths in database to make them web-accessible
    try {
      await sequelize.query(`
        UPDATE notices 
        SET attachment_path = SUBSTRING(attachment_path FROM 'uploads/notices/.*')
        WHERE attachment_path LIKE '%uploads/notices/%' AND attachment_path NOT LIKE 'uploads/notices/%'
      `);
      await sequelize.query(`
        UPDATE teacher_notices 
        SET attachment_path = SUBSTRING(attachment_path FROM 'uploads/notices/.*')
        WHERE attachment_path LIKE '%uploads/notices/%' AND attachment_path NOT LIKE 'uploads/notices/%'
      `);
    } catch (e) {
      // Ignore cleanup error if tables don't have records or columns aren't ready yet
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Migration is persistent one-time fixes. No rollback is appropriate for critical enum/column safety.
  }
};
