'use strict';

const sequelize = require('../config/database');
const redis = require('../config/redis');
const { clearPermissionCache } = require('../middlewares/checkPermission');

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TEACHER_BASE_PERMISSION_NAMES = [
  'classes.view',
];
const CLASS_TEACHER_PERMISSION_NAMES = [
  'classes.view',
  'attendance.view',
  'attendance.mark',
  'attendance.edit',
];
const DEFAULT_LEAVE_BALANCES = [
  { leave_type: 'casual', total_allowed: Number(process.env.DEFAULT_CASUAL_LEAVE || 12) },
  { leave_type: 'sick', total_allowed: Number(process.env.DEFAULT_SICK_LEAVE || 10) },
  { leave_type: 'emergency', total_allowed: Number(process.env.DEFAULT_EMERGENCY_LEAVE || 5) },
  { leave_type: 'earned', total_allowed: Number(process.env.DEFAULT_EARNED_LEAVE || 15) },
];

async function audit(tableName, recordId, changes, req) {
  const rows = (Array.isArray(changes) ? changes : [changes]).map((change) => ({
    table_name: tableName,
    record_id: recordId,
    school_id: req.user?.school_id || null,
    field_name: change.field,
    old_value: change.oldValue != null ? String(change.oldValue) : null,
    new_value: change.newValue != null ? String(change.newValue) : null,
    changed_by: req.user?.id || null,
    reason: change.reason || null,
    ip_address: req.ip || null,
    device_info: (req.headers['user-agent'] || '').substring(0, 299),
    created_at: new Date(),
  }));

  if (rows.length) {
    await sequelize.getQueryInterface().bulkInsert('audit_logs', rows);
  }
}

function requireFields(payload, fields) {
  for (const field of fields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      const error = new Error(`${field} is required.`);
      error.status = 422;
      throw error;
    }
  }
}

async function getCurrentSession(schoolId) {
  const [[session]] = await sequelize.query(`
    SELECT id, name
    FROM sessions
    WHERE school_id = :schoolId
    ORDER BY CASE WHEN is_current = true THEN 0 ELSE 1 END, start_date DESC
    LIMIT 1;
  `, { replacements: { schoolId } });

  return session || null;
}

async function ensureTeacherLeaveBalances(teacherId, sessionId, transaction = null) {
  if (!teacherId || !sessionId) return;

  for (const balance of DEFAULT_LEAVE_BALANCES) {
    const totalAllowed = Number.isFinite(balance.total_allowed) ? balance.total_allowed : 0;
    await sequelize.query(`
      INSERT INTO leave_balances (
        teacher_id, session_id, leave_type, total_allowed, used, remaining, created_at, updated_at
      )
      VALUES (
        :teacherId, :sessionId, :leaveType, :totalAllowed, 0, :totalAllowed, NOW(), NOW()
      )
      ON CONFLICT (teacher_id, session_id, leave_type) DO NOTHING;
    `, {
      replacements: {
        teacherId,
        sessionId,
        leaveType: balance.leave_type,
        totalAllowed,
      },
      transaction,
    });
  }
}

async function grantTeacherAssignmentPermissions(teacherId, { isClassTeacher = false } = {}, grantedBy = null) {
  const names = isClassTeacher
    ? CLASS_TEACHER_PERMISSION_NAMES
    : TEACHER_BASE_PERMISSION_NAMES;

  const [perms] = await sequelize.query(`
    SELECT id, name
    FROM permissions
    WHERE name IN (:names);
  `, {
    replacements: { names },
  });

  if (perms.length > 0) {
    await sequelize.getQueryInterface().bulkInsert(
      'teacher_permissions',
      perms.map((permission) => ({
        teacher_id: Number(teacherId),
        permission_id: permission.id,
        granted_by: grantedBy,
        granted_at: new Date(),
      })),
      { ignoreDuplicates: true }
    );

    clearPermissionCache(Number(teacherId), 'teacher');
  }

  return perms.map((permission) => permission.name);
}

exports.overview = async (req, res, next) => {
  try {
    const session = await getCurrentSession(req.user.school_id);

    const [[counts]] = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM teachers WHERE school_id = :schoolId AND is_active = true AND is_deleted = false) AS teachers,
        (SELECT COUNT(*) FROM teacher_assignments WHERE session_id = :sessionId AND is_active = true) AS active_assignments,
        (SELECT COUNT(*) FROM timetable_slots WHERE session_id = :sessionId AND is_active = true) AS timetable_slots,
        (
          SELECT COUNT(*)
          FROM teacher_leaves tl
          JOIN teachers teacher ON teacher.id = tl.teacher_id
          WHERE tl.status = 'pending'
            AND teacher.school_id = :schoolId
            AND teacher.is_deleted = false
        ) AS pending_leaves,
        (
          SELECT COUNT(*)
          FROM profile_correction_requests pcr
          JOIN teachers teacher ON teacher.id = pcr.teacher_id
          WHERE pcr.status = 'pending'
            AND teacher.school_id = :schoolId
            AND teacher.is_deleted = false
        ) AS pending_corrections,
        (
          SELECT COUNT(*)
          FROM teacher_notices n
          LEFT JOIN teachers u ON u.id = n.teacher_id
          LEFT JOIN users admin ON admin.id = n.created_by_user_id
          WHERE n.is_active = true
            AND n.category != 'fee'
            AND (u.school_id = :schoolId OR admin.school_id = :schoolId)
        ) AS active_notices,
        (
          SELECT COUNT(*)
          FROM homework h
          JOIN teachers u ON u.id = h.teacher_id
          WHERE h.session_id = :sessionId
            AND h.status = 'active'
            AND u.school_id = :schoolId
        ) AS active_homework;

    `, {
      replacements: {
        schoolId: req.user.school_id,
        sessionId: session?.id || 0,
      },
    });

    res.ok({ session, counts }, 'Admin teacher control overview loaded.');
  } catch (err) { next(err); }
};

exports.teachers = async (req, res, next) => {
  try {
    const [teachers] = await sequelize.query(`
      SELECT
        id,
        first_name,
        last_name,
        CONCAT(first_name, ' ', last_name) AS name,
        email,
        phone,
        employee_id,
        department,
        designation
      FROM teachers
      WHERE school_id = :schoolId
        AND is_active = true
        AND is_deleted = false
      ORDER BY first_name ASC, last_name ASC;
    `, {
      replacements: {
        schoolId: req.user.school_id,
      },
    });

    // Check online status in Redis
    const teachersWithOnlineStatus = await Promise.all(teachers.map(async (teacher) => {
      let is_online = false;
      if (redis.status === 'ready') {
        const key = `online:${req.user.school_id}:teacher:${teacher.id}`;
        const val = await redis.get(key);
        is_online = val === '1';
      }
      return { ...teacher, is_online };
    }));

    res.ok({ teachers: teachersWithOnlineStatus }, `${teachersWithOnlineStatus.length} teacher(s) found.`);
  } catch (err) { next(err); }
};

exports.assignments = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const session = await getCurrentSession(schoolId);
    const [rows] = await sequelize.query(`
      SELECT
        ta.*,
        CONCAT(u.first_name, ' ', u.last_name) AS teacher_name,
        c.name AS class_name,
        c.stream AS class_stream,
        sec.name AS section_name,
        sub.name AS subject_name,
        sub.code AS subject_code,
        sess.name AS session_name
      FROM teacher_assignments ta
      JOIN teachers u ON u.id = ta.teacher_id
      JOIN classes c ON c.id = ta.class_id
      JOIN sections sec ON sec.id = ta.section_id
      JOIN sessions sess ON sess.id = ta.session_id
      LEFT JOIN subjects sub ON sub.id = ta.subject_id
      WHERE ta.session_id = :sessionId AND u.school_id = :schoolId
      ORDER BY ta.is_active DESC, u.first_name ASC, u.last_name ASC, c.name ASC, sec.name ASC, ta.is_class_teacher DESC;
    `, { replacements: { sessionId: session?.id || 0, schoolId } });

    // Check online status in Redis for each teacher using a pipeline
    let assignmentsWithOnlineStatus = rows.map(r => ({ ...r, is_online: false }));
    if (redis.status === 'ready' && rows.length > 0) {
      const pipeline = redis.pipeline();
      rows.forEach(r => {
        pipeline.get(`online:${schoolId}:teacher:${r.teacher_id}`);
      });
      const results = await pipeline.exec();
      assignmentsWithOnlineStatus = assignmentsWithOnlineStatus.map((r, idx) => ({
        ...r,
        is_online: results[idx] && results[idx][1] === '1'
      }));
    }

    res.ok({ session, assignments: assignmentsWithOnlineStatus }, `${assignmentsWithOnlineStatus.length} teacher assignment(s) found.`);
  } catch (err) { next(err); }
};

exports.createAssignment = async (req, res, next) => {
  try {
    const session = await getCurrentSession(req.user.school_id);
    const { teacher_id, class_id, section_id, subject_id = null, is_class_teacher = false } = req.body;
    requireFields(req.body, ['teacher_id', 'class_id', 'section_id']);

    if (!is_class_teacher && !subject_id) {
      return res.fail('Subject must be selected for subject teacher assignments.', [], 422);
    }

    if (is_class_teacher) {
      const [[existingClassTeacher]] = await sequelize.query(`
        SELECT id
        FROM teacher_assignments
        WHERE session_id = :sessionId
          AND class_id = :classId
          AND section_id = :sectionId
          AND is_class_teacher = true
          AND is_active = true
        LIMIT 1;
      `, {
        replacements: {
          sessionId: session?.id || 0,
          classId: class_id,
          sectionId: section_id,
        },
      });

      if (existingClassTeacher) {
        return res.fail('An active class teacher is already assigned to this section.', [], 422);
      }
    } else {
      const [[existingSubjectAssignment]] = await sequelize.query(`
        SELECT id
        FROM teacher_assignments
        WHERE session_id = :sessionId
          AND teacher_id = :teacherId
          AND class_id = :classId
          AND section_id = :sectionId
          AND subject_id = :subjectId
          AND is_active = true
        LIMIT 1;
      `, {
        replacements: {
          sessionId: session?.id || 0,
          teacherId: teacher_id,
          classId: class_id,
          sectionId: section_id,
          subjectId: subject_id,
        },
      });

      if (existingSubjectAssignment) {
        return res.fail('This subject assignment already exists for the teacher.', [], 422);
      }
    }

    const [[assignment]] = await sequelize.query(`
      INSERT INTO teacher_assignments (
        teacher_id, session_id, class_id, section_id, subject_id, is_class_teacher,
        is_active, created_at, updated_at
      )
      VALUES (
        :teacherId, :sessionId, :classId, :sectionId, :subjectId, :isClassTeacher,
        true, NOW(), NOW()
      )
      RETURNING *;
    `, {
      replacements: {
        teacherId: teacher_id,
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
        subjectId: is_class_teacher ? null : subject_id,
        isClassTeacher: Boolean(is_class_teacher),
      },
    });

    const permissionsGranted = await grantTeacherAssignmentPermissions(
      Number(teacher_id),
      { isClassTeacher: Boolean(is_class_teacher) },
      req.user.id
    );

    await audit('teacher_assignments', assignment.id, {
      field: 'created',
      oldValue: null,
      newValue: is_class_teacher ? 'class_teacher' : `subject:${subject_id}`,
      reason: 'Admin created teacher assignment',
    }, req);

    res.ok({ assignment, permissions_granted: permissionsGranted }, 'Teacher assignment created.', 201);
  } catch (err) { next(err); }
};

exports.updateAssignment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { teacher_id, class_id, section_id, subject_id, is_class_teacher, is_active } = req.body;

    const [[assignment]] = await sequelize.query(`
      SELECT ta.* FROM teacher_assignments ta
      JOIN teachers t ON t.id = ta.teacher_id
      WHERE ta.id = :id AND t.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!assignment) return res.fail('Assignment not found or unauthorized.', [], 404);

    const session = await getCurrentSession(req.user.school_id);
    const sessionId = session?.id || 0;

    const finalTeacherId = teacher_id !== undefined ? Number(teacher_id) : assignment.teacher_id;
    const finalClassId = class_id !== undefined ? Number(class_id) : assignment.class_id;
    const finalSectionId = section_id !== undefined ? Number(section_id) : assignment.section_id;
    const finalIsClassTeacher = is_class_teacher !== undefined ? Boolean(is_class_teacher) : assignment.is_class_teacher;
    const finalSubjectId = finalIsClassTeacher ? null : (subject_id !== undefined ? (subject_id ? Number(subject_id) : null) : assignment.subject_id);
    const finalIsActive = is_active !== undefined ? Boolean(is_active) : assignment.is_active;

    // Validation if something changed
    if (finalIsActive && (
      finalTeacherId !== assignment.teacher_id ||
      finalClassId !== assignment.class_id ||
      finalSectionId !== assignment.section_id ||
      finalSubjectId !== assignment.subject_id ||
      finalIsClassTeacher !== assignment.is_class_teacher ||
      (finalIsActive !== assignment.is_active && finalIsActive === true)
    )) {
      if (finalIsClassTeacher) {
        const [[existingClassTeacher]] = await sequelize.query(`
          SELECT id
          FROM teacher_assignments
          WHERE session_id = :sessionId
            AND class_id = :classId
            AND section_id = :sectionId
            AND is_class_teacher = true
            AND is_active = true
            AND id != :id
          LIMIT 1;
        `, {
          replacements: {
            sessionId,
            classId: finalClassId,
            sectionId: finalSectionId,
            id
          },
        });

        if (existingClassTeacher) {
          return res.fail('An active class teacher is already assigned to this section.', [], 422);
        }
      } else {
        if (!finalSubjectId) {
          return res.fail('Subject must be selected for subject teacher assignments.', [], 422);
        }
        const [[existingSubjectAssignment]] = await sequelize.query(`
          SELECT id
          FROM teacher_assignments
          WHERE session_id = :sessionId
            AND teacher_id = :teacherId
            AND class_id = :classId
            AND section_id = :sectionId
            AND subject_id = :subjectId
            AND is_active = true
            AND id != :id
          LIMIT 1;
        `, {
          replacements: {
            sessionId,
            teacherId: finalTeacherId,
            classId: finalClassId,
            sectionId: finalSectionId,
            subjectId: finalSubjectId,
            id
          },
        });

        if (existingSubjectAssignment) {
          return res.fail('This subject assignment already exists for the teacher.', [], 422);
        }
      }
    }

    await sequelize.query(`
      UPDATE teacher_assignments
      SET teacher_id = :teacherId,
          class_id = :classId,
          section_id = :sectionId,
          subject_id = :subjectId,
          is_class_teacher = :isClassTeacher,
          is_active = :isActive,
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        teacherId: finalTeacherId,
        classId: finalClassId,
        sectionId: finalSectionId,
        subjectId: finalSubjectId,
        isClassTeacher: finalIsClassTeacher,
        isActive: finalIsActive,
      },
    });

    if (finalIsActive === true) {
      await grantTeacherAssignmentPermissions(
        Number(finalTeacherId),
        { isClassTeacher: finalIsClassTeacher },
        req.user.id
      );
    }

    await audit('teacher_assignments', Number(id), {
      field: 'updated',
      oldValue: JSON.stringify(assignment),
      newValue: JSON.stringify({
        teacher_id: finalTeacherId,
        class_id: finalClassId,
        section_id: finalSectionId,
        subject_id: finalSubjectId,
        is_class_teacher: finalIsClassTeacher,
        is_active: finalIsActive,
      }),
      reason: 'Admin updated teacher assignment',
    }, req);

    res.ok({ id: Number(id) }, 'Teacher assignment updated.');
  } catch (err) { next(err); }
};

exports.deleteAssignment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[assignment]] = await sequelize.query(`
      SELECT ta.* FROM teacher_assignments ta
      JOIN teachers t ON t.id = ta.teacher_id
      WHERE ta.id = :id AND t.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!assignment) return res.fail('Assignment not found or unauthorized.', [], 404);

    await sequelize.query(`DELETE FROM teacher_assignments WHERE id = :id;`, { replacements: { id } });

    await audit('teacher_assignments', Number(id), {
      field: 'deleted',
      oldValue: JSON.stringify(assignment),
      newValue: null,
      reason: 'Admin deleted teacher assignment',
    }, req);

    res.ok({ id: Number(id) }, 'Teacher assignment deleted.');
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.fail('Cannot delete assignment as it is referenced by other records. Try deactivating it instead.', [], 422);
    }
    next(err);
  }
};

exports.timetable = async (req, res, next) => {
  try {
    const session = await getCurrentSession(req.user.school_id);
    const [rows] = await sequelize.query(`
      SELECT
        ts.*,
        CONCAT(u.first_name, ' ', u.last_name) AS teacher_name,
        c.name AS class_name,
        c.stream AS class_stream,
        sec.name AS section_name,
        sub.name AS subject_name
      FROM timetable_slots ts
      JOIN teachers u ON u.id = ts.teacher_id
      JOIN classes c ON c.id = ts.class_id
      JOIN sections sec ON sec.id = ts.section_id
      JOIN subjects sub ON sub.id = ts.subject_id
      JOIN teacher_assignments ta
        ON ta.session_id = ts.session_id
       AND ta.class_id = ts.class_id
       AND ta.section_id = ts.section_id
       AND ta.teacher_id = ts.teacher_id
       AND ta.subject_id = ts.subject_id
       AND ta.is_active = true
      WHERE ts.session_id = :sessionId
      ORDER BY ts.day_of_week ASC, ts.period_number ASC, u.first_name ASC, u.last_name ASC;
    `, { replacements: { sessionId: session?.id || 0 } });

    res.ok({ session, timetable: rows }, `${rows.length} timetable slot(s) found.`);
  } catch (err) { next(err); }
};

exports.createTimetableSlot = async (req, res, next) => {
  try {
    const session = await getCurrentSession(req.user.school_id);
    const {
      teacher_id, class_id, section_id, subject_id,
      day_of_week, period_number, start_time, end_time, room_number = null,
    } = req.body;

    requireFields(req.body, ['teacher_id', 'class_id', 'section_id', 'subject_id', 'day_of_week', 'period_number', 'start_time', 'end_time']);
    if (!DAY_NAMES.includes(day_of_week)) {
      return res.fail('Invalid day_of_week.', [], 422);
    }

    const [[assignment]] = await sequelize.query(`
      SELECT id
      FROM teacher_assignments
      WHERE session_id = :sessionId
        AND teacher_id = :teacherId
        AND class_id = :classId
        AND section_id = :sectionId
        AND subject_id = :subjectId
        AND is_active = true
      LIMIT 1;
    `, {
      replacements: {
        sessionId: session?.id || 0,
        teacherId: teacher_id,
        classId: class_id,
        sectionId: section_id,
        subjectId: subject_id,
      },
    });

    if (!assignment) {
      return res.fail('The selected teacher is not actively assigned to this subject for the chosen class and section.', [], 422);
    }

    const [[slot]] = await sequelize.query(`
      INSERT INTO timetable_slots (
        session_id, class_id, section_id, teacher_id, subject_id, day_of_week,
        period_number, start_time, end_time, room_number, is_active
      )
      VALUES (
        :sessionId, :classId, :sectionId, :teacherId, :subjectId, :dayOfWeek,
        :periodNumber, :startTime, :endTime, :roomNumber, true
      )
      RETURNING *;
    `, {
      replacements: {
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
        teacherId: teacher_id,
        subjectId: subject_id,
        dayOfWeek: day_of_week,
        periodNumber: period_number,
        startTime: start_time,
        endTime: end_time,
        roomNumber: room_number,
      },
    });

    await audit('timetable_slots', slot.id, {
      field: 'created',
      oldValue: null,
      newValue: `${day_of_week}:${period_number}`,
      reason: 'Admin created timetable slot',
    }, req);

    res.ok({ slot }, 'Timetable slot created.', 201);
  } catch (err) { next(err); }
};

exports.updateTimetableSlot = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[slot]] = await sequelize.query(`
      SELECT ts.id, ts.is_active FROM timetable_slots ts
      JOIN sessions s ON s.id = ts.session_id
      WHERE ts.id = :id AND s.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!slot) return res.fail('Timetable slot not found or unauthorized.', [], 404);

    const fields = ['room_number', 'start_time', 'end_time', 'is_active'];
    const updates = fields.filter((field) => req.body[field] !== undefined);
    if (!updates.length) return res.fail('No timetable fields provided.', [], 422);

    const setClause = updates.map((field) => `${field} = :${field}`).join(', ');
    await sequelize.query(`
      UPDATE timetable_slots
      SET ${setClause}
      WHERE id = :id;
    `, { replacements: { ...req.body, id } });

    await audit('timetable_slots', Number(id), {
      field: 'updated',
      oldValue: slot.is_active,
      newValue: req.body.is_active ?? slot.is_active,
      reason: 'Admin updated timetable slot',
    }, req);

    res.ok({ id: Number(id) }, 'Timetable slot updated.');
  } catch (err) { next(err); }
};

exports.homework = async (req, res, next) => {
  try {
    const session = await getCurrentSession(req.user.school_id);
    const [rows] = await sequelize.query(`
      SELECT
        h.*,
        CONCAT(u.first_name, ' ', u.last_name) AS teacher_name,
        c.name AS class_name,
        c.stream AS class_stream,
        sec.name AS section_name,
        sub.name AS subject_name,
        COUNT(DISTINCT e.id) AS student_count,
        COUNT(hs.id) FILTER (WHERE hs.status IN ('submitted', 'graded')) AS submitted_count
      FROM homework h
      JOIN teachers u ON u.id = h.teacher_id
      JOIN classes c ON c.id = h.class_id
      JOIN sections sec ON sec.id = h.section_id
      JOIN subjects sub ON sub.id = h.subject_id
      JOIN enrollments e
        ON e.class_id = h.class_id
       AND e.section_id = h.section_id
       AND e.session_id = h.session_id
       AND e.status = 'active'
      LEFT JOIN homework_submissions hs
        ON hs.homework_id = h.id
       AND hs.enrollment_id = e.id
      WHERE h.session_id = :sessionId
        AND u.school_id = :schoolId
      GROUP BY h.id, u.id, c.id, c.name, c.stream, sec.id, sec.name, sub.id, sub.name
      ORDER BY h.created_at DESC;
    `, { 
      replacements: { 
        sessionId: session?.id || 0,
        schoolId: req.user.school_id
      } 
    });

    res.ok({ homework: rows }, `${rows.length} homework item(s) found.`);
  } catch (err) { next(err); }
};

exports.updateHomework = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'completed', 'cancelled'].includes(status)) {
      return res.fail('Invalid homework status.', [], 422);
    }

    const [[homework]] = await sequelize.query(`
      SELECT h.id, h.status FROM homework h
      JOIN teachers t ON t.id = h.teacher_id
      WHERE h.id = :id AND t.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId } });
    if (!homework) return res.fail('Homework not found or unauthorized.', [], 404);

    await sequelize.query(`
      UPDATE homework
      SET status = :status,
          updated_at = NOW()
      WHERE id = :id;
    `, { replacements: { id, status } });

    await audit('homework', Number(id), {
      field: 'status',
      oldValue: homework.status,
      newValue: status,
      reason: 'Admin updated homework status',
    }, req);

    res.ok({ id: Number(id), status }, 'Homework status updated.');
  } catch (err) { next(err); }
};

exports.notices = async (req, res, next) => {
  try {
    const { teacher_id, role, startDate, endDate, limit = 7 } = req.query;

    let whereClause = 'WHERE (u.school_id = :schoolId OR admin.school_id = :schoolId)';
    const replacements = { schoolId: req.user.school_id };

    if (teacher_id) {
      whereClause += ' AND n.teacher_id = :teacherId';
      replacements.teacherId = teacher_id;
    }

    if (role) {
      if (role === 'teacher') {
        whereClause += ' AND n.teacher_id IS NOT NULL';
      } else {
        whereClause += ' AND n.created_by_role = :role';
        replacements.role = role;
      }
    }

    if (startDate) {
      whereClause += ' AND n.publish_date >= :startDate';
      replacements.startDate = startDate;
    }

    if (endDate) {
      whereClause += ' AND n.publish_date <= :endDate';
      replacements.endDate = endDate;
    }

    const [rows] = await sequelize.query(`
      SELECT
        n.*,
        COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), admin.name) AS teacher_name,
        COALESCE(n.created_by_role, 'teacher') AS teacher_role,
        CONCAT(tu.first_name, ' ', tu.last_name) AS target_teacher_name,
        CONCAT(ts.first_name, ' ', ts.last_name) AS target_student_name,
        c.name AS class_name,
        c.stream AS class_stream,
        sec.name AS section_name,
        sub.name AS subject_name,
        COUNT(DISTINCT nr.id) AS teacher_read_count,
        COUNT(DISTINCT snr.id) AS student_read_count
      FROM teacher_notices n
      LEFT JOIN teachers u ON u.id = n.teacher_id
      LEFT JOIN users admin ON admin.id = n.created_by_user_id
      LEFT JOIN teachers tu ON tu.id = n.target_teacher_id
      LEFT JOIN students ts ON ts.id = n.target_student_id
      LEFT JOIN classes c ON c.id = n.class_id
      LEFT JOIN sections sec ON sec.id = n.section_id
      LEFT JOIN subjects sub ON sub.id = n.subject_id
      LEFT JOIN teacher_notice_reads nr ON nr.notice_id = n.id
      LEFT JOIN student_notice_reads snr ON snr.notice_id = n.id
      ${whereClause}
      GROUP BY n.id, u.id, u.first_name, u.last_name, admin.id, admin.name, tu.id, tu.first_name, tu.last_name, ts.id, ts.first_name, ts.last_name, c.id, c.name, c.stream, sec.id, sec.name, sub.id, sub.name
      ORDER BY n.publish_date DESC
      LIMIT :limit;
    `, {
      replacements: { ...replacements, limit: Number(limit) },
    });

    res.ok({ notices: rows }, `${rows.length} notice(s) found.`);
  } catch (err) { next(err); }
};

exports.createNotice = async (req, res, next) => {
  try {
    const { notifyAllTeachers, notifyAllStudents, notifyClass, notifySubject, sendNotification } = require('../utils/notification');
    const {
      title,
      content,
      category = 'general',
      target_scope,
      class_id = null,
      section_id = null,
      subject_id = null,
      target_student_id = null,
      target_teacher_id = null,
      attachment_path = null,
      publish_date = new Date(),
      expiry_date = null,
      posted_by_teacher_id = null, // Allow specifying a teacher ID if posted on behalf of one
    } = req.body;

    const allowedCategories = new Set(['general', 'homework', 'exam', 'event', 'holiday', 'other', 'fee']);
    const allowedScopes = new Set(['teachers', 'all_students', 'specific_section', 'specific_student', 'specific_teacher', 'specific_subject', 'whole_class', 'whole_school']);
    if (!title || !content || !target_scope) return res.fail('title, content and target_scope are required.', [], 422);
    if (!allowedCategories.has(category)) return res.fail('category is invalid.', [], 422);
    if (!allowedScopes.has(target_scope)) return res.fail('target_scope is invalid.', [], 422);
    if (expiry_date && publish_date) {
      const expiry = new Date(expiry_date).toISOString().slice(0, 10);
      const publish = new Date(publish_date).toISOString().slice(0, 10);
      if (expiry < publish) {
        return res.fail('expiry_date cannot be earlier than publish_date.', [], 422);
      }
    }
    if ((target_scope === 'specific_section' || target_scope === 'whole_class') && !class_id) {
      return res.fail('class_id is required for class or section notices.', [], 422);
    }
    if (target_scope === 'specific_subject' && (!class_id || !subject_id)) {
      return res.fail('class_id and subject_id are required for subject-wise notices.', [], 422);
    }
    if (target_scope === 'specific_student' && !target_student_id) {
      return res.fail('target_student_id is required for student-wise notices.', [], 422);
    }
    if (target_scope === 'specific_teacher' && !target_teacher_id) {
      return res.fail('target_teacher_id is required for teacher-wise notices.', [], 422);
    }

    // Handle attribution properly
    let teacherId = null;
    let createdByUserId = null;
    let createdByRole = req.user.role;

    if (req.user.role === 'teacher') {
      teacherId = req.user.id;
    } else {
      createdByUserId = req.user.id;
      // If admin is posting on behalf of a teacher
      if (posted_by_teacher_id) {
        teacherId = posted_by_teacher_id;
      }
    }

    const attachmentPath = req.file ? req.file.path.replace(/\\/g, '/') : (attachment_path || null);

    const [[notice]] = await sequelize.query(`
      INSERT INTO teacher_notices (
        teacher_id, created_by_user_id, created_by_role,
        class_id, section_id, subject_id, target_student_id, target_teacher_id,
        title, content, category, target_scope, attachment_path,
        publish_date, expiry_date, is_active, created_at, updated_at
      )
      VALUES (
        :teacherId, :createdByUserId, :createdByRole,
        :classId, :sectionId, :subjectId, :targetStudentId, :targetTeacherId,
        :title, :content, :category, :targetScope, :attachmentPath,
        :publishDate, :expiryDate, true, NOW(), NOW()
      )
      RETURNING *;
    `, {
      replacements: {
        teacherId,
        createdByUserId,
        createdByRole,
        classId: class_id,
        sectionId: section_id,
        subjectId: subject_id,
        targetStudentId: target_student_id,
        targetTeacherId: target_teacher_id,
        title,
        content,
        category,
        targetScope: target_scope,
        attachmentPath,
        publishDate: publish_date,
        expiryDate: expiry_date,
      },
    });

    const pushTitle = `New Notice: ${title}`;
    const pushContent = content.length > 100 ? content.substring(0, 97) + '...' : content;
    const data = { notice_id: notice.id, category };

    if (target_scope === 'all_students') {
      await notifyAllStudents(req.user.school_id, pushTitle, pushContent, 'notice', data);
    } else if (target_scope === 'whole_school') {
      await Promise.all([
        notifyAllStudents(req.user.school_id, pushTitle, pushContent, 'notice', data),
        notifyAllTeachers(req.user.school_id, pushTitle, pushContent, 'notice', data),
      ]);
    } else if (target_scope === 'teachers') {
      await notifyAllTeachers(req.user.school_id, pushTitle, pushContent, 'notice', data);
    } else if (target_scope === 'specific_section' || target_scope === 'whole_class') {
      await notifyClass(class_id, section_id, pushTitle, pushContent, 'notice', data);
    } else if (target_scope === 'specific_subject') {
      await notifySubject(subject_id, pushTitle, pushContent, 'notice', data);
    } else if (target_scope === 'specific_student') {
      await sendNotification({ studentId: target_student_id, title: pushTitle, content: pushContent, type: 'notice', data });
    } else if (target_scope === 'specific_teacher') {
      await sendNotification({ teacherId: target_teacher_id, title: pushTitle, content: pushContent, type: 'notice', data });
    }

    await audit('teacher_notices', notice.id, {
      field: 'created',
      oldValue: null,
      newValue: title,
      reason: 'Admin notice posted',
    }, req);

    res.ok({ notice }, 'Notice posted successfully.', 201);
  } catch (err) { next(err); }
};

exports.updateNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[notice]] = await sequelize.query(`
      SELECT id, is_active
      FROM teacher_notices
      WHERE id = :id
      LIMIT 1;
    `, { replacements: { id } });
    if (!notice) return res.fail('Notice not found.', [], 404);

    const attachmentPath = req.file ? req.file.path.replace(/\\/g, '/') : undefined;

    await sequelize.query(`
      UPDATE teacher_notices
      SET title = COALESCE(:title, title),
          content = COALESCE(:content, content),
          category = COALESCE(:category, category),
          attachment_path = COALESCE(:attachmentPath, attachment_path),
          is_active = COALESCE(:isActive, is_active),
          expiry_date = :expiryDate,
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        title: req.body.title,
        content: req.body.content,
        category: req.body.category,
        attachmentPath: attachmentPath,
        isActive: req.body.is_active,
        expiryDate: req.body.expiry_date || null,
      },
    });

    await audit('teacher_notices', Number(id), {
      field: 'is_active',
      oldValue: notice.is_active,
      newValue: req.body.is_active,
      reason: 'Admin updated teacher notice',
    }, req);

    res.ok({ id: Number(id) }, 'Teacher notice updated.');
  } catch (err) { next(err); }
};

exports.leaves = async (req, res, next) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        tl.*,
        CONCAT(u.first_name, ' ', u.last_name) AS teacher_name,
        reviewer.name AS reviewed_by_name
      FROM teacher_leaves tl
      JOIN teachers u ON u.id = tl.teacher_id
      LEFT JOIN users reviewer ON reviewer.id = tl.reviewed_by
      WHERE u.school_id = :schoolId
        AND u.is_deleted = false
      ORDER BY CASE WHEN tl.status = 'pending' THEN 0 ELSE 1 END, tl.created_at DESC;
    `, {
      replacements: {
        schoolId: req.user.school_id,
      },
    });

    res.ok({ applications: rows }, `${rows.length} leave application(s) found.`);
  } catch (err) { next(err); }
};

const { sendNotification } = require('../utils/notification');

exports.reviewLeave = async (req, res, next) => {
  const tx = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { status, review_note = null } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      await tx.rollback();
      return res.fail('status must be approved or rejected.', [], 422);
    }

    const [[leave]] = await sequelize.query(`
      SELECT tl.*, t.first_name, t.last_name
      FROM teacher_leaves tl
      JOIN teachers t ON t.id = tl.teacher_id
      WHERE tl.id = :id
        AND t.school_id = :schoolId
        AND t.is_deleted = false
      LIMIT 1;
    `, {
      replacements: {
        id,
        schoolId: req.user.school_id,
      },
      transaction: tx,
    });

    if (!leave) {
      await tx.rollback();
      return res.fail('Leave application not found.', [], 404);
    }
    if (leave.status !== 'pending') {
      await tx.rollback();
      return res.fail('Only pending leave applications can be reviewed.', [], 422);
    }

    await sequelize.query(`
      UPDATE teacher_leaves
      SET status = :status,
          reviewed_by = :reviewedBy,
          review_note = :reviewNote,
          reviewed_at = NOW(),
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        status,
        reviewedBy: req.user.id,
        reviewNote: review_note,
      },
      transaction: tx,
    });

    if (status === 'approved' && leave.leave_type !== 'without_pay') {
      const session = await getCurrentSession(req.user.school_id);
      await ensureTeacherLeaveBalances(leave.teacher_id, session?.id || 0, tx);

      await sequelize.query(`
        UPDATE leave_balances
        SET used = used + :daysCount,
            remaining = remaining - :daysCount,
            updated_at = NOW()
        WHERE teacher_id = :teacherId
          AND session_id = (
            SELECT id
            FROM sessions
            WHERE school_id = :schoolId
            ORDER BY CASE WHEN is_current = true THEN 0 ELSE 1 END, start_date DESC
            LIMIT 1
          )
          AND leave_type = :leaveType;
      `, {
        replacements: {
          teacherId: leave.teacher_id,
          schoolId: req.user.school_id,
          leaveType: leave.leave_type,
          daysCount: leave.days_count,
        },
        transaction: tx,
      });
    }

    await tx.commit();

    // FCM Notification
    await sendNotification({
      teacherId: leave.teacher_id,
      title: `Leave ${status === 'approved' ? 'Approved' : 'Rejected'}`,
      content: `Your leave request for ${leave.from_date} to ${leave.to_date} has been ${status}.${review_note ? ' Note: ' + review_note : ''}`,
      type: 'leave_status',
      data: { leave_id: leave.id, status }
    }).catch(err => console.error('FCM Error (Leave):', err));

    // Create System Notice
    await sequelize.query(`
      INSERT INTO notices (
        school_id, title, body, posted_by_user_id, posted_by_role, audience, 
        target_teacher_id, priority, created_at, updated_at
      ) VALUES (
        :schoolId, :title, :body, :userId, :role, 'specific_teacher',
        :targetTeacherId, 'info', NOW(), NOW()
      )
    `, {
      replacements: {
        schoolId: req.user.school_id,
        title: `Leave ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        body: `Your leave request for ${leave.from_date} to ${leave.to_date} has been ${status}.${review_note ? ' Note: ' + review_note : ''}`,
        userId: req.user.id,
        role: req.user.role,
        targetTeacherId: leave.teacher_id
      }
    }).catch(err => console.error('Notice Error (Leave):', err));

    await audit('teacher_leaves', Number(id), {
      field: 'status',
      oldValue: leave.status,
      newValue: status,
      reason: 'Admin reviewed leave application',
    }, req);

    res.ok({ id: Number(id), status }, 'Leave application reviewed.');
  } catch (err) {
    if (tx) await tx.rollback();
    next(err);
  }
};

exports.correctionRequests = async (req, res, next) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        pcr.*,
        CONCAT(u.first_name, ' ', u.last_name) AS teacher_name,
        reviewer.name AS reviewed_by_name
      FROM profile_correction_requests pcr
      JOIN teachers u ON u.id = pcr.teacher_id
      LEFT JOIN users reviewer ON reviewer.id = pcr.reviewed_by
      WHERE u.school_id = :schoolId
        AND u.is_deleted = false
      ORDER BY CASE WHEN pcr.status = 'pending' THEN 0 ELSE 1 END, pcr.created_at DESC;
    `, {
      replacements: {
        schoolId: req.user.school_id,
      },
    });

    res.ok({ requests: rows }, `${rows.length} correction request(s) found.`);
  } catch (err) { next(err); }
};

exports.reviewCorrectionRequest = async (req, res, next) => {
  const tx = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { status, review_note = null } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      await tx.rollback();
      return res.fail('status must be approved or rejected.', [], 422);
    }

    const [[request]] = await sequelize.query(`
      SELECT pcr.*
      FROM profile_correction_requests pcr
      JOIN teachers teacher ON teacher.id = pcr.teacher_id
      WHERE pcr.id = :id
        AND teacher.school_id = :schoolId
        AND teacher.is_deleted = false
      LIMIT 1;
    `, {
      replacements: {
        id,
        schoolId: req.user.school_id,
      },
      transaction: tx,
    });

    if (!request) {
      await tx.rollback();
      return res.fail('Correction request not found.', [], 404);
    }
    if (request.status !== 'pending') {
      await tx.rollback();
      return res.fail('Only pending correction requests can be reviewed.', [], 422);
    }

    const allowedFields = new Set(['phone', 'email', 'address', 'first_name', 'last_name', 'department', 'designation', 'joining_date', 'employee_id']);
    ['highest_qualification', 'specialization', 'university_name', 'graduation_year', 'years_of_experience'].forEach((field) => allowedFields.add(field));
    if (status === 'approved' && !allowedFields.has(request.field_name)) {
      await tx.rollback();
      return res.fail('This profile field cannot be updated from correction requests.', [], 422);
    }

    if (status === 'approved') {
      await sequelize.query(`
        UPDATE teachers
        SET ${request.field_name} = :requestedValue,
            updated_at = NOW()
        WHERE id = :teacherId;
      `, {
        replacements: {
          requestedValue: request.requested_value,
          teacherId: request.teacher_id,
        },
        transaction: tx,
      });
    }

    await sequelize.query(`
      UPDATE profile_correction_requests
      SET status = :status,
          reviewed_by = :reviewedBy,
          review_note = :reviewNote,
          reviewed_at = NOW(),
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        status,
        reviewedBy: req.user.id,
        reviewNote: review_note,
      },
      transaction: tx,
    });

    await tx.commit();

    // FCM Notification
    await sendNotification({
      teacherId: request.teacher_id,
      title: `Correction Request ${status === 'approved' ? 'Approved' : 'Rejected'}`,
      content: `Your profile correction request for '${request.field_name}' has been ${status}.`,
      type: 'correction_status',
      data: { request_id: request.id, status }
    }).catch(err => console.error('FCM Error (Correction):', err));

    await audit('profile_correction_requests', Number(id), {
      field: 'status',
      oldValue: request.status,
      newValue: status,
      reason: 'Admin reviewed teacher profile correction request',
    }, req);

    res.ok({ id: Number(id), status }, 'Correction request reviewed.');
  } catch (err) {
    if (tx) await tx.rollback();
    next(err);
  }
};

exports.studentCorrectionRequests = async (req, res, next) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        scr.*,
        CONCAT(s.first_name, ' ', s.last_name) AS student_name,
        s.admission_no,
        reviewer.name AS reviewed_by_name
      FROM student_correction_requests scr
      JOIN students s ON s.id = scr.student_id
      LEFT JOIN users reviewer ON reviewer.id = scr.reviewed_by
      WHERE s.school_id = :schoolId
        AND s.is_deleted = false
      ORDER BY CASE WHEN scr.status = 'pending' THEN 0 ELSE 1 END, scr.created_at DESC;
    `, {
      replacements: {
        schoolId: req.user.school_id,
      },
    });

    res.ok({ requests: rows }, `${rows.length} student correction request(s) found.`);
  } catch (err) { next(err); }
};

exports.reviewStudentCorrectionRequest = async (req, res, next) => {
  const tx = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { status, admin_response = null } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      await tx.rollback();
      return res.fail('status must be approved or rejected.', [], 422);
    }

    const [[request]] = await sequelize.query(`
      SELECT scr.*
      FROM student_correction_requests scr
      JOIN students s ON s.id = scr.student_id
      WHERE scr.id = :id
        AND s.school_id = :schoolId
        AND s.is_deleted = false
      LIMIT 1;
    `, {
      replacements: {
        id,
        schoolId: req.user.school_id,
      },
      transaction: tx,
    });

    if (!request) {
      await tx.rollback();
      return res.fail('Correction request not found.', [], 404);
    }
    if (request.status !== 'pending') {
      await tx.rollback();
      return res.fail('Only pending correction requests can be reviewed.', [], 422);
    }

    const allowedFields = new Set(['phone', 'email', 'address', 'first_name', 'last_name', 'date_of_birth', 'gender', 'father_name', 'mother_name']);
    if (status === 'approved' && !allowedFields.has(request.field_name)) {
      await tx.rollback();
      return res.fail('This profile field cannot be updated via correction request.', [], 422);
    }

    if (status === 'approved') {
      const isProfileField = ['phone', 'email', 'address', 'father_name', 'mother_name'].includes(request.field_name);
      
      if (isProfileField) {
        await sequelize.query(`
          UPDATE student_profiles
          SET ${request.field_name} = :requestedValue,
              updated_at = NOW()
          WHERE student_id = :studentId AND is_current = true;
        `, {
          replacements: {
            requestedValue: request.requested_value,
            studentId: request.student_id,
          },
          transaction: tx,
        });
      } else {
        await sequelize.query(`
          UPDATE students
          SET ${request.field_name} = :requestedValue,
              updated_at = NOW()
          WHERE id = :studentId;
        `, {
          replacements: {
            requestedValue: request.requested_value,
            studentId: request.student_id,
          },
          transaction: tx,
        });
      }
    }

    await sequelize.query(`
      UPDATE student_correction_requests
      SET status = :status,
          reviewed_by = :reviewedBy,
          admin_response = :adminResponse,
          reviewed_at = NOW(),
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        status,
        reviewedBy: req.user.id,
        adminResponse: admin_response,
      },
      transaction: tx,
    });

    await tx.commit();

    // FCM Notification
    await sendNotification({
      studentId: request.student_id,
      title: `Correction Request ${status === 'approved' ? 'Approved' : 'Rejected'}`,
      content: `Your profile correction request for '${request.field_name}' has been ${status}.`,
      type: 'correction_status',
      data: { request_id: request.id, status }
    }).catch(err => console.error('FCM Error (Student Correction):', err));

    await audit('student_correction_requests', Number(id), {
      field: 'status',
      oldValue: request.status,
      newValue: status,
      reason: 'Admin reviewed student profile correction request',
    }, req);

    res.ok({ id: Number(id), status }, 'Correction request reviewed.');
  } catch (err) {
    if (tx) await tx.rollback();
    next(err);
  }
};

exports.attendance = async (req, res, next) => {
  try {
    const session = await getCurrentSession(req.user.school_id);
    const [rows] = await sequelize.query(`
      SELECT
        a.id,
        a.date,
        a.status,
        a.override_reason,
        a.marked_at,
        s.first_name,
        s.last_name,
        e.roll_number,
        c.name AS class_name,
        c.stream AS class_stream,
        sec.name AS section_name,
        marker.name AS marked_by_name
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN users marker ON marker.id = a.marked_by
      WHERE e.session_id = :sessionId
      ORDER BY a.date DESC, c.name ASC, sec.name ASC, e.roll_number ASC
      LIMIT 300;
    `, { replacements: { sessionId: session?.id || 0 } });

    res.ok({ attendance: rows }, `${rows.length} attendance record(s) found.`);
  } catch (err) { next(err); }
};

exports.updateAttendance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    requireFields(req.body, ['status', 'reason']);

    const [[record]] = await sequelize.query(`
      SELECT a.id, a.status FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.id = :id AND s.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId } });
    if (!record) return res.fail('Attendance record not found or unauthorized.', [], 404);

    await sequelize.query(`
      UPDATE attendance
      SET status = :status,
          override_reason = :reason,
          marked_by = :markedBy,
          marked_at = NOW(),
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        status,
        reason,
        markedBy: req.user.id,
      },
    });

    await audit('attendance', Number(id), {
      field: 'status',
      oldValue: record.status,
      newValue: status,
      reason: `Admin override: ${reason}`,
    }, req);

    res.ok({ id: Number(id), status }, 'Attendance updated by admin.');
  } catch (err) { next(err); }
};

exports.marks = async (req, res, next) => {
  try {
    const session = await getCurrentSession(req.user.school_id);
    const [rows] = await sequelize.query(`
      SELECT
        er.id,
        er.exam_id,
        er.enrollment_id,
        er.subject_id,
        er.marks_obtained,
        er.grade,
        er.is_absent,
        er.is_pass,
        er.override_reason,
        ex.name AS exam_name,
        s.first_name,
        s.last_name,
        e.roll_number,
        c.name AS class_name,
        c.stream AS class_stream,
        sec.name AS section_name,
        sub.name AS subject_name
      FROM exam_results er
      JOIN exams ex ON ex.id = er.exam_id
      JOIN enrollments e ON e.id = er.enrollment_id
      JOIN students s ON s.id = e.student_id
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      JOIN subjects sub ON sub.id = er.subject_id
      WHERE e.session_id = :sessionId
      ORDER BY ex.id DESC, c.name ASC, sec.name ASC, e.roll_number ASC
      LIMIT 300;
    `, { replacements: { sessionId: session?.id || 0 } });

    res.ok({ marks: rows }, `${rows.length} mark record(s) found.`);
  } catch (err) { next(err); }
};

exports.updateMark = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { marks_obtained, is_absent = false, reason } = req.body;
    requireFields(req.body, ['reason']);

    const [[record]] = await sequelize.query(`
      SELECT er.id, er.marks_obtained, er.is_absent, er.subject_id, er.exam_id, ex.total_marks
      FROM exam_results er
      JOIN exams ex ON ex.id = er.exam_id
      JOIN enrollments e ON e.id = er.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE er.id = :id AND s.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId } });
    if (!record) return res.fail('Mark record not found or unauthorized.', [], 404);

    if (!is_absent && (marks_obtained === undefined || marks_obtained === null || Number(marks_obtained) < 0 || Number(marks_obtained) > Number(record.total_marks))) {
      return res.fail('marks_obtained must be within valid exam range.', [], 422);
    }

    await sequelize.query(`
      UPDATE exam_results
      SET marks_obtained = :marksObtained,
          is_absent = :isAbsent,
          override_reason = :reason,
          entered_by = :enteredBy,
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        marksObtained: is_absent ? null : marks_obtained,
        isAbsent: Boolean(is_absent),
        reason,
        enteredBy: req.user.id,
      },
    });

    await audit('exam_results', Number(id), {
      field: 'marks_obtained',
      oldValue: record.marks_obtained,
      newValue: is_absent ? 'ABSENT' : marks_obtained,
      reason: `Admin override: ${reason}`,
    }, req);

    res.ok({ id: Number(id) }, 'Marks updated by admin.');
  } catch (err) { next(err); }
};

exports.remarks = async (req, res, next) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        sr.id,
        sr.student_id,
        sr.teacher_id,
        sr.remark_type,
        sr.remark_text,
        sr.visibility,
        sr.is_edited,
        sr.is_deleted,
        sr.created_at,
        CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
        s.first_name,
        s.last_name,
        e.roll_number,
        c.name AS class_name,
        c.stream AS class_stream,
        sec.name AS section_name
      FROM student_remarks sr
      JOIN students s ON s.id = sr.student_id
      JOIN enrollments e ON e.id = sr.enrollment_id
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      JOIN teachers t ON t.id = sr.teacher_id
      WHERE sr.is_deleted = false
        AND s.school_id = :schoolId
      ORDER BY sr.created_at DESC
      LIMIT 300;
    `, {
      replacements: {
        schoolId: req.user.school_id,
      },
    });

    res.ok({ remarks: rows }, `${rows.length} remark(s) found.`);
  } catch (err) { next(err); }
};

exports.updateRemark = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { remark_text, visibility, reason } = req.body;
    requireFields(req.body, ['remark_text', 'reason']);

    const [[record]] = await sequelize.query(`
      SELECT sr.id, sr.remark_text, sr.visibility
      FROM student_remarks sr
      JOIN students s ON s.id = sr.student_id
      WHERE sr.id = :id AND sr.is_deleted = false AND s.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId } });
    if (!record) return res.fail('Remark not found or unauthorized.', [], 404);

    await sequelize.query(`
      UPDATE student_remarks
      SET remark_text = :remarkText,
          visibility = COALESCE(:visibility, visibility),
          is_edited = true,
          edited_at = NOW(),
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        remarkText: remark_text,
        visibility: visibility || null,
      },
    });

    await audit('student_remarks', Number(id), {
      field: 'remark_text',
      oldValue: record.remark_text,
      newValue: remark_text,
      reason: `Admin override: ${reason}`,
    }, req);

    res.ok({ id: Number(id) }, 'Remark updated by admin.');
  } catch (err) { next(err); }
};

exports.revokeLeave = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[leave]] = await sequelize.query(`
      SELECT tl.id, tl.status, tl.teacher_id, tl.leave_type, tl.days_count, tl.from_date
      FROM teacher_leaves tl
      JOIN teachers t ON t.id = tl.teacher_id
      WHERE tl.id = :id AND t.school_id = :schoolId;
    `, { replacements: { id, schoolId } });

    if (!leave) return res.fail('Leave application not found.', [], 404);
    if (leave.status !== 'approved') {
      return res.fail('Only approved leave applications can be revoked.', [], 422);
    }

    await sequelize.transaction(async (t) => {
      await sequelize.query(`
        UPDATE teacher_leaves
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { id }, transaction: t });

      if (leave.leave_type !== 'without_pay') {
        await sequelize.query(`
          UPDATE leave_balances
          SET used = GREATEST(used - :daysCount, 0),
              remaining = remaining + :daysCount,
              updated_at = NOW()
          WHERE teacher_id = :teacherId
            AND session_id = (
              SELECT id FROM sessions
              WHERE school_id = :schoolId
              ORDER BY CASE WHEN is_current=true THEN 0 ELSE 1 END,
                       start_date DESC
              LIMIT 1
            )
            AND leave_type = :leaveType;
        `, {
          replacements: {
            daysCount: leave.days_count,
            teacherId: leave.teacher_id,
            schoolId,
            leaveType: leave.leave_type
          },
          transaction: t
        });
      }

      await audit('teacher_leaves', Number(id), {
        field: 'status',
        oldValue: 'approved',
        newValue: 'cancelled',
        reason: 'Admin revoked approved leave application',
      }, req);
    });

    // FCM Notification for Revoke
    sendNotification({
      teacherId: leave.teacher_id,
      title: 'Leave Application Revoked',
      content: `Your approved leave application for ${leave.from_date} has been revoked by the administrator.`,
      type: 'leave_status',
      data: { leave_id: leave.id, status: 'cancelled' }
    }).catch(err => console.error('FCM Error (Revoke):', err));

    // Create System Notice for Revoke
    sequelize.query(`
      INSERT INTO notices (
        school_id, title, body, posted_by_user_id, posted_by_role, audience, 
        target_teacher_id, priority, created_at, updated_at
      ) VALUES (
        :schoolId, :title, :body, :userId, :role, 'specific_teacher',
        :targetTeacherId, 'urgent', NOW(), NOW()
      )
    `, {
      replacements: {
        schoolId: req.user.school_id,
        title: 'Leave Application Revoked',
        body: `Your approved leave application for ${leave.from_date} has been revoked by the administrator.`,
        userId: req.user.id,
        role: req.user.role,
        targetTeacherId: leave.teacher_id
      }
    }).catch(err => console.error('Notice Error (Revoke):', err));

    res.ok({ id: Number(id) }, 'Leave application revoked.');
  } catch (err) { next(err); }
};

exports.getLeaveBalances = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;

    const [balances] = await sequelize.query(`
      SELECT
        t.id AS teacher_id,
        CONCAT(t.first_name, ' ', t.last_name) AS name,
        t.employee_id,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'leave_type', lb.leave_type,
            'total_allowed', lb.total_allowed,
            'used', lb.used,
            'remaining', lb.remaining,
            'session_id', lb.session_id
          )
        ) FILTER (WHERE lb.id IS NOT NULL) AS balances
      FROM teachers t
      LEFT JOIN leave_balances lb ON lb.teacher_id = t.id
      JOIN sessions s ON s.id = lb.session_id AND s.is_current = true
      WHERE t.school_id = :schoolId
        AND t.is_deleted = false
      GROUP BY t.id, t.first_name, t.last_name, t.employee_id
      ORDER BY t.first_name ASC;
    `, { replacements: { schoolId } });

    res.ok({ balances }, 'Teacher leave balances retrieved.');
  } catch (err) { next(err); }
};

exports.updateLeaveBalance = async (req, res, next) => {
  try {
    const { teacher_id } = req.params;
    const { leave_type, total_allowed, session_id } = req.body;
    const schoolId = req.user.school_id;

    if (!leave_type || total_allowed == null || !session_id) {
      return res.fail('leave_type, total_allowed and session_id are required.', [], 422);
    }

    const [[balance]] = await sequelize.query(`
      SELECT id, used FROM leave_balances
      WHERE teacher_id = :teacher_id AND leave_type = :leave_type AND session_id = :session_id;
    `, { replacements: { teacher_id, leave_type, session_id } });

    if (!balance) return res.fail('Leave balance record not found.', [], 404);

    const newRemaining = Math.max(0, Number(total_allowed) - Number(balance.used));

    await sequelize.query(`
      UPDATE leave_balances
      SET total_allowed = :total_allowed,
          remaining = :newRemaining,
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        total_allowed: Number(total_allowed),
        newRemaining,
        id: balance.id
      }
    });

    await audit('leave_balances', balance.id, {
      field: 'total_allowed',
      oldValue: null,
      newValue: total_allowed,
      reason: `Admin updated ${leave_type} leave balance for teacher ${teacher_id}`,
    }, req);

    res.ok({ id: balance.id }, 'Leave balance updated.');
  } catch (err) { next(err); }
};
