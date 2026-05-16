'use strict';

const sequelize = require('../config/database');
const { sendPushToStudents } = require('../utils/pushNotifier');
const { Notice } = require('../models');

/**
 * Helper to resolve audience to student IDs for push notifications
 */
async function getTargetStudentIds(schoolId, audience, { target_class_id, target_section_id, target_student_id }) {
  let query = '';
  let replacements = { schoolId };

  if (audience === 'school_wide' || audience === 'parents') {
    query = `SELECT id FROM students WHERE school_id = :schoolId AND is_active = true AND is_deleted = false`;
  } else if (audience === 'class') {
    query = `SELECT student_id AS id FROM enrollments WHERE class_id = :classId AND status = 'active'`;
    replacements.classId = target_class_id;
  } else if (audience === 'section') {
    query = `SELECT student_id AS id FROM enrollments WHERE section_id = :sectionId AND status = 'active'`;
    replacements.sectionId = target_section_id;
  } else if (audience === 'student') {
    return [target_student_id];
  } else {
    return [];
  }

  const [students] = await sequelize.query(query, { replacements });
  return students.map(s => s.id);
}

/**
 * Helper to fire push notifications in background
 */
function fireNoticePush(notice, studentIds) {
  if (!studentIds || studentIds.length === 0) return;
  
  sendPushToStudents(studentIds, {
    title: notice.title,
    body: (notice.body || notice.content || '').length > 100 
      ? (notice.body || notice.content).substring(0, 97) + '...' 
      : (notice.body || notice.content),
    data: { 
      type: 'notice', 
      notice_id: notice.id,
      priority: notice.priority
    }
  }).catch(err => console.error('[fireNoticePush] Error:', err));
}

// ── Admin Functions ──────────────────────────────────────────────────────────

exports.createNotice = async (req, res, next) => {
  try {
    let { 
      title, body, content, audience, target_scope, is_school_wide,
      target_class_id, class_id, target_section_id, section_id, 
      target_student_id, target_teacher_id, target_subject_id, subject_id,
      priority = 'normal', expires_at, expiry_date 
    } = req.body;
    
    // Handle aliases from mobile/different versions
    body = body || content;
    audience = audience || target_scope;
    target_class_id = target_class_id || class_id;
    target_section_id = target_section_id || section_id;
    target_subject_id = target_subject_id || subject_id;
    expires_at = expires_at || expiry_date;

    // Map mobile scopes to backend audiences
    if (audience === 'whole_class') audience = 'class';
    if (audience === 'specific_section') audience = 'section';
    if (audience === 'specific_subject') audience = 'subject_wise';
    if (audience === 'specific_student') audience = 'student';
    if (audience === 'all_students' || audience === 'whole_school' || audience === 'all_classes') audience = 'school_wide';
    if (audience === 'all_parents') audience = 'parents';
    if (audience === 'all_accountants') audience = 'accountants';
    if (audience === 'all_teachers') audience = 'teachers';
    
    const schoolId = req.user.school_id;
    if (!schoolId) {
       return res.fail('School ID is missing from your profile. Please contact support.', [], 400);
    }
    const userId = req.user.id;
    let role = req.user.role;
    
    // Final safety check for roles allowed in DB ENUM
    if (role === 'super_admin') role = 'admin';
    if (!['admin', 'teacher', 'accountant', 'staff'].includes(role)) {
       if (req.user.role.includes('admin')) role = 'admin';
    }

    const attachment_path = req.file ? req.file.path.replace(/\\/g, '/') : null;
    const isSchoolWide = is_school_wide === 'true' || is_school_wide === true || audience === 'school_wide';

    const [result] = await sequelize.query(`
      INSERT INTO notices (
        school_id, title, body, posted_by_user_id, posted_by_role, audience, is_school_wide,
        target_class_id, target_section_id, target_student_id, target_teacher_id, target_subject_id,
        priority, expires_at, attachment_path, created_at, updated_at
      ) VALUES (
        :schoolId, :title, :body, :userId, :role, :audience, :is_school_wide,
        :target_class_id, :target_section_id, :target_student_id, :target_teacher_id, :target_subject_id,
        :priority, :expires_at, :attachment_path, NOW(), NOW()
      ) RETURNING *
    `, {
      replacements: {
        schoolId, title, body: body || ' ', userId, role, audience,
        is_school_wide: !!isSchoolWide,
        target_class_id: parseInt(target_class_id) || null,
        target_section_id: parseInt(target_section_id) || null,
        target_student_id: parseInt(target_student_id) || null,
        target_teacher_id: parseInt(target_teacher_id) || null,
        target_subject_id: parseInt(target_subject_id) || null,
        priority: ['normal', 'urgent', 'info'].includes(priority) ? priority : 'normal',
        expires_at: expires_at || null,
        attachment_path
      }
    });

    const createdNotice = result[0];
    res.ok(createdNotice, 'Notice posted successfully.', 201);

    // Push notifications in background
    if (['school_wide', 'class', 'section', 'student', 'parents'].includes(audience)) {
      getTargetStudentIds(schoolId, audience, { 
        target_class_id: parseInt(target_class_id) || null, 
        target_section_id: parseInt(target_section_id) || null, 
        target_student_id: parseInt(target_student_id) || null 
      }).then(studentIds => {
        fireNoticePush(createdNotice, studentIds);
      }).catch(err => console.error('[createNotice] Push error:', err));
    }
  } catch (err) { 
    try {
      require('fs').appendFileSync('notice_error.log', `[${new Date().toISOString()}] ${err.message}\n${err.stack}\n\n`);
    } catch (e) {}
    next(err); 
  }
};

exports.listAllNotices = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    let { audience, class_id, section_id, priority, page, perPage } = req.query;
    
    // Robust pagination
    const p = Math.max(1, parseInt(page) || 1);
    const pp = Math.max(1, Math.min(100, parseInt(perPage) || 20));
    const offset = (p - 1) * pp;

    let where = 'WHERE n.school_id = :schoolId AND n.is_deleted = false';
    const replacements = { schoolId };

    if (audience) { 
      where += ' AND n.audience = :audience'; 
      replacements.audience = audience; 
    }
    if (class_id && !isNaN(Number(class_id))) { 
      where += ' AND n.target_class_id = :class_id'; 
      replacements.class_id = Number(class_id); 
    }
    if (section_id && !isNaN(Number(section_id))) { 
      where += ' AND n.target_section_id = :section_id'; 
      replacements.section_id = Number(section_id); 
    }
    if (priority) { 
      where += ' AND n.priority = :priority'; 
      replacements.priority = priority; 
    }

    const [[{ count }]] = await sequelize.query(`SELECT COUNT(*)::int FROM notices n ${where}`, { replacements });

    const [notices] = await sequelize.query(`
      SELECT n.*, 
             COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name,
             (SELECT COUNT(*)::int FROM notice_reads nr WHERE nr.notice_id = n.id) as read_count,
             c.name as class_name, s.name as section_name,
             CONCAT(st.first_name, ' ', st.last_name) as student_name
      FROM notices n
      LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant')
      LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
      LEFT JOIN classes c ON c.id = n.target_class_id
      LEFT JOIN sections s ON s.id = n.target_section_id
      LEFT JOIN students st ON st.id = n.target_student_id
      ${where}
      ORDER BY n.created_at DESC
      LIMIT :limit OFFSET :offset
    `, { replacements: { ...replacements, limit: pp, offset } });

    res.ok({ notices, pagination: { total: count, page: p, perPage: pp } });
  } catch (err) { next(err); }
};

exports.updateNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, body, priority, expires_at } = req.body;
    const schoolId = req.user.school_id;
    const attachment_path = req.file ? req.file.path.replace(/\\/g, '/') : undefined;

    const notice = await Notice.findOne({
      where: { id, school_id: schoolId, is_deleted: false }
    });

    if (!notice) return res.fail('Notice not found.', [], 404);

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (body !== undefined) updateData.body = body;
    if (priority !== undefined) updateData.priority = priority;
    if (expires_at !== undefined) updateData.expires_at = expires_at || null;
    if (attachment_path !== undefined) updateData.attachment_path = attachment_path;

    await notice.update(updateData);
    res.ok(notice, 'Notice updated successfully.');
  } catch (err) { next(err); }
};

exports.deleteNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const [result] = await sequelize.query(`UPDATE notices SET is_deleted = true WHERE id = :id AND school_id = :schoolId RETURNING id`, { replacements: { id, schoolId } });
    if (result.length === 0) return res.fail('Notice not found.', [], 404);
    res.ok(null, 'Notice deleted.');
  } catch (err) { next(err); }
};

// ── Teacher Functions ────────────────────────────────────────────────────────

exports.listTeacherNotices = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;

    const [notices] = await sequelize.query(`
      SELECT n.*, COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name
      FROM notices n
      LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant')
      LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
      WHERE n.school_id = :schoolId AND n.is_deleted = false
        AND (n.expires_at IS NULL OR n.expires_at > NOW())
        AND (
          n.is_school_wide = true OR
          n.audience = 'teachers' OR
          (n.audience = 'specific_teacher' AND n.target_teacher_id = (SELECT id FROM teachers WHERE user_id = :userId LIMIT 1)) OR
          (n.posted_by_user_id = :userId AND n.posted_by_role = 'teacher')
        )
      ORDER BY n.created_at DESC
    `, { replacements: { userId, schoolId } });

    res.ok({ notices });
  } catch (err) { next(err); }
};

exports.markTeacherRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    await sequelize.query(`
      INSERT INTO notice_reads (notice_id, user_id, read_at)
      VALUES (:noticeId, :userId, NOW())
      ON CONFLICT (notice_id, user_id) DO UPDATE SET read_at = NOW()
    `, { replacements: { noticeId: id, userId } });
    res.ok(null, 'Notice marked as read.');
  } catch (err) { next(err); }
};

// ── Accountant Functions ─────────────────────────────────────────────────────

exports.listAccountantNotices = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const role = req.user.role;
    const [notices] = await sequelize.query(`
      SELECT n.*, 
             COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name,
             c.name as class_name,
             (SELECT COUNT(*)::int FROM notice_reads nr WHERE nr.notice_id = n.id) as read_count,
             EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = n.id AND nr.user_id = :userId) as is_read
      FROM notices n
      LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant')
      LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
      LEFT JOIN classes c ON c.id = n.target_class_id
      WHERE n.school_id = :schoolId AND n.is_deleted = false
        AND (
          (n.posted_by_user_id = :userId AND n.posted_by_role = :role) OR
          n.audience = 'accountants' OR
          n.audience = 'school_wide' OR
          n.is_school_wide = true
        )
      ORDER BY n.created_at DESC
    `, { replacements: { userId, schoolId, role } });
    res.ok({ notices });
  } catch (err) { next(err); }
};

exports.listAccountantPortalNotices = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;

    const [notices] = await sequelize.query(`
      SELECT n.*, COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name,
             EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = n.id AND nr.user_id = :userId) as is_read
      FROM notices n
      LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant')
      LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
      WHERE n.school_id = :schoolId AND n.is_deleted = false
        AND (n.expires_at IS NULL OR n.expires_at > NOW())
        AND (
          n.is_school_wide = true OR
          n.audience = 'school_wide' OR
          n.audience = 'accountants' OR
          (n.posted_by_user_id = :userId AND n.posted_by_role = 'accountant')
        )
      ORDER BY n.created_at DESC
    `, { replacements: { userId, schoolId } });

    const unreadCount = notices.filter(n => !n.is_read).length;
    res.ok({ notices, unread_count: unreadCount });
  } catch (err) { next(err); }
};

// ── Student Functions ────────────────────────────────────────────────────────

exports.getStudentNotices = async (req, res, next) => {
  try {
    const studentId = Number(req.user.student_id || req.user.id);
    const schoolId = req.user.school_id;

    // Robust context retrieval similar to studentPortalController
    const [[student]] = await sequelize.query(`
      SELECT
        s.id,
        s.school_id,
        e.id AS enrollment_id,
        e.class_id,
        e.section_id,
        e.session_id
      FROM students s
      LEFT JOIN LATERAL (
        SELECT en.id, en.class_id, en.section_id, en.session_id, en.status
        FROM enrollments en
        WHERE en.student_id = s.id
        ORDER BY CASE WHEN en.status = 'active' THEN 0 ELSE 1 END, en.joined_date DESC, en.id DESC
        LIMIT 1
      ) e ON true
      WHERE s.id = :studentId
        AND s.school_id = :schoolId
        AND s.is_deleted = false
      LIMIT 1;
    `, { replacements: { studentId, schoolId } });

    if (!student) return res.fail('Student record not found or inactive.', [], 404);

    const classId = student.class_id;
    const sectionId = student.section_id;

    const [notices] = await sequelize.query(`
      WITH combined_notices AS (
        -- Unified notices table
        SELECT 
          n.id, n.title, n.body AS content, n.audience::text, n.priority::text,
          n.created_at, n.expires_at, n.target_class_id, n.target_section_id, 
          n.target_student_id, n.target_subject_id, n.is_school_wide,
          COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) AS posted_by_name,
          n.posted_by_role::text, n.attachment_path,
          'unified' AS source
        FROM notices n
        LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant')
        LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
        WHERE n.school_id = :schoolId AND n.is_deleted = false
          AND (n.expires_at IS NULL OR n.expires_at > NOW())

        UNION ALL

        -- Old teacher_notices table for compatibility
        SELECT 
          tn.id, tn.title, tn.content, tn.target_scope::text AS audience, tn.category::text AS priority,
          tn.publish_date AS created_at, tn.expiry_date AS expires_at, tn.class_id AS target_class_id, 
          tn.section_id AS target_section_id, tn.target_student_id, tn.subject_id AS target_subject_id,
          (tn.target_scope IN ('all_students', 'whole_school')) AS is_school_wide,
          COALESCE(NULLIF(TRIM(CONCAT(poster.first_name, ' ', poster.last_name)), ''), admin.name, 'School') AS posted_by_name,
          COALESCE(tn.created_by_role, 'teacher')::text AS posted_by_role, tn.attachment_path,
          'teacher_notices' AS source
        FROM teacher_notices tn
        LEFT JOIN teachers poster ON poster.id = tn.teacher_id
        LEFT JOIN users admin ON admin.id = tn.created_by_user_id
        -- We filter teacher_notices by checking if the poster belongs to the same school
        WHERE tn.is_active = true
          AND (tn.expiry_date IS NULL OR tn.expiry_date > NOW())
          AND (
            EXISTS (SELECT 1 FROM teachers t2 WHERE t2.id = tn.teacher_id AND t2.school_id = :schoolId)
            OR EXISTS (SELECT 1 FROM users u2 WHERE u2.id = tn.created_by_user_id AND u2.school_id = :schoolId)
            OR tn.teacher_id IS NULL -- System notices
          )
      )
      SELECT *,
             EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = id AND nr.student_id = :studentId) AS is_read,
             EXISTS(SELECT 1 FROM notice_pins np WHERE np.notice_id = id AND np.student_id = :studentId) AS is_pinned
      FROM combined_notices
      WHERE 
        is_school_wide = true 
        OR audience IN ('school_wide', 'all_students', 'whole_school')
        OR (audience IN ('class', 'whole_class', 'my_class_only') AND target_class_id = :classId)
        OR (audience IN ('section', 'specific_section') AND target_section_id = :sectionId)
        OR (audience IN ('student', 'specific_student') AND target_student_id = :studentId)
        OR (audience IN ('subject_wise', 'specific_subject') AND EXISTS (
          SELECT 1 FROM student_subjects ss 
          WHERE ss.student_id = :studentId AND ss.subject_id = target_subject_id AND ss.is_active = true
        ))
      ORDER BY is_pinned DESC, created_at DESC
    `, { 
      replacements: { 
        schoolId, 
        studentId, 
        classId: classId || 0, 
        sectionId: sectionId || 0 
      } 
    });

    res.ok({ notices, unread_count: notices.filter(n => !n.is_read).length });
  } catch (err) { next(err); }
};

exports.markRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;
    await sequelize.query(`
      INSERT INTO notice_reads (notice_id, student_id, read_at)
      VALUES (:id, :studentId, NOW())
      ON CONFLICT (notice_id, student_id) DO UPDATE SET read_at = NOW()
    `, { replacements: { id, studentId } });
    res.ok(null, 'Notice marked as read.');
  } catch (err) { next(err); }
};

exports.pinNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;
    await sequelize.query(`
      INSERT INTO notice_pins (notice_id, student_id, pinned_at)
      VALUES (:id, :studentId, NOW())
      ON CONFLICT (notice_id, student_id) DO NOTHING
    `, { replacements: { id, studentId } });
    res.ok(null, 'Notice pinned.');
  } catch (err) { next(err); }
};

exports.unpinNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;
    await sequelize.query(`
      DELETE FROM notice_pins WHERE notice_id = :id AND student_id = :studentId
    `, { replacements: { id, studentId } });
    res.ok(null, 'Notice unpinned.');
  } catch (err) { next(err); }
};

// ── Parent Functions ─────────────────────────────────────────────────────────

exports.getParentNotices = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;

    // A parent can be a direct User or linked via StudentProfile
    const [wards] = await sequelize.query(`
      SELECT s.id, e.class_id, e.section_id, CONCAT(s.first_name, ' ', s.last_name) as student_name
      FROM students s
      LEFT JOIN LATERAL (
        SELECT en.class_id, en.section_id, en.status
        FROM enrollments en
        WHERE en.student_id = s.id
        ORDER BY CASE WHEN en.status = 'active' THEN 0 ELSE 1 END, en.joined_date DESC, en.id DESC
        LIMIT 1
      ) e ON true
      WHERE s.school_id = :schoolId AND s.is_deleted = false
        AND (
          s.family_id IN (SELECT id FROM families WHERE user_id = :userId)
          OR s.id IN (SELECT student_id FROM student_profiles WHERE id = :userId)
        )
    `, { replacements: { userId, schoolId } });

    if (wards.length === 0) return res.ok({ notices: [], unread_count: 0 });

    const studentIds = wards.map(w => w.id);
    const classIds = [...new Set(wards.map(w => w.class_id).filter(id => id))];
    const sectionIds = [...new Set(wards.map(w => w.section_id).filter(id => id))];

    const [notices] = await sequelize.query(`
      WITH combined_notices AS (
        SELECT 
          n.id, n.title, n.body AS content, n.audience::text, n.priority::text,
          n.created_at, n.expires_at, n.target_class_id, n.target_section_id, 
          n.target_student_id, n.target_subject_id, n.is_school_wide,
          COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) AS posted_by_name,
          n.posted_by_role::text, n.attachment_path,
          'unified' AS source
        FROM notices n
        LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant')
        LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
        WHERE n.school_id = :schoolId AND n.is_deleted = false
          AND (n.expires_at IS NULL OR n.expires_at > NOW())

        UNION ALL

        SELECT 
          tn.id, tn.title, tn.content, tn.target_scope::text AS audience, tn.category::text AS priority,
          tn.publish_date AS created_at, tn.expiry_date AS expires_at, tn.class_id AS target_class_id, 
          tn.section_id AS target_section_id, tn.target_student_id, tn.subject_id AS target_subject_id,
          (tn.target_scope IN ('all_students', 'whole_school')) AS is_school_wide,
          COALESCE(NULLIF(TRIM(CONCAT(poster.first_name, ' ', poster.last_name)), ''), admin.name, 'School') AS posted_by_name,
          COALESCE(tn.created_by_role, 'teacher')::text AS posted_by_role, tn.attachment_path,
          'teacher_notices' AS source
        FROM teacher_notices tn
        LEFT JOIN teachers poster ON poster.id = tn.teacher_id
        LEFT JOIN users admin ON admin.id = tn.created_by_user_id
        WHERE tn.is_active = true
          AND (tn.expiry_date IS NULL OR tn.expiry_date > NOW())
          AND (
            EXISTS (SELECT 1 FROM teachers t2 WHERE t2.id = tn.teacher_id AND t2.school_id = :schoolId)
            OR EXISTS (SELECT 1 FROM users u2 WHERE u2.id = tn.created_by_user_id AND u2.school_id = :schoolId)
            OR tn.teacher_id IS NULL
          )
      )
      SELECT n.*,
             EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = n.id AND nr.user_id = :userId) as is_read,
             CONCAT(st.first_name, ' ', st.last_name) as target_ward_name
      FROM combined_notices n
      LEFT JOIN students st ON st.id = n.target_student_id
      WHERE 
        n.is_school_wide = true 
        OR n.audience IN ('parents', 'school_wide', 'all_students', 'whole_school')
        OR (n.audience IN ('class', 'whole_class', 'my_class_only') AND n.target_class_id IN (:classIds))
        OR (n.audience IN ('section', 'specific_section') AND n.target_section_id IN (:sectionIds))
        OR (n.audience IN ('student', 'specific_student') AND n.target_student_id IN (:studentIds))
      ORDER BY n.created_at DESC
    `, { replacements: { 
      schoolId, userId, 
      studentIds: studentIds.length > 0 ? studentIds : [0], 
      classIds: classIds.length > 0 ? classIds : [0], 
      sectionIds: sectionIds.length > 0 ? sectionIds : [0] 
    } });

    const unreadCount = notices.filter(n => !n.is_read).length;
    res.ok({ notices, unread_count: unreadCount });
  } catch (err) { next(err); }
};

exports.markParentRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    await sequelize.query(`
      INSERT INTO notice_reads (notice_id, user_id, read_at)
      VALUES (:noticeId, :userId, NOW())
      ON CONFLICT (notice_id, user_id) DO UPDATE SET read_at = NOW()
    `, { replacements: { noticeId: id, userId } });
    res.ok(null, 'Notice marked as read.');
  } catch (err) { next(err); }
};

// ── Shared Functions ─────────────────────────────────────────────────────────

exports.getNoticeById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const [[notice]] = await sequelize.query(`
      SELECT n.*, COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name,
             c.name as class_name, s.name as section_name, CONCAT(st.first_name, ' ', st.last_name) as student_name
      FROM notices n
      LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant')
      LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
      LEFT JOIN classes c ON c.id = n.target_class_id
      LEFT JOIN sections s ON s.id = n.target_section_id
      LEFT JOIN students st ON st.id = n.target_student_id
      WHERE n.id = :id AND n.school_id = :schoolId AND n.is_deleted = false
    `, { replacements: { id, schoolId } });
    if (!notice) return res.fail('Notice not found.', [], 404);
    res.ok(notice);
  } catch (err) { next(err); }
};
