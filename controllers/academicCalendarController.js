'use strict';

const sequelize = require('../config/database');
const { sendPushToStudents, sendPushToUsers } = require('../utils/pushNotifier');
const { invalidateCache } = require('../middlewares/cache');
const { generateAcademicCalendarPdf } = require('../utils/pdfGenerator');

/**
 * Download Academic Calendar as PDF
 * GET /api/academic-calendar/download?session_id=&month=&year=&event_type=
 */
exports.downloadPdf = async (req, res, next) => {
  try {
    const { session_id, month, year, event_type, audience } = req.query;
    const schoolId = req.user.school_id;

    if (!session_id) {
      return res.fail('session_id is required');
    }

    // FIX: validate month/year are real numbers if provided
    if ((month && isNaN(parseInt(month, 10))) || (year && isNaN(parseInt(year, 10)))) {
      return res.fail('month and year must be valid numbers');
    }

    // 1. Fetch School Details
    const [[school]] = await sequelize.query(
      `SELECT name, address, phone, email, logo_url FROM schools WHERE id = :schoolId`,
      { replacements: { schoolId } }
    );

    // FIX: guard against missing school row
    if (!school) return res.fail('School not found', [], 404);

    // 2. Fetch Session Details
    const [[session]] = await sequelize.query(
      `SELECT id, name, start_date, end_date FROM sessions WHERE id = :sessionId AND school_id = :schoolId`,
      { replacements: { sessionId: session_id, schoolId } }
    );

    if (!session) {
      return res.fail('Session not found or access denied', [], 404);
    }

    // 3. Fetch Events
    const columns = `
      ae.id, ae.school_id, ae.session_id, ae.title, ae.description, ae.event_type, 
      ae.start_date, ae.end_date, ae.start_time, ae.end_time, ae.is_all_day, 
      ae.audience, ae.target_class_id, ae.color, ae.is_published, 
      ae.notify_on_publish, ae.created_by, ae.updated_by, ae.created_at, ae.updated_at
    `;

    let query = `
      SELECT ${columns}, c.name as target_class_name
      FROM academic_events ae
      LEFT JOIN classes c ON c.id = ae.target_class_id
      WHERE ae.school_id = :schoolId AND ae.session_id = :sessionId AND ae.is_published = true
    `;
    const replacements = { schoolId, sessionId: session_id };

    if (month && year) {
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).toISOString().split('T')[0];
      query += ` AND ae.start_date <= :lastDay AND ae.end_date >= :firstDay`;
      replacements.firstDay = firstDay;
      replacements.lastDay = lastDay;
    }

    if (event_type) {
      query += ` AND ae.event_type = :eventType`;
      replacements.eventType = event_type;
    }

    if (audience) {
      query += ` AND ae.audience = :audience`;
      replacements.audience = audience;
    }

    // Include session holidays
    if ((!event_type || event_type === 'holiday') && (!audience || audience === 'everyone')) {
      let holidaysQuery = `
        SELECT 
          id, :schoolId as school_id, session_id, name as title, CAST(NULL AS TEXT) as description, 'holiday' as event_type, 
          holiday_date as start_date, holiday_date as end_date, CAST(NULL AS TIME) as start_time, CAST(NULL AS TIME) as end_time,
          true as is_all_day, 'everyone' as audience, CAST(NULL AS INTEGER) as target_class_id, '#16a34a' as color,
          true as is_published, false as notify_on_publish, added_by as created_by, CAST(NULL AS INTEGER) as updated_by,
          created_at, created_at as updated_at, CAST(NULL AS VARCHAR) as target_class_name
        FROM session_holidays
        WHERE session_id = :sessionId
      `;
      if (month && year) {
        holidaysQuery += ` AND holiday_date >= :firstDay AND holiday_date <= :lastDay`;
      }
      query = `(${query}) UNION ALL (${holidaysQuery})`;
    }

    query += ` ORDER BY start_date ASC, start_time ASC`;

    const [events] = await sequelize.query(query, { replacements });

    // 4. Generate PDF
    const pdfBuffer = await generateAcademicCalendarPdf({ school, session, events });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Academic_Calendar_${session.name.replace(/\s+/g, '_')}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err); // FIX: use next(err) not res.fail(err.message) to avoid leaking internals
  }
};

/**
 * List events
 * GET /api/academic-calendar?session_id=&month=&year=&event_type=
 */
exports.list = async (req, res, next) => {
  try {
    const { session_id, month, year, event_type, audience } = req.query; // FIX: was missing audience param
    const schoolId = req.user.school_id;

    if (!session_id) {
      return res.fail('session_id is required');
    }

    // FIX: validate month/year
    if ((month && isNaN(parseInt(month, 10))) || (year && isNaN(parseInt(year, 10)))) {
      return res.fail('month and year must be valid numbers');
    }

    // Validate Session
    const [[session]] = await sequelize.query(
      `SELECT id FROM sessions WHERE id = :sessionId AND school_id = :schoolId`,
      { replacements: { sessionId: session_id, schoolId } }
    );
    if (!session) return res.fail('Invalid session ID or access denied', [], 404);

    const columns = `
      ae.id, ae.school_id, ae.session_id, ae.title, ae.description, ae.event_type, 
      ae.start_date, ae.end_date, ae.start_time, ae.end_time, ae.is_all_day, 
      ae.audience, ae.target_class_id, ae.color, ae.is_published, 
      ae.notify_on_publish, ae.created_by, ae.updated_by, ae.created_at, ae.updated_at
    `;

    let query = `
      SELECT ${columns}, c.name as target_class_name, false as is_readonly
      FROM academic_events ae
      LEFT JOIN classes c ON c.id = ae.target_class_id
      WHERE ae.school_id = :schoolId AND ae.session_id = :sessionId
    `;
    const replacements = { schoolId, sessionId: session_id };

    if (month && year) {
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).toISOString().split('T')[0];
      query += ` AND ae.start_date <= :lastDay AND ae.end_date >= :firstDay`;
      replacements.firstDay = firstDay;
      replacements.lastDay = lastDay;
    }

    if (event_type) {
      query += ` AND ae.event_type = :eventType`;
      replacements.eventType = event_type;
    }

    // FIX: audience filter was silently ignored in list (only applied in downloadPdf)
    if (audience) {
      query += ` AND ae.audience = :audience`;
      replacements.audience = audience;
    }

    // Include session holidays if event_type is not filtered or is 'holiday', and audience is not staff/teacher-only
    if ((!event_type || event_type === 'holiday') && (!audience || audience === 'everyone')) {
      let holidaysQuery = `
        SELECT 
          id, :schoolId as school_id, session_id, name as title, CAST(NULL AS TEXT) as description, 'holiday' as event_type, 
          holiday_date as start_date, holiday_date as end_date, CAST(NULL AS TIME) as start_time, CAST(NULL AS TIME) as end_time,
          true as is_all_day, 'everyone' as audience, CAST(NULL AS INTEGER) as target_class_id, '#16a34a' as color,
          true as is_published, false as notify_on_publish, added_by as created_by, CAST(NULL AS INTEGER) as updated_by,
          created_at, created_at as updated_at, CAST(NULL AS VARCHAR) as target_class_name, true as is_readonly
        FROM session_holidays
        WHERE session_id = :sessionId
      `;
      if (month && year) {
        holidaysQuery += ` AND holiday_date >= :firstDay AND holiday_date <= :lastDay`;
      }
      query = `(${query}) UNION ALL (${holidaysQuery})`;
    }

    query += ` ORDER BY start_date ASC, start_time ASC`;

    const [events] = await sequelize.query(query, { replacements });

    res.ok(events);
  } catch (err) {
    next(err); // FIX: use next(err)
  }
};

/**
 * Create event
 * POST /api/academic-calendar
 */
exports.create = async (req, res, next) => {
  try {
    const {
      session_id, title, description, event_type, start_date, end_date,
      start_time, end_time, is_all_day, audience, target_class_id,
      color, is_published, notify_on_publish
    } = req.body;
    const schoolId = req.user.school_id;
    const userId = req.user.id;

    if (!session_id || !title || !event_type || !start_date || !end_date) {
      return res.fail('Missing required fields');
    }

    // Validate Session
    const [[session]] = await sequelize.query(
      `SELECT id FROM sessions WHERE id = :sessionId AND school_id = :schoolId`,
      { replacements: { sessionId: session_id, schoolId } }
    );
    if (!session) return res.fail('Invalid session ID or access denied');

    // Validate Class if provided
    if (target_class_id) {
      const [[cls]] = await sequelize.query(
        `SELECT id FROM classes WHERE id = :classId AND school_id = :schoolId`,
        { replacements: { classId: target_class_id, schoolId } }
      );
      if (!cls) return res.fail('Invalid class ID or access denied');
    }

    if (new Date(end_date) < new Date(start_date)) {
      return res.fail('End date cannot be before start date');
    }

    const [eventId] = await sequelize.query(`
      INSERT INTO academic_events (
        school_id, session_id, title, description, event_type, start_date, end_date,
        start_time, end_time, is_all_day, audience, target_class_id,
        color, is_published, notify_on_publish, created_by, updated_by,
        created_at, updated_at
      ) VALUES (
        :schoolId, :sessionId, :title, :description, :eventType, :startDate, :endDate,
        :startTime, :endTime, :isAllDay, :audience, :targetClassId,
        :color, :isPublished, :notifyOnPublish, :createdBy, :updatedBy,
        NOW(), NOW()
      ) RETURNING id
    `, {
      replacements: {
        schoolId, sessionId: session_id, title, description, eventType: event_type,
        startDate: start_date, endDate: end_date, startTime: start_time || null,
        endTime: end_time || null, isAllDay: is_all_day !== undefined ? is_all_day : true,
        audience: audience || 'everyone', targetClassId: target_class_id || null,
        color: color || null, isPublished: is_published || false,
        notifyOnPublish: notify_on_publish || false, createdBy: userId, updatedBy: userId
      }
    });

    const [[event]] = await sequelize.query(`
      SELECT ae.*, c.name as target_class_name
      FROM academic_events ae
      LEFT JOIN classes c ON c.id = ae.target_class_id
      WHERE ae.id = :id AND ae.school_id = :schoolId
    `, { replacements: { id: eventId[0].id, schoolId } });

    invalidateCache(schoolId, '/api/academic-calendar*');

    if (event.is_published && event.notify_on_publish) {
      fireEventNotification(event);
    }

    res.ok(event, 'Event created successfully');
  } catch (err) {
    next(err); // FIX: use next(err)
  }
};

/**
 * Update event
 * PATCH /api/academic-calendar/:id
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const userId = req.user.id;
    const updates = req.body;

    // Check ownership and get existing state
    const [[existing]] = await sequelize.query(
      `SELECT id, start_date, end_date, is_published FROM academic_events WHERE id = :id AND school_id = :schoolId`,
      { replacements: { id, schoolId } }
    );

    if (!existing) {
      return res.fail('Event not found or access denied', [], 404);
    }

    // If target_class_id is updated, validate it
    if (updates.target_class_id) {
      const [[cls]] = await sequelize.query(
        `SELECT id FROM classes WHERE id = :classId AND school_id = :schoolId`,
        { replacements: { classId: updates.target_class_id, schoolId } }
      );
      if (!cls) return res.fail('Invalid class ID or access denied');
    }

    const startDate = updates.start_date || existing.start_date;
    const endDate = updates.end_date || existing.end_date;

    if (new Date(endDate) < new Date(startDate)) {
      return res.fail('End date cannot be before start date');
    }

    const fields = [];
    const replacements = { id, userId, schoolId };

    const allowedFields = [
      'title', 'description', 'event_type', 'start_date', 'end_date',
      'start_time', 'end_time', 'is_all_day', 'audience', 'target_class_id',
      'color', 'is_published', 'notify_on_publish'
    ];

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        fields.push(`${field} = :${field}`);
        replacements[field] = updates[field];
      }
    });

    if (fields.length === 0) {
      return res.fail('No fields to update');
    }

    await sequelize.query(`
      UPDATE academic_events
      SET ${fields.join(', ')}, updated_by = :userId, updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId
    `, { replacements });

    const [[event]] = await sequelize.query(`
      SELECT ae.*, c.name as target_class_name
      FROM academic_events ae
      LEFT JOIN classes c ON c.id = ae.target_class_id
      WHERE ae.id = :id AND ae.school_id = :schoolId
    `, { replacements: { id, schoolId } });

    invalidateCache(schoolId, '/api/academic-calendar*');

    // Only notify if status changed from false -> true
    if (event.is_published && event.notify_on_publish && updates.is_published && !existing.is_published) {
      fireEventNotification(event);
    }

    res.ok(event, 'Event updated successfully');
  } catch (err) {
    next(err); // FIX: use next(err)
  }
};

/**
 * Delete event
 * DELETE /api/academic-calendar/:id
 */
exports.destroy = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [result] = await sequelize.query(
      `DELETE FROM academic_events WHERE id = :id AND school_id = :schoolId RETURNING id`,
      { replacements: { id, schoolId } }
    );

    if (result.length === 0) {
      return res.fail('Event not found or access denied', [], 404);
    }

    invalidateCache(schoolId, '/api/academic-calendar*');
    res.ok(null, 'Event deleted successfully');
  } catch (err) {
    next(err); // FIX: use next(err)
  }
};

/**
 * Toggle publish
 * PATCH /api/academic-calendar/:id/publish
 */
exports.togglePublish = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const userId = req.user.id;

    const [[existing]] = await sequelize.query(
      `SELECT is_published, notify_on_publish FROM academic_events WHERE id = :id AND school_id = :schoolId`,
      { replacements: { id, schoolId } }
    );

    if (!existing) {
      return res.fail('Event not found', [], 404);
    }

    const newPublished = !existing.is_published;

    await sequelize.query(
      `UPDATE academic_events SET is_published = :newPublished, updated_by = :userId, updated_at = NOW() WHERE id = :id AND school_id = :schoolId`,
      { replacements: { id, newPublished, userId, schoolId } }
    );

    const [[event]] = await sequelize.query(`
      SELECT ae.*, c.name as target_class_name
      FROM academic_events ae
      LEFT JOIN classes c ON c.id = ae.target_class_id
      WHERE ae.id = :id AND ae.school_id = :schoolId
    `, { replacements: { id, schoolId } });

    invalidateCache(schoolId, '/api/academic-calendar*');

    if (newPublished && event.notify_on_publish) {
      fireEventNotification(event);
    }

    res.ok(event, `Event ${newPublished ? 'published' : 'unpublished'} successfully`);
  } catch (err) {
    next(err); // FIX: use next(err)
  }
};

/**
 * Helper to fire push notifications
 */
async function fireEventNotification(event) {
  try {
    const schoolId = event.school_id;
    const payload = {
      title: `New Event: ${event.title}`,
      body: event.description || `A new ${event.event_type.replace('_', ' ')} has been scheduled for ${event.start_date}.`,
      data: {
        type: 'academic_event',
        event_id: event.id,
        event_type: event.event_type
      }
    };

    if (event.audience === 'everyone' || event.audience === 'students') {
      let studentQuery = `SELECT id FROM students WHERE school_id = :schoolId AND is_active = true AND is_deleted = false`;
      const replacements = { schoolId };
      
      if (event.target_class_id) {
        studentQuery = `
          SELECT s.id 
          FROM students s
          JOIN enrollments e ON e.student_id = s.id
          WHERE s.school_id = :schoolId AND e.class_id = :classId AND e.status = 'active'
        `;
        replacements.classId = event.target_class_id;
      }
      
      const [students] = await sequelize.query(studentQuery, { replacements });
      const studentIds = students.map(s => s.id);
      if (studentIds.length > 0) {
        sendPushToStudents(studentIds, payload);
      }
    }

    // For parents
    if (event.audience === 'everyone' || event.audience === 'parents') {
      let parentQuery = `
        SELECT DISTINCT f.user_id 
        FROM families f
        JOIN students s ON s.family_id = f.id
        WHERE s.school_id = :schoolId AND s.is_active = true AND s.is_deleted = false AND f.user_id IS NOT NULL
      `;
      const replacements = { schoolId: event.school_id };

      if (event.target_class_id) {
        parentQuery = `
          SELECT DISTINCT f.user_id
          FROM families f
          JOIN students s ON s.family_id = f.id
          JOIN enrollments e ON e.student_id = s.id
          WHERE s.school_id = :schoolId AND e.class_id = :classId AND e.status = 'active' AND f.user_id IS NOT NULL
        `;
        replacements.classId = event.target_class_id;
      }

      const [parents] = await sequelize.query(parentQuery, { replacements });
      const parentUserIds = parents.map(p => p.user_id);
      if (parentUserIds.length > 0) {
        sendPushToUsers(parentUserIds, payload);
      }
    }

    // For staff/teachers
    if (event.audience === 'everyone' || event.audience === 'teachers' || event.audience === 'staff') {
      const [users] = await sequelize.query(`
        SELECT id FROM users 
        WHERE school_id = :schoolId AND is_active = true AND is_deleted = false 
        AND role IN ('admin', 'teacher', 'accountant', 'receptionist', 'librarian')
      `, { replacements: { schoolId } });
      
      const userIds = users.map(u => u.id);
      if (userIds.length > 0) {
        sendPushToUsers(userIds, payload);
      }
    }
  } catch (err) {
    console.error('[EventNotification] Error:', err.message);
  }
}
