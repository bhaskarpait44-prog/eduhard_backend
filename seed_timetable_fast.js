require('dotenv').config({ path: './.env' });
const sequelize = require('./config/database');

const SCHOOL_ID = 1;
const SESSION_ID = 1;

const PERIOD_CONFIG = {
  1: { start: '08:00', end: '08:45' },
  2: { start: '08:45', end: '09:30' },
  3: { start: '09:30', end: '10:15' },
  4: { start: '10:30', end: '11:15' },
  5: { start: '11:15', end: '12:00' },
  6: { start: '12:30', end: '13:15' },
  7: { start: '13:15', end: '14:00' },
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

async function seed() {
  console.log('Starting fast timetable seeding...');
  
  // Get all subject assignments
  const [assignments] = await sequelize.query(`
    SELECT ta.*, t.first_name, t.last_name
    FROM teacher_assignments ta
    JOIN teachers t ON t.id = ta.teacher_id
    WHERE ta.session_id = :sessionId AND ta.is_class_teacher = false AND ta.is_active = true
  `, { replacements: { sessionId: SESSION_ID } });

  // Group assignments by section
  const sectionMap = {};
  assignments.forEach(a => {
    const key = `${a.class_id}-${a.section_id}`;
    if (!sectionMap[key]) sectionMap[key] = [];
    sectionMap[key].push(a);
  });

  const sectionKeys = Object.keys(sectionMap);
  console.log(`Found assignments for ${sectionKeys.length} sections.`);

  for (const key of sectionKeys) {
    const sectionAssignments = sectionMap[key];
    const [classId, sectionId] = key.split('-').map(Number);
    
    console.log(`Seeding timetable for Section ID ${sectionId}...`);

    for (const day of DAYS) {
      for (let period = 1; period <= 7; period++) {
        const assignment = sectionAssignments[(period - 1) % sectionAssignments.length];
        
        await sequelize.query(`
          INSERT INTO timetable_slots 
            (session_id, teacher_id, class_id, section_id, subject_id, day_of_week, period_number, start_time, end_time, is_active, created_at, updated_at)
          VALUES
            (:sessionId, :teacherId, :classId, :sectionId, :subjectId, :day, :period, :start, :end, true, NOW(), NOW())
          ON CONFLICT DO NOTHING
        `, {
          replacements: {
            sessionId: SESSION_ID,
            teacherId: assignment.teacher_id,
            classId: classId,
            sectionId: sectionId,
            subjectId: assignment.subject_id,
            day,
            period,
            start: PERIOD_CONFIG[period].start,
            end: PERIOD_CONFIG[period].end
          }
        });
      }
    }
  }

  console.log('Timetable seeding completed successfully.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
