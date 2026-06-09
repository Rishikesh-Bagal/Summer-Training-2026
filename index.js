// index.js - Express server entry point
require("dotenv").config();

const express = require("express");
const { triageTickets, getStats } = require("./triage.service");
const { submitFeedback } = require("./feedback.service");
const { getAccuracyReport } = require("./accuracy.service");

const app = express();
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ service: "AI Customer Support Triage", status: "ok" });
});

// POST /triage - batch classify tickets
app.post("/triage", triageTickets);

// GET /triage/stats - operational stats (must be before /:id routes)
app.get("/triage/stats", getStats);

// GET /triage/accuracy - per-category accuracy report
app.get("/triage/accuracy", getAccuracyReport);

// POST /triage/:id/feedback - submit human correction
app.post("/triage/:id/feedback", submitFeedback);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error", detail: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Triage service running on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /triage`);
  console.log(`  GET  /triage/stats`);
  console.log(`  POST /triage/:id/feedback`);
  console.log(`  GET  /triage/accuracy`);
});

module.exports = app;
