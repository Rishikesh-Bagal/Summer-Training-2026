// accuracy.service.js - Per-category accuracy report generation
const { getDb } = require("./db");
const fs = require("fs");
const path = require("path");

async function getAccuracyReport(req, res) {
  const db = getDb();

  // Only tickets where humans provided category feedback
  const feedbackRows = db
    .prepare(
      `SELECT ai_category, human_category, ai_priority, human_priority, ai_team, human_team
       FROM tickets
       WHERE human_category IS NOT NULL OR human_priority IS NOT NULL OR human_team IS NOT NULL`
    )
    .all();

  if (feedbackRows.length === 0) {
    return res.json({
      message: "No feedback data available yet. Submit corrections via POST /triage/:id/feedback",
      total_feedback: 0,
      category_accuracy: {},
      priority_accuracy: {},
      team_accuracy: {},
      overall_accuracy: null,
    });
  }

  // Build per-category accuracy
  function computeAccuracy(rows, aiField, humanField) {
    const stats = {}; // { category: { correct, total, misclassified_as: {} } }

    for (const row of rows) {
      const ai = row[aiField];
      const human = row[humanField];
      if (!human) continue; // skip rows where this field wasn't corrected

      if (!stats[human]) {
        stats[human] = { correct: 0, total: 0, misclassified_as: {} };
      }
      stats[human].total++;

      if (ai === human) {
        stats[human].correct++;
      } else {
        // Track what the AI said instead
        stats[human].misclassified_as[ai] = (stats[human].misclassified_as[ai] || 0) + 1;
      }
    }

    // Format output
    return Object.fromEntries(
      Object.entries(stats).map(([label, s]) => [
        label,
        {
          total_samples: s.total,
          correct: s.correct,
          incorrect: s.total - s.correct,
          accuracy_pct: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
          misclassified_as: s.misclassified_as,
        },
      ])
    );
  }

  const categoryAccuracy = computeAccuracy(feedbackRows, "ai_category", "human_category");
  const priorityAccuracy = computeAccuracy(feedbackRows, "ai_priority", "human_priority");
  const teamAccuracy = computeAccuracy(feedbackRows, "ai_team", "human_team");

  // Overall accuracy across all category corrections
  const categoryRows = feedbackRows.filter((r) => r.human_category);
  const overallCorrect = categoryRows.filter((r) => r.ai_category === r.human_category).length;
  const overallAccuracy =
    categoryRows.length > 0 ? Math.round((overallCorrect / categoryRows.length) * 100) : null;

  // Find the worst-performing category
  const worstCategory = Object.entries(categoryAccuracy).sort(
    (a, b) => a[1].accuracy_pct - b[1].accuracy_pct
  )[0];

  const report = {
    generated_at: new Date().toISOString(),
    total_feedback_submissions: feedbackRows.length,
    category_feedback_count: categoryRows.length,
    overall_category_accuracy_pct: overallAccuracy,
    worst_category: worstCategory
      ? { name: worstCategory[0], accuracy_pct: worstCategory[1].accuracy_pct }
      : null,
    category_accuracy: categoryAccuracy,
    priority_accuracy: priorityAccuracy,
    team_accuracy: teamAccuracy,
  };

  // Persist report to file
  try {
    fs.writeFileSync(
      path.join(__dirname, "accuracy_report.json"),
      JSON.stringify(report, null, 2)
    );
  } catch (err) {
    console.error("Could not write accuracy_report.json:", err.message);
  }

  return res.json(report);
}

module.exports = { getAccuracyReport };
