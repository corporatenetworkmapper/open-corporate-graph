# Open Corporate Graph

**[Open the live map on GitHub Pages](https://corporatenetworkmapper.github.io/open-corporate-graph/)**

A free, browser-based corporate/entity relationship explorer built around public records, provenance, and interactive graph expansion.

## v14.4

The current main build uses a clean multi-file frontend (`index.html`, `app.css`, `core.js`, `graph.js`, `context.js`, and `search.js`) instead of the older monolithic controller.

## Core interaction

- Search for a company, person, agent, identifier, or address.
- Single-click an entity node to inspect it and load its address context.
- Double-click a company/person/agent node to expand deeper relationships.
- Address nodes are passive junctions: click them to inspect/highlight links already open in the graph; they do not expand.
- Drag nodes independently or drag empty graph space to pan the whole graph.
- Use ARRANGE and FIT ALL to reflow or frame the current graph.
- Export the complete graph as a full-resolution PNG.

## Address model

Entity load is address-aware:

`canonical identity → all stored address records → merged physical premise nodes → shared-premise neighbors`

All stored addresses across every member record of a canonical identity are retained. Address formatting variants such as `Street`/`St`, suite/unit/office forms, reversed street-number forms, and selected c/o layouts are normalized into shared physical premises while preserving the underlying source-specific address evidence.

A shared address or building is a correlation signal only. It does not by itself imply ownership, control, family relationship, or common beneficial ownership.

## Relationship expansion

The default expansion path prioritizes sourced financial/control evidence, including ownership, parent/subsidiary, member/manager, partner, finance, executive, and governance relationships. Agent/service and address links remain visible as corroborating evidence and graph bridges.

The relationship key is intentionally high-contrast:

- Money / ownership: bright green solid
- Control / governance: magenta dashed
- Finance: gold dotted
- Registered-agent / service: purple patterned
- Address / HQ / same address / same building: cyan dotted
- Other sourced relationship: neutral steel

## Lifecycle history

Historical records are preserved. Dissolved, inactive, terminated, forfeited, revoked, withdrawn, merged, cancelled, relinquished, delinquent, and similar lifecycle states remain attached as evidence instead of being filtered out.

Raw registry wording is retained where available; the graph should not silently convert one lifecycle label into another.

## State coverage

The explorer has routes for all 50 U.S. states plus D.C. State work is progressively moving toward true query-time machine sources. A state is only considered fully live when a current machine-readable source has been validated; cached/indexed records and portal links are not treated as equivalent to live registry access.

State refresh work is isolated from graph rendering so a slow or unavailable jurisdiction does not block node creation or interaction.

## Data architecture

The graph follows this provenance model:

`canonical identity → source-local records → evidence / relationships`

Source boundaries are preserved. Identifiers, addresses, filings, aliases, lifecycle states, and relationship evidence remain attributable to their source records.

## Data notes

Public-record coverage is uneven and source-dependent. A missing edge means the currently connected sources did not provide enough evidence to render that relationship; it does not prove that no relationship exists.

Shared surname, shared agent, shared address, or same-building evidence should be treated as a discovery signal rather than proof of ownership or personal relationship.

## Deployment

This repository is configured for GitHub Pages through GitHub Actions.

## Cost / dependencies

- No OpenCorporates paid API dependency
- No paid API required for the frontend itself
- Built to use public/open registry and corporate-data sources where permitted
