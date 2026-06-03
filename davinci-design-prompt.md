# Design Prompt — Maropost "Da Vinci AI" single-screen prototype

> **How to use:** Paste everything below the line into Claude (Claude Code, a Claude.ai artifact, or
> Cursor). Attach **`ai-entity.html`** alongside it as the orb engine to build on. Expected output:
> a single self-contained **`davinci.html`**.

---

**Build an AI-first single-screen prototype for Maropost's "Da Vinci AI" assistant.** One
self-contained `davinci.html` file (no build step) that a merchant can use to run their store by
**typing or speaking** commands like *"Run a campaign"* or *"Add a product."* The hero of the screen
is a **living AI entity** — a fluid orb that moves on its own and reacts when it listens and speaks.
I'm attaching `ai-entity.html` (a WebGL/Three.js particle-membrane orb); **reuse its orb engine as
the entity** and rebrand/restyle everything around it.

## 1. Concept
Da Vinci is an *AI-first* copilot: the entity **is** the interface, not a sidebar widget. The orb
sits center-stage, alive and breathing at rest. The user issues an intent (voice or text); the orb
*listens*, *thinks*, then *speaks* a concise reply while a Maropost-styled **action card** confirms
what it did. This is a believable visual prototype with a scripted intent router — no backend.

## 2. Keep / strip from `ai-entity.html`
- **KEEP:** the WebGL particle-membrane orb engine and its physics (idle eddies/breath, membrane wave
  sim, speaking-energy coupling, mic-driven reaction, pointer ripples). This fluid, physical,
  self-moving quality is the point — preserve it.
- **STRIP:** the HUD top bar + clock, the voice-picker `<select>`, the Speak/Listen button row, the
  hint line, and the "ARIA" name. Replace with the clean Da Vinci layout below.

## 3. The living entity — states & color
Drive the orb from a small state machine: **idle → listening → thinking → speaking** (→ back to
idle). Keep continuous organic motion in *all* states (never frozen).
- **idle:** slow fluid drift/breath; mostly warm-ink particles with a faint cyan shimmer.
- **listening:** orb ripples/expands in response to the live mic amplitude; cyan energy rises.
- **thinking:** tighter inward churn/turbulence; a brief "processing" feel.
- **speaking:** membrane pulses in sync with TTS syllable energy; brightest **electric-cyan
  (`#1ab7ea`)** glow.

Color treatment: particles in warm ink (`#1a1814`) over the warm-paper background; the **activity/
energy accent is Maropost cyan `#1ab7ea`**, intensifying with state. It should read as elegant ink on
warm paper that comes alive with cyan when the AI is active.

## 4. Brand system (hardcode as CSS variables; support light + dark)
- Fonts: **Inter** (UI) and JetBrains Mono (small state/eyebrow labels), via Google Fonts.
- **Light:** `--bg:#f7f3ec; --surface:#fdfbf7; --surface-subtle:#f1ece2; --text:#1a1814;
  --text-muted:#7a7466; --border:#e6dfd1; --primary:#1ab7ea; --primary-hover:#0d8cb8;
  --primary-soft:#d6eefb; --success:#1F7A4D; --warning:#B7791F; --error:#B33B2A;`
- **Dark:** `--bg:#0c1a2b; --surface:#12253d; --text:#edf7ff; --primary:#59c2ff;` (provide a toggle).
- Radii 4 / 12 / 14 / 28px + pill; soft shadows (`0 8px 32px -12px rgba(26,24,20,.08)`); flat bordered
  cards (1px `--border`, `border-radius:14px`, no heavy elevation). Icons: inline SVG in the
  **Lucide** style (e.g. sparkles, mic, send, package, users, bar-chart). Never hardcode raw colors
  outside the variable set.

## 5. Layout (single screen, responsive, centered)
- **Centered orb** as the focal element (≈ `min(70vw, 560px)`).
- A small **wordmark**: a sparkles glyph + "Da Vinci AI", with a `state` micro-label underneath
  (idle / listening / thinking / speaking) in mono caps.
- A **unified composer** (the only persistent control): a pill input — placeholder *"Ask Da Vinci, or
  say a command…"* — with an inline **mic button** (toggles voice) and a **send** button. Enter
  submits.
- **Suggestion chips** above/below the composer with real starter commands (see §7).
- A **lightweight response area**: Da Vinci's reply text + an **action card** (§7). Keep it minimal
  and AI-first — the orb stays the star; don't build a full chat app. Show at most the latest exchange
  (or a short, fading transcript). On first load show an empty/greeting state.

## 6. Voice & chat behavior (real)
- **Input STT:** use the Web Speech API `SpeechRecognition` (with `webkitSpeechRecognition` fallback).
  Mic button toggles listening; show the **interim transcript** live in the composer; on final result,
  submit it as a command. While listening, feed mic amplitude to the orb (reuse the existing
  AnalyserNode visualizer).
- **Output TTS:** use `speechSynthesis` to speak Da Vinci's reply; prefer a natural/neural English
  voice (rank `natural|neural|enhanced|premium`); couple the utterance to the orb's *speaking* state
  (start on `onstart`, end on `onend`). Provide a no-TTS visual fallback if speech is unavailable.
- **Graceful degradation:** if `SpeechRecognition` is unsupported (e.g. non-Chromium), hide/disable
  the mic with a tooltip ("Voice needs Chrome/Edge") — typing must always work.

## 7. Maropost intent router (scripted, keyword-based)
Implement a small `matchIntent(text)` that maps keywords to a response. Each intent returns (a) Da
Vinci's spoken + shown reply (concise, confident, warm — a product copilot, not a butler), and (b) a
**Maropost-styled action/insight card**. Ground these in the real product:

| Say / type | Da Vinci replies + card |
|---|---|
| "Run a campaign" / "create an email campaign" | "Drafting an email campaign for you." → **Action card**: campaign name input, audience (e.g. "All subscribers"), a **Smart Send** suggested time, buttons **Review** / **Launch**. |
| "Add a product" | "Let's add a product." → **Action card**: title, price, inventory fields (mock), **Save draft** / **Publish**. |
| "How did my last campaign do?" / "campaign performance" | "Here's your latest campaign." → **Insight card**: open rate, CTR, revenue, a tiny trend; **Open report**. |
| "Create a segment" | "Building a segment." → **Action card**: rule rows (e.g. *Purchased in last 30 days*), estimated size; **Save segment**. |
| "Show today's orders" / "sales summary" | "Today at a glance." → **Insight card**: orders, revenue, AOV. |
| (unmatched) | A helpful fallback offering 2–3 things it can do. |

Cards use surface bg, 1px border, radius 14, a Lucide icon, and a primary-cyan CTA. Wire **Review /
Launch / Save** to a small confirmation toast ("Campaign launched") — no real backend. After
replying, return the orb to *idle*.

Starter **suggestion chips:** `Run a campaign` · `Add a product` · `Campaign performance` ·
`Create a segment`.

*Context — these map to real Maropost areas: Marketing → Create Campaign / Email Campaigns /
Journeys; Products → Products List / Inventory; Contacts → Segments / All Contacts; Commerce → Sales
Orders / Coupons; Analytics → Campaign Reports / Sales Summary. "Smart Send" is Maropost's predictive
send-time feature.*

## 8. Technical constraints
- **One file**, opens directly in the browser. Three.js via the same `importmap` CDN pattern as
  `ai-entity.html`. Vanilla JS (no framework, no bundler). Keep it performant (cap DPR at 2; pause the
  render loop when the tab is hidden).
- Comment the intent router and the state machine so they're easy to extend with more commands.

## 9. Definition of done
1. Orb drifts fluidly and organically at idle (clearly "alive", never static).
2. Typing a command animates the orb (thinking → speaking), speaks a TTS reply, and renders the right
   on-brand action card.
3. Clicking the mic transcribes a spoken command (interim text visible) and triggers the same flow;
   the orb reacts to the live mic while listening.
4. All five §7 intents work, plus the fallback. Suggestion chips submit their command.
5. Visuals match the Maropost tokens (warm paper, cyan, Inter, soft bordered cards); light + dark
   toggle both look right; layout is responsive and centered.
