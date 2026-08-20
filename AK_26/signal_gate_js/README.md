# Signal Gate — VS Code JavaScript Version

This is a dependency-free browser implementation of Stage 1.

## Run it

1. Open this folder in VS Code.
2. Open `index.html`.
3. Recommended: install the VS Code extension **Live Server**.
4. Right-click `index.html` → **Open with Live Server**.

The game runs in your browser.

## Why this structure?

Each stage is separated into a JS module:

```text
stages/
├── stage1_signal_gate.js
├── stage2_social_scenario.js
└── stage3_emotional_choice.js
```

`main.js` acts as the controller.

## Add Stage 2

Create:

```text
stages/stage2_social_scenario.js
```

Example:

```js
export async function runStage2() {
  // Stage 2 code
  return {
    stage: "social_scenario",
    score: 0
  };
}
```

Then import it in `main.js`:

```js
import { runStage2 } from "./stages/stage2_social_scenario.js";
```

And run:

```js
const stage2 = await runStage2();
```

For the full game, you can make:

```text
main.js
   ↓
Stage 1
   ↓
Stage 2
   ↓
Stage 3
   ↓
Final questionnaire
   ↓
Data export/database
```

## Stage 1 design

Practice:
- 5 trials

Experimental:
- 24 Go
- 12 No-Go
- 6 delayed-response

Total experimental trials:
42

The browser records:
- correct reaction time
- premature responses
- No-Go commission errors
- missed signals
- reaction-time variability
- early-vs-late change
- raw trial-by-trial outcomes

## Important

This is an experimental game implementation, not a validated psychological instrument. The variables should not be treated as clinical or diagnostic measures without appropriate validation.
