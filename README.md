# JARVIS ECOM

An autonomous research and build system for e-commerce: you give it an objective in
plain language, it researches the market, validates candidates against evidence,
sources suppliers, computes unit economics, and shows you the whole thing happening
in a command center you can watch.

Its governing rule is that it never invents anything. A figure it could not retrieve
is marked `UNKNOWN` rather than estimated, every claim carries its source URL and
retrieval time, and a margin that excludes a cost it could not read says so in
words. Where an integration is not connected, the adapter reports `NOT_CONNECTED`
instead of pretending to work.

## Running it

Requires **Node 22 or newer** (it runs TypeScript directly, with no build step for
the server).

```bash
npm install
npm start
```

Then open <http://localhost:7801>. The interface boots, comes up at rest, and opens
the command center as soon as you give it something to do. Type, for example:

```
Jarvis, find me 3 products in the home office niche with strong current and future potential.
```

Other commands it understands, in English or Dutch: `status?`, `why?`, `stop`,
`pause`, `continue`, `show me product two`, `find a different niche`.

To run a mission from the command line instead, with a research budget and a
candidate pool size:

```bash
npm run mission -- "Jarvis, find me 2 products in the home office niche." 24 2
```

## Checking what your machine can actually do

```bash
npm run probe
```

This reports, honestly, what is reachable from where you are running it: whether the
open web is reachable, whether Chromium is installed and controllable, and which
integrations have credentials. Nothing is assumed.

## Research when the network is restricted

JARVIS prefers direct HTTP, then a real browser (Playwright), then the Claude
bridge. The bridge exists for environments whose network policy blocks public sites:
agents write their research requests to `jarvis/bridge/requests/`, an attached Claude
session performs the real search or page read and posts the findings back to
`POST /api/bridge/answer` with source URLs and timestamps. A request nobody answers
expires and becomes `UNKNOWN` evidence. It is never filled in with a guess.

```bash
npm run bridge     # list the requests waiting for an answer
```

## Permissions and spending

The system starts at `PERMISSION_LEVEL=0`, research only, and will not raise itself.
Levels run 0 (research) to 6 (financial transactions), and every level above 0 has to
be granted explicitly from the interface. Nothing in the system can purchase, place
an order, buy a domain or spend advertising money; those capabilities refuse until a
human authorizes them, and the refusal says exactly what is missing.

Credentials live in `.env` (copy `.env.example`). They are never sent to the browser,
and any event payload whose key looks like a secret is redacted before it can reach
the interface.

## Voice

Speech uses the browser's Web Speech API where it is available. Two things commonly
stop it, and the interface now names whichever one applies rather than doing nothing:
the page has no microphone permission, or the browser's speech service cannot be
reached from your network. Typing is always the full control surface; nothing is
limited without the microphone.

## Layout

```
apps/command-center   HTTP server, event stream and the interface
apps/browser-agent    Playwright control with per-action telemetry
core/                 types, evidence, state, events, permissions,
                      research routing, scoring, orchestration, telemetry
agents/               research, market, trend, customer, competitor,
                      supplier, economics, screening, brand, shopify, ads
scripts/              probe, mission, bridge, recompute, web build
tests/                95 tests over the rules that must not drift
```

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The test run writes to temporary directories, never to the event log or research
queue an operator is reading.
