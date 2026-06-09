// db.js - SQLite setup using Node.js built-in sqlite module (Node 22+)
const { DatabaseSync } = require("node:sqlite");

let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync("./triage.db");

    // Suppress experimental warning in output
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT UNIQUE NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        ai_category TEXT NOT NULL,
        ai_priority TEXT NOT NULL,
        ai_team TEXT NOT NULL,
        ai_summary TEXT NOT NULL,
        human_category TEXT,
        human_priority TEXT,
        human_team TEXT,
        feedback_submitted_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS batch_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_count INTEGER NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        processing_ms INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }
  return db;
}

module.exports = { getDb };
