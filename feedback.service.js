// feedback.service.js - Human correction submission endpoint
const { getDb } = require("./db");

const VALID_CATEGORIES = ["billing", "technical", "account", "feature_request", "other"];
const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
const VALID_TEAMS = ["billing_team", "engineering", "account_management", "product", "support"];

async function submitFeedback(req, res) {
  const { id } = req.params;
  const { category, priority, team } = req.body;

  // At least one correction field is required
  if (!category && !priority && !team) {
    return res.status(400).json({
      error: "At least one of category, priority, or team must be provided for feedback",
    });
  }

  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` });
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` });
  }
  if (team && !VALID_TEAMS.includes(team)) {
    return res.status(400).json({ error: `Invalid team. Must be one of: ${VALID_TEAMS.join(", ")}` });
  }

  const db = getDb();
  const ticket = db.prepare("SELECT * FROM tickets WHERE ticket_id = ?").get(id);

  if (!ticket) {
    return res.status(404).json({ error: `Ticket ${id} not found` });
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE tickets
    SET
      human_category = COALESCE(?, human_category),
      human_priority = COALESCE(?, human_priority),
      human_team     = COALESCE(?, human_team),
      feedback_submitted_at = ?
    WHERE ticket_id = ?
  `).run(category || null, priority || null, team || null, now, id);

  const updated = db.prepare("SELECT * FROM tickets WHERE ticket_id = ?").get(id);

  // Compute delta between AI and human decisions
  const delta = {};
  if (updated.human_category && updated.human_category !== updated.ai_category) {
    delta.category = { ai: updated.ai_category, human: updated.human_category };
  }
  if (updated.human_priority && updated.human_priority !== updated.ai_priority) {
    delta.priority = { ai: updated.ai_priority, human: updated.human_priority };
  }
  if (updated.human_team && updated.human_team !== updated.ai_team) {
    delta.team = { ai: updated.ai_team, human: updated.human_team };
  }

  return res.json({
    success: true,
    ticket_id: id,
    feedback_recorded_at: now,
    ai_classification: {
      category: updated.ai_category,
      priority: updated.ai_priority,
      team: updated.ai_team,
    },
    human_correction: {
      category: updated.human_category,
      priority: updated.human_priority,
      team: updated.human_team,
    },
    delta,
    agreement: Object.keys(delta).length === 0,
  });
}

module.exports = { submitFeedback };
