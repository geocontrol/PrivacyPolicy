# ADR-001: Technology Stack

**Date:** 2026-02-18
**Status:** Accepted

---

## Context

The project needs a local-first web application stack. The user works primarily in Node.js and wants a simple local web app (not a desktop wrapper like Electron or Tauri) that can be packaged for others to run on their machine.

---

## Decisions

### Language: Node.js with TypeScript
TypeScript is chosen over plain JavaScript for type safety on data models (services, documents, analysis results, graph edges), which reduces bugs when mapping between the database, LLM responses, and the frontend.

### Backend: Express.js
Lightweight, well-understood HTTP server. Sufficient for a local single-user API. No need for a heavier framework.

### Database: SQLite via `better-sqlite3`
- SQLite is purpose-built for single-user, local-first applications
- `better-sqlite3` is the most mature Node.js SQLite driver (synchronous API, 3M+ weekly npm downloads)
- One `.db` file — trivially simple deployment and backup
- JSONB support for storing LLM analysis results
- DuckDB was considered but rejected: its Node.js ecosystem is in transition (original package deprecated, new `@duckdb/node-api` still maturing), and its analytical strengths are overkill for the data volumes expected here. Can be revisited if needed.

### Document Storage: Local filesystem
Raw policy HTML/text files are stored under `data/policies/{service-id}/{timestamp}.html`. The database holds metadata and a reference to the file path. This keeps binary/large content out of SQLite and makes files directly inspectable.

### LLM Integration: Anthropic SDK (default, configurable)
Claude API is the initial target. The LLM provider is abstracted so other providers (OpenAI, Ollama for local models) can be swapped in via config.

### Policy Crawler: axios + cheerio (static), Playwright (JS-heavy)
Start with static HTML fetching via `axios` and parsing via `cheerio`. Add `playwright` as a fallback for sites that render content client-side. Playwright is not installed by default to keep the footprint small.

### Graph Visualisation: Cytoscape.js
Purpose-built for network/graph visualisation with a good npm package. Handles supply chain graphs (nodes = services/third parties, edges = data sharing relationships) well.

### Frontend: Vite + vanilla TypeScript
No heavy framework needed for a personal dashboard. Vite gives fast local dev and a clean build output. Vanilla TS keeps the bundle small and dependencies minimal.

### Packaging: Docker Compose (initial)
Allows the application to be run on any machine with Docker installed without Node.js setup. A future enhancement could be a standalone installer (e.g. via `pkg` or a shell script).

### API Key Storage: `.env` file
Standard approach for local applications. `.env` is gitignored. `.env.example` is committed as a template.

---

## Consequences

- TypeScript compilation step required in development (`tsx` for dev, `tsc` for build)
- SQLite file must be included in any backup strategy (it is the entire data store)
- LLM API costs are the user's responsibility — no data leaves the machine except to the configured LLM provider
- Playwright adds a significant install size if enabled; it is opt-in
