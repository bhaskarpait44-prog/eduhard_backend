'use strict';

/**
 * Migration: Fix exam_results NULL marks CHECK constraint (Issue #6)
 *
 * Problem:
 *   The original constraint uses `marks_obtained >= 0`, which evaluates to NULL
 *   (not FALSE) in Postgres when `marks_obtained IS NULL`. Since Postgres treats
 *   a NULL CHECK result as passing, a row with is_absent=false and
 *   marks_obtained=NULL silently bypasses the constraint — the exact case it was
 *   written to prevent.
 *
 * Fix:
 *   Replace the broken constraint with one that explicitly requires
 *   `marks_obtained IS NOT NULL` when `is_absent` is false/null.
 */

module.exports = {
  async up(queryInterface) {
    // ── Data audit: report any existing violating rows before altering ──────
    const [badRows] = await queryInterface.sequelize.query(`
      SELECT id, exam_id, enrollment_id, subject_id, is_absent, marks_obtained
      FROM exam_results
      WHERE is_absent IS NOT TRUE
        AND marks_obtained IS NULL;
    `);

    if (badRows.length > 0) {
      console.warn(
        `[fix-exam-results-null-marks-constraint] WARNING: Found ${badRows.length} ` +
        `row(s) with is_absent=false/null AND marks_obtained=NULL. ` +
        `These will remain until manually corrected. Enrollment IDs: ` +
        badRows.map(r => r.enrollment_id).join(', ')
      );
    }

    // ── Drop the broken constraint ────────────────────────────────────────
    await queryInterface.sequelize.query(`
      ALTER TABLE exam_results
      DROP CONSTRAINT IF EXISTS chk_marks_absent_consistency;
    `);

    // ── Recreate with correct NULL-safe logic ─────────────────────────────
    // New rule:
    //   • is_absent = true  → marks_obtained MUST be NULL
    //   • is_absent = false (or NULL) → marks_obtained MUST be non-negative (not null)
    await queryInterface.sequelize.query(`
      ALTER TABLE exam_results
      ADD CONSTRAINT chk_marks_absent_consistency
      CHECK (
        (is_absent = true  AND marks_obtained IS NULL)
        OR
        (is_absent IS NOT TRUE AND marks_obtained IS NOT NULL AND marks_obtained >= 0)
      );
    `);
  },

  async down(queryInterface) {
    // Restore the original (broken) constraint for rollback purposes
    await queryInterface.sequelize.query(`
      ALTER TABLE exam_results
      DROP CONSTRAINT IF EXISTS chk_marks_absent_consistency;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE exam_results
      ADD CONSTRAINT chk_marks_absent_consistency
      CHECK (
        (is_absent = true  AND marks_obtained IS NULL)
        OR
        (is_absent = false AND marks_obtained >= 0)
      );
    `);
  },
};
