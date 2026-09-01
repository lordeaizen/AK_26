/* M1 — Sky Gate (emotional Go/No-Go + stop signal)
 * M2 — Storm Run (speeded tracking under increasing pressure)
 *
 * Design notes:
 *  - The GO/NO-GO cue is the FRAME SHAPE (circle = fly, square = hold).
 *    Facial emotion is task-irrelevant background, which is what makes the
 *    angry-minus-neutral contrast (m1_emo_cost) interpretable.
 *  - Stop signal = red flash + tone after a staircased delay (SSD).
 */

window.Sky = window.Sky || {}
Sky.tasks = Sky.tasks || {}

var P1 = null

function m1Stage(emotion, shape, extraClass) {
	var ui = Sky.ui
	var box = ui.el("div", { class: "stim-wrap" })
	var stim = ui.el("div", { class: "stim frame-" + shape + (extraClass ? " " + extraClass : "") })
	stim.innerHTML = Sky.faceSVG(emotion, 170)
	box.appendChild(stim)
	return { box: box, stim: stim }
}

function buildM1Sequence(n, seedBlock) {
	/* 75:25 go:no-go; 25% of go trials carry a stop signal. */
	var nNoGo = Math.round(n * (1 - Sky.PARAMS.m1.goRatio))
	var nGo = n - nNoGo
	var nStop = Math.round(nGo * Sky.PARAMS.m1.stopFraction)
	var seq = []
	var i
	for (i = 0; i < nNoGo; i++) seq.push({ isNoGo: true, isStop: false })
	for (i = 0; i < nStop; i++) seq.push({ isNoGo: false, isStop: true })
	for (i = 0; i < nGo - nStop; i++) seq.push({ isNoGo: false, isStop: false })
	seq = Sky.rng.shuffle(seq)

	/* avoid runs of more than 3 consecutive no-go trials */
	for (i = 3; i < seq.length; i++) {
		if (seq[i].isNoGo && seq[i - 1].isNoGo && seq[i - 2].isNoGo && seq[i - 3].isNoGo) {
			for (var j = i + 1; j < seq.length; j++) {
				if (!seq[j].isNoGo) {
					var t = seq[i]
					seq[i] = seq[j]
					seq[j] = t
					break
				}
			}
		}
	}
	return seq
}

async function runM1Trial(spec, state, emotion, index, block, isPractice) {
	var ui = Sky.ui
	var P = Sky.PARAMS.m1

	// inter-trial interval with fixation
	ui.show(ui.el("div", { class: "fixation", text: "+" }))
	await Sky.sleep(Sky.rng.int(P.itiMin, P.itiMax))

	var shape = spec.isNoGo ? "square" : "circle"
	var node = m1Stage(emotion, shape)
	ui.show(node.box)

	var t0 = performance.now()
	if (!isPractice) {
		Sky.T.setContext({ module: "M1", block: block, trial_index: index })
		Sky.T.event("trial_start", {
			stim_id: emotion + "_" + shape,
			emotion: emotion,
			is_nogo: spec.isNoGo,
			is_stop: spec.isStop,
			ssd_ms: spec.isStop ? state.ssd : null,
		})
	}

	var offTimer = setTimeout(function () {
		node.stim.classList.add("blank")
	}, P.stimMs)
	var stopTimer = null
	if (spec.isStop) {
		stopTimer = setTimeout(function () {
			node.stim.classList.add("stop-signal")
			Sky.beep(880, 130)
		}, state.ssd)
	}

	var r = await Sky.awaitResponse(P.windowMs, { t0: t0 })
	clearTimeout(offTimer)
	if (stopTimer) clearTimeout(stopTimer)

	var outcome
	if (spec.isNoGo) outcome = r.responded ? "commission" : "correct_rejection"
	else if (spec.isStop) outcome = r.responded ? "stop_failure" : "stop_success"
	else outcome = r.responded ? "hit" : "miss"

	// SSD staircase, converging on p(inhibit) = .50
	if (spec.isStop) {
		if (outcome === "stop_success") state.ssd = Math.min(P.ssdMax, state.ssd + P.ssdStep)
		else state.ssd = Math.max(P.ssdMin, state.ssd - P.ssdStep)
	}

	if (!isPractice) {
		if (r.responded) Sky.T.event("response", { rt_ms: r.rt_ms, pointer: r.pointer })
		Sky.T.event("trial_end", { outcome: outcome, correct: outcome === "hit" || outcome === "correct_rejection" || outcome === "stop_success" })
	}

	// brief feedback in practice only (no feedback during the real blocks)
	if (isPractice) {
		var ok = outcome === "hit" || outcome === "correct_rejection" || outcome === "stop_success"
		node.stim.classList.add(ok ? "good" : "bad")
		await Sky.sleep(400)
	}
	return outcome
}

async function attentionProbe(moduleId) {
	var ui = Sky.ui
	var star = ui.el("div", { class: "probe" })
	star.innerHTML = '<div class="probe-star">\u2605</div><p>Tap the star!</p>'
	ui.show(star)
	var t0 = performance.now()
	var r = await Sky.awaitResponse(2500, { t0: t0 })
	Sky.T.event("attention_probe", { passed: r.responded, rt_ms: r.rt_ms }, { module: moduleId })
	await Sky.sleep(250)
	return r.responded
}
Sky.attentionProbe = attentionProbe

/* ---------------------------- M1 ---------------------------- */
Sky.tasks.M1 = {
	id: "M1",
	name: "Sky Gate",

	async practice() {
		var ui = Sky.ui
		var attempts = 0
		while (attempts < 3) {
			attempts++
			await ui.prompt({
				eyebrow: "Sky Gate — practice " + attempts + " of up to 3",
				title: "Fly through round gates, hold at square gates",
				bodyHtml:
					"<ul><li><b>Round gate</b> \u2192 tap anywhere (or press Space) as fast as you can.</li>" +
					"<li><b>Square gate</b> \u2192 do nothing at all.</li>" +
					"<li>If you hear a <b>beep</b> and the gate flashes red, stop yourself \u2014 do not tap.</li></ul>" +
					"<p>The faces in the gates do not matter. Only the shape matters.</p>",
				buttons: [{ label: "Start practice", value: "go" }],
			})
			var seq = buildM1Sequence(Sky.cfg.m1Practice, 1)
			var state = { ssd: Sky.PARAMS.m1.ssdStart }
			var correct = 0
			for (var i = 0; i < seq.length; i++) {
				var o = await runM1Trial(seq[i], state, "neutral", i, "practice", true)
				if (o === "hit" || o === "correct_rejection" || o === "stop_success") correct++
			}
			var acc = correct / seq.length
			Sky.T.event("practice_result", { module: "M1", accuracy: Math.round(acc * 1000) / 1000, attempt: attempts }, { module: "M1", block: "practice" })
			if (acc >= 0.8) {
				await ui.prompt({ title: "Nice flying!", bodyHtml: "<p>You are ready for the real gates.</p>", buttons: [{ label: "Continue", value: "ok" }] })
				return { passed: true, attempts: attempts, accuracy: acc }
			}
			if (attempts < 3) {
				await ui.prompt({ title: "Let's try that again", bodyHtml: "<p>Remember: round = tap, square = hold still.</p>", buttons: [{ label: "Practise again", value: "ok" }] })
			}
		}
		Sky.T.event("practice_failed", { module: "M1" }, { module: "M1", block: "practice" })
		return { passed: false, attempts: attempts }
	},

	async run(ctx) {
		var ui = Sky.ui
		var order = ctx.assignment.emotionOrder
		var state = { ssd: Sky.PARAMS.m1.ssdStart }

		for (var b = 0; b < order.length; b++) {
			var emotion = order[b]
			ui.hud("Sky Gate", "Flight " + (b + 1) + " of " + order.length)
			await ui.prompt({
				eyebrow: "Flight " + (b + 1) + " of " + order.length,
				title: "Ready for the next stretch of gates",
				bodyHtml: "<p>Round gate \u2192 tap. Square gate \u2192 hold. Beep and red flash \u2192 stop yourself.</p>",
				buttons: [{ label: "Fly", value: "go" }],
			})

			var seq = buildM1Sequence(Sky.cfg.m1TrialsPerBlock, b)
			for (var i = 0; i < seq.length; i++) {
				await runM1Trial(seq[i], state, emotion, i, emotion, false)
				ui.progress(((b * seq.length + i + 1) / (order.length * seq.length)) * 100)
				if (i > 0 && i % Math.max(20, Math.floor(seq.length / 2)) === 0) await attentionProbe("M1")
			}
			if (b < order.length - 1) {
				await ui.prompt({ title: "Short rest", bodyHtml: "<p>Shake out your hands. Tap when you are ready.</p>", buttons: [{ label: "I'm ready", value: "ok" }] })
			}
		}
		ui.progress(0)
	},
}

/* ---------------------------- M2 ---------------------------- */
function m2Trial(level, speed, index, useDecoy) {
	var ui = Sky.ui
	return new Promise(function (resolve) {
		var field = ui.el("div", { class: "field" })
		var travel = Sky.PARAMS.m2.baseTravelMs / speed
		var h = 380
		var targetTop = Sky.rng.int(40, h - 80)
		var target = ui.el("div", { class: "mover target", style: "top:" + targetTop + "px;left:-70px" })
		target.innerHTML = "\u2726"
		field.appendChild(target)

		var decoys = []
		if (useDecoy) {
			for (var d = 0; d < 2; d++) {
				var top = Sky.rng.int(40, h - 80)
				var dec = ui.el("div", { class: "mover decoy", style: "top:" + top + "px;left:-70px" })
				dec.innerHTML = "\u25C6"
				field.appendChild(dec)
				decoys.push({ node: dec, offset: Sky.rng.int(200, 900), speed: speed * (0.85 + Sky.rng.next() * 0.3) })
			}
		}
		ui.show(field)

		var width = field.clientWidth || 720
		var t0 = performance.now()
		Sky.T.setContext({ module: "M2", block: "L" + level, trial_index: index })
		Sky.T.event("trial_start", { stim_id: "target", level: level, speed: speed, decoys: useDecoy ? decoys.length : 0 })

		var raf = null
		var finished = false

		function step(t) {
			var dt = t - t0
			var p = dt / travel
			target.style.transform = "translateX(" + (p * (width + 140)) + "px)"
			decoys.forEach(function (d) {
				var dp = (dt - d.offset) / (Sky.PARAMS.m2.baseTravelMs / d.speed)
				if (dp > 0) d.node.style.transform = "translateX(" + (dp * (width + 140)) + "px)"
			})
			if (p >= 1) return finish("miss", null)
			raf = requestAnimationFrame(step)
		}

		function finish(outcome, rt) {
			if (finished) return
			finished = true
			cancelAnimationFrame(raf)
			field.removeEventListener("pointerdown", onTap)
			if (rt != null) Sky.T.event("response", { rt_ms: rt, outcome: outcome })
			Sky.T.event("trial_end", { outcome: outcome, correct: outcome === "hit", level: level })
			target.classList.add(outcome === "hit" ? "good" : "bad")
			setTimeout(function () {
				resolve(outcome)
			}, 220)
		}

		function onTap(ev) {
			var rt = Math.round((performance.now() - t0) * 10) / 10
			if (ev.target === target) finish("hit", rt)
			else if (ev.target.classList.contains("decoy")) finish("decoy_error", rt)
			else finish("miss_tap", rt)
		}

		field.addEventListener("pointerdown", onTap)
		raf = requestAnimationFrame(step)
	})
}

Sky.tasks.M2 = {
	id: "M2",
	name: "Storm Run",

	async run(ctx) {
		var ui = Sky.ui
		ui.hud("Storm Run", "Catch the sparks")
		await ui.prompt({
			eyebrow: "Storm Run",
			title: "Catch every spark before it leaves the sky",
			bodyHtml:
				"<p>Tap the bright <b>\u2726 spark</b> as it crosses. The wind gets faster each round.</p>" +
				"<p>Later on, dark <b>\u25C6 shards</b> appear too. Do not tap those.</p>",
			buttons: [{ label: "Start", value: "go" }],
		})

		var levels = Sky.PARAMS.m2.levels
		var per = Sky.cfg.m2TrialsPerLevel
		var idx = 0
		for (var l = 0; l < levels.length; l++) {
			ui.hud("Storm Run", "Wind level " + (l + 1) + " of " + levels.length)
			for (var i = 0; i < per; i++) {
				await m2Trial(l + 1, levels[l], idx++, l + 1 >= Sky.PARAMS.m2.decoyFromLevel)
				ui.progress((idx / (levels.length * per)) * 100)
			}
			if (l === 2) await attentionProbe("M2")
		}
		ui.progress(0)
	},
}
