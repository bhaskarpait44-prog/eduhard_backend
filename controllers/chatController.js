'use strict';

const sequelize = require('../config/database');

const MAX_MESSAGE_LENGTH = 2000;

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

async function getTeacherAssignments(teacherId, schoolId, sessionId) {
  const [rows] = await sequelize.query(`
    SELECT
      ta.id,
      ta.class_id,
      ta.section_id,
      ta.subject_id,
      ta.is_class_teacher,
      ta.session_id,
      c.name AS class_name,
      sec.name AS section_name,
      sub.name AS subject_name
    FROM teacher_assignments ta
    JOIN sessions sess ON sess.id = ta.session_id
    JOIN classes c ON c.id = ta.class_id
    JOIN sections sec ON sec.id = ta.section_id
    LEFT JOIN subjects sub ON sub.id = ta.subject_id
    WHERE ta.teacher_id = :teacherId
      AND sess.school_id = :schoolId
      AND ta.is_active = true
      AND (:sessionId::int IS NULL OR ta.session_id = :sessionId);
  `, {
    replacements: {
      teacherId,
      schoolId,
      sessionId: sessionId || null,
    },
  });

  return rows;
}

async function getStudentContext(req) {
  const studentId = Number(req.user.student_id || req.user.id);
  const [[student]] = await sequelize.query(`
    SELECT
      s.id,
      s.school_id,
      s.admission_no,
      s.first_name,
      s.last_name,
      e.id AS enrollment_id,
      e.session_id,
      e.class_id,
      e.section_id,
      e.roll_number,
      c.name AS class_name,
      sec.name AS section_name
    FROM students s
    LEFT JOIN LATERAL (
      SELECT en.*
      FROM enrollments en
      WHERE en.student_id = s.id
      ORDER BY CASE WHEN en.status = 'active' THEN 0 ELSE 1 END, en.joined_date DESC, en.id DESC
      LIMIT 1
    ) e ON true
    LEFT JOIN classes c ON c.id = e.class_id
    LEFT JOIN sections sec ON sec.id = e.section_id
    WHERE s.id = :studentId
      AND s.school_id = :schoolId
      AND s.is_deleted = false
      AND s.is_active = true
    LIMIT 1;
  `, {
    replacements: {
      studentId,
      schoolId: req.user.school_id,
    },
  });

  if (!student || !student.enrollment_id) {
    const error = new Error('No active academic enrollment found for this student.');
    error.status = 404;
    throw error;
  }

  return {
    studentId,
    student,
    enrollmentId: Number(student.enrollment_id),
    classId: Number(student.class_id),
    sectionId: Number(student.section_id),
    sessionId: Number(student.session_id),
  };
}

async function getStudentById(studentId, schoolId) {
  const [[student]] = await sequelize.query(`
    SELECT
      s.id,
      s.admission_no,
      s.first_name,
      s.last_name,
      e.id AS enrollment_id,
      e.session_id,
      e.class_id,
      e.section_id,
      e.roll_number,
      c.name AS class_name,
      sec.name AS section_name
    FROM students s
    JOIN enrollments e ON e.student_id = s.id
    JOIN classes c ON c.id = e.class_id
    JOIN sections sec ON sec.id = e.section_id
    WHERE s.id = :studentId
      AND s.school_id = :schoolId
      AND s.is_deleted = false
      AND e.status = 'active'
    ORDER BY e.joined_date DESC, e.id DESC
    LIMIT 1;
  `, { replacements: { studentId, schoolId } });

  return student || null;
}

async function getTeacherUser(teacherId, schoolId) {
  const [[teacher]] = await sequelize.query(`
    SELECT id, CONCAT(first_name, ' ', last_name) AS name, school_id
    FROM teachers
    WHERE id = :teacherId
      AND school_id = :schoolId
      AND is_active = true
      AND is_deleted = false
    LIMIT 1;
  `, { replacements: { teacherId, schoolId } });

  return teacher || null;
}

function normalizeSubjectId(value) {
  if (value === undefined || value === null || value === '') return null;
  return Number(value);
}

async function ensureTeacherStudentAccess({ teacherId, schoolId, studentId, subjectId = null }) {
  const session = await getCurrentSession(schoolId);
  const assignments = await getTeacherAssignments(teacherId, schoolId, session?.id || null);
  const student = await getStudentById(studentId, schoolId);

  if (!student) {
    const error = new Error('Student not found.');
    error.status = 404;
    throw error;
  }

  const matchingAssignment = assignments.find((assignment) => (
    Number(assignment.class_id) === Number(student.class_id) &&
    Number(assignment.section_id) === Number(student.section_id) &&
    (
      subjectId == null
        ? Boolean(assignment.is_class_teacher)
        : (!assignment.is_class_teacher && Number(assignment.subject_id) === Number(subjectId))
    )
  ));

  if (!matchingAssignment) {
    const error = new Error('You are not assigned to chat with this student in the selected scope.');
    error.status = 403;
    throw error;
  }

  return {
    student,
    assignment: matchingAssignment,
    subjectId: subjectId == null ? null : Number(subjectId),
  };
}

async function ensureStudentTeacherAccess({ req, teacherId, subjectId = null }) {
  const context = await getStudentContext(req);
  const teacher = await getTeacherUser(teacherId, req.user.school_id);
  if (!teacher) {
    const error = new Error('Teacher not found.');
    error.status = 404;
    throw error;
  }

  const [rows] = await sequelize.query(`
    SELECT
      ta.id,
      ta.subject_id,
      ta.is_class_teacher
    FROM teacher_assignments ta
    WHERE ta.teacher_id = :teacherId
      AND ta.session_id = :sessionId
      AND ta.class_id = :classId
      AND ta.section_id = :sectionId
      AND ta.is_active = true;
  `, {
    replacements: {
      teacherId,
      sessionId: context.sessionId,
      classId: context.classId,
      sectionId: context.sectionId,
    },
  });

  const assignment = rows.find((row) => (
    subjectId == null
      ? Boolean(row.is_class_teacher)
      : (!row.is_class_teacher && Number(row.subject_id) === Number(subjectId))
  ));

  if (!assignment) {
    const error = new Error('This teacher is not assigned to you in the selected chat scope.');
    error.status = 403;
    throw error;
  }

  return {
    teacher,
    student: context.student,
    studentId: context.studentId,
    enrollmentId: context.enrollmentId,
    subjectId: subjectId == null ? null : Number(subjectId),
    isClassTeacherChat: subjectId == null,
  };
}

async function findOrCreateConversation({
  studentId,
  teacherId,
  enrollmentId,
  subjectId = null,
  isClassTeacherChat = false,
}) {
  const [existingRows] = await sequelize.query(`
    SELECT id
    FROM chat_conversations
    WHERE student_id = :studentId
      AND teacher_id = :teacherId
      AND enrollment_id = :enrollmentId
      AND (
        (:subjectId::int IS NULL AND subject_id IS NULL)
        OR subject_id = :subjectId
      )
    LIMIT 1;
  `, {
    replacements: { studentId, teacherId, enrollmentId, subjectId },
  });

  if (existingRows[0]) return Number(existingRows[0].id);

  const [[conversation]] = await sequelize.query(`
    INSERT INTO chat_conversations (
      student_id, teacher_id, enrollment_id, subject_id, is_class_teacher_chat,
      last_message_at, created_at, updated_at
    )
    VALUES (
      :studentId, :teacherId, :enrollmentId, :subjectId, :isClassTeacherChat,
      NULL, NOW(), NOW()
    )
    RETURNING id;
  `, {
    replacements: {
      studentId,
      teacherId,
      enrollmentId,
      subjectId,
      isClassTeacherChat: Boolean(isClassTeacherChat),
    },
  });

  return Number(conversation.id);
}

async function getTeacherConversationOrFail(teacherId, conversationId) {
  const [[conversation]] = await sequelize.query(`
    SELECT *
    FROM chat_conversations
    WHERE id = :conversationId
      AND teacher_id = :teacherId
    LIMIT 1;
  `, { replacements: { teacherId, conversationId } });

  if (!conversation) {
    const error = new Error('Conversation not found.');
    error.status = 404;
    throw error;
  }

  return conversation;
}

async function getStudentConversationOrFail(studentId, conversationId) {
  const [[conversation]] = await sequelize.query(`
    SELECT *
    FROM chat_conversations
    WHERE id = :conversationId
      AND student_id = :studentId
    LIMIT 1;
  `, { replacements: { studentId, conversationId } });

  if (!conversation) {
    const error = new Error('Conversation not found.');
    error.status = 404;
    throw error;
  }

  return conversation;
}

async function loadTeacherConversations(teacherId) {
  const [rows] = await sequelize.query(`
    SELECT
      cc.id,
      cc.student_id,
      cc.subject_id,
      cc.is_class_teacher_chat,
      cc.last_message_at,
      s.first_name,
      s.last_name,
      s.admission_no,
      e.roll_number,
      c.name AS class_name,
      sec.name AS section_name,
      sub.name AS subject_name,
      msg.message_text AS last_message_text,
      msg.sender_role AS last_message_sender_role,
      msg.created_at AS last_message_created_at
    FROM chat_conversations cc
    JOIN students s ON s.id = cc.student_id
    JOIN enrollments e ON e.id = cc.enrollment_id
    JOIN classes c ON c.id = e.class_id
    JOIN sections sec ON sec.id = e.section_id
    LEFT JOIN subjects sub ON sub.id = cc.subject_id
    LEFT JOIN LATERAL (
      SELECT cm.message_text, cm.sender_role, cm.created_at
      FROM chat_messages cm
      WHERE cm.conversation_id = cc.id
      ORDER BY cm.created_at DESC, cm.id DESC
      LIMIT 1
    ) msg ON true
    WHERE cc.teacher_id = :teacherId
    ORDER BY COALESCE(cc.last_message_at, cc.created_at) DESC, cc.id DESC;
  `, { replacements: { teacherId } });

  return rows;
}

async function loadStudentConversations(studentId) {
  const [rows] = await sequelize.query(`
    SELECT
      cc.id,
      cc.teacher_id,
      cc.subject_id,
      cc.is_class_teacher_chat,
      cc.last_message_at,
      CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name,
      sub.name AS subject_name,
      msg.message_text AS last_message_text,
      msg.sender_role AS last_message_sender_role,
      msg.created_at AS last_message_created_at
    FROM chat_conversations cc
    JOIN teachers teacher ON teacher.id = cc.teacher_id
    LEFT JOIN subjects sub ON sub.id = cc.subject_id
    LEFT JOIN LATERAL (
      SELECT cm.message_text, cm.sender_role, cm.created_at
      FROM chat_messages cm
      WHERE cm.conversation_id = cc.id
      ORDER BY cm.created_at DESC, cm.id DESC
      LIMIT 1
    ) msg ON true
    WHERE cc.student_id = :studentId
    ORDER BY COALESCE(cc.last_message_at, cc.created_at) DESC, cc.id DESC;
  `, { replacements: { studentId } });

  return rows;
}

async function loadConversationMessages(conversationId) {
  const [rows] = await sequelize.query(`
    SELECT
      cm.id,
      cm.sender_role,
      cm.sender_teacher_id,
      cm.sender_student_id,
      cm.message_text,
      cm.created_at
    FROM chat_messages cm
    WHERE cm.conversation_id = :conversationId
    ORDER BY cm.created_at ASC, cm.id ASC;
  `, { replacements: { conversationId } });

  return rows;
}

async function saveMessage({ conversationId, senderRole, teacherId = null, studentId = null, messageText }) {
  const trimmed = String(messageText || '').trim();
  if (!trimmed) {
    const error = new Error('message_text is required.');
    error.status = 422;
    throw error;
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    const error = new Error(`message_text cannot exceed ${MAX_MESSAGE_LENGTH} characters.`);
    error.status = 422;
    throw error;
  }

  const [[message]] = await sequelize.query(`
    INSERT INTO chat_messages (
      conversation_id, sender_role, sender_teacher_id, sender_student_id, message_text, created_at
    )
    VALUES (
      :conversationId, :senderRole, :teacherId, :studentId, :messageText, NOW()
    )
    RETURNING id, sender_role, sender_teacher_id, sender_student_id, message_text, created_at;
  `, {
    replacements: {
      conversationId,
      senderRole,
      teacherId,
      studentId,
      messageText: trimmed,
    },
  });

  await sequelize.query(`
    UPDATE chat_conversations
    SET last_message_at = NOW(),
        updated_at = NOW()
    WHERE id = :conversationId;
  `, { replacements: { conversationId } });

  return message;
}

exports.teacherContacts = async (req, res, next) => {
  try {
    const session = await getCurrentSession(req.user.school_id);
    const assignments = await getTeacherAssignments(req.user.id, req.user.school_id, session?.id || null);
    if (!assignments.length) return res.ok({ contacts: [] }, 'No chat contacts found.');

    const [rows] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.student_id,
        e.roll_number,
        e.class_id,
        e.section_id,
        s.admission_no,
        s.first_name,
        s.last_name,
        c.name AS class_name,
        sec.name AS section_name
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      WHERE e.session_id = :sessionId
        AND e.status = 'active'
        AND s.is_deleted = false
        AND e.section_id IN (:sectionIds)
      ORDER BY c.name ASC, sec.name ASC, e.roll_number ASC, s.first_name ASC;
    `, {
      replacements: {
        sessionId: session?.id || 0,
        sectionIds: [...new Set(assignments.map((assignment) => Number(assignment.section_id)).filter(Boolean))],
      },
    });

    const contacts = [];
    assignments.forEach((assignment) => {
      rows
        .filter((row) => Number(row.class_id) === Number(assignment.class_id) && Number(row.section_id) === Number(assignment.section_id))
        .forEach((row) => {
          contacts.push({
            student_id: row.student_id,
            enrollment_id: row.enrollment_id,
            first_name: row.first_name,
            last_name: row.last_name,
            admission_no: row.admission_no,
            roll_number: row.roll_number,
            class_name: row.class_name,
            section_name: row.section_name,
            subject_id: assignment.is_class_teacher ? null : assignment.subject_id,
            subject_name: assignment.is_class_teacher ? null : assignment.subject_name,
            scope_label: assignment.is_class_teacher ? 'Class Teacher' : assignment.subject_name,
            is_class_teacher_chat: Boolean(assignment.is_class_teacher),
          });
        });
    });

    const uniqueContacts = Array.from(new Map(
      contacts.map((item) => [`${item.student_id}:${item.subject_id || 'class'}`, item])
    ).values());

    res.ok({ contacts: uniqueContacts }, `${uniqueContacts.length} chat contact(s) found.`);
  } catch (err) { next(err); }
};

exports.teacherConversations = async (req, res, next) => {
  try {
    const conversations = await loadTeacherConversations(req.user.id);
    res.ok({ conversations }, `${conversations.length} conversation(s) found.`);
  } catch (err) { next(err); }
};

exports.teacherCreateConversation = async (req, res, next) => {
  try {
    requireFields(req.body, ['student_id']);
    const subjectId = normalizeSubjectId(req.body.subject_id);
    const access = await ensureTeacherStudentAccess({
      teacherId: req.user.id,
      schoolId: req.user.school_id,
      studentId: Number(req.body.student_id),
      subjectId,
    });

    const conversationId = await findOrCreateConversation({
      studentId: Number(access.student.id),
      teacherId: req.user.id,
      enrollmentId: Number(access.student.enrollment_id),
      subjectId,
      isClassTeacherChat: Boolean(access.assignment.is_class_teacher),
    });

    const [[conversation]] = await sequelize.query(`
      SELECT id
      FROM chat_conversations
      WHERE id = :conversationId
      LIMIT 1;
    `, { replacements: { conversationId } });

    res.ok({ conversation }, 'Conversation ready.', 201);
  } catch (err) { next(err); }
};

exports.teacherConversationMessages = async (req, res, next) => {
  try {
    const conversation = await getTeacherConversationOrFail(req.user.id, Number(req.params.id));
    const messages = await loadConversationMessages(Number(conversation.id));
    res.ok({ conversation, messages }, `${messages.length} message(s) found.`);
  } catch (err) { next(err); }
};

exports.teacherSendMessage = async (req, res, next) => {
  try {
    const conversation = await getTeacherConversationOrFail(req.user.id, Number(req.params.id));
    requireFields(req.body, ['message_text']);
    const message = await saveMessage({
      conversationId: Number(conversation.id),
      senderRole: 'teacher',
      teacherId: req.user.id,
      messageText: req.body.message_text,
    });
    res.ok({ message }, 'Message sent.', 201);
  } catch (err) { next(err); }
};

exports.studentContacts = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const [rows] = await sequelize.query(`
      SELECT
        ta.teacher_id,
        ta.subject_id,
        ta.is_class_teacher,
        CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name,
        sub.name AS subject_name
      FROM teacher_assignments ta
      JOIN teachers teacher ON teacher.id = ta.teacher_id
      LEFT JOIN subjects sub ON sub.id = ta.subject_id
      WHERE ta.session_id = :sessionId
        AND ta.class_id = :classId
        AND ta.section_id = :sectionId
        AND ta.is_active = true
      ORDER BY ta.is_class_teacher DESC, teacher.first_name ASC, sub.name ASC;
    `, {
      replacements: {
        sessionId: context.sessionId,
        classId: context.classId,
        sectionId: context.sectionId,
      },
    });

    const contacts = Array.from(new Map(
      rows.map((row) => [`${row.teacher_id}:${row.subject_id || 'class'}`, {
        teacher_id: row.teacher_id,
        teacher_name: row.teacher_name,
        subject_id: row.is_class_teacher ? null : row.subject_id,
        subject_name: row.is_class_teacher ? null : row.subject_name,
        scope_label: row.is_class_teacher ? 'Class Teacher' : row.subject_name,
        is_class_teacher_chat: Boolean(row.is_class_teacher),
      }])
    ).values());

    res.ok({ contacts }, `${contacts.length} chat contact(s) found.`);
  } catch (err) { next(err); }
};

exports.studentConversations = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const conversations = await loadStudentConversations(context.studentId);
    res.ok({ conversations }, `${conversations.length} conversation(s) found.`);
  } catch (err) { next(err); }
};

exports.studentCreateConversation = async (req, res, next) => {
  try {
    requireFields(req.body, ['teacher_id']);
    const subjectId = normalizeSubjectId(req.body.subject_id);
    const access = await ensureStudentTeacherAccess({
      req,
      teacherId: Number(req.body.teacher_id),
      subjectId,
    });

    const conversationId = await findOrCreateConversation({
      studentId: access.studentId,
      teacherId: Number(access.teacher.id),
      enrollmentId: access.enrollmentId,
      subjectId,
      isClassTeacherChat: access.isClassTeacherChat,
    });

    const [[conversation]] = await sequelize.query(`
      SELECT id
      FROM chat_conversations
      WHERE id = :conversationId
      LIMIT 1;
    `, { replacements: { conversationId } });

    res.ok({ conversation }, 'Conversation ready.', 201);
  } catch (err) { next(err); }
};

exports.studentConversationMessages = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const conversation = await getStudentConversationOrFail(context.studentId, Number(req.params.id));
    const messages = await loadConversationMessages(Number(conversation.id));
    res.ok({ conversation, messages }, `${messages.length} message(s) found.`);
  } catch (err) { next(err); }
};

exports.studentSendMessage = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const conversation = await getStudentConversationOrFail(context.studentId, Number(req.params.id));
    requireFields(req.body, ['message_text']);
    const message = await saveMessage({
      conversationId: Number(conversation.id),
      senderRole: 'student',
      studentId: context.studentId,
      messageText: req.body.message_text,
    });
    res.ok({ message }, 'Message sent.', 201);
  } catch (err) { next(err); }
};
