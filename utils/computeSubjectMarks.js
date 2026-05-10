'use strict';

/**
 * Computes combined_total_marks and combined_passing_marks
 * based on subject_type. Called before every insert/update.
 */
function computeSubjectMarks(data) {
  const {
    subject_type,
    theory_total_marks,
    theory_passing_marks,
    practical_total_marks,
    practical_passing_marks,
  } = data;

  const tt = parseFloat(theory_total_marks)    || 0;
  const tp = parseFloat(theory_passing_marks)  || 0;
  const pt = parseFloat(practical_total_marks)  || 0;
  const pp = parseFloat(practical_passing_marks)|| 0;

  switch (subject_type) {
    case 'theory':
      return {
        theory_total_marks      : tt,
        theory_passing_marks    : tp,
        practical_total_marks   : null,
        practical_passing_marks : null,
        combined_total_marks    : tt,
        combined_passing_marks  : tp,
      };

    case 'practical':
      return {
        theory_total_marks      : null,
        theory_passing_marks    : null,
        practical_total_marks   : pt,
        practical_passing_marks : pp,
        combined_total_marks    : pt,
        combined_passing_marks  : pp,
      };

    case 'both':
      return {
        theory_total_marks      : tt,
        theory_passing_marks    : tp,
        practical_total_marks   : pt,
        practical_passing_marks : pp,
        combined_total_marks    : tt + pt,
        combined_passing_marks  : tp + pp,
      };

    default:
      throw new Error(`Invalid subject_type: ${subject_type}`);
  }
}

module.exports = computeSubjectMarks;