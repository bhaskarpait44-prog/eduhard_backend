'use strict';

/**
 * AI Insights Engine - Deterministic Statistical & Rule-Based Analysis
 * This module performs analysis without external LLM calls.
 */

/**
 * 1. Trend Detection
 * Computes percentage change between two values.
 */
exports.calculateTrend = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

/**
 * 2. Anomaly Detection (Z-Score Based)
 * Identifies values that deviate significantly from the mean.
 * Threshold of 2.0 is standard for identifying outliers (95% confidence).
 */
exports.detectAnomalies = (dataPoints, threshold = 2.0) => {
  if (!dataPoints || dataPoints.length < 3) return [];
  
  const values = dataPoints.map(p => p.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(values.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / values.length);
  
  if (stdDev === 0) return [];

  return dataPoints
    .map(p => ({ ...p, zScore: (p.value - mean) / stdDev }))
    .filter(p => Math.abs(p.zScore) > threshold);
};

/**
 * 3. Risk Scoring (Student Level)
 * Weighted formula: 
 * - Attendance (40%): Higher risk if below 75%
 * - Fees (30%): Higher risk if dues exist and are old
 * - Academics (30%): Higher risk if average marks < 50%
 */
exports.calculateStudentRisk = ({ attendancePct, feeDueRatio, avgMarks }) => {
  // Normalize scores to 0-100 (100 is high risk)
  const attendanceRisk = attendancePct < 75 ? (75 - attendancePct) * (100 / 75) : 0;
  const feeRisk = Math.min(feeDueRatio * 100, 100);
  const academicRisk = avgMarks < 50 ? (50 - avgMarks) * 2 : 0;

  const totalScore = (attendanceRisk * 0.4) + (feeRisk * 0.3) + (academicRisk * 0.3);
  
  return {
    score: Math.round(totalScore),
    breakdown: {
      attendance: Math.round(attendanceRisk),
      fees: Math.round(feeRisk),
      academics: Math.round(academicRisk)
    }
  };
};

/**
 * 4. Simple Linear Regression / Forecasting
 * Predicts value at period 'targetIndex' based on historical trend.
 */
exports.predictValue = (dataPoints, targetIndex) => {
  if (!dataPoints || dataPoints.length < 2) return null;
  
  const n = dataPoints.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  
  dataPoints.forEach((p, i) => {
    sumX += i;
    sumY += p.value;
    sumXY += i * p.value;
    sumXX += i * i;
  });
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  return slope * targetIndex + intercept;
};

/**
 * 5. Rule-Based Recommendation Generator
 */
exports.generateRecommendations = (insights) => {
  const recommendations = [];

  // Attendance Rules
  if (insights.attendanceTrend < -5) {
    recommendations.push({
      type: 'warning',
      message: `Attendance dropped by ${Math.abs(insights.attendanceTrend).toFixed(1)}% this week. Consider class-wise reviews.`
    });
  }

  // Fee Rules
  if (insights.feeCollectionRatio < 0.6) {
    recommendations.push({
      type: 'critical',
      message: 'Monthly fee collection is below 60%. Trigger automated SMS reminders to defaulters.'
    });
  }

  // Risk Rules
  if (insights.highRiskCount > 10) {
    recommendations.push({
      type: 'info',
      message: `Found ${insights.highRiskCount} high-risk students. Schedule a counselor meeting for the top 5.`
    });
  }

  return recommendations;
};

/**
 * 6. Natural Language Template Builder
 */
exports.buildSummaryText = (data) => {
  let summary = `Dashboard Overview for ${new Date().toLocaleDateString()}: `;
  
  summary += `Overall attendance is at ${data.attendance.today.toFixed(1)}%, which is ${data.attendance.trend >= 0 ? 'up' : 'down'} by ${Math.abs(data.attendance.trend).toFixed(1)}% from last week. `;
  
  if (data.fees.collectionRatio < 0.5) {
    summary += `Fee collection is lagging significantly at ${Math.round(data.fees.collectionRatio * 100)}%. `;
  } else {
    summary += `Fee collection remains steady at ${Math.round(data.fees.collectionRatio * 100)}%. `;
  }

  if (data.anomalies.length > 0) {
    summary += `Detected ${data.anomalies.length} statistical anomalies in class performance. `;
  }

  return summary;
};
