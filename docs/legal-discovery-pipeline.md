# Legal Discovery Pipeline

## Overview

When a service is added, the application now queues an asynchronous legal-discovery run.

The run attempts to find and store legal/compliance documents beyond only a privacy policy, and tracks a checklist status per service.

## Discovery stages

1. LLM planner stage
   - Uses homepage text and URL context.
   - Suggests candidate doc types, candidate paths, potential regulations, and hub clues.
2. Scraper + path probing stage
   - Scores homepage links for legal-document patterns.
   - Probes well-known paths per doc type.
3. Sitemap stage
   - Attempts to parse `sitemap.xml` and sitemap index files.
   - Scores sitemap URLs against legal-document patterns.
   - Stores the raw sitemap XML locally for user review.
4. Targeted fallback stage
   - Fetches shortlisted pages and validates text against doc-type patterns.

Browser-simulation navigation is intentionally deferred.

## Checklist model

Core required doc types:

- `privacy_policy`
- `data_policy`
- `security_policy`
- `terms_of_use`
- `terms_and_conditions`

Regulation-specific doc types (required when signals indicate relevance):

- `hipaa_notice`
- `sox_compliance`
- `gdpr_addendum`

## Resource hubs

The pipeline also detects and records site hubs such as:

- `privacy_center`
- `security_center`

These are persisted separately from legal documents and surfaced through API/UI.

## Persistence

New DB tables:

- `legal_documents`
- `legal_checklist_items`
- `service_resource_hubs`
- `service_discovery_runs`

Raw discovered documents are saved under:

- `data/legal-documents/{serviceId}/{docType}/{timestamp}.html`

## API surface

- `GET /api/services/:id/legal-documents`
- `GET /api/services/:id/checklist`
- `GET /api/services/:id/discovery-runs/latest`
- `POST /api/services/:id/discover`
- `GET /api/services/:id/sitemap`
- `POST /api/services/:id/sitemap/collect`

## User-guided sitemap selection

- The UI exposes a sitemap modal when a sitemap snapshot exists.
- Users can select URLs with checkboxes.
- Selected URLs are collected for local storage and can be sent through analysis.
