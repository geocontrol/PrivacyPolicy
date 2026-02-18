# Ideation Brief: Privacy Policy Intelligence Dashboard

**Date:** 2026-02-18
**Status:** Draft
**Version:** 0.1

---

## 1. Problem Statement

As a user of multiple online and digital services, each platform has its own privacy and security policy. Under GDPR and similar regulations (CCPA, PECR, etc.), these policies must be publicly accessible and detail:

- What data is collected
- How it is used and processed
- Who the data is shared with (third parties)
- Contact details for data-related queries

In practice, these policies are long, dense, and written in legal language. Users have no practical way to track policies across all their services, monitor for changes, understand third-party data sharing chains, or make informed decisions about their data.

---

## 2. Project Vision

A **local-first personal intelligence dashboard** that aggregates, stores, analyses, and summarises privacy policies across any digital platform or service a user registers. The application surfaces key information in plain language, visualises third-party data supply chains, and allows the user to recursively review the privacy policies of those third parties.

---

## 3. Core User Stories

### 3.1 Adding a Service
> As a user, I want to add a platform or service by name and URL so the application can locate and retrieve the relevant privacy policy documents.

### 3.2 Document Retrieval & Storage
> As a user, I want the application to fetch the privacy policy, store a local copy, and record a timestamp of when it was retrieved — so I have a historical record and can detect changes over time.

### 3.3 Analysis & Summarisation
> As a user, I want the application to analyse the retrieved policy and produce a plain-language summary covering: data collected, how it is used, how it is processed, retention periods, user rights, and contact details.

### 3.4 Third-Party Supply Chain Visualisation
> As a user, I want the application to identify any third parties mentioned in a policy and visualise the data supply chain — so I can understand who else has access to my data and under what terms.

### 3.5 Recursive Third-Party Review
> As a user, I want to select any identified third party and request that its privacy policy is also retrieved, analysed, and summarised — extending the supply chain view recursively.

### 3.6 Personal Dashboard
> As a user, I want a dashboard that shows all my registered services, when their policies were last retrieved and reviewed, key summary points, and links into the third-party supply chain graph.

---

## 4. Functional Requirements

### 4.1 Service Management
- Add a service by name and URL
- Edit or remove a registered service
- Tag or categorise services (e.g. social media, fintech, health, productivity)

### 4.2 Policy Retrieval
- Crawl the provided URL to locate the privacy policy page(s)
- Download and store a local copy of the policy document(s)
- Record retrieval timestamp and URL source
- Support re-retrieval to detect policy changes over time (diff view)
- Handle common formats: HTML pages, linked PDFs

### 4.3 Storage
- Persistent local data store
- Store raw policy documents with versioning (timestamp per retrieval)
- Store structured analysis results linked to document versions
- Store the service/third-party graph relationships

### 4.4 LLM-Powered Analysis
- Send retrieved policy text to an LLM (Claude or configurable provider)
- Extract and structure:
  - Data categories collected
  - Purposes of processing
  - Legal basis for processing
  - Data retention periods
  - Third parties named and their roles
  - User rights and how to exercise them
  - Data controller contact details
- Generate a plain-language summary
- Identify and extract named third-party entities

### 4.5 Supply Chain Visualisation
- Build a graph of data relationships: Service → Third Parties → Their Third Parties
- Render as an interactive visual graph on the dashboard
- Allow click-through to view any node's policy summary
- Indicate retrieval status for each node (retrieved / pending / not found)

### 4.6 Dashboard
- Overview list of all registered services
- Per-service status: last retrieved date, summary available, third-party count
- Key summary points displayed inline
- Visual supply chain graph per service
- Notifications or indicators when a policy may be outdated (configurable staleness threshold)

---

## 5. Non-Functional Requirements

- **Local-first**: All data stored on the user's machine. No cloud sync or remote database.
- **Packagable**: Should be runnable by any user on their own computer without complex setup (target: single installer or simple run script).
- **LLM-agnostic**: LLM provider should be configurable. Initial target: Anthropic Claude API. Should support alternative providers (OpenAI, local models via Ollama, etc.).
- **Privacy-respecting**: Ironic but essential — the application itself should not transmit user data anywhere except to the configured LLM API for analysis.
- **Offline-capable (partial)**: Core dashboard and stored data should be viewable without an internet connection. Retrieval and LLM analysis require connectivity.
- **Persistent storage**: Data must survive application restarts.

---

## 6. Out of Scope (for now)

- Automatic scheduled re-retrieval (may be added later)
- Multi-user support
- Cloud sync or backup
- Legal advice or compliance scoring
- Browser extension integration
- Mobile app

---

## 7. Proposed High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                   User Interface                     │
│              (Local Web Dashboard / GUI)             │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                 Application Layer                    │
│  - Service Manager                                   │
│  - Policy Retriever / Crawler                        │
│  - LLM Analysis Orchestrator                         │
│  - Supply Chain Graph Builder                        │
└───────┬───────────────────────────┬─────────────────┘
        │                           │
┌───────▼────────┐         ┌────────▼────────────────┐
│  Local Storage │         │  External LLM API        │
│  (documents,   │         │  (Claude / OpenAI /      │
│   analysis,    │         │   Ollama / configurable) │
│   graph data)  │         └─────────────────────────┘
└────────────────┘
        │
┌───────▼────────┐
│  Internet      │
│  (Policy page  │
│   retrieval    │
│   only)        │
└────────────────┘
```

---

## 8. Technology Candidates (to be decided)

| Component | Options to Evaluate |
|---|---|
| UI / Dashboard | React + local web server, Electron, Tauri |
| Backend / API | Python (FastAPI / Flask), Node.js |
| Local Database | SQLite, DuckDB |
| Document Storage | Local filesystem (structured folders) |
| Graph Visualisation | D3.js, Cytoscape.js, Mermaid |
| LLM Integration | Anthropic SDK, OpenAI SDK, Ollama |
| Policy Crawler | Python requests + BeautifulSoup, Playwright (for JS-heavy sites) |
| Packaging | Docker, PyInstaller, Electron Builder, Tauri |

---

## 9. Open Questions

1. How should the crawler handle sites that require login to access privacy settings (beyond the public policy page)?
2. What is the acceptable staleness threshold before flagging a policy as potentially outdated?
3. Should the supply chain graph have a maximum recursion depth to prevent runaway third-party chains?
4. How do we handle privacy policies that are not in English?
5. How should LLM API keys be stored securely on the user's machine?
6. Should there be a manual override to paste policy text directly (for services where crawling fails)?

---

## 10. Next Steps

- [ ] Review and finalise this brief
- [ ] Make technology stack decisions (Section 8)
- [ ] Answer open questions (Section 9)
- [ ] Define data models (services, documents, analysis, graph)
- [ ] Create project architecture document
- [ ] Set up development environment and tooling
- [ ] Build proof-of-concept: add service → retrieve policy → LLM summary

---

*This document will evolve as the project progresses. All major decisions should be recorded here or in linked documents in `docs/`.*
