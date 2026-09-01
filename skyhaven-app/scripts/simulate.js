#!/usr/bin/env node
/**
 * Generates one synthetic full-protocol session and posts it to the running
 * server, then prints the scored result. Use this to exercise the pipeline
 * without playing through the whole battery.
 *
 *   npm start          (in one terminal)
 *   npm run simulate   (in another)
 *
 * The synthetic child is impulsive with angry faces, gives up on rigged gates,
 * perseverates for two trials after each rule change, escalates mildly with
 * Vex, and reads ambiguous stories as hostile about two thirds of the time.
 */

const BASE = process.env.BASE || "http://localhost:3000"

let mono = 0
let counter = 0
const events = []

function ev(type, o) {
	o = o || {}
	mono += 900 + Math.random() * 400
	events.push({
		event_id: "sim-" + Date.now().toString(36) + "-" + counter++,
		module: o.module || "session",
		block: o.block === undefined ? null : o.block,
		trial_index: o.trial_index === undefined ? null : o.trial_index,
		event_type: type,
		t_client_mono: Math.round(mono * 100) / 100,
		t_client_wall: new Date().toISOString(),
		payload: o.payload || {},
		quality: { frame_jitter_ms: 3.1, input_lag_ms: 22, window_focused: true },
		schema_version: "1.0.0",
	})
}

function gauss(m, s) {
	const u = Math.max(1e-9, Math.random())
	const v = Math.random()
	return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function pick(list) {
	return list[Math.floor(Math.random() * list.length)]
}

function build() {
	ev("session_start", { payload: { profile: "full", simulated: true } })
	ev("consent_recorded", { payload: { type: "guardian_confirmed", granted: true } })
	ev("consent_recorded", { payload: { type: "child_assent", granted: true } })
	ev("calibration_result", { payload: { mean_frame_ms: 16.7, frame_jitter_ms: 3.1, tap_rts: [268, 244, 259], input_lag_ms: 44 } })
	ev("rating_given", { payload: { scale: "anger", point: "baseline", value: 2, decision_ms: 1800 } })

	/* ---------------- M1 ---------------- */
	ev("module_start", { module: "M1" })
	const commissionRate = { neutral: 0.18, happy: 0.2, angry: 0.34 }
	for (const block of ["neutral", "happy", "angry"]) {
		let ssd = 250
		for (let i = 0; i < 160; i++) {
			const isNogo = i % 4 === 3
			const isStop = !isNogo && i % 8 === 2
			ev("trial_start", { module: "M1", block: block, trial_index: i, payload: { stim_id: block, emotion: block, is_nogo: isNogo, is_stop: isStop, ssd_ms: isStop ? ssd : null } })

			let outcome
			let rt = null
			if (isNogo) {
				if (Math.random() < commissionRate[block]) {
					rt = Math.round(gauss(390, 70))
					outcome = "commission"
				} else outcome = "correct_rejection"
			} else if (isStop) {
				// failing to stop gets likelier as the delay grows, so the staircase
				// converges on ~50% the way a real one does
				const pFail = 1 / (1 + Math.exp(-(ssd - 230) / 60))
				if (Math.random() < pFail) {
					rt = Math.round(gauss(430, 80))
					outcome = "stop_failure"
					ssd = Math.max(50, ssd - 50)
				} else {
					outcome = "stop_success"
					ssd = Math.min(800, ssd + 50)
				}
			} else if (Math.random() < 0.04) {
				outcome = "miss"
			} else {
				rt = Math.round(gauss(block === "angry" ? 405 : 420, 85))
				outcome = "hit"
			}

			if (rt != null) ev("response", { module: "M1", block: block, trial_index: i, payload: { rt_ms: rt } })
			ev("trial_end", {
				module: "M1",
				block: block,
				trial_index: i,
				payload: { outcome: outcome, correct: outcome === "hit" || outcome === "correct_rejection" || outcome === "stop_success", rt_ms: rt, is_nogo: isNogo, is_stop: isStop, ssd_ms: isStop ? ssd : null, emotion: block },
			})
		}
		ev("attention_probe", { module: "M1", payload: { passed: true, rt_ms: 780 } })
	}
	ev("module_end", { module: "M1" })

	/* ---------------- M2 ---------------- */
	ev("module_start", { module: "M2" })
	for (let lvl = 1; lvl <= 5; lvl++) {
		for (let i = 0; i < 20; i++) {
			ev("trial_start", { module: "M2", block: "L" + lvl, trial_index: i, payload: { level: lvl } })
			const pMiss = 0.06 + lvl * 0.05
			const r = Math.random()
			const outcome = r < pMiss ? "miss_tap" : r < pMiss + 0.03 ? "decoy_error" : "hit"
			const rt = Math.round(gauss(560 + lvl * 55, 90))
			ev("response", { module: "M2", block: "L" + lvl, trial_index: i, payload: { rt_ms: rt } })
			ev("trial_end", { module: "M2", block: "L" + lvl, trial_index: i, payload: { outcome: outcome, correct: outcome === "hit", rt_ms: rt, level: lvl } })
		}
	}
	ev("module_end", { module: "M2" })

	/* ---------------- M3 ---------------- */
	ev("module_start", { module: "M3" })
	const rigged = [2, 4, 5]
	for (let i = 0; i < 8; i++) {
		const isRigged = rigged.indexOf(i) !== -1
		ev("trial_start", { module: "M3", block: isRigged ? "rigged" : "fair", trial_index: i, payload: { is_rigged: isRigged } })
		const quit = isRigged && Math.random() < 0.7
		const duration = isRigged ? Math.round(gauss(21000, 5000)) : Math.round(gauss(9000, 2500))
		const interactions = isRigged ? Math.round(gauss(34, 8)) : Math.round(gauss(9, 3))
		if (quit) ev("quit_pressed", { module: "M3", trial_index: i, payload: { elapsed_ms: duration } })
		ev("trial_end", {
			module: "M3",
			block: isRigged ? "rigged" : "fair",
			trial_index: i,
			payload: { outcome: quit ? "quit" : isRigged ? "timeout" : "success", correct: !isRigged, duration_ms: duration, interactions: interactions, quit: quit, is_rigged: isRigged },
		})
		if (isRigged) {
			ev("retry_offered", { module: "M3", trial_index: i, payload: {} })
			if (Math.random() < 0.5) ev("retry_pressed", { module: "M3", trial_index: i, payload: {} })
		}
	}
	ev("rating_given", { module: "M3", payload: { scale: "anger", point: "m3_early", value: 2, decision_ms: 1500 } })
	ev("rating_given", { module: "M3", payload: { scale: "anger", point: "m3_post_rigged", value: 4, decision_ms: 1400 } })
	ev("module_end", { module: "M3" })

	/* ---------------- M4 ---------------- */
	ev("module_start", { module: "M4" })
	let idx = 0
	for (let epoch = 0; epoch < 4; epoch++) {
		for (let i = 0; i < 12; i++) {
			// two perseverative errors after each silent rule change
			const correct = epoch > 0 && i < 2 ? false : Math.random() < 0.88
			const rt = Math.round(gauss(i === 0 && epoch > 0 ? 900 : 650, 120))
			ev("trial_start", { module: "M4", block: "epoch" + epoch, trial_index: idx, payload: { rule_epoch: epoch } })
			ev("response", { module: "M4", block: "epoch" + epoch, trial_index: idx, payload: { rt_ms: rt } })
			ev("trial_end", { module: "M4", block: "epoch" + epoch, trial_index: idx, payload: { outcome: correct ? "correct" : "error", correct: correct, rt_ms: rt, rule_epoch: epoch } })
			idx++
		}
	}
	ev("rating_given", { module: "M4", payload: { scale: "anger", point: "m4_post", value: 3, decision_ms: 1300 } })
	ev("module_end", { module: "M4" })

	/* ---------------- M5 ---------------- */
	ev("module_start", { module: "M5" })
	const m5 = [
		{ id: "ignore", category: "avoidant", weight: 0 },
		{ id: "complain", category: "verbal_resolution", weight: 1 },
		{ id: "complain", category: "verbal_resolution", weight: 1 },
		{ id: "block", category: "instrumental", weight: 2 },
		{ id: "even", category: "retaliation", weight: 3 },
		{ id: "even", category: "retaliation", weight: 3 },
	]
	m5.forEach(function (c, i) {
		ev("provocation_shown", { module: "M5", trial_index: i, payload: { event_id: "p" + (i + 1), actor: "Vex" } })
		ev("choice_made", {
			module: "M5",
			block: "provocation",
			trial_index: i,
			payload: { option_id: c.id, category: c.category, weight: c.weight, decision_ms: Math.round(gauss(2600, 700)), displayed_position: i % 5, event_id: "p" + (i + 1) },
		})
	})
	ev("rating_given", { module: "M5", payload: { scale: "anger", point: "m5_e3", value: 3, decision_ms: 1200 } })
	ev("rating_given", { module: "M5", payload: { scale: "anger", point: "m5_e6", value: 4, decision_ms: 1100 } })
	ev("module_end", { module: "M5" })

	/* ---------------- M6 ---------------- */
	ev("module_start", { module: "M6" })
	const intents = ["ambiguous", "ambiguous", "hostile", "benign", "ambiguous", "ambiguous", "hostile", "benign", "ambiguous", "ambiguous", "hostile", "benign"]
	intents.forEach(function (intent, i) {
		const hostileRead = intent === "hostile" ? Math.random() < 0.9 : intent === "benign" ? Math.random() < 0.1 : Math.random() < 0.65
		const action = hostileRead ? pick([{ id: "getback", c: "retaliation", w: 3 }, { id: "exclude", c: "instrumental", w: 2 }]) : pick([{ id: "ask", c: "verbal_resolution", w: 1 }, { id: "ignore", c: "avoidant", w: 0 }, { id: "adult", c: "help_seeking", w: 0 }])
		ev("trial_start", { module: "M6", block: intent, trial_index: i, payload: { vignette_id: "v" + (i + 1), intent: intent } })
		ev("vignette_answer", {
			module: "M6",
			block: intent,
			trial_index: i,
			payload: {
				vignette_id: "v" + (i + 1),
				intent: intent,
				intent_response: hostileRead ? "hostile" : pick(["accidental", "benign", "unsure"]),
				comprehension_correct: Math.random() < 0.95,
				anger: hostileRead ? 4 : 2,
				open_response: hostileRead ? "I would get back at them" : "I would ask what happened",
				choice_id: action.id,
				choice_category: action.c,
				choice_weight: action.w,
				choice_decision_ms: Math.round(gauss(3400, 900)),
				expected_outcome: hostileRead ? "better" : "same",
				confidence: 4,
			},
		})
		ev("trial_end", { module: "M6", block: intent, trial_index: i, payload: { outcome: "answered", correct: true, vignette_id: "v" + (i + 1) } })
	})
	ev("module_end", { module: "M6" })

	/* ---------------- M7 ---------------- */
	ev("module_start", { module: "M7" })
	ev("consent_recorded", { module: "M7", payload: { type: "m7_reassent", granted: true } })
	ev("m7_round", { module: "M7", trial_index: 0, payload: { option_id: "take", category: "instrumental", weight: 2, decision_ms: 4100, displayed_position: 3, would_repeat: false, repeat_weight: 1, fairness: 3 } })
	ev("module_end", { module: "M7" })

	ev("debrief_completed", { payload: { final_anger: 2, baseline_anger: 2 } })
}

async function main() {
	const startRes = await fetch(BASE + "/api/session/start", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ participantId: "SIM-" + (100 + Math.floor(Math.random() * 900)), ageBand: "11-13", profile: "full", operator: "simulator", m7Consented: true }),
	}).catch(function () {
		return null
	})

	if (!startRes || !startRes.ok) {
		console.error("Could not reach the server at " + BASE + ". Start it first with: npm start")
		process.exit(1)
	}
	const session = await startRes.json()

	build()
	for (const e of events) {
		e.session_id = session.sessionId
		e.participant_id = session.participantId
	}

	for (let i = 0; i < events.length; i += 200) {
		await fetch(BASE + "/api/events", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionId: session.sessionId, events: events.slice(i, i + 200) }),
		})
	}
	await fetch(BASE + "/api/session/end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.sessionId, completed: true }) })

	const scored = await (await fetch(BASE + "/api/score/" + session.sessionId)).json()
	const f = scored.features
	console.log("")
	console.log("  Simulated session " + session.sessionId + " (" + events.length + " events)")
	console.log("  ---------------------------------------------")
	console.log("  M1 commission  neutral " + f.m1_commission_neutral + "  angry " + f.m1_commission_angry + "  cost " + f.m1_emo_cost)
	console.log("  M1 d'          " + f.m1_dprime + "    SSRT " + f.m1_ssrt + " ms (" + f.m1_ssrt_flag + ", p=" + f.m1_prespond + ")")
	console.log("  M2 decay       " + f.m2_decay + "      strategy " + f.m2_strategy)
	console.log("  M3 time-to-quit " + f.m3_ttq + " s   quit rate " + f.m3_quit_rate + "   agitation " + f.m3_input_force)
	console.log("  M4 perseveration " + f.m4_persev + "   recovery " + f.m4_recovery)
	console.log("  M5 severity    " + f.m5_severity + "   escalation " + f.m5_escalation)
	console.log("  M6 HAB         " + f.m6_hab + "   validity " + f.m6_validity_flag + "   benign check " + f.m6_check_benign)
	console.log("  M7 repeat      " + f.m7_repeat + "   self-eval " + f.m7_selfeval)
	console.log("  trials " + scored.qc.trials_total + " (excluded " + scored.qc.trials_excluded + ")   QC flags: " + (scored.qc.flags.join(", ") || "none"))
	console.log("")
	console.log("  Open http://localhost:3000/dashboard.html to inspect it.")
	console.log("")
}

main()
