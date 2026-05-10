'use strict';

const sequelize = require('../config/database');
const { sendPushToStudents } = require('../utils/pushNotifier');

/**
 * Helper to resolve audience to student IDs for push notifications
 */
async function getTargetStudentIds(schoolId, audience, { target_class_id, target_section_id, target_student_id }) {
  let query = '';
  let replacements = { schoolId };

  if (audience === 'school_wide') {
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
    body: notice.body.length > 100 ? notice.body.substring(0, 97) + '...' : notice.body,
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
    const { title, body, audience, target_class_id, target_section_id, target_student_id, priority = 'normal', expires_at } = req.body;
    const schoolId = req.user.school_id;
    const userId = req.user.id;

    const [notice] = await sequelize.query(`
      INSERT INTO notices (
        school_id, title, body, posted_by_user_id, posted_by_role, audience, 
        target_class_id, target_section_id, target_student_id, priority, expires_at, created_at, updated_at
      ) VALUES (
        :schoolId, :title, :body, :userId, 'admin', :audience, 
        :target_class_id, :target_section_id, :target_student_id, :priority, :expires_at, NOW(), NOW()
      ) RETURNING *
    `, {
      replacements: {
        schoolId, title, body, userId, audience,
        target_class_id: target_class_id || null,
        target_section_id: target_section_id || null,
        target_student_id: target_student_id || null,
        priority,
        expires_at: expires_at || null
      }
    });

    const createdNotice = notice[0];
    res.ok(createdNotice, 'Notice posted successfully.', 201);

    // Background push
    const studentIds = await getTargetStudentIds(schoolId, audience, { target_class_id, target_section_id, target_student_id });
    fireNoticePush(createdNotice, studentIds);

  } catch (err) { next(err); }
};

exports.listAllNotices = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { audience, class_id, section_id, priority, from_date, page = 1, perPage = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(perPage);

    let where = 'WHERE n.school_id = :schoolId AND n.is_deleted = false';
    const replacements = { schoolId, limit: parseInt(perPage), offset: parseInt(offset) };

    if (audience) { where += ' AND n.audience = :audience'; replacements.audience = audience; }
    if (class_id) { where += ' AND n.target_class_id = :class_id'; replacements.class_id = class_id; }
    if (section_id) { where += ' AND n.target_section_id = :section_id'; replacements.section_id = section_id; }
    if (priority) { where += ' AND n.priority = :priority'; replacements.priority = priority; }
    if (from_date) { where += ' AND n.created_at >= :from_date'; replacements.from_date = from_date; }

    const [notices] = await sequelize.query(`
      SELECT n.*, u.name as posted_by_name,
             (SELECT COUNT(*)::int FROM notice_reads nr WHERE nr.notice_id = n.id) as read_count,
             c.name as class_name, s.name as section_name,
             CONCAT(st.first_name, ' ', st.last_name) as student_name
      FROM notices n
      LEFT JOIN users u ON u.id = n.posted_by_user_id
      LEFT JOIN classes c ON c.id = n.target_class_id
      LEFT JOIN sections s ON s.id = n.target_section_id
      LEFT JOIN students st ON st.id = n.target_student_id
      ${where}
      ORDER BY n.created_at DESC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    const [[{ count }]] = await sequelize.query(`
      SELECT COUNT(*)::int as count FROM notices n ${where}
    `, { replacements });

    res.ok({
      notices,
      pagination: {
        total: count,
        page: parseInt(page),
        perPage: parseInt(perPage),
        totalPages: Math.ceil(count / parseInt(perPage))
      }
    });
  } catch (err) { next(err); }
};

exports.updateNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, body, priority, expires_at } = req.body;
    const schoolId = req.user.school_id;

    const [result] = await sequelize.query(`
      UPDATE notices SET
        title = COALESCE(:title, title),
        body = COALESCE(:body, body),
        priority = COALESCE(:priority, priority),
        expires_at = :expires_at,
        updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId AND is_deleted = false
      RETURNING *
    `, {
      replacements: { id, schoolId, title, body, priority, expires_at: expires_at || null }
    });

    if (result.length === 0) return res.fail('Notice not found.', [], 404);
    res.ok(result[0], 'Notice updated successfully.');
  } catch (err) { next(err); }
};

exports.deleteNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [result] = await sequelize.query(`
      UPDATE notices SET is_deleted = true, updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId AND is_deleted = false
      RETURNING id
    `, { replacements: { id, schoolId } });

    if (result.length === 0) return res.fail('Notice not found.', [], 404);
    res.ok(null, 'Notice deleted.');
  } catch (err) { next(err); }
};

// ── Teacher Functions ────────────────────────────────────────────────────────

exports.createTeacherNotice = async (req, res, next) => {
  try {
    const { title, body, audience, target_class_id, target_section_id, priority = 'normal', expires_at } = req.body;
    const schoolId = req.user.school_id;
    const teacherId = req.user.id;

    if (!['class', 'section'].includes(audience)) {
      return res.fail('Teachers can only post to classes or sections.', [], 403);
    }

    // Verify teacher is assigned to this class/section
    const [assignment] = await sequelize.query(`
      SELECT id FROM teacher_assignments
      WHERE teacher_id = :teacherId
        AND class_id = :target_class_id
        AND (:target_section_id::int IS NULL OR section_id = :target_section_id)
        AND is_active = true
      LIMIT 1
    `, {
      replacements: { 
        teacherId, 
        target_class_id, 
        target_section_id: target_section_id || null 
      }
    });

    if (assignment.length === 0) {
      return res.fail('You are not assigned to this class or section.', [], 403);
    }

    const [notice] = await sequelize.query(`
      INSERT INTO notices (
        school_id, title, body, posted_by_user_id, posted_by_role, audience, 
        target_class_id, target_section_id, priority, expires_at, created_at, updated_at
      ) VALUES (
        :schoolId, :title, :body, :teacherId, 'teacher', :audience, 
        :target_class_id, :target_section_id, :priority, :expires_at, NOW(), NOW()
      ) RETURNING *
    `, {
      replacements: {
        schoolId, title, body, teacherId, audience,
        target_class_id,
        target_section_id: target_section_id || null,
        priority,
        expires_at: expires_at || null
      }
    });

    const createdNotice = notice[0];
    res.ok(createdNotice, 'Notice posted successfully.', 201);

    // Background push
    const studentIds = await getTargetStudentIds(schoolId, audience, { target_class_id, target_section_id });
    fireNoticePush(createdNotice, studentIds);

  } catch (err) { next(err); }
};

exports.listTeacherNotices = async (req, res, next) => {
  try {
    const teacherId = req.user.id;
    const schoolId = req.user.school_id;

    const [notices] = await sequelize.query(`
      SELECT n.*,
             (SELECT COUNT(*)::int FROM notice_reads nr WHERE nr.notice_id = n.id) as read_count,
             c.name as class_name, s.name as section_name
      FROM notices n
      LEFT JOIN classes c ON c.id = n.target_class_id
      LEFT JOIN sections s ON s.id = n.target_section_id
      WHERE n.posted_by_user_id = :teacherId AND n.posted_by_role = 'teacher' 
        AND n.school_id = :schoolId AND n.is_deleted = false
      ORDER BY n.created_at DESC
    `, { replacements: { teacherId, schoolId } });

    res.ok(notices);
  } catch (err) { next(err); }
};

exports.updateTeacherNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, body, priority, expires_at } = req.body;
    const teacherId = req.user.id;

    const [result] = await sequelize.query(`
      UPDATE notices SET
        title = COALESCE(:title, title),
        body = COALESCE(:body, body),
        priority = COALESCE(:priority, priority),
        expires_at = :expires_at,
        updated_at = NOW()
      WHERE id = :id AND posted_by_user_id = :teacherId AND posted_by_role = 'teacher' AND is_deleted = false
      RETURNING *
    `, {
      replacements: { id, teacherId, title, body, priority, expires_at: expires_at || null }
    });

    if (result.length === 0) return res.fail('Notice not found or unauthorized.', [], 404);
    res.ok(result[0], 'Notice updated successfully.');
  } catch (err) { next(err); }
};

exports.deleteTeacherNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id;

    const [result] = await sequelize.query(`
      UPDATE notices SET is_deleted = true, updated_at = NOW()
      WHERE id = :id AND posted_by_user_id = :teacherId AND posted_by_role = 'teacher' AND is_deleted = false
      RETURNING id
    `, { replacements: { id, teacherId } });

    if (result.length === 0) return res.fail('Notice not found or unauthorized.', [], 404);
    res.ok(null, 'Notice deleted.');
  } catch (err) { next(err); }
};

// ── Accountant Functions ─────────────────────────────────────────────────────

exports.createAccountantNotice = async (req, res, next) => {
  try {
    const { title, body, audience, target_class_id, priority = 'info', expires_at } = req.body;
    const schoolId = req.user.school_id;
    const userId = req.user.id;

    if (!['school_wide', 'class'].includes(audience)) {
      return res.fail('Accountants can only post school-wide or class-level notices.', [], 403);
    }

    const [notice] = await sequelize.query(`
      INSERT INTO notices (
        school_id, title, body, posted_by_user_id, posted_by_role, audience, 
        target_class_id, priority, expires_at, created_at, updated_at
      ) VALUES (
        :schoolId, :title, :body, :userId, 'accountant', :audience, 
        :target_class_id, :priority, :expires_at, NOW(), NOW()
      ) RETURNING *
    `, {
      replacements: {
        schoolId, title, body, userId, audience,
        target_class_id: target_class_id || null,
        priority,
        expires_at: expires_at || null
      }
    });

    const createdNotice = notice[0];
    res.ok(createdNotice, 'Fee notice posted successfully.', 201);

    // Background push
    const studentIds = await getTargetStudentIds(schoolId, audience, { target_class_id });
    fireNoticePush(createdNotice, studentIds);

  } catch (err) { next(err); }
};

// ── Student Functions ────────────────────────────────────────────────────────

exports.getStudentNotices = async (req, res, next) => {
  try {
    const studentUserId = req.user.id;
    const schoolId = req.user.school_id;

    // Get student details
    const [[student]] = await sequelize.query(`
      SELECT s.id, e.class_id, e.section_id 
      FROM students s
      JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      JOIN users u ON u.id = :studentUserId
      WHERE s.school_id = :schoolId
      LIMIT 1
    `, { replacements: { studentUserId, schoolId } });

    if (!student) return res.fail('Student record not found.', [], 404);

    const [notices] = await sequelize.query(`
      SELECT n.*, u.name as posted_by_name,
             EXISTS(SELECT 1 FROM notice_reads nr WHERE nr.notice_id = n.id AND nr.student_id = :studentId) as is_read,
             EXISTS(SELECT 1 FROM notice_pins np WHERE np.notice_id = n.id AND np.student_id = :studentId) as is_pinned
      FROM notices n
      LEFT JOIN users u ON u.id = n.posted_by_user_id
      WHERE n.school_id = :schoolId 
        AND n.is_deleted = false
        AND (n.expires_at IS NULL OR n.expires_at > NOW())
        AND (
          n.audience = 'school_wide' OR
          (n.audience = 'class' AND n.target_class_id = :classId) OR
          (n.audience = 'section' AND n.target_section_id = :sectionId) OR
          (n.audience = 'student' AND n.target_student_id = :studentId)
        )
      ORDER BY is_pinned DESC, 
               CASE WHEN n.priority = 'urgent' THEN 0 WHEN n.priority = 'normal' THEN 1 ELSE 2 END ASC,
               n.created_at DESC
    `, {
      replacements: {
        schoolId,
        studentId: student.id,
        classId: student.class_id,
        sectionId: student.section_id
      }
    });

    res.ok(notices);
  } catch (err) { next(err); }
};

exports.markRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentUserId = req.user.id;

    // Get student ID
    const [[student]] = await sequelize.query(`
      SELECT id FROM students WHERE school_id = :schoolId AND id = (SELECT student_id FROM students s JOIN users u ON u.id = :studentUserId WHERE s.id = s.id LIMIT 1)
      LIMIT 1
    `, { replacements: { studentUserId, schoolId: req.user.school_id } });
    
    // Simplification for markRead/Pin/Unpin: usually student role in req.user has direct link.
    // Let's assume we can find it via subquery.
    
    await sequelize.query(`
      INSERT INTO notice_reads (notice_id, student_id, read_at)
      SELECT :id, s.id, NOW()
      FROM students s
      WHERE s.id = (SELECT s2.id FROM students s2 JOIN users u ON u.id = :studentUserId LIMIT 1)
      ON CONFLICT (notice_id, student_id) DO UPDATE SET read_at = NOW()
    `, { replacements: { id, studentUserId } });

    res.ok(null, 'Notice marked as read.');
  } catch (err) { next(err); }
};

exports.pinNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentUserId = req.user.id;

    await sequelize.query(`
      INSERT INTO notice_pins (notice_id, student_id, pinned_at)
      SELECT :id, s.id, NOW()
      FROM students s
      WHERE s.id = (SELECT s2.id FROM students s2 JOIN users u ON u.id = :studentUserId LIMIT 1)
      ON CONFLICT (notice_id, student_id) DO NOTHING
    `, { replacements: { id, studentUserId } });

    res.ok(null, 'Notice pinned.');
  } catch (err) { next(err); }
};

exports.unpinNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentUserId = req.user.id;

    await sequelize.query(`
      DELETE FROM notice_pins
      WHERE notice_id = :id 
        AND student_id = (SELECT s.id FROM students s JOIN users u ON u.id = :studentUserId LIMIT 1)
    `, { replacements: { id, studentUserId } });

    res.ok(null, 'Notice unpinned.');
  } catch (err) { next(err); }
};

// ── Shared Functions ─────────────────────────────────────────────────────────

exports.getNoticeById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[notice]] = await sequelize.query(`
      SELECT n.*, u.name as posted_by_name,
             (SELECT COUNT(*)::int FROM notice_reads nr WHERE nr.notice_id = n.id) as read_count,
             c.name as class_name, s.name as section_name,
             CONCAT(st.first_name, ' ', st.last_name) as student_name
      FROM notices n
      LEFT JOIN users u ON u.id = n.posted_by_user_id
      LEFT JOIN classes c ON c.id = n.target_class_id
      LEFT JOIN sections s ON s.id = n.target_section_id
      LEFT JOIN students st ON st.id = n.target_student_id
      WHERE n.id = :id AND n.school_id = :schoolId AND n.is_deleted = false
    `, { replacements: { id, schoolId } });

    if (!notice) return res.fail('Notice not found.', [], 404);
    res.ok(notice);
  } catch (err) { next(err); }
};
