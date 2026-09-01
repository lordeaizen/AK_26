/* Session orchestration: setup -> consent -> calibration -> baseline ->
 * practice -> modules (counterbalanced) -> washout gates -> mood repair ->
 * debrief -> end. Mirrors §4 of the protocol.
 */

window.Sky = window.Sky || {}
Sky.narration = true

var SESSION = null
var ASSIGNMENT = null
var BASELINE_ANGER = null
var ABORTED = false

/* ------------------------- setup screen ------------------------- */
function setupScreen() {
	var ui = Sky.ui
	return new Promise(function (resolve) {
		var form = ui.el("div", { class: "form" })
		function field(labelText, node) {
			return ui.el("label", { class: "field" }, [ui.el("span", { text: labelText }), node])
		}
		var pid = ui.el("input", { class: "input", placeholder: "e.g. SKY-013", value: "" })
		var age = ui.el("select", { class: "input" })
		;["8-10", "11-13", "14-16", "adult-pilot"].forEach(function (a) {
			age.appendChild(ui.el("option", { value: a, text: a }))
		})
		var prof = ui.el("select", { class: "input" })
		Object.keys(Sky.PROFILES).forEach(function (k) {
			prof.appendChild(ui.el("option", { value: k, text: Sky.PROFILES[k].label }))
		})
		var op = ui.el("input", { class: "input", placeholder: "researcher initials" })
		var m7 = ui.el("input", { type: "checkbox" })
		var narr = ui.el("input", { type: "checkbox" })
		narr.checked = false

		form.appendChild(field("Participant code (pseudonymous)", pid))
		form.appendChild(field("Age band", age))
		form.appendChild(field("Run profile", prof))
		form.appendChild(field("Operator", op))
		form.appendChild(ui.el("label", { class: "check" }, [m7, ui.el("span", { text: "Enable optional Module M7 (requires ethics approval)" })]))
		form.appendChild(ui.el("label", { class: "check" }, [narr, ui.el("span", { text: "Read stories aloud (browser voice)" })]))

		var err = ui.el("p", { class: "error" })
		form.appendChild(err)

		var go = ui.el("button", { class: "btn primary", text: "Begin session" })
		go.addEventListener("click", function () {
			if (!pid.value.trim()) {
				err.textContent = "A participant code is required."
				return
			}
			Sky.narration = narr.checked
			resolve({
				participantId: pid.value.trim(),
				ageBand: age.value,
				profile: prof.value,
				operator: op.value.trim() || "unspecified",
				m7Consented: m7.checked,
			})
		})

		ui.show(
			ui.el("div", { class: "card wide" }, [
				ui.el("div", { class: "eyebrow", text: "Skyhaven \u2014 research build v1.0" }),
				ui.el("h1", { text: "Session setup" }),
				ui.el("div", {
					class: "notice",
					html:
						"<b>Research instrument, not a diagnostic tool.</b> Stimuli are schematic placeholders, " +
						"no normative data exist, and individual-level scoring is disabled in software. " +
						"Use with children only under an approved ethics protocol.",
				}),
				form,
				ui.el("div", { class: "btn-row" }, [go, ui.el("a", { class: "btn ghost", href: "/dashboard.html", text: "Researcher dashboard" })]),
			]),
		)
	})
}

/* ------------------------- consent / assent ------------------------- */
async function consentFlow() {
	var ui = Sky.ui
	var guardian = await ui.prompt({
		eyebrow: "For the adult present",
		title: "Guardian consent",
		bodyHtml:
			"<ul><li>This session records reaction times, choices and short written answers. No audio, no video, no photographs.</li>" +
			"<li>Data are stored against a participant code only.</li>" +
			"<li>Some puzzles are made hard on purpose so we can see how children handle frustration. This is explained to the child at the end.</li>" +
			"<li>You or the child can stop at any moment with no consequence.</li></ul>",
		buttons: [
			{ label: "Consent given", value: "yes" },
			{ label: "Do not proceed", value: "no", kind: "ghost" },
		],
	})
	Sky.T.event("consent_recorded", { type: "guardian", value: guardian })
	if (guardian !== "yes") return false

	var assent = await ui.prompt({
		eyebrow: "For the player",
		title: "Would you like to play Skyhaven?",
		bodyHtml:
			"<p>You will fly through gates, catch sparks, open rune gates and hear some short stories.</p>" +
			"<p>Some parts are tricky on purpose. There are no right or wrong answers in the stories.</p>" +
			"<p>You can stop whenever you want by pressing the <b>I want to stop</b> button at the bottom. Nobody will mind.</p>",
		buttons: [
			{ label: "Yes, let's play", value: "yes" },
			{ label: "Not today", value: "no", kind: "ghost" },
		],
	})
	Sky.T.event("consent_recorded", { type: "child_assent", value: assent })
	return assent === "yes"
}

/* ------------------------- calibration (§6.5) ------------------------- */
async function calibrate() {
	var ui = Sky.ui
	ui.show(ui.card({ eyebrow: "Getting ready", title: "Checking this device\u2026", bodyHtml: "<p>Please do not touch the screen for a moment.</p>" }))
	await Sky.sleep(2200)

	var lags = []
	for (var i = 0; i < 3; i++) {
		ui.show(ui.el("div", { class: "calib-dot" }))
		await Sky.sleep(400)
		var t0 = performance.now()
		var r = await Sky.awaitResponse(4000, { t0: t0 })
		if (r.responded) lags.push(r.rt_ms)
		await Sky.sleep(200)
	}

	var result = {
		refresh_hz: Sky.quality.refresh_hz,
		frame_jitter_ms: Sky.quality.frame_jitter_ms,
		input_lag_ms: Sky.quality.input_lag_ms == null ? null : Math.round(Sky.quality.input_lag_ms * 10) / 10,
		tap_rts: lags,
		user_agent: navigator.userAgent,
		screen: window.innerWidth + "x" + window.innerHeight,
		dpr: window.devicePixelRatio,
	}
	Sky.T.event("calibration_result", result)
	return result
}

/* ------------------------- washout gate (§4.3) ------------------------- */
async function washout(label) {
	var ui = Sky.ui
	var attempts = 0
	var CAP = 3 * 60 * 1000
	var started = performance.now()

	while (attempts < 3) {
		attempts++
		var seconds = Math.round(Sky.cfg.washoutMs / 1000)
		var ring = ui.el("div", { class: "breath" })
		var count = ui.el("p", { class: "muted", text: seconds + "s" })
		ui.show(ui.el("div", { class: "card" }, [ui.el("div", { class: "eyebrow", text: "Rest stop" }), ui.el("h2", { text: "Float for a moment" }), ring, ui.el("p", { text: "Breathe in as the circle grows, out as it shrinks." }), count]))
		Sky.T.event("washout_start", { label: label, attempt: attempts })

		var remaining = seconds
		while (remaining > 0) {
			await Sky.sleep(1000)
			remaining--
			count.textContent = remaining + "s"
		}

		var now = await Sky.rate({ scale: "anger", point: "washout_" + label + "_" + attempts, question: "How annoyed do you feel right now?" })
		Sky.T.event("washout_end", { label: label, attempt: attempts, anger: now, baseline: BASELINE_ANGER })

		if (BASELINE_ANGER == null || now <= BASELINE_ANGER + 1) return true
		if (performance.now() - started > CAP) {
			Sky.T.event("washout_capped", { label: label, anger: now })
			return false
		}
	}
	return false
}

/* ------------------------- mood repair + debrief (§9.5) ------------------------- */
async function moodRepair() {
	var ui = Sky.ui
	await ui.prompt({ eyebrow: "Bonus round", title: "One easy round to finish", bodyHtml: "<p>Catch five stars. These ones are slow on purpose.</p>", buttons: [{ label: "Go", value: "ok" }] })
	for (var i = 0; i < 5; i++) {
		await new Promise(function (resolve) {
			var field = ui.el("div", { class: "field" })
			var star = ui.el("div", { class: "mover target easy", style: "top:" + (80 + i * 40) + "px;left:80px" })
			star.innerHTML = "\u2605"
			star.addEventListener("pointerdown", function () {
				star.classList.add("good")
				setTimeout(resolve, 200)
			})
			field.appendChild(star)
			ui.show(field)
		})
	}
	await ui.prompt({ title: "All five \u2014 nice work!", bodyHtml: "<p>You caught every star.</p>", buttons: [{ label: "Next", value: "ok" }] })
}

async function debrief() {
	var ui = Sky.ui
	await ui.prompt({
		eyebrow: "Finished",
		title: "Thank you for flying Skyhaven",
		bodyHtml:
			"<p>There is something important I want to tell you.</p>" +
			"<p><b>Some of those rune gates could not be opened at all.</b> One of the runes was missing, so no matter how well you played, that gate could not open. " +
			"That was not your fault and it says nothing about how good you are at puzzles.</p>" +
			"<p>The other flyer, Vex, was part of the story too \u2014 not a real player.</p>" +
			"<p>The stories had no right or wrong answers. I just wanted to know what you think.</p>",
		buttons: [{ label: "Okay, I understand", value: "ok" }],
	})
	var feel = await Sky.rate({ scale: "anger", point: "debrief", question: "How do you feel now, at the end?" })
	await ui.prompt({
		title: "See you in the clouds",
		bodyHtml: "<p>If anything felt uncomfortable, please tell the adult with you. Thank you for helping with this research.</p>",
		buttons: [{ label: "Finish", value: "ok" }],
	})
	Sky.T.event("debrief_completed", { final_anger: feel, baseline: BASELINE_ANGER })
}

/* ------------------------- stop rule (§9.4) ------------------------- */
function wireStopButton() {
	var btn = document.getElementById("stop-btn")
	btn.addEventListener("click", async function () {
		if (!SESSION || ABORTED) return
		var sure = await Sky.ui.prompt({
			title: "Would you like to stop?",
			bodyHtml: "<p>That is completely fine. Nobody will mind.</p>",
			buttons: [
				{ label: "Yes, stop now", value: "yes" },
				{ label: "No, keep playing", value: "no", kind: "ghost" },
			],
		})
		if (sure !== "yes") return
		ABORTED = true
		Sky.T.event("distress_flag", { source: "child_stop_button" })
		await Sky.T.flush()
		await debrief()
		await endSession({ completed: false, stoppedEarly: true, distress: true })
		Sky.ui.show(Sky.ui.card({ title: "Session ended", bodyHtml: "<p>Thank you. You can close this window.</p>" }))
	})
}

async function endSession(state) {
	await Sky.T.flush()
	try {
		await fetch("/api/session/end", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(Object.assign({ sessionId: SESSION.sessionId }, state)),
		})
	} catch (e) {}
}

/* ------------------------- main ------------------------- */
async function main() {
	wireStopButton()
	var setup = await setupScreen()
	Sky.cfg = Sky.PROFILES[setup.profile]

	var res = await fetch("/api/session/start", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(setup),
	})
	SESSION = await res.json()
	ASSIGNMENT = SESSION.assignment
	Sky.rng.seed(ASSIGNMENT.seed)
	Sky.T.start(SESSION)
	Sky.T.event("session_start", {
		profile: setup.profile,
		age_band: setup.ageBand,
		assignment: ASSIGNMENT,
		stimulus_set: "schematic_placeholder_v1",
	})
	document.getElementById("session-tag").textContent = SESSION.participantId + " \u00b7 " + SESSION.sessionId

	var ok = await consentFlow()
	if (!ok) {
		await endSession({ completed: false, stoppedEarly: true })
		Sky.ui.show(Sky.ui.card({ title: "Session not started", bodyHtml: "<p>No task data were collected.</p>" }))
		return
	}

	await calibrate()

	var ctx = { session: SESSION, assignment: ASSIGNMENT }

	// baseline affect BEFORE anything frustrating (protocol correction C4)
	Sky.T.setContext({ module: "baseline", block: null, trial_index: 0 })
	BASELINE_ANGER = await Sky.rate({ scale: "anger", point: "baseline", question: "How annoyed do you feel right now?" })
	await Sky.rate({ scale: "arousal", point: "baseline", question: "How worked up does your body feel?", labels: ["Very calm", "Calm", "In between", "Buzzy", "Very buzzy"] })

	// M1 always runs first and always after mastery practice
	await Sky.tasks.M1.practice()

	var order = ASSIGNMENT.moduleOrder
	var arousing = { M3: 1, M5: 1 }

	for (var i = 0; i < order.length; i++) {
		if (ABORTED) return
		var id = order[i]
		var task = Sky.tasks[id]
		if (!task) continue
		Sky.T.event("module_start", { module: id, position: i }, { module: id })
		await task.run(ctx)
		Sky.T.event("module_end", { module: id }, { module: id })
		await Sky.T.flush()
		if (arousing[id] && i < order.length - 1) await washout(id)
	}

	if (ABORTED) return
	await Sky.tasks.M7.run(ctx)
	await washout("final")
	await moodRepair()
	await debrief()
	await endSession({ completed: true })

	Sky.ui.hud("Skyhaven", "Session complete")
	Sky.ui.show(
		Sky.ui.card({
			title: "Session complete",
			bodyHtml: "<p>All data have been written to <code>data/events/" + SESSION.sessionId + ".jsonl</code>.</p>",
			buttons: [{ label: "Open researcher dashboard", onClick: function () { window.location.href = "/dashboard.html" } }],
		}),
	)
}

window.addEventListener("error", function (e) {
	if (Sky.T && Sky.T.sessionId) Sky.T.event("client_error", { message: String(e.message), source: e.filename + ":" + e.lineno })
})

main()
