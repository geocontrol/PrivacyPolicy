# Privacy Policy Dashboard

A local-first personal intelligence dashboard that aggregates, analyses, and visualises privacy policies across digital services and platforms.

## What it does

- Add any online service by name and URL
- Automatically runs asynchronous legal-document discovery on add (privacy/terms/security/data + regulated docs when applicable)
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

## Run with Docker Compose

### Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- A populated `.env` file (copy from `.env.example`)

### Start

```bash
docker compose up --build
```

App URL: `http://localhost:3000`

### Stop

```bash
docker compose down
```

### Rebuild

```bash
docker compose build
docker compose up
```

### Data persistence

Compose mounts `./data` into `/app/data` in the container. This keeps:

- SQLite DB at `./data/db.sqlite`
- Retrieved policy files at `./data/policies`

### Environment and secrets

- Compose loads environment variables from `.env` (`env_file`).
- Keep `.env` out of version control.
- `ANTHROPIC_API_KEY` is required for policy analysis.
- `EXTENSION_API_TOKEN` is optional unless you use the extension signup endpoint.

### Troubleshooting

- Port conflict on `3000`: stop the process using the port or change the host mapping in `docker-compose.yml`.
- Permission errors on `./data`: ensure your local user has read/write access to the `data` directory.
- Analysis fails with config errors: verify `ANTHROPIC_API_KEY` is set in `.env`.

## Browser extension signup endpoint

Set `EXTENSION_API_TOKEN` in your `.env` file. Browser extension requests must send the same value in the `x-extension-token` header.

## Chrome extension

A standalone Chrome extension is available in:

- `extensions/privacy-dashboard-chrome`

It provides a popup button to add the currently browsed site to this dashboard via the extension signup API. See its dedicated README for setup and usage.

Endpoint:

- `POST /api/integrations/extension/signup`

Headers:

- `x-extension-token: <EXTENSION_API_TOKEN>`
- `Content-Type: application/json`

Request body:

```json
{
  "url": "https://example.com/signup",
  "name": "Example",
  "category": "Technology"
}
```

Behavior:

- Upserts a service by normalized domain
- Queues legal discovery for checklist/resource-hub detection
- Fetches the latest privacy policy document
- Runs policy analysis
- Returns `201` when a new service is created, `200` when an existing service is reused

## Legal discovery endpoints

- `GET /api/services/:id/legal-documents` — discovered legal documents + resource hubs
- `GET /api/services/:id/checklist` — required/found/missing checklist items
- `GET /api/services/:id/discovery-runs/latest` — latest async discovery run status
- `POST /api/services/:id/discover` — manually queue discovery
- `GET /api/services/:id/sitemap` — latest stored sitemap snapshot + page list
- `POST /api/services/:id/sitemap/collect` — collect selected sitemap pages for storage and optional analysis

## Sitemap workflow (UI)

- If discovery finds a sitemap, the XML snapshot is copied locally and surfaced in service details.
- Service details include an **Open Sitemap Selector** modal.
- The modal renders sitemap page URLs with checkboxes.
- Selected URLs can be collected for local storage, with optional analysis.

Response shape:

```json
{
  "service": {
    "id": "svc-...",
    "name": "Example",
    "url": "example.com",
    "category": "Technology",
    "created_at": "2024-01-01 00:00:00",
    "updated_at": "2024-01-01 00:00:00"
  },
  "created": true,
  "fetch": {
    "documentId": "doc-...",
    "resolvedUrl": "https://example.com/privacy"
  },
  "analysis": {
    "id": "ana-...",
    "analysed_at": "2024-01-01 00:00:00"
  },
  "message": "Service added and processing complete"
}
```

## Documentation

- [`docs/ideation-brief.md`](docs/ideation-brief.md) — project vision and requirements
- [`docs/adr-001-technology-stack.md`](docs/adr-001-technology-stack.md) — technology decisions and rationale
- [`docs/legal-discovery-pipeline.md`](docs/legal-discovery-pipeline.md) — multi-document discovery design
