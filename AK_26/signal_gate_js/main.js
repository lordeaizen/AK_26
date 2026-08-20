import { runSignalGate } from "./stages/stage1_signal_gate.js";

const screens = {
  start: document.querySelector("#start-screen"),
  game: document.querySelector("#game-screen"),
  results: document.querySelector("#results-screen"),
};

const startButton = document.querySelector("#start-btn");
const restartButton = document.querySelector("#restart-btn");

function showScreen(name) {
  Object.values(screens).forEach(screen => screen.classList.remove("active"));
  screens[name].classList.add("active");
}

function renderResults(data) {
  const box = document.querySelector("#results");

  const fmt = value =>
    value === null || value === undefined ? "—" : value;

  box.innerHTML = `
    <div class="metric">
      <span>Mean reaction time</span>
      <strong>${fmt(data.meanReactionTime)} <small>ms</small></strong>
    </div>
    <div class="metric">
      <span>Reaction-time SD</span>
      <strong>${fmt(data.reactionTimeSD)} <small>ms</small></strong>
    </div>
    <div class="metric">
      <span>Premature clicks</span>
      <strong>${data.prematureClicks}</strong>
    </div>
    <div class="metric">
      <span>No-Go errors</span>
      <strong>${data.noGoErrors}</strong>
    </div>
    <div class="metric">
      <span>Missed signals</span>
      <strong>${data.missedSignals}</strong>
    </div>
    <div class="metric">
      <span>Early → late RT change</span>
      <strong>${fmt(data.improvementEarlyMinusLate)} <small>ms</small></strong>
    </div>
    <p class="small">
      Raw trial data is stored in this browser session and can later be exported
      to JSON/CSV or connected to your database.
    </p>
  `;
}

async function startGame() {
  showScreen("game");

  const result = await runSignalGate({
    reactor: document.querySelector("#reactor"),
    instruction: document.querySelector("#instruction"),
    trialLabel: document.querySelector("#trial-label"),
    statusLabel: document.querySelector("#status-label"),
    signalName: document.querySelector("#signal-name"),
    signalPip: document.querySelector("#signal-pip"),
    progressBar: document.querySelector("#progress-bar"),
    distractorContainer: document.querySelector("#distractor-container"),
  });

  renderResults(result);
  showScreen("results");
}

startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);
