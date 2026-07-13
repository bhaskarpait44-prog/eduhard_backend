'use strict';

const sequelize = require('../config/database');
const { invalidateCache } = require('../middlewares/cache');
const { writeAuditLog } = require('../utils/writeAuditLog');
const { acquireLockWithRetry, releaseLock } = require('../utils/lock');

async function getSessionMeta(sessionId, schoolId) {
  const [[session]] = await sequelize.query(`
    SELECT id, name, start_date, end_date, status, is_locked
    FROM sessions
    WHERE id = :sessionId
      AND school_id = :schoolId
    LIMIT 1;
  `, { replacements: { sessionId, schoolId } });

  return session || null;
}

async function getClassMeta(classId, schoolId) {
  const [[klass]] = await sequelize.query(`
    SELECT id, name, order_number, stream
    FROM classes
    WHERE id = :classId
      AND school_id = :schoolId
      AND COALESCE(is_deleted, false) = false
    LIMIT 1;
  `, { replacements: { classId, schoolId } });

  return klass || null;
}

async function getNextClass(classOrder, schoolId, currentStream) {
  const [[klass]] = await sequelize.query(`
    SELECT id, name, order_number, stream
    FROM classes
    WHERE school_id = :schoolId
      AND order_number > :orderNumber
      AND (stream = :currentStream OR stream = 'regular' OR stream IS NULL)
      AND COALESCE(is_deleted, false) = false
    ORDER BY order_number ASC
    LIMIT 1;
  `, {
    replacements: {
      schoolId,
      orderNumber: Number(classOrder),
      currentStream: currentStream || 'regular',
    },
  });

  return klass || null;
}

async function getSectionForTargetClass(targetClassId, sectionName) {
  const [[sameNameSection]] = await sequelize.query(`
    SELECT id, name, capacity
    FROM sections
    WHERE class_id = :classId
      AND COALESCE(is_deleted, false) = false
      AND name = :sectionName
    ORDER BY id ASC
    LIMIT 1;
  `, {
    replacements: {
      classId: targetClassId,
      sectionName,
    },
  });

  if (sameNameSection) return sameNameSection;

  const [[firstSection]] = await sequelize.query(`
    SELECT id, name, capacity
    FROM sections
    WHERE class_id = :classId
      AND COALESCE(is_deleted, false) = false
    ORDER BY id ASC
    LIMIT 1;
  `, { replacements: { classId: targetClassId } });

  return firstSection || null;
}

async function nextRollNumber(sectionId, sessionId, transaction) {
  const [[row]] = await sequelize.query(`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(roll_number, '[^0-9]', '', 'g'), '')::int), 0) AS max_roll
    FROM enrollments
    WHERE section_id = :sectionId
      AND session_id = :sessionId;
  `, {
    replacements: { sectionId, sessionId },
    transaction,
  });

  const nextNum = Number(row?.max_roll || 0) + 1;
  return nextNum < 10 ? '0' + nextNum : String(nextNum);
}
exports.nextRollNumber = nextRollNumber;



function normalizePromotionOutcome(result) {
  const normalized = String(result || '').trim().toLowerCase();
  if (normalized === 'pass') return 'pass';
  if (['fail', 'compartment', 'detained'].includes(normalized)) return normalized;
  return null;
}

// ── POST /api/enrollments ─────────────────────────────────────────────────────
exports.enroll = async (req, res, next) => {
  const lockKey = `enrollment:section:${req.body.section_id}`;
  let lockAcquired = false;

  try {
    const { student_id, session_id, class_id, section_id, stream, joining_type, joined_date, roll_number } = req.body;
    
    // Acquire section distributed lock to prevent race conditions on capacity check
    lockAcquired = await acquireLockWithRetry(lockKey);
    if (!lockAcquired) {
      return res.fail('Server is busy processing enrollments. Please try again.', [], 429);
    }

    const normalizedStream = stream ? String(stream).trim().toLowerCase() : 'regular';

    // Verify session status
    const sessionMeta = await getSessionMeta(session_id, req.user.school_id);
    if (!sessionMeta) return res.fail('Session not found.', [], 404);
    if (['closed', 'archived', 'locked'].includes(sessionMeta.status) || sessionMeta.is_locked) {
      return res.fail(`Cannot enroll student: session is ${sessionMeta.status}.`);
    }

    const enrollment = await sequelize.transaction(async (t) => {
      // Check if student is already enrolled in this session
      const [[existingEnrollment]] = await sequelize.query(`
        SELECT id FROM enrollments 
        WHERE student_id = :student_id 
          AND session_id = :session_id 
          AND status = 'active'
        LIMIT 1;
      `, { replacements: { student_id, session_id }, transaction: t });

      if (existingEnrollment) {
        throw Object.assign(new Error('Student is already enrolled in an active class for this session.'), { status: 409 });
      }

      // Check section capacity
      const [[capacityCheck]] = await sequelize.query(`
        SELECT sec.capacity,
               COUNT(e.id) AS current_count
        FROM sections sec
        LEFT JOIN enrollments e ON e.section_id = sec.id
          AND e.session_id = :session_id AND e.status = 'active'
        WHERE sec.id = :section_id
        GROUP BY sec.capacity;
      `, { replacements: { section_id, session_id }, transaction: t });

      if (capacityCheck && parseInt(capacityCheck.current_count) >= capacityCheck.capacity) {
        throw Object.assign(new Error(`Section is at full capacity (${capacityCheck.capacity} students).`), { status: 409 });
      }

      // Auto-assign roll number if not provided
      let finalRollNumber = roll_number?.trim();
      if (!finalRollNumber) {
        finalRollNumber = await nextRollNumber(section_id, session_id, t);
      }

      const [[newEnrollment]] = await sequelize.query(`
        INSERT INTO enrollments
          (student_id, session_id, class_id, section_id, stream, roll_number, joined_date,
           joining_type, left_date, leaving_type, previous_enrollment_id, status, created_at, updated_at)
        VALUES
          (:student_id, :session_id, :class_id, :section_id, :stream, :roll_number, :joined_date,
           :joining_type, NULL, NULL, NULL, 'active', NOW(), NOW())
        RETURNING id, student_id, session_id, class_id, section_id, stream, roll_number, joining_type, status;
      `, { replacements: { student_id, session_id, class_id, section_id, stream: normalizedStream, roll_number: finalRollNumber, joined_date, joining_type }, transaction: t });

      return newEnrollment;
    });

    await writeAuditLog(sequelize, {
      tableName: 'enrollments',
      recordId: enrollment.id,
      changes: { field: 'status', oldValue: null, newValue: 'active' },
      changedBy: req.user.id,
      reason: `Initial enrollment: ${joining_type}`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    invalidateCache(req.user.school_id, '/api/enrollments*');
    invalidateCache(req.user.school_id, '/api/students*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    res.ok(enrollment, 'Student enrolled successfully.', 201);
  } catch (err) {
    if (err.status) return res.fail(err.message, [], err.status);
    next(err);
  } finally {
    if (lockAcquired) {
      await releaseLock(lockKey);
    }
  }
};

// ── GET /api/enrollments/:id ──────────────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[enrollment]] = await sequelize.query(`
      SELECT e.*, s.first_name, s.last_name, s.admission_no,
             c.name AS class_name, sec.name AS section_name,
             sess.name AS session_name
      FROM enrollments e
      JOIN students  s   ON s.id   = e.student_id
      JOIN classes   c   ON c.id   = e.class_id
      JOIN sections  sec ON sec.id = e.section_id
      JOIN sessions  sess ON sess.id = e.session_id
      WHERE e.id = :id AND s.school_id = :schoolId;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!enrollment) return res.fail('Enrollment not found.', [], 404);
    res.ok(enrollment, 'Enrollment retrieved.');
  } catch (err) { next(err); }
};

// ── POST /api/enrollments/promote ────────────────────────────────────────────
exports.promote = async (req, res, next) => {
  const lockKey = `enrollment:section:${req.body.new_section_id}`;
  let lockAcquired = false;

  try {
    const { session_id, new_session_id, class_id, new_class_id, new_section_id } = req.body;
    const today = new Date().toISOString().split('T')[0];

    if (!session_id || !new_session_id || !class_id || !new_class_id || !new_section_id) {
      return res.fail('session_id, new_session_id, class_id, new_class_id and new_section_id are required.');
    }

    // Acquire section distributed lock to prevent race conditions on capacity check
    lockAcquired = await acquireLockWithRetry(lockKey);
    if (!lockAcquired) {
      return res.fail('Server is busy processing enrollments. Please try again.', [], 429);
    }

    const targetSession = await getSessionMeta(new_session_id, req.user.school_id);
    if (!targetSession) return res.fail('Target session not found.', [], 404);
    if (['closed', 'archived', 'locked'].includes(targetSession.status) || targetSession.is_locked) {
      return res.fail(`Cannot promote students: target session is ${targetSession.status}.`);
    }

    if (Number(session_id) === Number(new_session_id) && Number(class_id) === Number(new_class_id)) {
      return res.fail('Target session or class must be different from the current class setup.');
    }

    const [[targetSection]] = await sequelize.query(`
      SELECT sec.id, sec.capacity, cls.id AS class_id
      FROM sections sec
      JOIN classes cls ON cls.id = sec.class_id
      JOIN schools sch ON sch.id = cls.school_id
      WHERE sec.id = :sectionId
        AND cls.id = :classId
        AND sch.id = :schoolId
      LIMIT 1;
    `, {
      replacements: {
        sectionId: new_section_id,
        classId: new_class_id,
        schoolId: req.user.school_id,
      },
    });

    if (!targetSection) {
      return res.fail('Target section not found for the selected class.', [], 404);
    }

    // FIX #9: Added school_id guard via students JOIN to prevent cross-school data access
    const [eligible] = await sequelize.query(`
      SELECT e.id, e.student_id, sr.result
      FROM enrollments e
      JOIN students stu ON stu.id = e.student_id
      JOIN student_results sr ON sr.enrollment_id = e.id
      WHERE e.session_id = :session_id
        AND e.class_id = :class_id
        AND e.status = 'active'
        AND sr.is_promoted = true
        AND stu.school_id = :schoolId;
    `, { replacements: { session_id, class_id, schoolId: req.user.school_id } });

    if (eligible.length === 0) {
      return res.fail('No students eligible for promotion in this class.');
    }

    const [[capacityRow]] = await sequelize.query(`
      SELECT COUNT(*) AS cnt
      FROM enrollments
      WHERE session_id = :sessionId
        AND section_id = :sectionId
        AND status = 'active';
    `, {
      replacements: {
        sessionId: new_session_id,
        sectionId: new_section_id,
      },
    });

    const currentCount = Number(capacityRow?.cnt || 0);
    const requiredCapacity = currentCount + eligible.length;
    if (targetSection.capacity != null && requiredCapacity > Number(targetSection.capacity)) {
      return res.fail(`Target section capacity exceeded. Capacity: ${targetSection.capacity}, current: ${currentCount}, promoting: ${eligible.length}.`);
    }

    const promoted = [];
    await sequelize.transaction(async (t) => {
      for (const en of eligible) {
        // Close old enrollment
        await sequelize.query(`
          UPDATE enrollments SET status = 'inactive', left_date = :today,
            leaving_type = 'promoted', updated_at = NOW()
          WHERE id = :id;
        `, { replacements: { today, id: en.id }, transaction: t });

        // Create new enrollment
        const [[newEnrollment]] = await sequelize.query(`
          INSERT INTO enrollments
            (student_id, session_id, class_id, section_id, joined_date, joining_type,
             previous_enrollment_id, status, created_at, updated_at)
          VALUES
            (:student_id, :new_session_id, :new_class_id, :new_section_id, :today,
             'promoted', :prev_id, 'active', NOW(), NOW())
          RETURNING id;
        `, {
          replacements: {
            student_id: en.student_id,
            new_session_id, new_class_id, new_section_id,
            today, prev_id: en.id,
          },
          transaction: t,
        });

        promoted.push({ student_id: en.student_id, new_enrollment_id: newEnrollment.id });

        // Audit the promotion
        await writeAuditLog(sequelize, {
          tableName: 'enrollments',
          recordId: en.id,
          changes: { field: 'status', oldValue: 'active', newValue: 'inactive' },
          changedBy: req.user.id,
          reason: 'Promoted to next class',
          ipAddress: req.ip,
          deviceInfo: req.headers['user-agent']
        });
        await writeAuditLog(sequelize, {
          tableName: 'enrollments',
          recordId: newEnrollment.id,
          changes: { field: 'status', oldValue: null, newValue: 'active' },
          changedBy: req.user.id,
          reason: 'Initial enrollment via promotion',
          ipAddress: req.ip,
          deviceInfo: req.headers['user-agent']
        });
      }
    });

    // FIX #2: Invalidate cache BEFORE sending response to avoid dead-code after res.ok()
    invalidateCache(req.user.school_id, '/api/enrollments*');
    invalidateCache(req.user.school_id, '/api/students*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    res.ok({ promoted_count: promoted.length, students: promoted }, `${promoted.length} student(s) promoted.`);
  } catch (err) {
    next(err);
  } finally {
    if (lockAcquired) {
      await releaseLock(lockKey);
    }
  }
};

exports.promotionCandidates = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { session_id, class_id, result_source = 'final_result' } = req.query;

    if (!session_id || !class_id) {
      return res.fail('session_id and class_id are required.', [], 422);
    }

    const sourceSession = await getSessionMeta(Number(session_id), schoolId);
    if (!sourceSession) {
      return res.fail('Source session not found.', [], 404);
    }

    const currentClass = await getClassMeta(Number(class_id), schoolId);
    if (!currentClass) {
      return res.fail('Class not found.', [], 404);
    }

    const nextClass = await getNextClass(currentClass.order_number, schoolId, currentClass.stream);

    const [rows] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.student_id,
        e.roll_number,
        e.stream,
        e.section_id,
        sec.name AS section_name,
        s.admission_no,
        s.first_name,
        s.last_name,
        sr.result AS final_result,
        sr.is_promoted,
        sr.percentage,
        sr.grade
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN student_results sr
        ON sr.enrollment_id = e.id
       AND sr.session_id = e.session_id
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.status = 'active'
        AND s.school_id = :schoolId
        AND COALESCE(s.is_deleted, false) = false
      ORDER BY sec.name ASC, e.roll_number ASC NULLS LAST, s.first_name ASC, s.last_name ASC;
    `, {
      replacements: {
        sessionId: Number(session_id),
        classId: Number(class_id),
        schoolId,
      },
    });

    const students = rows.map((row) => {
      const finalResult = normalizePromotionOutcome(row.final_result);
      const boardDefault = finalResult || '';
      const effectiveOutcome = result_source === 'board_result'
        ? boardDefault
        : finalResult;
      const isPass = effectiveOutcome === 'pass';
      const promotedClass = isPass ? nextClass : currentClass;
      const actionType = isPass
        ? (nextClass ? 'promote' : 'graduate')
        : 'repeat';

      return {
        enrollment_id: row.enrollment_id,
        student_id: row.student_id,
        admission_no: row.admission_no,
        student_name: `${row.first_name} ${row.last_name || ''}`.trim(),
        roll_number: row.roll_number,
        stream: row.stream,
        section_id: row.section_id,
        section_name: row.section_name,
        final_result: finalResult,
        is_promoted: Boolean(row.is_promoted),
        percentage: row.percentage,
        grade: row.grade,
        board_result: boardDefault,
        suggested_outcome: effectiveOutcome,
        target_class_id: promotedClass?.id || null,
        target_class_name: promotedClass?.name || null,
        action_type: actionType,
      };
    });

    return res.ok({
      source_session: sourceSession,
      class: currentClass,
      next_class: nextClass || null,
      result_source,
      students,
    }, `${students.length} promotion candidate(s) loaded.`);
  } catch (err) { next(err); }
};

exports.processPromotions = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const {
      source_session_id,
      target_session_id,
      class_id,
      result_source = 'final_result',
      students = [],
    } = req.body;

    if (!source_session_id || !target_session_id || !class_id) {
      return res.fail('source_session_id, target_session_id and class_id are required.', [], 422);
    }

    if (!Array.isArray(students) || students.length === 0) {
      return res.fail('At least one student is required for promotion processing.', [], 422);
    }

    const sourceSession = await getSessionMeta(Number(source_session_id), schoolId);
    const targetSession = await getSessionMeta(Number(target_session_id), schoolId);
    const currentClass = await getClassMeta(Number(class_id), schoolId);

    if (!sourceSession || !targetSession || !currentClass) {
      return res.fail('Promotion context is invalid. Verify sessions and class.', [], 404);
    }

    if (['closed', 'archived', 'locked'].includes(targetSession.status) || targetSession.is_locked) {
      return res.fail(`Cannot process promotions: target session is ${targetSession.status}.`);
    }

    const nextClass = await getNextClass(currentClass.order_number, schoolId);
    const today = targetSession.start_date || new Date().toISOString().split('T')[0];

    const enrollmentIds = students.map((row) => Number(row.enrollment_id)).filter(Boolean);
    const [activeEnrollments] = await sequelize.query(`
      SELECT
        e.id,
        e.student_id,
        e.class_id,
        e.section_id,
        e.stream,
        e.roll_number,
        sec.name AS section_name,
        sr.result AS final_result,
        sr.is_promoted
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN student_results sr
        ON sr.enrollment_id = e.id
       AND sr.session_id = e.session_id
      WHERE e.id IN (:enrollmentIds)
        AND e.session_id = :sourceSessionId
        AND e.class_id = :classId
        AND e.status = 'active'
        AND s.school_id = :schoolId
    `, {
      replacements: {
        enrollmentIds,
        sourceSessionId: Number(source_session_id),
        classId: Number(class_id),
        schoolId,
      },
    });

    const enrollmentMap = new Map(activeEnrollments.map((row) => [Number(row.id), row]));
    const processed = [];

    await sequelize.transaction(async (t) => {
      for (const requestedStudent of students) {
        const enrollment = enrollmentMap.get(Number(requestedStudent.enrollment_id));
        if (!enrollment) continue;

        const outcome = result_source === 'board_result'
          ? normalizePromotionOutcome(requestedStudent.board_result)
          : normalizePromotionOutcome(enrollment.final_result);

        if (!outcome) continue;

        const passLike = outcome === 'pass';
        const targetClass = passLike ? nextClass : currentClass;
        const actionType = passLike ? (nextClass ? 'promoted' : 'graduated') : 'failed';

        await sequelize.query(`
          UPDATE enrollments
          SET status = 'inactive',
              left_date = :today,
              leaving_type = :leavingType,
              updated_at = NOW()
          WHERE id = :id;
        `, {
          replacements: {
            today,
            leavingType: actionType,
            id: enrollment.id,
          },
          transaction: t,
        });

        if (!targetClass) {
          await sequelize.query(`
            UPDATE students
            SET status = 'graduated',
                is_active = false,
                updated_at = NOW()
            WHERE id = :studentId;
          `, { replacements: { studentId: enrollment.student_id }, transaction: t });

          processed.push({
            enrollment_id: enrollment.id,
            student_id: enrollment.student_id,
            action: 'graduated',
            target_class_id: null,
            target_section_id: null,
          });
          continue;
        }

        const targetSection = await getSectionForTargetClass(targetClass.id, enrollment.section_name);
        if (!targetSection) {
          throw new Error(`No section found in target class ${targetClass.name}.`);
        }

        const [[existingTarget]] = await sequelize.query(`
          SELECT id
          FROM enrollments
          WHERE student_id = :studentId
            AND session_id = :targetSessionId
          LIMIT 1;
        `, {
          replacements: {
            studentId: enrollment.student_id,
            targetSessionId: Number(target_session_id),
          },
          transaction: t,
        });

        if (existingTarget) {
          processed.push({
            enrollment_id: enrollment.id,
            student_id: enrollment.student_id,
            action: 'skipped_existing_target',
            target_class_id: targetClass.id,
            target_section_id: targetSection.id,
          });
          continue;
        }

        const rollNumber = await nextRollNumber(targetSection.id, Number(target_session_id), t);

        const [[createdEnrollment]] = await sequelize.query(`
          INSERT INTO enrollments
            (student_id, session_id, class_id, section_id, stream, roll_number, joined_date, joining_type,
             previous_enrollment_id, status, created_at, updated_at)
          VALUES
            (:studentId, :targetSessionId, :targetClassId, :targetSectionId, :stream, :rollNumber, :today, :joiningType,
             :previousEnrollmentId, 'active', NOW(), NOW())
          RETURNING id;
        `, {
          replacements: {
            studentId: enrollment.student_id,
            targetSessionId: Number(target_session_id),
            targetClassId: targetClass.id,
            targetSectionId: targetSection.id,
            stream: enrollment.stream,
            rollNumber,
            today,
            joiningType: passLike ? 'promoted' : 'failed',
            previousEnrollmentId: enrollment.id,
          },
          transaction: t,
        });

        await sequelize.query(`
          INSERT INTO student_subjects
            (student_id, session_id, subject_id, is_core, is_active, created_by, updated_by, created_at, updated_at)
          SELECT
            :studentId,
            :targetSessionId,
            sub.id,
            COALESCE(sub.is_core, false),
            true,
            :userId,
            :userId,
            NOW(),
            NOW()
          FROM subjects sub
          WHERE sub.class_id = :targetClassId
            AND COALESCE(sub.is_deleted, false) = false;
        `, {
          replacements: {
            studentId: enrollment.student_id,
            targetSessionId: Number(target_session_id),
            targetClassId: targetClass.id,
            userId: req.user.id,
          },
          transaction: t,
        });

        processed.push({
          enrollment_id: enrollment.id,
          student_id: enrollment.student_id,
          action: passLike ? 'promoted' : 'repeated',
          target_class_id: targetClass.id,
          target_section_id: targetSection.id,
          new_enrollment_id: createdEnrollment.id,
        });
      }
    });

    // FIX #2: Cache invalidation was dead code after return — moved before res.ok()
    invalidateCache(req.user.school_id, '/api/enrollments*');
    invalidateCache(req.user.school_id, '/api/students*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    return res.ok({
      processed_count: processed.length,
      promoted_count: processed.filter((row) => row.action === 'promoted').length,
      repeated_count: processed.filter((row) => row.action === 'repeated').length,
      graduated_count: processed.filter((row) => row.action === 'graduated').length,
      skipped_count: processed.filter((row) => row.action === 'skipped_existing_target').length,
      items: processed,
    }, `${processed.length} student promotion record(s) processed.`);
  } catch (err) { next(err); }
};

// ── POST /api/enrollments/transfer ───────────────────────────────────────────
exports.transfer = async (req, res, next) => {
  const lockKey = `enrollment:section:${req.body.new_section_id}`;
  let lockAcquired = false;

  try {
    const { enrollment_id, new_section_id, reason } = req.body;
    const today = new Date().toISOString().split('T')[0];

    // Acquire section distributed lock to prevent race conditions on capacity check
    lockAcquired = await acquireLockWithRetry(lockKey);
    if (!lockAcquired) {
      return res.fail('Server is busy processing enrollments. Please try again.', [], 429);
    }

    // FIX #3: Added school_id guard via students JOIN to prevent IDOR (cross-school transfer)
    const [[current]] = await sequelize.query(`
      SELECT e.id, e.student_id, e.session_id, e.class_id, e.stream,
             s.status AS session_status, s.is_locked AS session_locked
      FROM enrollments e
      JOIN sessions s ON s.id = e.session_id
      JOIN students stu ON stu.id = e.student_id
      WHERE e.id = :enrollment_id
        AND e.status = 'active'
        AND stu.school_id = :schoolId;
    `, { replacements: { enrollment_id, schoolId: req.user.school_id } });

    if (!current) return res.fail('Active enrollment not found.', [], 404);

    if (['closed', 'archived', 'locked'].includes(current.session_status) || current.session_locked) {
      return res.fail(`Cannot transfer student: session is ${current.session_status}.`);
    }

    await sequelize.transaction(async (t) => {
      // Close current
      await sequelize.query(`
        UPDATE enrollments SET status = 'inactive', left_date = :today,
          leaving_type = 'transfer_out', updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { today, id: enrollment_id }, transaction: t });

      // Open new in different section
      await sequelize.query(`
        INSERT INTO enrollments
          (student_id, session_id, class_id, section_id, stream, joined_date, joining_type,
           previous_enrollment_id, status, created_at, updated_at)
        VALUES
          (:student_id, :session_id, :class_id, :new_section_id, :stream, :today,
           'transfer_in', :prev_id, 'active', NOW(), NOW());
      `, {
        replacements: {
          student_id: current.student_id,
          session_id: current.session_id,
          class_id  : current.class_id,
          stream    : current.stream,
          new_section_id, today,
          prev_id   : enrollment_id,
        },
        transaction: t,
      });
    });

    // FIX #2: Invalidate cache BEFORE sending response
    invalidateCache(req.user.school_id, '/api/enrollments*');
    invalidateCache(req.user.school_id, '/api/students*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    res.ok({ enrollment_id, new_section_id }, 'Student transferred to new section.');
  } catch (err) {
    next(err);
  } finally {
    if (lockAcquired) {
      await releaseLock(lockKey);
    }
  }
};

exports.downloadPromotionSummary = async (req, res, next) => {
  try {
    const { session_id } = req.query;
    const schoolId = req.user.school_id;

    if (!session_id) return res.fail('session_id is required.');

    const school = await sequelize.query(`SELECT name, address, phone FROM schools WHERE id = :schoolId LIMIT 1`, {
      replacements: { schoolId },
      type: sequelize.QueryTypes.SELECT
    }).then(r => r[0]);

    const [[session]] = await sequelize.query(`SELECT name FROM sessions WHERE id = :sessionId LIMIT 1`, {
      replacements: { sessionId: session_id }
    });

    const [summary] = await sequelize.query(`
      SELECT 
        c.name AS class_name,
        COUNT(e.id)::int AS total,
        COUNT(CASE WHEN e.leaving_type = 'promoted' THEN 1 END)::int AS promoted,
        COUNT(CASE WHEN e.leaving_type = 'failed' THEN 1 END)::int AS repeated,
        COUNT(CASE WHEN e.leaving_type = 'graduated' THEN 1 END)::int AS graduated,
        COUNT(CASE WHEN e.status = 'active' THEN 1 END)::int AS pending
      FROM enrollments e
      JOIN classes c ON c.id = e.class_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId AND s.school_id = :schoolId
      GROUP BY c.id, c.name, c.order_number
      ORDER BY c.order_number ASC;
    `, { replacements: { sessionId: session_id, schoolId } });

    const PDFDocument = require('pdfkit');
    // FIX #11: bufferPages: true is required for doc.bufferedPageRange() to work correctly
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Promotion_Summary_${session?.name || 'Report'}.pdf"`);
    doc.pipe(res);

    const drawHeader = () => {
      doc.fillColor('#0f766e').fontSize(18).font('Helvetica-Bold').text(school.name.toUpperCase(), { align: 'center' });
      doc.fillColor('#64748b').fontSize(9).font('Helvetica').text(school.address, { align: 'center' });
      doc.moveDown(0.5);
      doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('PROMOTION SUMMARY REPORT', { align: 'center' });
      doc.fontSize(10).text(`Academic Session: ${session?.name || 'N/A'}`, { align: 'center' });
      doc.moveDown(1);
      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(1.5);
    };

    drawHeader();

    const startX = 40;
    const cols = [
      { label: 'Class Name', width: 150 },
      { label: 'Total', width: 70, align: 'center' },
      { label: 'Promoted', width: 70, align: 'center' },
      { label: 'Repeated', width: 70, align: 'center' },
      { label: 'Graduated', width: 70, align: 'center' },
      { label: 'Pending', width: 70, align: 'center' }
    ];

    // Header Row
    doc.fillColor('#f8fafc').rect(startX, doc.y, 515, 25).fill();
    doc.fillColor('#475569').fontSize(9).font('Helvetica-Bold');
    let currX = startX;
    cols.forEach(c => {
      doc.text(c.label.toUpperCase(), currX + 5, doc.y - 18, { width: c.width, align: c.align || 'left' });
      currX += c.width;
    });
    doc.moveDown(0.5);

    // Data Rows
    doc.font('Helvetica').fontSize(10).fillColor('#1e293b');
    let grandTotal = 0, gPromoted = 0, gRepeated = 0, gGraduated = 0, gPending = 0;

    summary.forEach((row, i) => {
      if (doc.y > 730) {
        doc.addPage();
        drawHeader();
        // Re-draw header
        doc.fillColor('#f8fafc').rect(startX, doc.y, 515, 25).fill();
        doc.fillColor('#475569').fontSize(9).font('Helvetica-Bold');
        currX = startX;
        cols.forEach(c => {
          doc.text(c.label.toUpperCase(), currX + 5, doc.y - 18, { width: c.width, align: c.align || 'left' });
          currX += c.width;
        });
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(10).fillColor('#1e293b');
      }

      currX = startX;
      const rowY = doc.y;
      
      doc.text(row.class_name, currX + 5, rowY); currX += cols[0].width;
      doc.text(row.total.toString(), currX, rowY, { width: cols[1].width, align: 'center' }); currX += cols[1].width;
      doc.fillColor('#16a34a').text(row.promoted.toString(), currX, rowY, { width: cols[2].width, align: 'center' }); currX += cols[2].width;
      doc.fillColor('#dc2626').text(row.repeated.toString(), currX, rowY, { width: cols[3].width, align: 'center' }); currX += cols[3].width;
      doc.fillColor('#2563eb').text(row.graduated.toString(), currX, rowY, { width: cols[4].width, align: 'center' }); currX += cols[4].width;
      doc.fillColor('#64748b').text(row.pending.toString(), currX, rowY, { width: cols[5].width, align: 'center' });
      doc.fillColor('#1e293b');

      grandTotal += row.total; gPromoted += row.promoted; gRepeated += row.repeated; gGraduated += row.graduated; gPending += row.pending;
      
      doc.moveDown(1.2);
      doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(startX, doc.y - 5).lineTo(555, doc.y - 5).stroke();
    });

    // Grand Total Row
    doc.moveDown(0.5);
    doc.fillColor('#f8fafc').rect(startX, doc.y, 515, 25).fill();
    doc.fillColor('#0f766e').font('Helvetica-Bold').fontSize(10);
    currX = startX;
    doc.text('GRAND TOTAL', currX + 5, doc.y + 7); currX += cols[0].width;
    doc.text(grandTotal.toString(), currX, doc.y - 12, { width: cols[1].width, align: 'center' }); currX += cols[1].width;
    doc.text(gPromoted.toString(), currX, doc.y - 12, { width: cols[2].width, align: 'center' }); currX += cols[2].width;
    doc.text(gRepeated.toString(), currX, doc.y - 12, { width: cols[3].width, align: 'center' }); currX += cols[3].width;
    doc.text(gGraduated.toString(), currX, doc.y - 12, { width: cols[4].width, align: 'center' }); currX += cols[4].width;
    doc.text(gPending.toString(), currX, doc.y - 12, { width: cols[5].width, align: 'center' });

    // Summary Chart/Stats
    doc.moveDown(4);
    doc.fillColor('#1e293b').fontSize(11).text('Session Statistics Overview');
    doc.strokeColor('#0f766e').lineWidth(1).moveTo(40, doc.y + 2).lineTo(200, doc.y + 2).stroke();
    doc.moveDown(1);
    
    const statsX = 60;
    const stats = [
      { label: 'Overall Promotion Rate', value: `${((gPromoted / (grandTotal - gPending || 1)) * 100).toFixed(1)}%` },
      { label: 'Overall Failure Rate', value: `${((gRepeated / (grandTotal - gPending || 1)) * 100).toFixed(1)}%` },
      { label: 'Pending Processing', value: `${gPending} students` }
    ];

    stats.forEach(s => {
      doc.fillColor('#64748b').fontSize(9).text(s.label, statsX, doc.y);
      doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text(s.value, statsX + 150, doc.y - 10);
      doc.moveDown(0.8).font('Helvetica');
    });

    // Pagination
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#94a3b8').fontSize(8).text(`Page ${i + 1} of ${range.count} | EduCore ERP`, 40, 780, { align: 'center', width: 515 });
    }

    doc.end();
  } catch (err) { next(err); }
};
