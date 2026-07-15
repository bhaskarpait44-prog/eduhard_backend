'use strict';

const sequelize = require('../config/database');

async function testQuery() {
  try {
    const schoolId = 1;
    const sessionId = 1;
    const classId = 1;

    let query = `
      SELECT ae.*, c.name as target_class_name, false as is_readonly
      FROM academic_events ae
      LEFT JOIN classes c ON c.id = ae.target_class_id
      WHERE ae.school_id = :schoolId 
        AND ae.session_id = :sessionId
        AND ae.is_published = true
        AND (
          ae.audience = 'everyone'
          OR (ae.audience = 'students' AND (ae.target_class_id IS NULL OR ae.target_class_id = :classId))
        )
    `;
    const replacements = { 
      schoolId, 
      sessionId,
      classId
    };

    // Include session holidays
    let holidaysQuery = `
      SELECT 
        id, NULL as school_id, session_id, name as title, NULL as description, 'holiday' as event_type, 
        holiday_date as start_date, holiday_date as end_date, NULL as start_time, NULL as end_time,
        true as is_all_day, 'everyone' as audience, NULL as target_class_id, '#16a34a' as color,
        true as is_published, false as notify_on_publish, NULL as created_by, NULL as updated_by,
        created_at, created_at as updated_at, NULL as target_class_name, true as is_readonly
      FROM session_holidays
      WHERE session_id = :sessionId
    `;

    query = `(${query}) UNION ALL (${holidaysQuery})`;
    query += ` ORDER BY start_date ASC`;

    const [events] = await sequelize.query(query, { replacements });
    console.log('Query Succeeded! Events count:', events.length);
    process.exit(0);
  } catch (err) {
    console.error('Query Failed! Error:', err.message);
    process.exit(1);
  }
}

testQuery();
