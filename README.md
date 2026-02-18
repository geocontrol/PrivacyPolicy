# Privacy Policy Dashboard

A local-first personal intelligence dashboard that aggregates, analyses, and visualises privacy policies across digital services and platforms.

## What it does

- Add any online service by name and URL
- Automatically fetches and stores the privacy policy document (with timestamps)
- Uses an LLM to analyse and summarise the policy in plain language
- Identifies third parties mentioned in each policy and builds a supply chain graph
- Lets you recursively fetch and review third-party policies
- Dashboard shows all services, last reviewed dates, key summary points, and an interactive supply chain graph

## Tech stack

| Component | Technology |
|---|---|
| Backend | Node.js + TypeScript + Express |
| Database | SQLite (`better-sqlite3`) |
| LLM | Anthropic Claude API (configurable) |
| Crawler | axios + cheerio |
| Graph viz | Cytoscape.js |
| Frontend | Vite + vanilla TypeScript |

## Project structure

```
docs/        — documentation, ADRs, ideation brief
src/
  server/    — Express backend, DB schema, crawler, analyser, graph builder
  client/    — Frontend dashboard (Vite)
data/        — local persistent store (gitignored — created on first run)
  db.sqlite
  policies/  — raw policy documents by service ID and timestamp
```

## Getting started

### Prerequisites

- Node.js 20+
- An Anthropic API key (or configure another provider)

### Setup

```bash
npm install
cp .env.example .env
# Edit .env and add your API key
npm run dev
```

The server starts at `http://localhost:3000`.

In a second terminal, start the frontend dev server:

```bash
npm run client:dev
```

Then open `http://localhost:5173` in your browser.

## Documentation

- [`docs/ideation-brief.md`](docs/ideation-brief.md) — project vision and requirements
- [`docs/adr-001-technology-stack.md`](docs/adr-001-technology-stack.md) — technology decisions and rationale
