# Skyhaven — research build (v1.0)

A runnable implementation of the **Skyhaven** gamified behavioural battery described in
`Skyhaven_Protocol_v1.0.pdf`: seven modules (M1–M7), an append-only event log, an offline
scoring pipeline, quality-control flags and CSV exports.

**This is a research instrument, not a diagnostic test.** It has no norms, uses placeholder
schematic faces instead of a validated stimulus set, and its dimension-level scoring (D1–D6)
is deliberately switched off. Do not run it with real participants without ethics approval.

---

## Run it

You need **Node.js 18 or newer**. There are no dependencies to install.

```bash
npm start
```

Then open:

| What | Where |
| --- | --- |
| The game | http://localhost:3000/ |
| Researcher dashboard | http://localhost:3000/dashboard.html |

In VS Code you can also press **F5** and pick *Run Skyhaven server*.

Fill in a participant code, choose **Demo (~8 min)** or **Full protocol (~38 min)**, and play.

### Test it without playing

```bash
npm start          # terminal 1
npm run simulate   # terminal 2 — posts one synthetic full session
npm run score      # prints every metric and writes data/exports/*.csv
```

---

## What is in the box

```
server.js                  zero-dependency HTTP server + JSON API
lib/store.js               append-only JSONL event log + session register
lib/counterbalance.js      deterministic per-participant order assignment
lib/scoring.js             trial reconstruction, 60+ metrics, QC, codebook, CSV
public/index.html          the game shell
public/js/core.js          timing, event tracker, UI kit, rating scales
public/js/vignettes.js     12 stories × 3 intent versions + comprehension checks
public/js/tasks-cognitive.js   M1 Beacon Watch, M2 Wind Run
public/js/tasks-frustration.js M3 Rune Gates, M4 Shifting Bridge
public/js/tasks-social.js  M5 Sky Market, M6 Story Deck, M7 Second Chance
public/js/app.js           session runner: consent → calibration → modules → debrief
public/dashboard.html      per-session scores, QC panel, downloads
scripts/simulate.js        synthetic participant generator
scripts/score.js           offline scorer / CSV exporter
```

---

## The seven modules

| ID | In-game name | Measures | Key outputs |
| --- | --- | --- | --- |
| M1 | Beacon Watch | response inhibition under neutral / happy / angry faces | `m1_commission`, `m1_dprime`, `m1_ssrt`, `m1_emo_cost`, `m1_pes` |
| M2 | Wind Run | performance under speed pressure | `m2_lisas`, `m2_decay`, `m2_strategy` |
| M3 | Rune Gates | frustration tolerance (some gates cannot be solved) | `m3_ttq`, `m3_quit_rate`, `m3_anger_delta`, `m3_input_force` |
| M4 | Shifting Bridge | cognitive flexibility after silent rule changes | `m4_persev`, `m4_switch_cost`, `m4_recovery` |
| M5 | Sky Market | response to repeated provocation by a rival | `m5_severity`, `m5_escalation`, `m5_repertoire` |
| M6 | Story Deck | hostile attribution bias + social problem solving | `m6_hab`, `m6_severity`, `m6_expectancy`, `m6_sdr` |
| M7 | Second Chance | retaliation + consequence reflection — **opt-in only** | `m7_repeat`, `m7_selfeval`, `m7_shift` |

M6 shows each child a mix of **ambiguous**, clearly **hostile** and clearly **benign** versions of
the same stories. Only the ambiguous ones score hostile attribution bias; the other two are
validity checks. If a child reads the *benign* stories as hostile too, the HAB score is marked
invalid rather than reported.

---

## How data is collected

Everything is an **event**, appended to `data/events/<sessionId>.jsonl` and never rewritten:

```json
{
  "event_id": "…",
  "session_id": "ses_…",
  "participant_id": "SKY-014",
  "module": "M1",
  "block": "angry",
  "trial_index": 37,
  "event_type": "trial_end",
  "t_client_mono": 184392.4,
  "t_client_wall": "2026-08-31T17:12:03.221Z",
  "t_server_recv": "2026-08-31T17:12:03.402Z",
  "payload": { "outcome": "commission", "rt_ms": 388, "is_nogo": true },
  "quality": { "frame_jitter_ms": 3.1, "input_lag_ms": 22, "window_focused": true },
  "schema_version": "1.0.0"
}
```

- Timing uses a **monotonic clock** (`performance.now()`), so wall-clock drift cannot corrupt RTs.
- Events are **batched and de-duplicated by `event_id`**, so a dropped connection cannot lose or
  double-count trials. Unsent events survive a refresh in `localStorage`.
- A short **device calibration** (frame jitter + three taps) is stored with every session, and
  its input lag is subtracted from nothing — it is *reported* so slow devices can be excluded
  rather than silently corrected.
- Response options are always **shuffled and their shown position logged**, so position bias is
  detectable.
- Nothing identifying is collected: only the pseudonymous code the operator types in.

The register of sessions lives in `data/sessions.json`. Delete the `data/` folder to reset.

---

## Scoring and quality control

Raw events are reconstructed into trials, then into metrics (see `lib/scoring.js` and the live
codebook at `/api/codebook`, which documents every metric's formula, direction and main confound).

Trials are excluded for `rt_anticipatory` (< 150 ms), `rt_outlier` (> 3 SD within block) and
`timing_invalid`. Sessions get flags such as `unreliable_session`, `disengaged`,
`indiscriminate_response`, `ssrt_invalid`, `staircase_not_converged` and `debrief_missing`.

**Expected on simulated data:** the simulator's reaction times are independent random draws, so
split-half reliability is near zero and every simulated session is flagged `unreliable_session`.
That is correct behaviour — real human RTs autocorrelate. It is not a bug.

### API

| Route | Purpose |
| --- | --- |
| `POST /api/session/start` | create a session, get counterbalancing assignment |
| `POST /api/events` | batch upload (idempotent) |
| `POST /api/session/end` | mark completed / stopped early / distress |
| `GET /api/sessions` | session register |
| `GET /api/score/:sessionId` | full scored result + QC |
| `GET /api/cohort` | distribution summary across stored sessions |
| `GET /api/codebook` | metric definitions |
| `GET /api/export/features.csv` | one row per session |
| `GET /api/export/trials.csv?session=` | one row per trial |
| `GET /api/export/events.jsonl?session=` | raw log |

---

## Ethics safeguards built into the code

- **Assent screen** in the child's own words, on top of guardian consent.
- **Stop button** always visible; stopping still runs mood repair and debrief.
- Frustration phases are **capped at 6 minutes**, washouts at 3 minutes.
- **Washout gate**: the session will not move on until self-reported anger returns to within one
  point of baseline (or the cap is hit, which is flagged).
- **Mandatory debrief** telling the child the gates were unwinnable and Vex was not real.
- M7 requires consent at setup *and* re-assent at the moment it runs, and its outcome is
  deliberately neutral so the game never teaches that aggression pays.

---

## Before using this with real children

1. Replace the schematic SVG faces in `core.js` with a licensed validated set (NIMH-ChEFS, CAFE
   or Radboud Faces).
2. Collect norms. Until then `dimensions` is `null` and only raw metrics are reported.
3. `m6_sdr` (self-report vs. behaviour discrepancy) uses a **keyword placeholder** — the open
   responses need human coding.
4. Validate against RPQ / SDQ and teacher ratings (hypotheses H1–H5 in the protocol).

---

## Customising

- Trial counts and timings: `Sky.PROFILES` and `Sky.PARAMS` in `public/js/core.js`.
- Stories and response options: `public/js/vignettes.js`.
- Provocation events: `M5_EVENTS` in `public/js/tasks-social.js`.
- Port: `PORT=4000 npm start`.
