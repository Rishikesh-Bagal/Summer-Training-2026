// triage.service.js - Batch ticket classification using Claude API
const Anthropic = require("@anthropic-ai/sdk");
const { getDb } = require("./db");

const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID_CATEGORIES = ["billing", "technical", "account", "feature_request", "other"];
const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
const VALID_TEAMS = ["billing_team", "engineering", "account_management", "product", "support"];

function buildBatchPrompt(tickets) {
  const ticketList = tickets
    .map(
      (t, i) =>
        `Ticket ${i + 1} [ID: ${t.id}]
Subject: ${t.subject}
Body: ${t.body}`
    )
    .join("\n\n---\n\n");

  return `You are a support triage system. Classify each ticket below and return ONLY a valid JSON array — no markdown, no explanation, no extra text.

For each ticket return an object with exactly these fields:
- ticket_id: the ID string from the ticket header
- category: one of: billing, technical, account, feature_request, other
- priority: one of: low, medium, high, critical
- team: one of: billing_team, engineering, account_management, product, support
- summary: a single sentence (max 20 words) describing the issue

Priority guide:
- critical: system down, data loss, security breach, payments failing
- high: major feature broken, many users affected
- medium: single user issue, degraded experience
- low: question, cosmetic issue, feature request

Team routing:
- billing_team: invoices, charges, refunds, subscription changes
- engineering: bugs, errors, crashes, performance issues
- account_management: account access, login, profile, permissions
- product: feature requests, suggestions, roadmap questions
- support: general questions, onboarding, how-to

Tickets to classify:

${ticketList}

Return ONLY the JSON array. Example format:
[{"ticket_id":"T001","category":"billing","priority":"high","team":"billing_team","summary":"Customer was double charged for their subscription."}]`;
}

async function triageTickets(req, res) {
  const { tickets } = req.body;

  if (!Array.isArray(tickets) || tickets.length === 0) {
    return res.status(400).json({ error: "tickets must be a non-empty array" });
  }

  for (const t of tickets) {
    if (!t.id || !t.subject || !t.body) {
      return res.status(400).json({ error: "Each ticket must have id, subject, and body" });
    }
  }

  const start = Date.now();

  let message;
  try {
    message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      temperature: 0,
      messages: [{ role: "user", content: buildBatchPrompt(tickets) }],
    });
  } catch (err) {
    console.error("Claude API error:", err.message);
    return res.status(502).json({ error: "Claude API request failed", detail: err.message });
  }

  const processingMs = Date.now() - start;
  const rawText = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");

  let classified;
  try {
    const clean = rawText.replace(/```json|```/g, "").trim();
    classified = JSON.parse(clean);
  } catch {
    console.error("Failed to parse Claude response:", rawText);
    return res.status(500).json({ error: "Failed to parse model response", raw: rawText });
  }

  // Validate and sanitise each result
  const sanitised = classified.map((item) => ({
    ticket_id: String(item.ticket_id),
    category: VALID_CATEGORIES.includes(item.category) ? item.category : "other",
    priority: VALID_PRIORITIES.includes(item.priority) ? item.priority : "medium",
    team: VALID_TEAMS.includes(item.team) ? item.team : "support",
    summary: String(item.summary || "").slice(0, 200),
  }));

  // Persist to SQLite
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO tickets
      (ticket_id, subject, body, ai_category, ai_priority, ai_team, ai_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const ticketMap = Object.fromEntries(tickets.map((t) => [String(t.id), t]));

  for (const item of sanitised) {
    const orig = ticketMap[item.ticket_id];
    if (orig) {
      insert.run(item.ticket_id, orig.subject, orig.body, item.category, item.priority, item.team, item.summary);
    }
  }

  // Record batch run stats
  db.prepare(`
    INSERT INTO batch_runs (ticket_count, prompt_tokens, completion_tokens, total_tokens, processing_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    tickets.length,
    message.usage.input_tokens,
    message.usage.output_tokens,
    message.usage.input_tokens + message.usage.output_tokens,
    processingMs
  );

  return res.json({
    success: true,
    processed: sanitised.length,
    processing_ms: processingMs,
    tokens_used: {
      prompt: message.usage.input_tokens,
      completion: message.usage.output_tokens,
      total: message.usage.input_tokens + message.usage.output_tokens,
    },
    results: sanitised,
  });
}

async function getStats(req, res) {
  const db = getDb();

  const runs = db.prepare("SELECT * FROM batch_runs ORDER BY created_at DESC LIMIT 10").all();
  const totalTickets = db.prepare("SELECT COUNT(*) as count FROM tickets").get();
  const categoryDist = db.prepare("SELECT ai_category as category, COUNT(*) as count FROM tickets GROUP BY ai_category").all();
  const priorityDist = db.prepare("SELECT ai_priority as priority, COUNT(*) as count FROM tickets GROUP BY ai_priority").all();
  const teamDist = db.prepare("SELECT ai_team as team, COUNT(*) as count FROM tickets GROUP BY ai_team").all();
  const feedbackCount = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE human_category IS NOT NULL").get();

  const avgProcessingMs =
    runs.length > 0 ? Math.round(runs.reduce((s, r) => s + r.processing_ms, 0) / runs.length) : 0;

  const totalTokens = runs.reduce((s, r) => s + r.total_tokens, 0);

  return res.json({
    total_tickets_processed: totalTickets.count,
    tickets_with_feedback: feedbackCount.count,
    recent_batch_runs: runs.length,
    avg_processing_ms: avgProcessingMs,
    total_tokens_used: totalTokens,
    category_distribution: Object.fromEntries(categoryDist.map((r) => [r.category, r.count])),
    priority_distribution: Object.fromEntries(priorityDist.map((r) => [r.priority, r.count])),
    team_distribution: Object.fromEntries(teamDist.map((r) => [r.team, r.count])),
    recent_runs: runs.map((r) => ({
      ticket_count: r.ticket_count,
      total_tokens: r.total_tokens,
      processing_ms: r.processing_ms,
      created_at: r.created_at,
    })),
  });
}

module.exports = { triageTickets, getStats };
