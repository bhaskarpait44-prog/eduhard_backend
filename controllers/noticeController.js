'use strict';

const sequelize = require('../config/database');
const { sendPushToStudents, sendPushToUsers, sendPushToTeachers } = require('../utils/pushNotifier');
const { Notice } = require('../models');
const { invalidateCache } = require('../middlewares/cache');

/**
 * Helper to resolve audience to student IDs for push notifications
 */
async function getTargetStudentIds(schoolId, audience, { target_class_id, target_section_id, target_student_id }) {
  let query = '';
  let replacements = { schoolId };

  if (audience === 'school_wide' || audience === 'everyone' || audience === 'all_students') {
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
 * Helper to resolve audience to staff user IDs and teacher IDs for push notifications.
 * Returns { userIds: [], teacherIds: [] }
 */
async function getTargetStaffIds(schoolId, audience, { target_teacher_id }) {
  const result = { userIds: [], teacherIds: [] };
  const replacements = { schoolId };

  if (audience === 'school_wide' || audience === 'everyone') {
    // Get all staff users
    const [users] = await sequelize.query(`
      SELECT id FROM users WHERE school_id = :schoolId AND is_active = true AND is_deleted = false AND role != 'student'
    `, { replacements });
    result.userIds = users.map(u => u.id);
    
    // Get all teachers
    const [teachers] = await sequelize.query(`
      SELECT id FROM teachers WHERE school_id = :schoolId AND is_active = true AND is_deleted = false
    `, { replacements });
    result.teacherIds = teachers.map(t => t.id);
    
  } else if (audience === 'teachers') {
    const [teachers] = await sequelize.query(`
      SELECT id FROM teachers WHERE school_id = :schoolId AND is_active = true AND is_deleted = false
    `, { replacements });
    result.teacherIds = teachers.map(t => t.id);
    
  } else if (audience === 'accountants') {
    const [users] = await sequelize.query(`
      SELECT id FROM users WHERE school_id = :schoolId AND role = 'accountant' AND is_active = true AND is_deleted = false
    `, { replacements });
    result.userIds = users.map(u => u.id);
    
  } else if (audience === 'receptionists') {
    const [users] = await sequelize.query(`
      SELECT id FROM users WHERE school_id = :schoolId AND role = 'receptionist' AND is_active = true AND is_deleted = false
    `, { replacements });
    result.userIds = users.map(u => u.id);
    
  } else if (audience === 'librarians') {
    const [users] = await sequelize.query(`
      SELECT id FROM users WHERE school_id = :schoolId AND role = 'librarian' AND is_active = true AND is_deleted = false
    `, { replacements });
    result.userIds = users.map(u => u.id);
    
  } else if (audience === 'specific_teacher') {
    result.teacherIds = [target_teacher_id];
  }

  return result;
}

/**
 * Helper to fire push notifications in background
 */
async function fireNoticePush(notice, studentIds, staffIds) {
  const payload = {
    title: notice.title,
    body: (notice.body || notice.content || '').length > 100 
      ? (notice.body || notice.content).substring(0, 97) + '...' 
      : (notice.body || notice.content),
    data: { 
      type: 'notice', 
      notice_id: notice.id,
      priority: notice.priority
    }
  };

  try {
    if (studentIds?.length > 0) {
      await sendPushToStudents(studentIds, payload);
    }
    if (staffIds?.userIds?.length > 0) {
      await sendPushToUsers(staffIds.userIds, payload);
    }
    if (staffIds?.teacherIds?.length > 0) {
      await sendPushToTeachers(staffIds.teacherIds, payload);
    }
  } catch (err) {
    console.error('[fireNoticePush] Error dispatching notices:', err);
  }
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
    if (audience === 'all_students' || audience === 'whole_school' || audience === 'all_classes' || audience === 'everyone') audience = 'school_wide';
    if (audience === 'all_parents') audience = 'parents';
    if (audience === 'all_accountants') audience = 'accountants';
    if (audience === 'all_teachers') audience = 'teachers';
    if (audience === 'all_receptionists') audience = 'receptionists';
    
    const schoolId = req.user.school_id;
    if (!schoolId) {
       return res.fail('School ID is missing from your profile. Please contact support.', [], 400);
    }
    const userId = req.user.id;
    let role = req.user.role;
    
    // Final safety check for roles allowed in DB ENUM
    if (role === 'super_admin' || role?.includes('admin')) role = 'admin';
    if (!['admin', 'teacher', 'accountant', 'receptionist', 'librarian'].includes(role)) {
       role = 'admin'; // Fallback to admin for system-posted notices if needed
    }

    const attachment_path = req.file ? req.file.path.replace(/\\/g, '/') : null;
    const isSchoolWide = is_school_wide === 'true' || is_school_wide === true || 
                       ['school_wide', 'all_students', 'whole_school', 'all_classes', 'everyone'].includes(audience);

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
    invalidateCache(schoolId, '/api/notices*');
    res.ok(createdNotice, 'Notice posted successfully.', 201);

    // Push notifications in background
    (async () => {
      try {
        const studentIds = await getTargetStudentIds(schoolId, audience, { 
          target_class_id: parseInt(target_class_id) || null, 
          target_section_id: parseInt(target_section_id) || null, 
          target_student_id: parseInt(target_student_id) || null 
        });
        
        const staffIds = await getTargetStaffIds(schoolId, audience, {
          target_teacher_id: parseInt(target_teacher_id) || null
        });

        fireNoticePush(createdNotice, studentIds, staffIds);
      } catch (err) {
        console.error('[createNotice] Push background error:', err);
      }
    })();
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
             CONCAT(st.first_name, ' ', st.last_name) as student_name,
             CONCAT(tt.first_name, ' ', tt.last_name) as target_teacher_name
      FROM notices n
      LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant', 'receptionist', 'librarian')
      LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
      LEFT JOIN classes c ON c.id = n.target_class_id
      LEFT JOIN sections s ON s.id = n.target_section_id
      LEFT JOIN students st ON st.id = n.target_student_id
      LEFT JOIN teachers tt ON tt.id = n.target_teacher_id
      ${where}
      ORDER BY n.created_at DESC
      LIMIT :limit OFFSET :offset
    `, { replacements: { ...replacements, limit: pp, offset } });

    // DEBUG LOG
    try {
      require('fs').appendFileSync('notice_debug.log', `[${new Date().toISOString()}] listAllNotices: schoolId=${schoolId}, count=${notices.length}, total=${count}\n`);
    } catch (e) {}

    res.ok({ notices, pagination: { total: count, page: p, perPage: pp, totalPages: Math.ceil(count / pp) } });
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
    if (req.user.role !== 'admin' && (
      notice.posted_by_role !== req.user.role ||
      Number(notice.posted_by_user_id) !== Number(req.user.id)
    )) {
      return res.fail('You can only edit notices posted by you.', [], 403);
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (body !== undefined) updateData.body = body;
    if (priority !== undefined) updateData.priority = priority;
    if (expires_at !== undefined) updateData.expires_at = expires_at || null;
    if (attachment_path !== undefined) updateData.attachment_path = attachment_path;

    await notice.update(updateData);
    invalidateCache(schoolId, '/api/notices*');
    res.ok(notice, 'Notice updated successfully.');
  } catch (err) { next(err); }
};

exports.deleteNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    let ownershipWhere = '';
    const replacements = { id, schoolId };
    if (req.user.role !== 'admin') {
      ownershipWhere = 'AND posted_by_role = :role AND posted_by_user_id = :userId';
      replacements.role = req.user.role;
      replacements.userId = req.user.id;
    }
    const [result] = await sequelize.query(`
      UPDATE notices
      SET is_deleted = true
      WHERE id = :id AND school_id = :schoolId ${ownershipWhere}
      RETURNING id
    `, { replacements });
    if (result.length === 0) return res.fail('Notice not found.', [], 404);
    invalidateCache(schoolId, '/api/notices*');
    res.ok(null, 'Notice deleted.');
  } catch (err) { next(err); }
};

// ── Teacher Functions ────────────────────────────────────────────────────────

exports.listTeacherNotices = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;

    const [notices] = await sequelize.query(`
      WITH combined_notices AS (
        SELECT 
          n.id, n.school_id, n.title, n.body, n.posted_by_user_id, n.posted_by_role::text AS posted_by_role,
          n.audience::text AS audience, n.is_school_wide, n.target_class_id, n.target_section_id,
          n.target_student_id, n.target_teacher_id, n.target_subject_id, n.priority::text AS priority,
          n.expires_at, n.attachment_path, n.is_deleted, n.created_at, n.updated_at,
          COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name,
          'unified' as source
        FROM notices n
        LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant', 'receptionist', 'librarian')
        LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
        WHERE n.school_id = :schoolId AND n.is_deleted = false
          AND (n.expires_at IS NULL OR n.expires_at > NOW())


        UNION ALL

        SELECT 
          tn.id, NULL as school_id, tn.title, tn.content as body, tn.teacher_id as posted_by_user_id, 
          'teacher' as posted_by_role, 
          CASE tn.target_scope::text
            WHEN 'my_class_only' THEN 'class'
            WHEN 'whole_class' THEN 'class'
            WHEN 'specific_section' THEN 'section'
            WHEN 'whole_school' THEN 'school_wide'
            WHEN 'all_students' THEN 'school_wide'
            WHEN 'specific_student' THEN 'student'
            WHEN 'specific_subject' THEN 'subject_wise'
            ELSE tn.target_scope::text
          END as audience,
          (tn.target_scope::text IN ('all_students', 'whole_school', 'all_classes', 'everyone')) as is_school_wide,
          tn.class_id as target_class_id, tn.section_id as target_section_id, tn.target_student_id,
          tn.target_teacher_id, tn.subject_id as target_subject_id, tn.category::text as priority,
          tn.expiry_date as expires_at, tn.attachment_path, false as is_deleted,
          tn.publish_date as created_at, tn.updated_at,
          COALESCE(CONCAT(t.first_name, ' ', t.last_name), 'School') as posted_by_name,
          'teacher_notices' as source
        FROM teacher_notices tn
        LEFT JOIN teachers t ON t.id = tn.teacher_id
        WHERE tn.is_active = true
          AND (tn.expiry_date IS NULL OR tn.expiry_date > NOW())
          AND (
            t.school_id = :schoolId
            OR (tn.teacher_id IS NULL AND EXISTS (
              SELECT 1 FROM users u2
              WHERE u2.id = tn.created_by_user_id AND u2.school_id = :schoolId
            ))
          )
      )
      SELECT n.*,
             (CASE 
               WHEN n.source = 'unified' THEN EXISTS(
                 SELECT 1 FROM notice_reads nr 
                 WHERE nr.notice_id = n.id 
                 AND (nr.teacher_id = :userId OR nr.user_id = :userId)
               ) 
               WHEN n.source = 'teacher_notices' THEN EXISTS(
                 SELECT 1 FROM teacher_notice_reads tnr 
                 WHERE tnr.notice_id = n.id 
                 AND (tnr.teacher_id = :userId OR tnr.user_id = :userId)
               )
               ELSE false 
             END) as is_read,
             (
               (n.source = 'unified' AND n.posted_by_role = 'teacher' AND n.posted_by_user_id = :userId)
               OR
               (n.source = 'teacher_notices' AND n.posted_by_user_id IN (
                 SELECT id FROM teachers WHERE email = (SELECT email FROM users WHERE id = :userId)
               ))
             ) as can_manage
      FROM combined_notices n
      WHERE 
        n.is_school_wide = true 
        OR LOWER(n.audience::text) IN ('school_wide', 'all_students', 'whole_school', 'all_classes', 'everyone')
        OR LOWER(n.audience::text) = 'teachers'
        OR (LOWER(n.audience::text) = 'specific_teacher' AND n.target_teacher_id = :userId)
        OR (n.posted_by_user_id = :userId AND n.posted_by_role = 'teacher')      ORDER BY n.created_at DESC
    `, { replacements: { userId, schoolId } });

    res.ok({ notices });
  } catch (err) { next(err); }
};

exports.markTeacherRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { source = 'unified' } = req.query;
    const userId = req.user.id; // teacher_id

    if (source === 'teacher_notices') {
      await sequelize.query(`
        INSERT INTO teacher_notice_reads (notice_id, teacher_id, read_at)
        VALUES (:noticeId, :userId, NOW())
        ON CONFLICT (notice_id, teacher_id) DO UPDATE SET read_at = NOW()
      `, { replacements: { noticeId: id, userId } });
    } else {
      // Check if it's actually a unified notice first
      const [[exists]] = await sequelize.query(`SELECT id FROM notices WHERE id = :id LIMIT 1`, { replacements: { id } });
      
      if (exists) {
        await sequelize.query(`
          INSERT INTO notice_reads (notice_id, teacher_id, read_at)
          VALUES (:noticeId, :userId, NOW())
          ON CONFLICT (notice_id, teacher_id) DO UPDATE SET read_at = NOW()
        `, { replacements: { noticeId: id, userId } });
      } else {
        // Fallback: try teacher_notices if it wasn't specified but ID exists there
        await sequelize.query(`
          INSERT INTO teacher_notice_reads (notice_id, teacher_id, read_at)
          VALUES (:noticeId, :userId, NOW())
          ON CONFLICT (notice_id, teacher_id) DO UPDATE SET read_at = NOW()
        `, { replacements: { noticeId: id, userId } });
      }
    }
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
      WITH combined_notices AS (
        SELECT 
          n.id, n.school_id, n.title, n.body, n.posted_by_user_id, n.posted_by_role::text AS posted_by_role,
          n.audience::text AS audience, n.is_school_wide, n.target_class_id, n.target_section_id,
          n.target_student_id, n.target_teacher_id, n.target_subject_id, n.priority::text AS priority,
          n.expires_at, n.attachment_path, n.is_deleted, n.created_at, n.updated_at,
          COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name,
          c.name as class_name,
          'unified' as source
        FROM notices n
        LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant', 'receptionist', 'librarian')
        LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
        LEFT JOIN classes c ON c.id = n.target_class_id
        WHERE n.school_id = :schoolId AND n.is_deleted = false
          AND (n.expires_at IS NULL OR n.expires_at > NOW())


        UNION ALL

        SELECT 
          tn.id, NULL as school_id, tn.title, tn.content as body, tn.teacher_id as posted_by_user_id, 
          'teacher' as posted_by_role, 
          CASE tn.target_scope::text
            WHEN 'my_class_only' THEN 'class'
            WHEN 'whole_class' THEN 'class'
            WHEN 'specific_section' THEN 'section'
            WHEN 'whole_school' THEN 'school_wide'
            WHEN 'all_students' THEN 'school_wide'
            WHEN 'specific_student' THEN 'student'
            WHEN 'specific_subject' THEN 'subject_wise'
            ELSE tn.target_scope::text
          END as audience,
          (tn.target_scope::text IN ('all_students', 'whole_school', 'all_classes', 'everyone')) as is_school_wide,
          tn.class_id as target_class_id, tn.section_id as target_section_id, tn.target_student_id,
          tn.target_teacher_id, tn.subject_id as target_subject_id, tn.category::text as priority,
          tn.expiry_date as expires_at, tn.attachment_path, false as is_deleted,
          tn.publish_date as created_at, tn.updated_at,
          COALESCE(CONCAT(t.first_name, ' ', t.last_name), 'School') as posted_by_name,
          NULL as class_name,
          'teacher_notices' as source
        FROM teacher_notices tn
        LEFT JOIN teachers t ON t.id = tn.teacher_id
        WHERE tn.is_active = true
          AND (tn.expiry_date IS NULL OR tn.expiry_date > NOW())
          AND (
            t.school_id = :schoolId
            OR (tn.teacher_id IS NULL AND EXISTS (
              SELECT 1 FROM users u2
              WHERE u2.id = tn.created_by_user_id AND u2.school_id = :schoolId
            ))
          )
      )
      SELECT n.*,
             (CASE WHEN n.source = 'unified' THEN (SELECT COUNT(*)::int FROM notice_reads nr WHERE nr.notice_id = n.id) ELSE 0 END) as read_count,
             (CASE WHEN n.source = 'unified' THEN EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = n.id AND nr.user_id = :userId) ELSE false END) as is_read
      FROM combined_notices n
      WHERE 
        n.is_school_wide = true OR
        LOWER(n.audience::text) IN ('school_wide', 'all_students', 'whole_school', 'all_classes', 'everyone') OR
        LOWER(n.audience::text) = 'accountants' OR
        (n.posted_by_user_id = :userId AND n.posted_by_role = 'accountant')
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
      WITH combined_notices AS (
        SELECT 
          n.id, n.school_id, n.title, n.body, n.posted_by_user_id, n.posted_by_role::text AS posted_by_role,
          n.audience::text AS audience, n.is_school_wide, n.target_class_id, n.target_section_id,
          n.target_student_id, n.target_teacher_id, n.target_subject_id, n.priority::text AS priority,
          n.expires_at, n.attachment_path, n.is_deleted, n.created_at, n.updated_at,
          COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name,
          'unified' as source
        FROM notices n
        LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant', 'receptionist', 'librarian')
        LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
        WHERE n.school_id = :schoolId AND n.is_deleted = false
          AND (n.expires_at IS NULL OR n.expires_at > NOW())


        UNION ALL

        SELECT 
          tn.id, NULL as school_id, tn.title, tn.content as body, tn.teacher_id as posted_by_user_id, 
          'teacher' as posted_by_role, 
          CASE tn.target_scope::text
            WHEN 'my_class_only' THEN 'class'
            WHEN 'whole_class' THEN 'class'
            WHEN 'specific_section' THEN 'section'
            WHEN 'whole_school' THEN 'school_wide'
            WHEN 'all_students' THEN 'school_wide'
            WHEN 'specific_student' THEN 'student'
            WHEN 'specific_subject' THEN 'subject_wise'
            ELSE tn.target_scope::text
          END as audience,
          (tn.target_scope::text IN ('all_students', 'whole_school', 'all_classes', 'everyone')) as is_school_wide,
          tn.class_id as target_class_id, tn.section_id as target_section_id, tn.target_student_id,
          tn.target_teacher_id, tn.subject_id as target_subject_id, tn.category::text as priority,
          tn.expiry_date as expires_at, tn.attachment_path, false as is_deleted,
          tn.publish_date as created_at, tn.updated_at,
          COALESCE(CONCAT(t.first_name, ' ', t.last_name), 'School') as posted_by_name,
          'teacher_notices' as source
        FROM teacher_notices tn
        LEFT JOIN teachers t ON t.id = tn.teacher_id
        WHERE tn.is_active = true
          AND (tn.expiry_date IS NULL OR tn.expiry_date > NOW())
          AND (
            t.school_id = :schoolId
            OR (tn.teacher_id IS NULL AND EXISTS (
              SELECT 1 FROM users u2
              WHERE u2.id = tn.created_by_user_id AND u2.school_id = :schoolId
            ))
          )
      )
      SELECT n.*,
             (CASE WHEN n.source = 'unified' THEN EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = n.id AND nr.user_id = :userId) ELSE false END) as is_read
      FROM combined_notices n
      WHERE 
        n.is_school_wide = true OR
        LOWER(n.audience::text) IN ('school_wide', 'all_students', 'whole_school', 'all_classes', 'everyone') OR
        LOWER(n.audience::text) = 'accountants' OR
        (n.posted_by_user_id = :userId AND n.posted_by_role = 'accountant')
      ORDER BY n.created_at DESC
    `, { replacements: { userId, schoolId } });

    const unreadCount = notices.filter(n => !n.is_read).length;
    res.ok({ notices, unread_count: unreadCount });
  } catch (err) { next(err); }
};

exports.listReceptionistNotices = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;

    const [notices] = await sequelize.query(`
      WITH combined_notices AS (
        SELECT 
          n.id, n.school_id, n.title, n.body, n.posted_by_user_id, n.posted_by_role::text AS posted_by_role,
          n.audience::text AS audience, n.is_school_wide, n.target_class_id, n.target_section_id,
          n.target_student_id, n.target_teacher_id, n.target_subject_id, n.priority::text AS priority,
          n.expires_at, n.attachment_path, n.is_deleted, n.created_at, n.updated_at,
          COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name,
          'unified' as source
        FROM notices n
        LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant', 'receptionist', 'librarian')
        LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
        WHERE n.school_id = :schoolId AND n.is_deleted = false
          AND (n.expires_at IS NULL OR n.expires_at > NOW())


        UNION ALL

        SELECT 
          tn.id, NULL as school_id, tn.title, tn.content as body, tn.teacher_id as posted_by_user_id, 
          'teacher' as posted_by_role, 
          CASE tn.target_scope::text
            WHEN 'my_class_only' THEN 'class'
            WHEN 'whole_class' THEN 'class'
            WHEN 'specific_section' THEN 'section'
            WHEN 'whole_school' THEN 'school_wide'
            WHEN 'all_students' THEN 'school_wide'
            WHEN 'specific_student' THEN 'student'
            WHEN 'specific_subject' THEN 'subject_wise'
            ELSE tn.target_scope::text
          END as audience,
          (tn.target_scope::text IN ('all_students', 'whole_school', 'all_classes', 'everyone')) as is_school_wide,
          tn.class_id as target_class_id, tn.section_id as target_section_id, tn.target_student_id,
          tn.target_teacher_id, tn.subject_id as target_subject_id, tn.category::text as priority,
          tn.expiry_date as expires_at, tn.attachment_path, false as is_deleted,
          tn.publish_date as created_at, tn.updated_at,
          COALESCE(CONCAT(t.first_name, ' ', t.last_name), 'School') as posted_by_name,
          'teacher_notices' as source
        FROM teacher_notices tn
        LEFT JOIN teachers t ON t.id = tn.teacher_id
        WHERE tn.is_active = true
          AND (tn.expiry_date IS NULL OR tn.expiry_date > NOW())
          AND (
            t.school_id = :schoolId
            OR (tn.teacher_id IS NULL AND EXISTS (
              SELECT 1 FROM users u2
              WHERE u2.id = tn.created_by_user_id AND u2.school_id = :schoolId
            ))
          )
      )
      SELECT n.*,
             (CASE WHEN n.source = 'unified' THEN EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = n.id AND nr.user_id = :userId) ELSE false END) as is_read
      FROM combined_notices n
      WHERE 
        n.is_school_wide = true OR
        LOWER(n.audience::text) IN ('school_wide', 'all_students', 'whole_school', 'all_classes', 'everyone') OR
        LOWER(n.audience::text) = 'receptionists'
      ORDER BY n.created_at DESC
    `, { replacements: { userId, schoolId } });

    res.ok({ notices, unread_count: notices.filter(n => !n.is_read).length });
  } catch (err) { next(err); }
};

exports.listLibrarianNotices = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;

    const [notices] = await sequelize.query(`
      WITH combined_notices AS (
        SELECT 
          n.id, n.school_id, n.title, n.body, n.posted_by_user_id, n.posted_by_role::text AS posted_by_role,
          n.audience::text AS audience, n.is_school_wide, n.target_class_id, n.target_section_id,
          n.target_student_id, n.target_teacher_id, n.target_subject_id, n.priority::text AS priority,
          n.expires_at, n.attachment_path, n.is_deleted, n.created_at, n.updated_at,
          COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) as posted_by_name,
          'unified' as source
        FROM notices n
        LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant', 'receptionist', 'librarian')
        LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
        WHERE n.school_id = :schoolId AND n.is_deleted = false
          AND (n.expires_at IS NULL OR n.expires_at > NOW())


        UNION ALL

        SELECT 
          tn.id, NULL as school_id, tn.title, tn.content as body, tn.teacher_id as posted_by_user_id, 
          'teacher' as posted_by_role, 
          CASE tn.target_scope::text
            WHEN 'my_class_only' THEN 'class'
            WHEN 'whole_class' THEN 'class'
            WHEN 'specific_section' THEN 'section'
            WHEN 'whole_school' THEN 'school_wide'
            WHEN 'all_students' THEN 'school_wide'
            WHEN 'specific_student' THEN 'student'
            WHEN 'specific_subject' THEN 'subject_wise'
            ELSE tn.target_scope::text
          END as audience,
          (tn.target_scope::text IN ('all_students', 'whole_school', 'all_classes', 'everyone')) as is_school_wide,
          tn.class_id as target_class_id, tn.section_id as target_section_id, tn.target_student_id,
          tn.target_teacher_id, tn.subject_id as target_subject_id, tn.category::text as priority,
          tn.expiry_date as expires_at, tn.attachment_path, false as is_deleted,
          tn.publish_date as created_at, tn.updated_at,
          COALESCE(CONCAT(t.first_name, ' ', t.last_name), 'School') as posted_by_name,
          'teacher_notices' as source
        FROM teacher_notices tn
        LEFT JOIN teachers t ON t.id = tn.teacher_id
        WHERE tn.is_active = true
          AND (tn.expiry_date IS NULL OR tn.expiry_date > NOW())
          AND (
            t.school_id = :schoolId
            OR (tn.teacher_id IS NULL AND EXISTS (
              SELECT 1 FROM users u2
              WHERE u2.id = tn.created_by_user_id AND u2.school_id = :schoolId
            ))
          )
      )
      SELECT n.*,
             (CASE WHEN n.source = 'unified' THEN EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = n.id AND nr.user_id = :userId) ELSE false END) as is_read
      FROM combined_notices n
      WHERE 
        n.is_school_wide = true OR
        LOWER(n.audience::text) IN ('school_wide', 'all_students', 'whole_school', 'all_classes', 'everyone') OR
        LOWER(n.audience::text) = 'librarians'
      ORDER BY n.created_at DESC
    `, { replacements: { userId, schoolId } });

    res.ok({ notices, unread_count: notices.filter(n => !n.is_read).length });
  } catch (err) { next(err); }
};

// ── Student Functions ────────────────────────────────────────────────────────

exports.getStudentNotices = async (req, res, next) => {
  try {
    const studentId = Number(req.user.student_id || req.user.id);
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT
        s.id, s.school_id, e.id AS enrollment_id, e.class_id, e.section_id, e.session_id
      FROM students s
      LEFT JOIN LATERAL (
        SELECT en.id, en.class_id, en.section_id, en.session_id, en.status
        FROM enrollments en
        WHERE en.student_id = s.id
        ORDER BY CASE WHEN en.status = 'active' THEN 0 ELSE 1 END, en.joined_date DESC, en.id DESC
        LIMIT 1
      ) e ON true
      WHERE s.id = :studentId AND s.school_id = :schoolId AND s.is_deleted = false
      LIMIT 1;
    `, { replacements: { studentId, schoolId } });

    if (!student) return res.fail('Student record not found or inactive.', [], 404);

    const classId = student.class_id;
    const sectionId = student.section_id;

    const [notices] = await sequelize.query(`
      WITH combined_notices AS (
        SELECT 
          n.id, n.title, n.body, n.audience::text, n.priority::text,
          n.created_at, n.expires_at, n.target_class_id, n.target_section_id, 
          n.target_student_id, n.target_subject_id, n.is_school_wide,
          COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) AS posted_by_name,
          n.posted_by_role::text, n.attachment_path,
          'unified' AS source
        FROM notices n
        LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant', 'receptionist', 'librarian')
        LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
        WHERE n.school_id = :schoolId AND n.is_deleted = false
          AND (n.expires_at IS NULL OR n.expires_at > NOW())


        UNION ALL

        SELECT 
          tn.id, tn.title, tn.content AS body, 
          CASE tn.target_scope::text
            WHEN 'my_class_only' THEN 'class'
            WHEN 'whole_class' THEN 'class'
            WHEN 'specific_section' THEN 'section'
            WHEN 'whole_school' THEN 'school_wide'
            WHEN 'all_students' THEN 'school_wide'
            WHEN 'specific_student' THEN 'student'
            WHEN 'specific_subject' THEN 'subject_wise'
            ELSE tn.target_scope::text
          END AS audience, 
          tn.category::text AS priority,
          tn.publish_date AS created_at, tn.expiry_date AS expires_at, tn.class_id AS target_class_id, 
          tn.section_id AS target_section_id, tn.target_student_id, tn.subject_id AS target_subject_id,
          (tn.target_scope::text IN ('all_students', 'whole_school', 'all_classes', 'everyone')) AS is_school_wide,
          COALESCE(NULLIF(TRIM(CONCAT(t.first_name, ' ', t.last_name)), ''), admin.name, 'School') AS posted_by_name,
          COALESCE(tn.created_by_role, 'teacher')::text AS posted_by_role, tn.attachment_path,
          'teacher_notices' AS source
        FROM teacher_notices tn
        LEFT JOIN teachers t ON t.id = tn.teacher_id
        LEFT JOIN users admin ON admin.id = tn.created_by_user_id
        WHERE tn.is_active = true
          AND (tn.expiry_date IS NULL OR tn.expiry_date > NOW())
          AND (
            t.school_id = :schoolId
            OR (tn.teacher_id IS NULL AND EXISTS (
              SELECT 1 FROM users u2
              WHERE u2.id = tn.created_by_user_id AND u2.school_id = :schoolId
            ))
          )
      )
      SELECT n.*,
             (CASE 
               WHEN n.source = 'unified' THEN EXISTS(
                 SELECT 1 FROM notice_reads nr 
                 WHERE nr.notice_id = n.id AND nr.student_id = :studentId
               ) 
               WHEN n.source = 'teacher_notices' THEN EXISTS(
                 SELECT 1 FROM student_notice_reads snr 
                 WHERE snr.notice_id = n.id AND snr.student_id = :studentId
               )
               ELSE false 
             END) AS is_read,
             (CASE WHEN n.source = 'unified' THEN EXISTS(SELECT 1 FROM notice_pins np WHERE np.notice_id = n.id AND np.student_id = :studentId) ELSE false END) AS is_pinned
      FROM combined_notices n
      WHERE 
        n.is_school_wide = true 
        OR LOWER(n.audience::text) IN ('school_wide', 'all_students', 'whole_school', 'all_classes', 'everyone')
        OR (LOWER(n.audience::text) IN ('class', 'whole_class', 'my_class_only') AND n.target_class_id = :classId)
        OR (LOWER(n.audience::text) IN ('section', 'specific_section') AND n.target_section_id = :sectionId)
        OR (LOWER(n.audience::text) IN ('student', 'specific_student') AND n.target_student_id = :studentId)
        OR (LOWER(n.audience::text) IN ('subject_wise', 'specific_subject') AND EXISTS (
          SELECT 1 FROM student_subjects ss 
          WHERE ss.student_id = :studentId AND ss.subject_id = n.target_subject_id AND ss.is_active = true
        ))
      ORDER BY is_pinned DESC, n.created_at DESC
    `, { 
      replacements: { schoolId, studentId, classId: classId || 0, sectionId: sectionId || 0 } 
    });

    res.ok({ notices, unread_count: notices.filter(n => !n.is_read).length });
  } catch (err) { next(err); }
};

exports.markRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { source = 'unified' } = req.query;
    const studentId = Number(req.user.student_id || req.user.id);
    
    if (source === 'teacher_notices') {
      await sequelize.query(`
        INSERT INTO student_notice_reads (notice_id, student_id, read_at)
        VALUES (:id, :studentId, NOW())
        ON CONFLICT (notice_id, student_id) DO UPDATE SET read_at = NOW()
      `, { replacements: { id, studentId } });
    } else {
      // Check if it's unified or fallback
      const [[exists]] = await sequelize.query(`SELECT id FROM notices WHERE id = :id LIMIT 1`, { replacements: { id } });
      if (exists) {
        await sequelize.query(`
          INSERT INTO notice_reads (notice_id, student_id, read_at)
          VALUES (:id, :studentId, NOW())
          ON CONFLICT (notice_id, student_id) DO UPDATE SET read_at = NOW()
        `, { replacements: { id, studentId } });
      } else {
        await sequelize.query(`
          INSERT INTO student_notice_reads (notice_id, student_id, read_at)
          VALUES (:id, :studentId, NOW())
          ON CONFLICT (notice_id, student_id) DO UPDATE SET read_at = NOW()
        `, { replacements: { id, studentId } });
      }
    }
    res.ok(null, 'Notice marked as read.');
  } catch (err) { next(err); }
};

exports.pinNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentId = Number(req.user.student_id || req.user.id);
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
    const studentId = Number(req.user.student_id || req.user.id);
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

    const [wards] = await sequelize.query(`
      SELECT s.id, e.class_id, e.section_id
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

    let actualUserId = userId;
    if (req.user.role === 'parent') {
       const [[linkedUser]] = await sequelize.query(`
         SELECT u.id FROM users u
         JOIN families f ON f.user_id = u.id
         JOIN students s ON s.family_id = f.id
         WHERE s.id IN (:studentIds) AND u.role = 'parent' AND u.school_id = :schoolId
         LIMIT 1
       `, { replacements: { studentIds, schoolId } });
       if (linkedUser) actualUserId = linkedUser.id;
    }

    const [notices] = await sequelize.query(`
      WITH combined_notices AS (
        SELECT 
          n.id, n.title, n.body, n.audience::text, n.priority::text,
          n.created_at, n.expires_at, n.target_class_id, n.target_section_id, 
          n.target_student_id, n.target_subject_id, n.is_school_wide,
          COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) AS posted_by_name,
          n.posted_by_role::text, n.attachment_path,
          'unified' AS source
        FROM notices n
        LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant', 'receptionist', 'librarian')
        LEFT JOIN teachers t ON t.id = n.posted_by_user_id AND n.posted_by_role = 'teacher'
        WHERE n.school_id = :schoolId AND n.is_deleted = false
          AND (n.expires_at IS NULL OR n.expires_at > NOW())


        UNION ALL

        SELECT 
          tn.id, tn.title, tn.content AS body, 
          CASE tn.target_scope::text
            WHEN 'my_class_only' THEN 'class'
            WHEN 'whole_class' THEN 'class'
            WHEN 'specific_section' THEN 'section'
            WHEN 'whole_school' THEN 'school_wide'
            WHEN 'all_students' THEN 'school_wide'
            WHEN 'specific_student' THEN 'student'
            WHEN 'specific_subject' THEN 'subject_wise'
            ELSE tn.target_scope::text
          END AS audience, 
          tn.category::text AS priority,
          tn.publish_date AS created_at, tn.expiry_date AS expires_at, tn.class_id AS target_class_id, 
          tn.section_id AS target_section_id, tn.target_student_id, tn.subject_id AS target_subject_id,
          (tn.target_scope::text IN ('all_students', 'whole_school', 'all_classes', 'everyone')) AS is_school_wide,
          COALESCE(NULLIF(TRIM(CONCAT(t.first_name, ' ', t.last_name)), ''), admin.name, 'School') AS posted_by_name,
          COALESCE(tn.created_by_role, 'teacher')::text AS posted_by_role, tn.attachment_path,
          'teacher_notices' AS source
        FROM teacher_notices tn
        LEFT JOIN teachers t ON t.id = tn.teacher_id
        LEFT JOIN users admin ON admin.id = tn.created_by_user_id
        WHERE tn.is_active = true
          AND (tn.expiry_date IS NULL OR tn.expiry_date > NOW())
          AND (
            t.school_id = :schoolId
            OR (tn.teacher_id IS NULL AND EXISTS (
              SELECT 1 FROM users u2
              WHERE u2.id = tn.created_by_user_id AND u2.school_id = :schoolId
            ))
          )
      )
      SELECT n.*,
             (CASE WHEN n.source = 'unified' THEN EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = n.id AND nr.user_id = :actualUserId) ELSE false END) as is_read
      FROM combined_notices n
      WHERE 
        n.is_school_wide = true 
        OR LOWER(n.audience::text) IN ('parents', 'school_wide', 'all_students', 'whole_school', 'all_classes', 'everyone')
        OR (LOWER(n.audience::text) IN ('class', 'whole_class', 'my_class_only') AND n.target_class_id IN (:classIds))
        OR (LOWER(n.audience::text) IN ('section', 'specific_section') AND n.target_section_id IN (:sectionIds))
        OR (LOWER(n.audience::text) IN ('student', 'specific_student') AND n.target_student_id IN (:studentIds))
      ORDER BY n.created_at DESC
    `, { replacements: { 
      schoolId, actualUserId, 
      studentIds: studentIds.length > 0 ? studentIds : [0], 
      classIds: classIds.length > 0 ? classIds : [0], 
      sectionIds: sectionIds.length > 0 ? sectionIds : [0] 
    } });

    res.ok({ notices, unread_count: notices.filter(n => !n.is_read).length });
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
      LEFT JOIN users u ON u.id = n.posted_by_user_id AND n.posted_by_role IN ('admin', 'accountant', 'receptionist', 'librarian')
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
