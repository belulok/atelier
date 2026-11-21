# Atelier — AI back office for hosts

An AI back office for solo short-let/Airbnb hosts in London, shown as a **four-level
3D workspace** where the AI agents are your staff: **Mila** (Guest Concierge, replies in the
guest's language), **Theo** (Turnover Coordinator), **Priya** (Pricing & Calendar),
**Sam** (Reviews & Reputation). Each shows a live status bubble: working / thinking /
needs approval / idle.

## Stack

- **Front end**: Vite + React (JS) + Three.js. The 3D office is reused from
  `reference/office3d/` (kept pristine); the running copy in `src/office3d/` adds multiple floors, a lift, camera presets, people/agent characters and the
  `raisehand` approval behaviour. See `src/office3d/README.md`.
- **Server**: Node + Express (`server/`), data in local SQLite via built-in
  `node:sqlite` (`data/host.db`, reseeded on Reset).
- **AI**: Mistral only, server-side. `MISTRAL_API_KEY` and `MISTRAL_MODEL`
  ("Le Chonk" = `mistral-large-latest`) in `.env`; chat completions with function
  calling drive each agent loop (`server/agents.js`). Voice is Voxtral:
  TTS `POST /v1/audio/speech` (`VOXTRAL_TTS_MODEL`, default `voxtral-mini-tts-2603`),
  STT `POST /v1/audio/transcriptions` (`VOXTRAL_STT_MODEL`, default
  `voxtral-mini-transcribe-3`) — see docs.mistral.ai Audio. The key never reaches
  the browser. If the key is empty, a clearly-labeled **local demo stub** answers
  instead so the demo still runs; set the key for real Mistral AI.

## Run

```bash
npm install
# put your key in .env:  MISTRAL_API_KEY=...
npm run dev     # vite on :5173 (proxies /api) + express on :4100
```

Open http://localhost:5173

## Demo flow

1. Arrive in **The Commons**. Select **Start work** to go to Guest Experience.
   Use the floor rail or **Take the lift** to visit Operations and The Studio.
   **Building overview** shows all four levels; select a floor to enter it. The
   people directory shows coworkers, their agents, and your four workflow agents.
   Coworker presence is sample data, not a live organisation connection. Your
   work-session start and location persist across reloads.
2. Open **Agent tools** for the existing overnight simulation and voice controls.
   **Work queue** opens approvals, audit, inbox, jobs and flats.
3. **Simulate overnight** injects 4 events and runs all agents in parallel:
   - (a) German guest asks in German for 11:00 check-in at Flat 2 → ✋ approval
   - (b) Flat 1 guest reports broken heater, asks £40 refund → ✋ approval
   - (c) Flat 3 Saturday cleaner cancels → Theo reschedules **without** approval
   - (d) Flat 3 Saturday is empty → ✋ approval to drop the rate
4. **RAISE HAND**: when an agent calls `request_approval(type, summary, amount_gbp,
   payload)` its bubble turns red, it walks to your spot, and a card shows summary +
   amount + Approve/Deny. The action executes **only after approval, exactly once**
   (double-resolve returns 409). Every decision lands in the **Audit** tab.
   Refunds, discounts, price changes, early check-ins and guest messages all require
   approval — there is deliberately no direct "message guest" tool.
5. **Voice**: each approval request is spoken via Voxtral TTS (auto-plays; browser
   speechSynthesis as fallback). The 🎙️ button records you saying "approve"/"deny"
   → Voxtral STT → resolves the top pending card (browser SpeechRecognition fallback).
6. **Morning briefing**: ~30s spoken summary of the night (Mistral writes it,
   Voxtral speaks it), shown as a card with transcript.

## API (server, :4100)

`GET /api/state` · `GET /api/stream` (SSE) · `POST /api/simulate/overnight` ·
`POST /api/briefing` · `POST /api/approvals/:id/resolve {decision}` ·
`GET /api/approvals/:id/audio` · `POST /api/voice/stt` (raw audio body) ·
`POST /api/reset` · `GET /api/meta`

## Layout

```
reference/office3d/   pristine Three.js office (room, furniture, characters, poses, nav, desk screens)
src/office3d/         detailed floor scene, lightweight building overview, lift and avatars
src/                  React app: App.jsx, office/OfficeCanvas.jsx, api.js
server/               index.js (express+SSE), db.js (sqlite+seed), agents.js (Mistral tool loop),
                      approvals.js (raise hand, execute-once), simulate.js, mistral.js (chat+TTS+STT)
scripts/dev.mjs       runs server + vite together
data/                 host.db + generated audio (gitignored)
```

## Workspace checks

```sh
node --test src/office/building.test.js
npm run build
```

The workspace is a local simulation. Connecting actual organisation members,
authentication and shared presence requires a backend integration. Existing
Mistral-driven agent workflows remain available through Agent tools and Work queue.
