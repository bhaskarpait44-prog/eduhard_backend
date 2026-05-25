'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const schoolId = 1;
    const sessionId = 1;

    // Define periods: 8:00 AM to 2:00 PM (24-hour format for DB)
    // Period 1: 08:00 - 08:45
    // Period 2: 08:45 - 09:30
    // Period 3: 09:30 - 10:15
    // Period 4: 10:15 - 11:00
    // BREAK   : 11:00 - 12:00 (1 hour)
    // Period 5: 12:00 - 12:45
    // Period 6: 12:45 - 13:30 (Use 13 for 1 PM)
    // Period 7: 13:30 - 14:00 (Use 14 for 2 PM)

    const periods = [
      { num: 1, start: '08:00:00', end: '08:45:00' },
      { num: 2, start: '08:45:00', end: '09:30:00' },
      { num: 3, start: '09:30:00', end: '10:15:00' },
      { num: 4, start: '10:15:00', end: '11:00:00' },
      // 11 to 12 is break
      { num: 5, start: '12:00:00', end: '12:45:00' },
      { num: 6, start: '12:45:00', end: '13:30:00' },
      { num: 7, start: '13:30:00', end: '14:00:00' },
    ];

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // Fetch classes and their assigned subject teachers
    const [assignments] = await queryInterface.sequelize.query(`
      SELECT 
        ta.class_id, ta.section_id, ta.teacher_id, ta.subject_id,
        c.name as class_name
      FROM teacher_assignments ta
      JOIN classes c ON c.id = ta.class_id
      WHERE ta.session_id = ${sessionId} AND ta.subject_id IS NOT NULL AND ta.is_active = true
    `);

    const timetableSlots = [];

    // Group assignments by class
    const classMap = {};
    assignments.forEach(a => {
      if (!classMap[a.class_id]) classMap[a.class_id] = [];
      classMap[a.class_id].push(a);
    });

    const classIds = Object.keys(classMap);

    days.forEach(day => {
      classIds.forEach(classId => {
        const classAssignments = classMap[classId];
        const sectionId = classAssignments[0].section_id;

        periods.forEach((period, pIdx) => {
          const assignmentIndex = (days.indexOf(day) + pIdx) % classAssignments.length;
          const selected = classAssignments[assignmentIndex];

          timetableSlots.push({
            session_id: sessionId,
            class_id: parseInt(classId),
            section_id: sectionId,
            teacher_id: selected.teacher_id,
            subject_id: selected.subject_id,
            day_of_week: day,
            period_number: period.num,
            start_time: period.start,
            end_time: period.end,
            room_number: `R-${classAssignments[0].class_name.replace('Class ', '').replace('LKG', 'L').replace('UKG', 'U')}`,
            is_active: true,
            created_at: now,
            updated_at: now
          });
        });
      });
    });

    await queryInterface.bulkInsert('timetable_slots', timetableSlots, { ignoreDuplicates: true });
    console.log(`Generated ${timetableSlots.length} timetable slots.`);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('timetable_slots', null, {});
  }
};
