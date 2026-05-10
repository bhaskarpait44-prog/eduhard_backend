'use strict';

const sequelize = require('../config/database');

async function recomputeStudentAchievements({ studentId, sessionId, enrollmentId }) {
  if (!studentId || !sessionId || !enrollmentId) return [];

  await awardPerfectAttendance({ studentId, sessionId, enrollmentId });
  await awardTopPerformer({ studentId, sessionId, enrollmentId });
  await awardImprovement({ studentId, sessionId, enrollmentId });
  await awardAttendanceStreak({ studentId, sessionId, enrollmentId });
  await awardHomeworkStreak({ studentId, sessionId, enrollmentId });

  const [rows] = await sequelize.query(`
    SELECT id, achievement_type, earned_for, earned_at, session_id
    FROM student_achievements
    WHERE student_id = :studentId
      AND session_id = :sessionId
    ORDER BY earned_at DESC, id DESC;
  `, {
    replacements: { studentId, sessionId },
  });

  return rows;
}

async function awardPerfectAttendance({ studentId, sessionId, enrollmentId }) {
  const [rows] = await sequelize.query(`
    SELECT
      TO_CHAR(date, 'Mon YYYY') AS month_label,
      ROUND(
        (
          COUNT(*) FILTER (WHERE status IN ('present', 'late'))
          + COUNT(*) FILTER (WHERE status = 'half_day') * 0.5
        ) / NULLIF(COUNT(*) FILTER (WHERE status <> 'holiday'), 0) * 100,
        2
      ) AS percentage
    FROM attendance
    WHERE enrollment_id = :enrollmentId
    GROUP BY DATE_TRUNC('month', date), TO_CHAR(date, 'Mon YYYY')
    HAVING COUNT(*) FILTER (WHERE status <> 'holiday') > 0
    ORDER BY DATE_TRUNC('month', date) ASC;
  `, {
    replacements: { enrollmentId },
  });

  for (const row of rows) {
    if (Number(row.percentage || 0) >= 100) {
      await upsertAchievement({
        studentId,
        sessionId,
        achievementType: 'perfect_attendance',
        earnedFor: row.month_label,
      });
    }
  }
}

async function awardTopPerformer({ studentId, sessionId, enrollmentId }) {
  const rows = await examPercentages({ enrollmentId, sessionId });
  for (const row of rows) {
    if (Number(row.percentage || 0) >= 90) {
      await upsertAchievement({
        studentId,
        sessionId,
        achievementType: 'top_performer',
        earnedFor: row.exam_name,
      });
    }
  }
}

async function awardImprovement({ studentId, sessionId, enrollmentId }) {
  const rows = await examPercentages({ enrollmentId, sessionId });
  for (let index = 1; index < rows.length; index += 1) {
    if (Number(rows[index].percentage || 0) > Number(rows[index - 1].percentage || 0)) {
      await upsertAchievement({
        studentId,
        sessionId,
        achievementType: 'improvement',
        earnedFor: rows[index].exam_name,
      });
    }
  }
}

async function awardAttendanceStreak({ studentId, sessionId, enrollmentId }) {
  const [rows] = await sequelize.query(`
    SELECT date, status
    FROM attendance
    WHERE enrollment_id = :enrollmentId
      AND date <= CURRENT_DATE
      AND status <> 'holiday'
    ORDER BY date ASC, id ASC;
  `, {
    replacements: { enrollmentId },
  });

  let bestStreak = 0;
  let currentStreak = 0;
  for (const row of rows) {
    if (['present', 'late', 'half_day'].includes(row.status)) {
      currentStreak += 1;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  if (bestStreak >= 5) {
    await upsertAchievement({
      studentId,
      sessionId,
      achievementType: 'attendance_streak',
      earnedFor: `Best streak ${bestStreak} days`,
    });
  }
}

async function awardHomeworkStreak({ studentId, sessionId, enrollmentId }) {
  const [rows] = await sequelize.query(`
    SELECT hs.is_late
    FROM homework_submissions hs
    JOIN homework h ON h.id = hs.homework_id
    WHERE hs.enrollment_id = :enrollmentId
      AND h.session_id = :sessionId
      AND hs.status IN ('submitted', 'graded')
    ORDER BY h.due_date ASC, hs.submitted_at ASC, hs.id ASC;
  `, {
    replacements: { enrollmentId, sessionId },
  });

  let bestStreak = 0;
  let currentStreak = 0;
  for (const row of rows) {
    if (!row.is_late) {
      currentStreak += 1;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  if (bestStreak >= 5) {
    await upsertAchievement({
      studentId,
      sessionId,
      achievementType: 'homework_streak',
      earnedFor: `Homework streak ${bestStreak}`,
    });
  }
}

async function examPercentages({ enrollmentId, sessionId }) {
  const [rows] = await sequelize.query(`
    SELECT
      ex.id AS exam_id,
      ex.name AS exam_name,
      ex.start_date,
      ROUND(
        SUM(COALESCE(er.marks_obtained, COALESCE(er.theory_marks_obtained, 0) + COALESCE(er.practical_marks_obtained, 0)))
        / NULLIF(SUM(COALESCE(sub.combined_total_marks, 0)), 0) * 100,
        2
      ) AS percentage
    FROM exams ex
    JOIN exam_results er
      ON er.exam_id = ex.id
     AND er.enrollment_id = :enrollmentId
    JOIN subjects sub ON sub.id = er.subject_id
    WHERE ex.session_id = :sessionId
    GROUP BY ex.id, ex.name, ex.start_date
    ORDER BY ex.start_date ASC, ex.id ASC;
  `, {
    replacements: { enrollmentId, sessionId },
  });
  return rows;
}

async function upsertAchievement({ studentId, sessionId, achievementType, earnedFor }) {
  await sequelize.query(`
    INSERT INTO student_achievements (
      student_id, achievement_type, earned_for, earned_at, session_id, created_at, updated_at
    )
    VALUES (
      :studentId, :achievementType, :earnedFor, NOW(), :sessionId, NOW(), NOW()
    )
    ON CONFLICT (student_id, achievement_type, session_id, earned_for)
    DO NOTHING;
  `, {
    replacements: {
      studentId,
      achievementType,
      earnedFor,
      sessionId,
    },
  });
}

module.exports = {
  recomputeStudentAchievements,
};
