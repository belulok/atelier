# STATUS — isomux agent office

Last audit: 2026-11-21 (Step 0 of the feature prompt). Repo: `mistral-office-agent`.

## Audit table (feature → state at Step 0, 2026-11-21)

| Feature | State | Files |
|---|---|---|
| F1 Live office + team builder | **Partial** — live office + status bubbles existed; agent create/rename/delete from UI missing | `src/office/OfficeExperience.jsx`, `src/office/building.js`, `src/office3d/*`, `server/db.js`, `server/index.js` |
| F2 Raise Hand approvals | **Partial** — tool, red status, walk-to-host, card, exactly-once guard, audit existed; idempotency key + approved_by missing | `server/approvals.js`, `server/agents.js`, `src/App.jsx` |
| F3 Workflow inspector | **Missing** | — |
| F4 Hands-free voice | **Partial** — Voxtral TTS/STT wired for click-to-talk approvals | `server/index.js`, `server/mistral.js`, `src/App.jsx` |
| F5 Chat threads | **Missing** | — |
| F6 Floors as departments | **Partial** — 4 floors + lift existed | `src/office/building.js` |
| F7 Human avatar / colleagues / external agents | **Missing** | — |
| F8 Simulation sandbox (diff before approval) | **Missing** | — |
| F9 Conflict radar | **Missing** | — |
| F10 Janitor & Auditor | **Missing** | — |
| F11 Offline/sovereign mode | **Missing** | — |

## Phase 1 — DONE (all verified 2026-11-21, headless Chrome + API)

| Feature | State now | How to demo |
|---|---|---|
| F1 Team builder | **Done** — `POST/PATCH/DELETE /api/agents`; "＋ Hire agent" in Agent tools → Team tab (name, role, department, desk); new agent appears at a desk immediately (server `agents`+`agent_state`, `building.js` maps server agents) | Hire "Nina / Upsell & Extras / Operations / desk 5" → she appears in office + Team list; Rename/Delete work |
| F2 Raise Hand | **Done** — added `idempotency_key` (unique per action) + `approved_by`; audit shows who/when; double-resolve → 409, action runs once | Simulate overnight → approve a card → audit line `✅ approved by host at … executed once` |
| F3 Workflow inspector | **Done** — every LLM step + tool call recorded in `workflow_events`; person detail / thread msg "🔀 workflow" opens modal: Diagram (SVG nodes+edges, active node pulses) / Terminal (live log); node click → input/output/duration + "Ask about this step" (`POST /api/agents/:id/ask`, Mistral-grounded) | Run a task, open inspector, click a node, ask "what did this step do" |
| F4 Hands-free voice | **Done** (code-verified; mic needs a real browser) — "🎙️ Hands-free" toggle: continuous SpeechRecognition (or rolling MediaRecorder → Voxtral STT); "approve"/"deny" resolve top card; "Mila, …" → `POST /api/instruct` → agent replies and speaks via Voxtral TTS (`voice_reply` SSE → autoplay) | Toggle hands-free, say "approve" then "Mila, summarise the night" |
| F5 Chat threads | **Done** — `threads`/`thread_messages`/`thread_reads`; Threads tab; "Since you last opened" divider + Mistral one-line catch-up (`/api/threads/:id/summary`); `send_visual_card` renders checklist/table/timeline/chart; each agent msg links to F3 workflow | Open thread with Mila, ask for a checklist → card renders; reopen → divider + summary |

## Modes (added 2026-11-21)

- **Advanced mode** (default): everything above — 3D office, floating side panels, work queue, inspector.
- **Simple mode**: "💬 Simple" toggle in the topbar (persisted in localStorage). On **desktop** it opens as a
  rounded popup card over the office; on **mobile (≤680px)** it goes full-screen like a chat app.
  Chat-first list of all agent threads with head avatars, status dots, unread badges. Opening a thread with
  new agent activity since last read shows a **Quick Glance** card (`POST /api/threads/:id/glance`, cached per
  last-agent-message): last read, new count, run progress %, "What changed" timeline from workflow_events,
  Mistral-written "In short" bullets, "What's next?" chips, and a **View conversation** button for the full
  thread. 🎙️ mic in a thread = Voxtral voice conversation loop (STT → message → agent reply → TTS plays back).
  Verified: desktop popup + mobile screenshots, glance API, zero console errors.

## Phase 2 — NOT STARTED (waiting for next instruction per spec)

F6 floors-as-departments hardening, F7 avatar/colleagues/visitors, F8 sandbox diff,
F9 conflict radar, F10 Janitor/Auditor, F11 offline mode.

## Log

- 2026-11-21 Step 0: audit written; `AGENTS.md` Product section added.
- 2026-11-21 Phase 1: F1–F5 implemented + verified (API curl + headless-Chrome screenshots, zero console errors). Server restarted; vite HMR picked up client changes.
- 2026-11-21 Modes: Simple/Advanced toggle + Quick Glance + voice conversation added (see Modes section). Verified desktop popup (1440px) and mobile full-screen (390px) screenshots.


## Voice conversation (done 2026-11-21)
- **Voice screen like ChatGPT voice mode, with the agent's face** (Simple mode → open a chat → 🎙️ or tap the face).
  Hands-free turns: it detects when you start and stop talking, the agent answers out loud, and talking over the
  agent interrupts it. Each turn is saved in the chat thread. Files: `src/voice/engine.js`, `src/voice/VoiceMode.jsx`,
  `src/voice/wav.js`, `src/voice/voice.css`, `src/office/AgentHead.jsx` (optional `mouth`/`blink`).
- **Fixes:** STT upload now sends raw audio (it was multipart, so Voxtral got a corrupted file); recordings are 16 kHz
  WAV; Voxtral TTS sends `voice_id` (`VOXTRAL_VOICE`, default `gb_jane_neutral`), defaults to `voxtral-mini-tts-3-0`
  and reads the base64 `audio_data` response; new `POST /api/threads/:id/voice-turn` returns reply + audio together.
- **Without a Mistral key** it uses the browser's speech recognition and voice (no silent failure).
- **Verified:** build; endpoint tests; headless Chrome with a fake microphone (open, calibrate, detect speech, record
  WAV, upload, fall back to browser voice, close). **Not verified:** real Voxtral STT/TTS calls (no key in `.env`).


## Hire a subagent by asking (done 2026-11-21)
- In a chat or voice conversation, ask an agent to create a new agent or subagent ("Mila, create a subagent for
  upsells"). The agent calls `hire_agent`: a name, role, department and job instructions it writes; the new agent
  reports to the hiring agent (or another agent if asked), appears at a desk and in Simple mode
  ("reports to Mila"), and uses its manager and instructions in its own prompt. Logged in the audit.
- Hiring is offered only in conversations the host starts (chat, voice, instructions), never in automated runs
  such as Simulate overnight, so content like a guest message can't trigger it. Office capped at 16 agents.
- Fixes found on the way: built-in agents now get their own prompts (they matched the generic custom-agent
  prompt before); workflow step data is stored as valid JSON when long (cutting it mid-string made
  `GET /api/state` fail with 500 and broke live updates).
- Verified with the real Mistral key: Mila hired "Nina, Upsells & Extras" by voice; Nina then answered by voice
  with her manager and job. Shared code: `server/team.js` (API Hire button and the tool).

### Done: every agent on the floor has a chat (belulok)
- The 5 coworker agents in the office (Pip/Alex, Iris/Jules, Atlas/Omar, Scout/Finn, Nova/Ada) were
  decoration only, so the office showed agents walking around that you couldn't chat with. They are now real
  server agents (`server/colleagues.js`, added on start and after reset), each with an owner, a job and a desk.
- The office draws every agent from the server (`organisationMembers` in `src/office/building.js`), so
  anything you see on the floor is in Simple mode's chat list and can be chatted with by text or voice.
  The 7 sample *people* stay as decoration.
- New `agents.owner` column; a coworker's agent knows whose agent it is. Verified with the real key: Pip
  answers by voice as Alex's agent.

### Done: simple mode — click an agent in the 3D office to open the chat (belulok)
- The simple-mode popup no longer swallows the whole screen: the dim backdrop is `pointer-events: none`,
  so the office around the popup stays live. On wide desktop (>=1100px) the popup docks to the right;
  below that it is centered; <=680px it is full-screen (mobile unchanged).
- Clicking an agent (3D character or floating name tag) in simple mode opens that agent's chat in the
  popup (`onAgentChat` in `OfficeExperience`, `registerOpen` in `SimpleMode`); non-agent clicks do nothing.
  In advanced mode the people sidebar still opens as before. Exit simple mode via the "Advanced" button
  or the topbar toggle (now clickable again through the backdrop).
- Fixed a 500 on `GET /api/state`: old rows had JSON columns cut mid-string; all reads now parse safely
  (`safeJson`/`parse`) and 7 bad rows in `data/host.db` were repaired.

### Done: voice conversation stays in the chat box (belulok)
- Voice mode used to cover the whole screen; it now opens inside the Simple mode chat box, in place of the
  messages, under the box's own header (`embedded` prop on `src/voice/VoiceMode.jsx`, `.vm-embedded` in
  `src/voice/voice.css`, `src/SimpleMode.jsx`). Phone width: the box is full screen, so voice is too.
- Clicking empty office space (a click, not a drag) or pressing Esc closes the Simple mode popup; clicking an
  agent still opens its chat (`onEmptyClick` through `createOffice.js` → `OfficeCanvas` → `OfficeExperience` → `App`).
