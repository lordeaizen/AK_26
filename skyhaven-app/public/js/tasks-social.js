/* M5 — Lantern Race (in-world provocation by a personified rival)
 * M6 — Story Circle (social information processing / hostile attribution bias)
 * M7 — The Last Gate (retaliation + consequence, optional and gated)
 *
 * All three log a severity-weighted choice:
 *   0 avoidant / help-seeking, 1 assertive verbal,
 *   2 instrumental or indirect retaliation, 3 direct retaliation.
 * Option order is randomised per event and the displayed order is stored, so
 * position bias can be checked at analysis time.
 */

window.Sky = window.Sky || {}
Sky.tasks = Sky.tasks || {}

function choicePanel(opts) {
	var ui = Sky.ui
	return new Promise(function (resolve) {
		var shuffled = Sky.rng.shuffle(opts.actions)
		var t0 = performance.now()
		var list = ui.el("div", { class: "choice-list" })
		shuffled.forEach(function (a, pos) {
			var b = ui.el("button", { class: "choice no-capture", text: a.label })
			b.addEventListener("click", function () {
				resolve({
					action: a,
					position: pos,
					decision_ms: Math.round(performance.now() - t0),
					order: shuffled.map(function (x) {
						return x.id
					}),
				})
			})
			list.appendChild(b)
		})
		ui.show(ui.card({ eyebrow: opts.eyebrow, title: opts.title, bodyHtml: opts.bodyHtml, body: list }))
	})
}
Sky.choicePanel = choicePanel

/* ---------------------------- M5 ---------------------------- */
Sky.tasks.M5 = {
	id: "M5",
	name: "Lantern Race",

	async run(ctx) {
		var ui = Sky.ui
		ui.hud("Lantern Race", "Race to the sky tower")
		await ui.prompt({
			eyebrow: "Lantern Race",
			title: "Carry your lantern to the tower",
			bodyHtml: "<p>You are racing another flyer called <b>Vex</b>. Things will not always go your way. Each time something happens, choose what you do next.</p>",
			buttons: [{ label: "Start the race", value: "go" }],
		})

		var events = Sky.PROVOCATION_EVENTS.slice(0, Sky.cfg.m5Events)
		for (var i = 0; i < events.length; i++) {
			var ev = events[i]
			Sky.T.setContext({ module: "M5", block: "race", trial_index: i })

			// short animated beat so the setback is experienced, not just read
			var scene = ui.el("div", { class: "scene" }, [
				ui.el("div", { class: "scene-sky" }, [ui.el("div", { class: "glider you", text: "\u25B2" }), ui.el("div", { class: "glider rival", text: "\u25BC" })]),
				ui.el("p", { class: "scene-text", text: ev.text }),
			])
			ui.show(ui.el("div", { class: "card wide" }, [ui.el("div", { class: "eyebrow", text: "Setback " + (i + 1) + " of " + events.length }), scene]))
			Sky.T.event("provocation_shown", { event_id: ev.id })
			await Sky.sleep(2600)

			var pick = await choicePanel({
				eyebrow: "Setback " + (i + 1) + " of " + events.length,
				title: "What do you do?",
				bodyHtml: "<p class='muted'>" + ev.text + "</p>",
				actions: Sky.PROVOCATION_ACTIONS,
			})
			Sky.T.event("choice_made", {
				event_id: ev.id,
				option_id: pick.action.id,
				category: pick.action.category,
				weight: pick.action.weight,
				decision_ms: pick.decision_ms,
				displayed_position: pick.position,
				displayed_order: pick.order,
			})
			ui.progress(((i + 1) / events.length) * 100)

			if (i === 2 || i === events.length - 1) {
				await Sky.rate({ scale: "anger", point: "m5_e" + (i + 1), question: "How annoyed do you feel right now?" })
			}
		}
		ui.progress(0)
	},
}

/* ---------------------------- M6 ---------------------------- */
function openResponse(question, hint) {
	var ui = Sky.ui
	return new Promise(function (resolve) {
		var t0 = performance.now()
		var box = ui.el("textarea", { class: "open-input no-capture", rows: "3", placeholder: hint || "Type what you would do…" })
		var wrap = ui.el("div", {}, [box])
		var done = ui.el("button", { class: "btn primary", text: "Done" })
		done.addEventListener("click", function () {
			resolve({ text: box.value.trim(), ms: Math.round(performance.now() - t0) })
		})
		var skip = ui.el("button", { class: "btn ghost", text: "I don't know" })
		skip.addEventListener("click", function () {
			resolve({ text: "", ms: Math.round(performance.now() - t0), skipped: true })
		})
		ui.show(ui.el("div", { class: "card wide" }, [ui.el("h2", { text: question }), wrap, ui.el("div", { class: "btn-row" }, [done, skip])]))
		box.focus()
	})
}

function pickOne(title, bodyHtml, options, eyebrow) {
	var ui = Sky.ui
	return new Promise(function (resolve) {
		var t0 = performance.now()
		var list = ui.el("div", { class: "choice-list" })
		options.forEach(function (o, i) {
			var b = ui.el("button", { class: "choice no-capture", text: o.label })
			b.addEventListener("click", function () {
				resolve({ value: o.value, index: i, ms: Math.round(performance.now() - t0) })
			})
			list.appendChild(b)
		})
		ui.show(ui.card({ eyebrow: eyebrow, title: title, bodyHtml: bodyHtml, body: list }))
	})
}
Sky.pickOne = pickOne

Sky.tasks.M6 = {
	id: "M6",
	name: "Story Circle",

	async run(ctx) {
		var ui = Sky.ui
		ui.hud("Story Circle", "Stories from Skyhaven")
		await ui.prompt({
			eyebrow: "Story Circle",
			title: "Some short stories about Skyhaven",
			bodyHtml:
				"<p>I will tell you some short stories. Imagine each one is really happening to you.</p>" +
				"<p>There are no right or wrong answers \u2014 I only want to know what <b>you</b> think.</p>",
			buttons: [{ label: "I'm ready", value: "go" }],
		})

		var n = Math.min(Sky.cfg.m6Vignettes, Sky.VIGNETTES.length)
		var order = Sky.rng.shuffle(Sky.VIGNETTES.slice(0, Sky.VIGNETTES.length)).slice(0, n)

		for (var i = 0; i < order.length; i++) {
			var v = order[i]
			var intent = ctx.assignment.vignetteIntents[i % ctx.assignment.vignetteIntents.length]
			var storyText = v.base + " " + v.versions[intent]
			Sky.T.setContext({ module: "M6", block: intent, trial_index: i })
			Sky.T.event("trial_start", { stim_id: v.id, intent: intent })

			// 1. narration (screen text + optional browser speech)
			var readT0 = performance.now()
			try {
				if (window.speechSynthesis && Sky.narration) {
					window.speechSynthesis.cancel()
					var utt = new SpeechSynthesisUtterance(storyText)
					utt.rate = 0.95
					window.speechSynthesis.speak(utt)
				}
			} catch (e) {}
			await ui.prompt({
				eyebrow: "Story " + (i + 1) + " of " + order.length,
				title: v.title,
				bodyHtml: "<p class='story'>" + storyText + "</p>",
				buttons: [{ label: "Next", value: "ok" }],
			})
			var readMs = Math.round(performance.now() - readT0)

			// 2. comprehension gate — one re-read allowed (§5 M6)
			var compOptions = v.comprehension.options.map(function (label, idx) {
				return { label: label, value: idx }
			})
			var comp = await pickOne(v.comprehension.q, "", Sky.rng.shuffle(compOptions), "Quick check")
			var compOk = comp.value === v.comprehension.correct
			if (!compOk) {
				await ui.prompt({ title: "Let's read it once more", bodyHtml: "<p class='story'>" + storyText + "</p>", buttons: [{ label: "Got it", value: "ok" }] })
				var comp2 = await pickOne(v.comprehension.q, "", Sky.rng.shuffle(compOptions), "Quick check")
				compOk = comp2.value === v.comprehension.correct
			}

			// 3. intent attribution — the HAB measurement
			var intentAns = await pickOne(
				"Why do you think that happened?",
				"",
				Sky.rng.shuffle([
					{ label: "They did it on purpose to be mean", value: "hostile" },
					{ label: "They did it for their own reason, not to hurt me", value: "benign" },
					{ label: "It was an accident", value: "accidental" },
					{ label: "I really can't tell", value: "unsure" },
				]),
				"Story " + (i + 1),
			)

			// 4. anger
			var anger = await Sky.rate({ scale: "anger", point: "m6_" + v.id, question: "How angry would you feel?" })

			// 5. open-ended response generation (SIP step 4)
			var open = await openResponse("What would you do?", "Type anything you would really do…")

			// 6. forced choice from the weighted action set
			var pick = await choicePanel({ eyebrow: "Story " + (i + 1), title: "Now pick one of these", actions: Sky.VIGNETTE_ACTIONS })

			// 7. outcome expectancy + confidence (D6)
			var exp = await pickOne(
				"If you did that, how would things turn out?",
				"",
				[
					{ label: "Better for me", value: "better" },
					{ label: "No change", value: "same" },
					{ label: "Worse for me", value: "worse" },
				],
				"Story " + (i + 1),
			)
			var conf = await pickOne(
				"How sure are you?",
				"",
				[
					{ label: "Not sure", value: 1 },
					{ label: "A bit sure", value: 2 },
					{ label: "Very sure", value: 3 },
				],
				"Story " + (i + 1),
			)

			Sky.T.event("open_response", { stim_id: v.id, text: open.text, ms: open.ms, skipped: !!open.skipped })
			Sky.T.event("choice_made", {
				stim_id: v.id,
				option_id: pick.action.id,
				category: pick.action.category,
				weight: pick.action.weight,
				decision_ms: pick.decision_ms,
				displayed_position: pick.position,
				displayed_order: pick.order,
			})
			Sky.T.event("vignette_answer", {
				stim_id: v.id,
				intent: intent, // what the story actually was
				intent_response: intentAns.value, // what the child read into it
				intent_ms: intentAns.ms,
				comprehension_correct: compOk,
				anger: anger,
				open_response: open.text,
				choice_id: pick.action.id,
				choice_category: pick.action.category,
				choice_weight: pick.action.weight,
				choice_ms: pick.decision_ms,
				expected_outcome: exp.value,
				expectancy_confidence: conf.value,
				read_ms: readMs,
			})
			Sky.T.event("trial_end", { outcome: "answered", correct: compOk })
			ui.progress(((i + 1) / order.length) * 100)
		}
		ui.progress(0)
	},
}

/* ---------------------------- M7 (optional) ---------------------------- */
Sky.tasks.M7 = {
	id: "M7",
	name: "The Last Gate",

	async run(ctx) {
		var ui = Sky.ui
		if (!ctx.session.m7Consented) {
			Sky.T.event("module_skipped", { module: "M7", reason: "not_enabled_by_researcher" }, { module: "M7" })
			return
		}

		// re-assent immediately before the module (§9.2)
		var assent = await ui.prompt({
			eyebrow: "Optional part",
			title: "One last part \u2014 only if you want to",
			bodyHtml: "<p>There is one more short story about the end of the race. You can say no and we will finish here instead. Saying no is completely fine.</p>",
			buttons: [
				{ label: "Yes, I want to do it", value: "yes" },
				{ label: "No thank you", value: "no", kind: "ghost" },
			],
		})
		Sky.T.event("consent_recorded", { type: "m7_reassent", value: assent }, { module: "M7" })
		if (assent !== "yes") return

		Sky.T.setContext({ module: "M7", block: "final", trial_index: 0 })
		await ui.prompt({
			eyebrow: "The Last Gate",
			title: "The ribbon goes to Vex",
			bodyHtml: "<p>At the finish line the keeper hands the ribbon to Vex. You are sure you crossed first. Vex looks over at you and shrugs.</p>",
			buttons: [{ label: "Next", value: "ok" }],
		})

		var pick = await Sky.choicePanel({
			eyebrow: "The Last Gate",
			title: "What do you do?",
			actions: [
				{ id: "nothing", label: "Do nothing", category: "avoidant", weight: 0 },
				{ id: "report", label: "Tell the keeper what happened", category: "help_seeking", weight: 0 },
				{ id: "confront", label: "Tell Vex it was not fair", category: "assertive", weight: 1 },
				{ id: "take", label: "Take the ribbon off Vex", category: "instrumental", weight: 2 },
				{ id: "even", label: "Wreck Vex's lantern", category: "retaliation", weight: 3 },
			],
		})

		// deliberately NEUTRAL consequence: no reward, no punishment (§9.3)
		await ui.prompt({
			title: "What happened next",
			bodyHtml: "<p>The keeper writes both names in the record book and the crowd moves on to the next race. Nothing else changes.</p>",
			buttons: [{ label: "Next", value: "ok" }],
		})

		var repeat = await pickOne(
			"If it happened again tomorrow, would you do the same thing?",
			"",
			[
				{ label: "Yes, the same", value: true },
				{ label: "No, something different", value: false },
			],
			"The Last Gate",
		)

		var alt = null
		if (repeat.value === false) {
			var altPick = await Sky.choicePanel({ title: "What would you do instead?", actions: Sky.VIGNETTE_ACTIONS })
			alt = altPick.action
		}

		var fairness = await Sky.rate({
			scale: "fairness",
			point: "m7_selfeval",
			question: "Was what you chose a fair thing to do?",
			labels: ["Not fair", "A bit unfair", "In between", "Mostly fair", "Very fair"],
		})

		Sky.T.event("m7_round", {
			option_id: pick.action.id,
			category: pick.action.category,
			weight: pick.action.weight,
			decision_ms: pick.decision_ms,
			would_repeat: repeat.value,
			repeat_weight: alt ? alt.weight : pick.action.weight,
			fairness: fairness,
		})
	},
}
