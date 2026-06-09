# AI Customer Support Triage Service

A Node.js backend that automates support ticket triage using a single Claude API call per batch. Classifies tickets by category, priority, and team, persists results to SQLite, and exposes a human feedback loop with per-category accuracy reporting.

## Tech Stack

- Node.js 22+ with Express
- Anthropic Claude API (claude-sonnet-4)
- SQLite via Node.js built-in `node:sqlite` module (no native bindings needed)

## Setup

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Create a `.env` file from the example:

```bash
cp .env.example .env
```

3. Add your Anthropic API key to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

4. Start the server:

```bash
node index.js
```

The server runs on `http://localhost:3000` by default.

## Endpoints

### POST /triage

Classifies a batch of tickets in a single LLM call.

```bash
curl -X POST http://localhost:3000/triage \
  -H "Content-Type: application/json" \
  -d '{
    "tickets": [
      {
        "id": "T001",
        "subject": "Charged twice for subscription",
        "body": "I was billed $49 twice this month. Please refund one of the charges."
      },
      {
        "id": "T002",
        "subject": "App crashes on login",
        "body": "Every time I try to log in the app crashes. Started after yesterdays update."
      },
      {
        "id": "T003",
        "subject": "How do I export my data?",
        "body": "I want to download all my data before cancelling my account."
      }
    ]
  }'
```

Response:
```json
{
  "success": true,
  "processed": 3,
  "processing_ms": 1823,
  "tokens_used": { "prompt": 412, "completion": 124, "total": 536 },
  "results": [
    {
      "ticket_id": "T001",
      "category": "billing",
      "priority": "high",
      "team": "billing_team",
      "summary": "Customer was double charged $49 and is requesting an immediate refund."
    }
  ]
}
```

### GET /triage/stats

Returns operational stats including token usage, processing times, and category distribution.

```bash
curl http://localhost:3000/triage/stats
```

### POST /triage/:id/feedback

Submit a human correction for an AI-classified ticket. At least one field is required.

```bash
curl -X POST http://localhost:3000/triage/T002/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "category": "technical",
    "priority": "critical",
    "team": "engineering"
  }'
```

Response includes the delta between AI and human decisions:
```json
{
  "success": true,
  "ticket_id": "T002",
  "delta": {
    "priority": { "ai": "high", "human": "critical" }
  },
  "agreement": false
}
```

### GET /triage/accuracy

Generates a per-category accuracy report showing where the model consistently misclassifies tickets. The report is also saved to `accuracy_report.json`.

```bash
curl http://localhost:3000/triage/accuracy
```

## Classification Schema

| Field | Allowed Values |
|-------|---------------|
| category | billing, technical, account, feature_request, other |
| priority | low, medium, high, critical |
| team | billing_team, engineering, account_management, product, support |

## Files

- `index.js` - Express server and route wiring
- `db.js` - SQLite schema setup
- `triage.service.js` - POST /triage and GET /triage/stats
- `feedback.service.js` - POST /triage/:id/feedback
- `accuracy.service.js` - GET /triage/accuracy
- `sample_tickets.json` - 50 sample tickets for testing
- `triage_results.json` - Example triage output committed to repo
- `accuracy_report.json` - Example accuracy report committed to repo

## Prompt Design

The service uses a single batch prompt that sends all tickets to Claude in one call. Temperature is set to 0 to ensure deterministic, consistent classification output. The prompt instructs the model to return only a JSON array with no markdown or preamble, which makes parsing reliable. All returned values are validated against allowed enums before being written to the database to guard against model hallucinations.
