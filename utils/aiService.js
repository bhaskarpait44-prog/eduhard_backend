'use strict';

/**
 * In-house Rule-Based Analysis Engine
 * Generates natural language summaries from aggregated school data.
 */

exports.generateAnalysis = async (data) => {
  const parts = [];

  // 1. Attendance Analysis
  const att = data.attendance;
  if (att) {
    if (att.today.percentage >= 90) {
      parts.push(`Today's student attendance is excellent at **${att.today.percentage.toFixed(1)}%** (${att.today.present} present).`);
    } else if (att.today.percentage >= 75) {
      parts.push(`Today's student attendance is fair at **${att.today.percentage.toFixed(1)}%** (${att.today.absent} absent).`);
    } else if (att.today.total_marked > 0) {
      parts.push(`⚠️ **Alert:** Today's student attendance is critically low at **${att.today.percentage.toFixed(1)}%**.`);
    } else {
      parts.push(`No student attendance data marked for today yet.`);
    }

    if (att.weekly_avg < 80 && att.weekly_avg > 0) {
      parts.push(`The weekly average is trending low (${att.weekly_avg}%).`);
    }
  }

  // 2. Fee Collection Analysis
  const fees = data.fees;
  if (fees) {
    if (fees.collection_percentage >= 80) {
      parts.push(`Fee collection for the month is strong at **${fees.collection_percentage.toFixed(1)}%**.`);
    } else if (fees.expected > 0) {
      parts.push(`Fee collection is currently at **${fees.collection_percentage.toFixed(1)}%** of expected monthly revenue.`);
    }
    
    if (fees.defaulter_count > 0) {
      parts.push(`⚠️ There are **${fees.defaulter_count}** students with overdue payments requiring immediate follow-up.`);
    }
  }

  // 3. Staff Attendance Analysis
  const staff = data.staff;
  if (staff) {
    if (staff.percentage >= 90) {
      parts.push(`Staff attendance is optimal at **${staff.percentage.toFixed(1)}%**.`);
    } else if (staff.total_marked > 0 && staff.percentage < 85) {
      parts.push(`⚠️ **Alert:** Staff attendance is low today (**${staff.percentage.toFixed(1)}%**, ${staff.today_absent} absent).`);
    }
  }

  // 4. Upcoming Exams
  const exams = data.upcoming_exams;
  if (exams && exams.length > 0) {
    const nextExam = exams[0];
    const examDate = new Date(nextExam.start_date).toLocaleDateString();
    parts.push(`📅 **Upcoming Event:** The next exam is "${nextExam.name}" starting on ${examDate}.`);
  }

  if (parts.length === 0) {
    return "Insufficient data to generate a dashboard summary at this time.";
  }

  return parts.join(' ');
};
