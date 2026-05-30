'use strict';

const sequelize = require('../config/database');
const { sendPushToStudents, sendPushToUsers } = require('../utils/pushNotifier');
const { invalidateCache } = require('../middlewares/cache');
const { generateAcademicCalendarPdf } = require('../utils/pdfGenerator');

/**
 * Download Academic Calendar as PDF
 * GET /api/academic-calendar/download?session_id=&month=&year=&event_type=
 */
exports.downloadPdf = async (req, res) => {
  try {
    const { session_id, month, year, event_type } = req.query;
    const schoolId = req.user.school_id;

    if (!session_id) {
      return res.fail('session_id is required');
    }

    // 1. Fetch School Details
    const [[school]] = await sequelize.query(
      `SELECT name, address, phone, email, logo_url FROM schools WHERE id = :schoolId`,
      { replacements: { schoolId } }
    );

    // 2. Fetch Session Details
    const [[session]] = await sequelize.query(
      `SELECT name FROM sessions WHERE id = :sessionId AND school_id = :schoolId`,
      { replacements: { sessionId: session_id, schoolId } }
    );

    if (!session) {
      return res.fail('Session not found');
    }

    // 3. Fetch Events (reuse logic from list)
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
      WHERE ae.school_id = :schoolId AND ae.session_id = :sessionId
    `;
    const replacements = { schoolId, sessionId: session_id };

    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM ae.start_date) = :month AND EXTRACT(YEAR FROM ae.start_date) = :year`;
      replacements.month = month;
      replacements.year = year;
    }

    if (event_type) {
      query += ` AND ae.event_type = :eventType`;
      replacements.eventType = event_type;
    }

    // Include session holidays if event_type is not filtered or is filtered to 'holiday'
    if (!event_type || event_type === 'holiday') {
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
        holidaysQuery += ` AND EXTRACT(MONTH FROM holiday_date) = :month AND EXTRACT(YEAR FROM holiday_date) = :year`;
      }
      query = `(${query}) UNION ALL (${holidaysQuery})`;
    }

    query += ` ORDER BY start_date ASC, start_time ASC`;

    const [events] = await sequelize.query(query, { replacements });

    // 4. Generate PDF
    const pdfBuffer = await generateAcademicCalendarPdf({
      school,
      session,
      events
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Academic_Calendar_${session.name.replace(/\s+/g, '_')}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    res.fail(err.message);
  }
};

/**
 * List events
 * GET /api/academic-calendar?session_id=&month=&year=&event_type=
 */
exports.list = async (req, res) => {
  try {
    const { session_id, month, year, event_type } = req.query;
    const schoolId = req.user.school_id;

    if (!session_id) {
      return res.fail('session_id is required');
    }

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
      query += ` AND EXTRACT(MONTH FROM ae.start_date) = :month AND EXTRACT(YEAR FROM ae.start_date) = :year`;
      replacements.month = month;
      replacements.year = year;
    }

    if (event_type) {
      query += ` AND ae.event_type = :eventType`;
      replacements.eventType = event_type;
    }

    // Include session holidays if event_type is not filtered or is filtered to 'holiday'
    if (!event_type || event_type === 'holiday') {
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
        holidaysQuery += ` AND EXTRACT(MONTH FROM holiday_date) = :month AND EXTRACT(YEAR FROM holiday_date) = :year`;
      }
      query = `(${query}) UNION ALL (${holidaysQuery})`;
    }

    query += ` ORDER BY start_date ASC, start_time ASC`;

    const [events] = await sequelize.query(query, { replacements });

    res.ok(events);
  } catch (err) {
    res.fail(err.message);
  }
};

/**
 * Create event
 * POST /api/academic-calendar
 */
exports.create = async (req, res) => {
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
      WHERE ae.id = :id
    `, { replacements: { id: eventId[0].id } });

    invalidateCache(schoolId, '/api/academic-calendar*');

    if (event.is_published && event.notify_on_publish) {
      fireEventNotification(event);
    }

    res.ok(event, 'Event created successfully');
  } catch (err) {
    res.fail(err.message);
  }
};

/**
 * Update event
 * PATCH /api/academic-calendar/:id
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const userId = req.user.id;
    const updates = req.body;

    // Check ownership
    const [[existing]] = await sequelize.query(
      `SELECT id FROM academic_events WHERE id = :id AND school_id = :schoolId`,
      { replacements: { id, schoolId } }
    );

    if (!existing) {
      return res.fail('Event not found or access denied', [], 404);
    }

    if (updates.start_date && updates.end_date && new Date(updates.end_date) < new Date(updates.start_date)) {
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
      WHERE ae.id = :id
    `, { replacements: { id } });

    invalidateCache(schoolId, '/api/academic-calendar*');

    res.ok(event, 'Event updated successfully');
  } catch (err) {
    res.fail(err.message);
  }
};

/**
 * Delete event
 * DELETE /api/academic-calendar/:id
 */
exports.destroy = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [result] = await sequelize.query(
      `DELETE FROM academic_events WHERE id = :id AND school_id = :schoolId`,
      { replacements: { id, schoolId } }
    );

    invalidateCache(schoolId, '/api/academic-calendar*');
    res.ok(null, 'Event deleted successfully');
  } catch (err) {
    res.fail(err.message);
  }
};

/**
 * Toggle publish
 * PATCH /api/academic-calendar/:id/publish
 */
exports.togglePublish = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[existing]] = await sequelize.query(
      `SELECT is_published, notify_on_publish FROM academic_events WHERE id = :id AND school_id = :schoolId`,
      { replacements: { id, schoolId } }
    );

    if (!existing) {
      return res.fail('Event not found', [], 404);
    }

    const newPublished = !existing.is_published;

    await sequelize.query(
      `UPDATE academic_events SET is_published = :newPublished, updated_at = NOW() WHERE id = :id`,
      { replacements: { id, newPublished } }
    );

    const [[event]] = await sequelize.query(`
      SELECT ae.*, c.name as target_class_name
      FROM academic_events ae
      LEFT JOIN classes c ON c.id = ae.target_class_id
      WHERE ae.id = :id
    `, { replacements: { id } });

    invalidateCache(schoolId, '/api/academic-calendar*');

    if (newPublished && event.notify_on_publish) {
      fireEventNotification(event);
    }

    res.ok(event, `Event ${newPublished ? 'published' : 'unpublished'} successfully`);
  } catch (err) {
    res.fail(err.message);
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
