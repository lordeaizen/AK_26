// Stage 1: Signal Gate
// This file is intentionally independent from main.js so new stages can be
// added later without rewriting the Stage 1 logic.

const PRACTICE_TRIALS = [
  "go", "nogo", "go", "delayed", "go"
];

const EXPERIMENTAL = [
  ...Array(24).fill("go"),
  ...Array(12).fill("nogo"),
  ...Array(6).fill("delayed"),
];

const DISTRACTORS = ["△", "□", "×", "◆", "•", "+"];

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sd(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance =
    values.reduce((sum, x) => sum + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function round(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}

function setSignal(reactor, signal, ui = {}) {
  reactor.dataset.signal = signal;

  const names = {
    GREEN: "GREEN / CLICK",
    BLUE: "BLUE / HOLD",
    RED: "RED / WAIT",
    NEUTRAL: "STANDBY",
  };

  const colors = {
    GREEN: "#49f29a",
    BLUE: "#4b83ff",
    RED: "#ff5368",
    NEUTRAL: "#667085",
  };

  if (ui.signalName) ui.signalName.textContent = names[signal] || signal;
  if (ui.signalPip) {
    ui.signalPip.style.background = colors[signal] || colors.NEUTRAL;
    ui.signalPip.style.color = colors[signal] || colors.NEUTRAL;
  }
}

function showDistractor(container) {
  if (Math.random() > 0.28) return;

  const item = document.createElement("div");
  item.className = "distractor";
  item.textContent = DISTRACTORS[Math.floor(Math.random() * DISTRACTORS.length)];
  item.style.left = `${random(10, 90)}%`;
  item.style.top = `${random(10, 80)}%`;
  container.appendChild(item);

  setTimeout(() => item.remove(), random(250, 700));
}

async function waitForClickOrTimeout(reactor, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      reactor.removeEventListener("click", onClick);
      clearTimeout(timer);
      resolve(result);
    };

    const onClick = () => finish({ clicked: true, time: performance.now() });

    const timer = setTimeout(
      () => finish({ clicked: false, time: performance.now() }),
      timeoutMs
    );

    reactor.addEventListener("click", onClick);
  });
}

async function runTrial({ type, reactor, instruction, trialNumber, total, distractorContainer, ui }) {
  const result = {
    trialNumber,
    type,
    practice: trialNumber <= 5,
    reactionTime: null,
    outcome: null,
  };

  // Unpredictable inter-trial interval.
  setSignal(reactor, "NEUTRAL", ui);
  instruction.textContent = "WAIT FOR SIGNAL";
  await sleep(random(800, 2000));

  if (type === "go") {
    setSignal(reactor, "GREEN", ui);
    instruction.textContent = "CLICK";
    showDistractor(distractorContainer);

    const started = performance.now();
    const response = await waitForClickOrTimeout(reactor, 1200);

    if (response.clicked) {
      result.reactionTime = response.time - started;
      result.outcome = "correct";
    } else {
      result.outcome = "miss";
    }
  }

  if (type === "nogo") {
    setSignal(reactor, "BLUE", ui);
    instruction.textContent = "DO NOT CLICK";
    showDistractor(distractorContainer);

    const started = performance.now();
    const response = await waitForClickOrTimeout(reactor, 1200);

    if (response.clicked) {
      result.reactionTime = response.time - started;
      result.outcome = "commission_error";
    } else {
      result.outcome = "correct";
    }
  }

  if (type === "delayed") {
    setSignal(reactor, "RED", ui);
    instruction.textContent = "WAIT";

    // Premature response window.
    const premature = await waitForClickOrTimeout(reactor, random(800, 1800));

    if (premature.clicked) {
      result.reactionTime = 0;
      result.outcome = "premature";
      return result;
    }

    setSignal(reactor, "GREEN", ui);
    instruction.textContent = "CLICK";
    showDistractor(distractorContainer);

    const started = performance.now();
    const response = await waitForClickOrTimeout(reactor, 1200);

    if (response.clicked) {
      result.reactionTime = response.time - started;
      result.outcome = "correct";
    } else {
      result.outcome = "miss";
    }
  }

  return result;
}

function calculateResults(trials) {
  const experimental = trials.filter(t => !t.practice);

  const correctRTs = experimental
    .filter(t =>
      (t.type === "go" || t.type === "delayed") &&
      t.outcome === "correct" &&
      t.reactionTime != null
    )
    .map(t => t.reactionTime);

  const earlyRTs = experimental
    .slice(0, 10)
    .filter(t => t.outcome === "correct" && t.reactionTime != null)
    .map(t => t.reactionTime);

  const lateRTs = experimental
    .slice(-10)
    .filter(t => t.outcome === "correct" && t.reactionTime != null)
    .map(t => t.reactionTime);

  const result = {
    stage: "signal_gate",
    trials,
    correctReactionTimes: correctRTs.map(round),
    meanReactionTime: round(mean(correctRTs)),
    reactionTimeSD: round(sd(correctRTs)),
    prematureClicks: experimental.filter(t => t.outcome === "premature").length,
    noGoErrors: experimental.filter(t => t.outcome === "commission_error").length,
    missedSignals: experimental.filter(t => t.outcome === "miss").length,
    improvementEarlyMinusLate:
      earlyRTs.length && lateRTs.length
        ? round(mean(earlyRTs) - mean(lateRTs))
        : null,
    completedAt: new Date().toISOString(),
  };

  // Temporary browser storage. Later you can replace this with your database/API.
  localStorage.setItem("signalGate_stage1", JSON.stringify(result));

  return result;
}

export async function runSignalGate(ui) {
  const trials = [
    ...PRACTICE_TRIALS,
    ...shuffle(EXPERIMENTAL),
  ];

  const results = [];

  for (let i = 0; i < trials.length; i++) {
    const current = i + 1;
    ui.trialLabel.textContent = `TRIAL ${String(current).padStart(2, "0")} / ${trials.length}`;
    ui.statusLabel.textContent = i < 5 ? "PRACTICE" : "RECORDED";
    if (ui.progressBar) {
      ui.progressBar.style.width = `${(current / trials.length) * 100}%`;
    }

    const trialResult = await runTrial({
      type: trials[i],
      reactor: ui.reactor,
      instruction: ui.instruction,
      trialNumber: current,
      total: trials.length,
      distractorContainer: ui.distractorContainer,
      ui,
    });

    results.push(trialResult);
    await sleep(250);
  }

  setSignal(ui.reactor, "NEUTRAL", ui);
  ui.instruction.textContent = "STAGE COMPLETE";
  if (ui.statusLabel) ui.statusLabel.textContent = "COMPLETE";

  return calculateResults(results);
}
