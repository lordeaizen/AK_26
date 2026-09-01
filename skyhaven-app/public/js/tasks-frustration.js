/* M3 — Rune Gates (scheduled, bounded frustration)
 * M4 — Shifting Bridge (silent rule change)
 *
 * Ethics constraints implemented here (§9.3):
 *  - a Skip control is visible on every rigged trial, from the first second
 *  - no more than two rigged trials in a row
 *  - the whole frustration phase is time-capped
 *  - the child is told in the debrief that some gates could not be finished
 */

window.Sky = window.Sky || {}
Sky.tasks = Sky.tasks || {}

var RUNES = ["\u16A0", "\u16B1", "\u16C1", "\u16D2", "\u16DE", "\u16E3"]

function m3Trial(index, rigged, capMs) {
	var ui = Sky.ui
	return new Promise(function (resolve) {
		var keyRune = Sky.rng.pick(RUNES)
		var others = RUNES.filter(function (r) {
			return r !== keyRune
		})
		var needed = Sky.PARAMS.m3.keyCount
		var present = rigged ? Sky.PARAMS.m3.riggedKeyCount : needed // rigged: one key rune is missing

		var cells = []
		var i
		for (i = 0; i < present; i++) cells.push(keyRune)
		for (i = present; i < 9; i++) cells.push(Sky.rng.pick(others))
		cells = Sky.rng.shuffle(cells)

		var found = 0
		var taps = 0
		var t0 = performance.now()
		var finished = false

		var counter = ui.el("div", { class: "counter", text: "Found 0 of " + needed })
		var bar = ui.el("div", { class: "timebar" }, [ui.el("div", { class: "timebar-fill", id: "m3fill" })])
		var grid = ui.el("div", { class: "rune-grid" })

		cells.forEach(function (r, ci) {
			var tile = ui.el("button", { class: "rune-tile", text: r })
			tile.addEventListener("pointerdown", function () {
				if (finished) return
				taps++
				if (r === keyRune && !tile.classList.contains("lit")) {
					tile.classList.add("lit")
					found++
					counter.textContent = "Found " + found + " of " + needed
					if (found >= needed) finish("success", false)
				} else if (r !== keyRune) {
					tile.classList.add("wrong")
					setTimeout(function () {
						tile.classList.remove("wrong")
					}, 200)
				}
			})
			grid.appendChild(tile)
		})

		var skip = ui.el("button", { class: "btn ghost no-capture", text: "Skip this gate" })
		skip.addEventListener("click", function () {
			if (finished) return
			Sky.T.event("quit_pressed", { elapsed_ms: Math.round(performance.now() - t0) })
			finish("quit", true)
		})

		ui.show(
			ui.el("div", { class: "card wide" }, [
				ui.el("div", { class: "eyebrow", text: "Rune Gate " + (index + 1) }),
				ui.el("h2", { html: "Light up all <span class='rune-inline'>" + keyRune + "</span> runes" }),
				counter,
				bar,
				grid,
				ui.el("div", { class: "btn-row" }, [skip]),
			]),
		)

		Sky.T.setContext({ module: "M3", block: rigged ? "rigged" : "fair", trial_index: index })
		Sky.T.event("trial_start", { stim_id: "rune_gate", is_rigged: rigged, needed: needed, present: present, cap_ms: capMs })

		var fill = document.getElementById("m3fill")
		var raf
		function tick() {
			var p = (performance.now() - t0) / capMs
			if (fill) fill.style.width = Math.min(100, p * 100) + "%"
			if (p >= 1) return finish("timeout", false)
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)

		function finish(outcome, quit) {
			if (finished) return
			finished = true
			cancelAnimationFrame(raf)
			var dur = Math.round(performance.now() - t0)
			Sky.T.event("trial_end", {
				outcome: outcome,
				correct: outcome === "success",
				duration_ms: dur,
				quit: quit,
				interactions: taps,
				is_rigged: rigged,
			})
			resolve({ outcome: outcome, duration_ms: dur, taps: taps })
		}
	})
}

Sky.tasks.M3 = {
	id: "M3",
	name: "Rune Gates",

	async run(ctx) {
		var ui = Sky.ui
		ui.hud("Rune Gates", "Open the gates")
		await ui.prompt({
			eyebrow: "Rune Gates",
			title: "Light up the matching runes to open each gate",
			bodyHtml:
				"<p>Find and tap all four matching runes before the bar runs out.</p>" +
				"<p>Some gates are hard. You can press <b>Skip this gate</b> at any time \u2014 that is completely okay.</p>",
			buttons: [{ label: "Start", value: "go" }],
		})

		// baseline anger rating is taken by app.js before this module runs
		var total = Sky.cfg.m3Trials
		var riggedSet = Sky.cfg.m3RiggedIndexes
		var phaseStart = performance.now()
		var PHASE_CAP_MS = 6 * 60 * 1000 // §9.3 hard cap on total frustration exposure

		for (var i = 0; i < total; i++) {
			if (performance.now() - phaseStart > PHASE_CAP_MS) {
				Sky.T.event("phase_capped", { module: "M3", after_trials: i })
				break
			}
			var rigged = riggedSet.indexOf(i) !== -1
			var res = await m3Trial(i, rigged, Sky.cfg.m3CapMs)
			ui.progress(((i + 1) / total) * 100)

			if (res.outcome !== "success") {
				Sky.T.event("retry_offered", { trial_index: i, is_rigged: rigged })
				var choice = await ui.prompt({
					title: res.outcome === "quit" ? "Gate skipped" : "The gate stayed shut",
					bodyHtml: "<p>What would you like to do?</p>",
					buttons: [
						{ label: "Try this gate again", value: "retry" },
						{ label: "Move to the next gate", value: "next", kind: "ghost" },
					],
				})
				if (choice === "retry") {
					Sky.T.event("retry_pressed", { trial_index: i, is_rigged: rigged })
					await m3Trial(i + 100, rigged, Sky.cfg.m3CapMs) // retry logged separately
				}
			}

			if (i === 1) await Sky.rate({ scale: "anger", point: "m3_early", question: "How annoyed do you feel right now?" })
			if (rigged && i === riggedSet[riggedSet.length - 1]) {
				await Sky.rate({ scale: "anger", point: "m3_post_rigged", question: "How annoyed do you feel right now?" })
				await Sky.rate({ scale: "arousal", point: "m3_post_rigged", question: "How worked up does your body feel?", labels: ["Very calm", "Calm", "In between", "Buzzy", "Very buzzy"] })
			}
		}
		ui.progress(0)
	},
}

/* ---------------------------- M4 ---------------------------- */
var M4_RULES = [
	{ id: "blue", label: "blue", test: function (o) { return o.color === "blue" } },
	{ id: "square", label: "square", test: function (o) { return o.shape === "square" } },
	{ id: "yellow", label: "yellow", test: function (o) { return o.color === "yellow" } },
	{ id: "circle", label: "circle", test: function (o) { return o.shape === "circle" } },
]

function m4Options(rule) {
	var colors = ["blue", "yellow"]
	var shapes = ["square", "circle"]
	var all = []
	colors.forEach(function (c) {
		shapes.forEach(function (s) {
			all.push({ color: c, shape: s })
		})
	})
	var safe = Sky.rng.pick(all.filter(function (o) { return rule.test(o) }))
	var unsafe = Sky.rng.pick(all.filter(function (o) { return !rule.test(o) }))
	return Sky.rng.shuffle([
		{ obj: safe, safe: true },
		{ obj: unsafe, safe: false },
	])
}

function m4Trial(index, rule, epoch) {
	var ui = Sky.ui
	return new Promise(function (resolve) {
		var opts = m4Options(rule)
		var row = ui.el("div", { class: "tile-row" })
		var t0 = performance.now()
		var done = false

		opts.forEach(function (o) {
			var tile = ui.el("button", { class: "bridge-tile " + o.obj.color + " " + o.obj.shape })
			tile.addEventListener("pointerdown", function () {
				if (done) return
				done = true
				var rt = Math.round((performance.now() - t0) * 10) / 10
				Sky.T.event("response", { rt_ms: rt, chosen: o.obj.color + "_" + o.obj.shape })
				Sky.T.event("trial_end", { outcome: o.safe ? "correct" : "incorrect", correct: o.safe, rule_epoch: epoch })
				tile.classList.add(o.safe ? "good" : "bad")
				setTimeout(function () {
					resolve(o.safe)
				}, 450)
			})
			row.appendChild(tile)
		})

		ui.show(
			ui.el("div", { class: "card wide" }, [
				ui.el("div", { class: "eyebrow", text: "Shifting Bridge" }),
				ui.el("h2", { text: "Step on the safe plank" }),
				ui.el("p", { class: "muted", text: "Work out which plank holds you. It will not always be the same one." }),
				row,
			]),
		)

		Sky.T.setContext({ module: "M4", block: "epoch" + epoch, trial_index: index })
		Sky.T.event("trial_start", { stim_id: "bridge", rule_epoch: epoch, rule: rule.id })
	})
}

Sky.tasks.M4 = {
	id: "M4",
	name: "Shifting Bridge",

	async run(ctx) {
		var ui = Sky.ui
		ui.hud("Shifting Bridge", "Find the safe planks")
		await ui.prompt({
			eyebrow: "Shifting Bridge",
			title: "Cross the bridge",
			bodyHtml: "<p>One plank in each pair is safe. Tap it. You will find out straight away if you were right.</p>",
			buttons: [{ label: "Start crossing", value: "go" }],
		})

		var idx = 0
		var totalTrials = Sky.cfg.m4Epochs * Sky.cfg.m4TrialsPerEpoch
		for (var e = 0; e < Sky.cfg.m4Epochs; e++) {
			var rule = M4_RULES[e % M4_RULES.length]
			for (var i = 0; i < Sky.cfg.m4TrialsPerEpoch; i++) {
				await m4Trial(idx, rule, e) // rule changes silently between epochs
				idx++
				ui.progress((idx / totalTrials) * 100)
			}
		}
		ui.progress(0)
		await Sky.rate({ scale: "anger", point: "m4_post", question: "How annoyed do you feel right now?" })
	},
}
