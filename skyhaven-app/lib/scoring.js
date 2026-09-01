/**
 * L2 -> L3 -> L4 scoring pipeline.
 *
 * Every function here is a pure transform of the stored event stream, so any
 * number in the output can be recomputed from data/events/*.jsonl.
 * Formulas follow Appendix A of the protocol; QC rules follow Appendix B.
 */

/* ------------------------------------------------------------------ *
 * statistics helpers
 * ------------------------------------------------------------------ */

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

function sd(a) {
	if (a.length < 2) return null
	const m = mean(a)
	return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1))
}

function median(a) {
	if (!a.length) return null
	const s = [...a].sort((x, y) => x - y)
	const mid = Math.floor(s.length / 2)
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** OLS slope of y on x */
function slope(xs, ys) {
	if (xs.length < 2) return null
	const mx = mean(xs)
	const my = mean(ys)
	let num = 0
	let den = 0
	for (let i = 0; i < xs.length; i++) {
		num += (xs[i] - mx) * (ys[i] - my)
		den += (xs[i] - mx) * (xs[i] - mx)
	}
	return den === 0 ? null : num / den
}

/** Acklam inverse normal CDF — used for d' */
function probit(p) {
	if (p <= 0 || p >= 1) return null
	const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924]
	const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857]
	const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878]
	const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742]
	const pl = 0.02425
	let q, r
	if (p < pl) {
		q = Math.sqrt(-2 * Math.log(p))
		return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
	}
	if (p <= 1 - pl) {
		q = p - 0.5
		r = q * q
		return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
	}
	q = Math.sqrt(-2 * Math.log(1 - p))
	return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
}

const round = (x, n) => (x === null || x === undefined || Number.isNaN(x) ? null : Number(x.toFixed(n)))

/* ------------------------------------------------------------------ *
 * L2 — trial reconstruction + quality control (Appendix B)
 * ------------------------------------------------------------------ */

const QC = {
	RT_FLOOR_MS: 150, // anticipatory
	RT_SD_CUTOFF: 3,
	JITTER_MAX_MS: 20,
	PROBE_FAIL_MAX: 0.2,
	CALIB_LAG_MAX_MS: 150,
	SSRT_PRESPOND_MIN: 0.25,
	SSRT_PRESPOND_MAX: 0.75,
}

/**
 * Rebuild one row per trial from the raw event stream, attaching QC flags.
 * Nothing is deleted — excluded trials are marked with a reason code so that
 * attrition can be reported.
 */
function buildTrials(events) {
	const byTrial = new Map()
	const key = (e) => e.module + "|" + (e.block || "-") + "|" + e.trial_index

	for (const e of events) {
		if (!["trial_start", "response", "trial_end"].includes(e.event_type)) continue
		const k = key(e)
		if (!byTrial.has(k)) {
			byTrial.set(k, {
				key: k,
				module: e.module,
				block: e.block || null,
				trial_index: e.trial_index,
				exclude: null,
			})
		}
		const t = byTrial.get(k)
		const p = e.payload || {}
		const q = e.quality || {}

		if (e.event_type === "trial_start") {
			Object.assign(t, {
				t_onset: e.t_client_mono,
				stim_id: p.stim_id ?? null,
				is_nogo: !!p.is_nogo,
				is_stop: !!p.is_stop,
				is_probe: !!p.is_probe,
				is_rigged: !!p.is_rigged,
				ssd_ms: p.ssd_ms ?? null,
				level: p.level ?? null,
				rule_epoch: p.rule_epoch ?? null,
				emotion: p.emotion ?? null,
			})
		}
		if (e.event_type === "response") {
			t.rt_ms = p.rt_ms ?? null
			t.frame_jitter_ms = q.frame_jitter_ms ?? null
			t.window_focused = q.window_focused !== false
		}
		if (e.event_type === "trial_end") {
			t.outcome = p.outcome ?? null
			t.correct = p.correct ?? null
			t.duration_ms = p.duration_ms ?? null
			t.quit = !!p.quit
			t.interactions = p.interactions ?? null
			if (t.frame_jitter_ms == null) t.frame_jitter_ms = q.frame_jitter_ms ?? null
			if (t.window_focused == null) t.window_focused = q.window_focused !== false
		}
	}

	const trials = [...byTrial.values()]

	// trial-level QC
	for (const t of trials) {
		if (t.rt_ms != null && t.rt_ms < QC.RT_FLOOR_MS) t.exclude = "rt_anticipatory"
		else if (t.frame_jitter_ms != null && t.frame_jitter_ms > QC.JITTER_MAX_MS) t.exclude = "timing_invalid"
		else if (t.window_focused === false) t.exclude = "timing_invalid"
	}

	// within module+block RT outliers
	const groups = new Map()
	for (const t of trials) {
		if (t.rt_ms == null || t.exclude) continue
		const g = t.module + "|" + (t.block || "-")
		if (!groups.has(g)) groups.set(g, [])
		groups.get(g).push(t)
	}
	for (const list of groups.values()) {
		const rts = list.map((t) => t.rt_ms)
		const m = mean(rts)
		const s = sd(rts)
		if (s == null) continue
		for (const t of list) if (Math.abs(t.rt_ms - m) > QC.RT_SD_CUTOFF * s) t.exclude = "rt_outlier"
	}

	return trials
}

const valid = (trials, fn) => trials.filter((t) => !t.exclude && fn(t))

/* ------------------------------------------------------------------ *
 * L3 — features, module by module (protocol §5 / Appendix A)
 * ------------------------------------------------------------------ */

/** M1 — emotional Go/No-Go + stop signal */
function featuresM1(trials) {
	const out = {}
	const blocks = ["neutral", "happy", "angry"]

	for (const b of blocks) {
		const all = valid(trials, (t) => t.module === "M1" && t.block === b)
		if (!all.length) continue

		const nogo = all.filter((t) => t.is_nogo)
		const go = all.filter((t) => !t.is_nogo && !t.is_stop)
		const commissions = nogo.filter((t) => t.outcome === "commission").length
		const hits = go.filter((t) => t.outcome === "hit").length

		// m1_commission = commissions / no-go trials
		out["m1_commission_" + b] = nogo.length ? round(commissions / nogo.length, 4) : null

		// m1_dprime = z(H) - z(FA), log-linear corrected
		const H = (hits + 0.5) / (go.length + 1)
		const FA = (commissions + 0.5) / (nogo.length + 1)
		const zH = probit(H)
		const zFA = probit(FA)
		out["m1_dprime_" + b] = zH != null && zFA != null ? round(zH - zFA, 3) : null

		const goRts = go.filter((t) => t.rt_ms != null).map((t) => t.rt_ms)
		out["m1_meanrt_" + b] = round(mean(goRts), 1)
		out["m1_rtcv_" + b] = goRts.length > 1 ? round(sd(goRts) / mean(goRts), 4) : null
	}

	// Pooled M1 metrics across all emotion blocks (Appendix A headline numbers)
	const allM1 = valid(trials, (t) => t.module === "M1")
	const nogoAll = allM1.filter((t) => t.is_nogo)
	const goAll = allM1.filter((t) => !t.is_nogo && !t.is_stop)
	if (nogoAll.length || goAll.length) {
		const commissionsAll = nogoAll.filter((t) => t.outcome === "commission").length
		const hitsAll = goAll.filter((t) => t.outcome === "hit").length
		const rtsAll = goAll.map((t) => t.rt_ms).filter((x) => x != null)
		out.m1_go_trials = goAll.length
		out.m1_nogo_trials = nogoAll.length
		out.m1_commission = nogoAll.length ? round(commissionsAll / nogoAll.length, 4) : null
		out.m1_omission = goAll.length ? round(goAll.filter((t) => t.outcome === "miss").length / goAll.length, 4) : null
		out.m1_go_rt = round(mean(rtsAll), 1)
		out.m1_rtcv = rtsAll.length > 1 ? round(sd(rtsAll) / mean(rtsAll), 4) : null
		const zHa = probit((hitsAll + 0.5) / (goAll.length + 1))
		const zFAa = probit((commissionsAll + 0.5) / (nogoAll.length + 1))
		out.m1_dprime = zHa != null && zFAa != null ? round(zHa - zFAa, 3) : null
		if (out.m1_rtcv != null && out.m1_rtcv > 0.6) out.m1_rt_unreliable = true
	}

	// m1_emo_cost = commission(angry) - commission(neutral)  [primary D2]
	if (out.m1_commission_angry != null && out.m1_commission_neutral != null) {
		out.m1_emo_cost = round(out.m1_commission_angry - out.m1_commission_neutral, 4)
	}

	// m1_pes — post-error slowing, pooled across blocks
	const ordered = trials
		.filter((t) => t.module === "M1")
		.sort((a, b) => (a.block === b.block ? a.trial_index - b.trial_index : 0))
	const afterError = []
	const afterCorrect = []
	for (let i = 1; i < ordered.length; i++) {
		const prev = ordered[i - 1]
		const cur = ordered[i]
		if (cur.exclude || cur.rt_ms == null || cur.block !== prev.block) continue
		const prevError = prev.outcome === "commission" || prev.outcome === "miss" || prev.outcome === "stop_failure"
		if (prevError) afterError.push(cur.rt_ms)
		else if (prev.outcome === "hit" || prev.outcome === "correct_rejection") afterCorrect.push(cur.rt_ms)
	}
	out.m1_pes = afterError.length && afterCorrect.length ? round(mean(afterError) - mean(afterCorrect), 1) : null

	// m1_ssrt — integration method with replacement of go omissions
	const stopTrials = valid(trials, (t) => t.module === "M1" && t.is_stop)
	const goForSsrt = valid(trials, (t) => t.module === "M1" && !t.is_nogo && !t.is_stop)
	if (stopTrials.length >= 10 && goForSsrt.length >= 20) {
		const failures = stopTrials.filter((t) => t.outcome === "stop_failure").length
		const pRespond = failures / stopTrials.length
		const meanSsd = mean(stopTrials.map((t) => t.ssd_ms).filter((x) => x != null))

		const goRts = goForSsrt.map((t) => t.rt_ms).filter((x) => x != null)
		const omissions = goForSsrt.filter((t) => t.outcome === "miss").length
		const maxRt = goRts.length ? Math.max(...goRts) : 1000
		for (let i = 0; i < omissions; i++) goRts.push(maxRt) // omission replacement
		goRts.sort((a, b) => a - b)

		const idx = Math.max(0, Math.min(goRts.length - 1, Math.round(pRespond * goRts.length) - 1))
		out.m1_ssrt = meanSsd != null ? round(goRts[idx] - meanSsd, 1) : null
		out.m1_prespond = round(pRespond, 3)
		out.m1_mean_ssd = round(meanSsd, 1)
		if (pRespond < QC.SSRT_PRESPOND_MIN || pRespond > QC.SSRT_PRESPOND_MAX || (out.m1_ssrt != null && out.m1_ssrt <= 0)) {
			// staircase failed to converge, or produced a non-interpretable
			// negative estimate: report it but never use it
			out.m1_ssrt_flag = "ssrt_invalid"
		}
	} else {
		out.m1_ssrt = null
		out.m1_ssrt_flag = "insufficient_trials"
	}

	return out
}

/** M2 — pressure tracking, speed/accuracy */
function featuresM2(trials) {
	const out = {}
	const levels = [...new Set(trials.filter((t) => t.module === "M2").map((t) => t.level))].filter((l) => l != null).sort()
	const lisasByLevel = []

	for (const lvl of levels) {
		const all = valid(trials, (t) => t.module === "M2" && t.level === lvl)
		if (all.length < 3) continue
		const rts = all.filter((t) => t.rt_ms != null).map((t) => t.rt_ms)
		const pe = all.filter((t) => t.correct === false).length / all.length
		const sdRt = sd(rts) || 0
		const sdPe = Math.sqrt(pe * (1 - pe)) || 0.0001
		// LISAS = meanRT + (SD_RT / SD_PE) * PE
		const lisas = (mean(rts) || 0) + (sdRt / sdPe) * pe
		out["m2_lisas_L" + lvl] = round(lisas, 1)
		out["m2_acc_L" + lvl] = round(1 - pe, 3)
		lisasByLevel.push({ lvl, lisas })
	}

	if (lisasByLevel.length >= 2) {
		out.m2_decay = round(
			slope(
				lisasByLevel.map((x) => x.lvl),
				lisasByLevel.map((x) => x.lisas),
			),
			2,
		)
		const first = valid(trials, (t) => t.module === "M2" && t.level === levels[0])
		const last = valid(trials, (t) => t.module === "M2" && t.level === levels[levels.length - 1])
		const accD = first.length && last.length ? last.filter((t) => t.correct).length / last.length - first.filter((t) => t.correct).length / first.length : null
		const rtD = mean(last.map((t) => t.rt_ms).filter(Boolean)) - mean(first.map((t) => t.rt_ms).filter(Boolean))
		out.m2_strategy = accD != null && rtD ? round(accD / rtD, 5) : null
	}
	return out
}

/** M3 — scheduled frustration */
function featuresM3(trials, events) {
	const out = {}
	const rigged = trials.filter((t) => t.module === "M3" && t.is_rigged)
	const fair = trials.filter((t) => t.module === "M3" && !t.is_rigged)

	// m3_ttq — median seconds to quit on rigged trials
	const quitTimes = rigged.filter((t) => t.quit && t.duration_ms != null).map((t) => t.duration_ms / 1000)
	out.m3_ttq = round(median(quitTimes), 2)
	out.m3_quit_rate = rigged.length ? round(quitTimes.length / rigged.length, 3) : null

	// m3_effort_auc — normalised cumulative interaction over rigged trials
	const caps = rigged.map((t) => t.duration_ms || 0)
	const capTotal = caps.reduce((s, x) => s + x, 0)
	const interactions = rigged.reduce((s, t) => s + (t.interactions || 0), 0)
	out.m3_effort_auc = capTotal ? round(Math.min(1, interactions / (capTotal / 1000) / 3), 4) : null

	// m3_retry — retry presses / retry opportunities
	const retries = events.filter((e) => e.event_type === "retry_pressed" && e.module === "M3").length
	const opportunities = events.filter((e) => e.event_type === "retry_offered" && e.module === "M3").length
	out.m3_retry = opportunities ? round(retries / opportunities, 3) : null

	// m3_anger_delta — rating after the rigged run minus baseline
	const ratings = events
		.filter((e) => e.event_type === "rating_given" && (e.payload || {}).scale === "anger")
		.map((e) => ({ point: e.payload.point, value: e.payload.value }))
	const base = ratings.find((r) => r.point === "baseline")
	const post = ratings.find((r) => r.point === "m3_post_rigged")
	out.m3_anger_baseline = base ? base.value : null
	out.m3_anger_delta = base && post ? round(post.value - base.value, 2) : null

	// m3_input_force — tap rate on rigged vs fair trials
	const rate = (list) => {
		const secs = list.reduce((s, t) => s + (t.duration_ms || 0) / 1000, 0)
		const taps = list.reduce((s, t) => s + (t.interactions || 0), 0)
		return secs ? taps / secs : null
	}
	const rr = rate(rigged)
	const fr = rate(fair)
	out.m3_input_force = rr != null && fr != null ? round(rr - fr, 3) : null
	return out
}

/** M4 — rule-change adaptation */
function featuresM4(trials) {
	const out = {}
	const all = trials.filter((t) => t.module === "M4").sort((a, b) => a.trial_index - b.trial_index)
	if (!all.length) return out

	const changePoints = []
	for (let i = 1; i < all.length; i++) if (all[i].rule_epoch !== all[i - 1].rule_epoch) changePoints.push(i)

	const switchCosts = []
	const persev = []
	const recovery = []

	for (const cp of changePoints) {
		const before = all.slice(Math.max(0, cp - 3), cp).filter((t) => !t.exclude && t.rt_ms != null)
		const after = all.slice(cp, cp + 3).filter((t) => !t.exclude && t.rt_ms != null)
		if (before.length && after.length) switchCosts.push(mean(after.map((t) => t.rt_ms)) - mean(before.map((t) => t.rt_ms)))

		let run = 0
		for (let i = cp; i < all.length && all[i].rule_epoch === all[cp].rule_epoch; i++) {
			if (all[i].correct === false) run++
			else break
		}
		persev.push(run)

		let streak = 0
		let n = 0
		for (let i = cp; i < all.length && all[i].rule_epoch === all[cp].rule_epoch; i++) {
			n++
			streak = all[i].correct ? streak + 1 : 0
			if (streak >= 3) break
		}
		recovery.push(n)
	}

	out.m4_switch_cost = round(mean(switchCosts), 1)
	out.m4_persev = round(mean(persev), 2)
	out.m4_recovery = round(mean(recovery), 2)
	out.m4_accuracy = round(all.filter((t) => t.correct).length / all.length, 3)
	return out
}

/** Shared severity coding for choice modules (§5 M5) */
function choiceFeatures(events, moduleId, prefix) {
	const out = {}
	const choices = events
		.filter((e) => e.event_type === "choice_made" && e.module === moduleId)
		.sort((a, b) => a.trial_index - b.trial_index)
	if (!choices.length) return out

	const weights = choices.map((e) => e.payload.weight)
	const maxW = 3
	out[prefix + "_severity"] = round(weights.reduce((s, w) => s + w, 0) / (maxW * weights.length), 4)
	out[prefix + "_escalation"] = round(
		slope(
			choices.map((_, i) => i + 1),
			weights,
		),
		4,
	)
	const severeLatencies = choices.filter((e) => e.payload.weight >= 2).map((e) => e.payload.decision_ms)
	out[prefix + "_latency"] = round(median(severeLatencies), 0)
	out[prefix + "_repertoire"] = new Set(choices.map((e) => e.payload.category)).size
	out[prefix + "_max_weight"] = Math.max(...weights)
	return out
}

/** M6 — social information processing (the highest-value module) */
function featuresM6(events) {
	const out = {}
	const answers = events.filter((e) => e.event_type === "vignette_answer")
	if (!answers.length) return out

	const byIntent = (intent) => answers.filter((a) => a.payload.intent === intent)

	// Validity checks first (§5 M6). If comprehension fails, HAB is not scored.
	const hostileSet = byIntent("hostile")
	const benignSet = byIntent("benign")
	const ambiguous = byIntent("ambiguous")

	const comprehensionFails = answers.filter((a) => a.payload.comprehension_correct === false).length
	out.m6_comprehension_fail_rate = round(comprehensionFails / answers.length, 3)

	out.m6_check_hostile = hostileSet.length ? round(hostileSet.filter((a) => a.payload.intent_response === "hostile").length / hostileSet.length, 3) : null
	out.m6_check_benign = benignSet.length ? round(benignSet.filter((a) => a.payload.intent_response === "hostile").length / benignSet.length, 3) : null

	let invalid = null
	if (out.m6_comprehension_fail_rate > 0.25) invalid = "sip_invalid"
	else if (out.m6_check_benign === 1) invalid = "indiscriminate_response"
	else if (out.m6_check_hostile === 0 && hostileSet.length >= 2) invalid = "sip_invalid"
	out.m6_validity_flag = invalid

	// m6_hab — hostile attributions / ambiguous vignettes  [primary D4]
	if (ambiguous.length) {
		const hostile = ambiguous.filter((a) => a.payload.intent_response === "hostile").length
		out.m6_hab = invalid ? null : round(hostile / ambiguous.length, 4)
		out.m6_anger_amb = round(mean(ambiguous.map((a) => a.payload.anger).filter((x) => x != null)), 2)
		out.m6_n_ambiguous = ambiguous.length
	}

	const weights = answers.map((a) => a.payload.choice_weight).filter((x) => x != null)
	out.m6_severity = weights.length ? round(weights.reduce((s, w) => s + w, 0) / (3 * weights.length), 4) : null

	// m6_expectancy — aggressive choices rated as producing a better outcome
	const aggressive = answers.filter((a) => a.payload.choice_weight >= 2)
	out.m6_expectancy = aggressive.length ? round(aggressive.filter((a) => a.payload.expected_outcome === "better").length / aggressive.length, 3) : null

	// m6_repertoire — distinct solution types in the open-ended step.
	// Keyword heuristic: PLACEHOLDER for human coding, flagged as such.
	const kinds = new Set()
	let openSeverity = 0
	let openN = 0
	for (const a of answers) {
		const text = String(a.payload.open_response || "").toLowerCase()
		if (!text.trim()) continue
		openN++
		let w = 0
		if (/\b(hit|punch|kick|hurt|smash|break|revenge|get back|payback)\b/.test(text)) {
			kinds.add("physical_aggression")
			w = 3
		} else if (/\b(shout|yell|insult|stupid|name|swear|rude|mean back)\b/.test(text)) {
			kinds.add("verbal_aggression")
			w = 2
		} else if (/\b(tell|teacher|adult|report|help)\b/.test(text)) {
			kinds.add("help_seeking")
			w = 0
		} else if (/\b(ask|talk|explain|say|sorry|calm|share)\b/.test(text)) {
			kinds.add("verbal_resolution")
			w = 1
		} else if (/\b(ignore|walk away|nothing|leave)\b/.test(text)) {
			kinds.add("avoidant")
			w = 0
		} else {
			kinds.add("other")
			w = 1
		}
		openSeverity += w
	}
	out.m6_repertoire = kinds.size
	out.m6_repertoire_coding = "keyword_placeholder"

	// m6_sdr — divergence between generated and selected severity
	if (openN && weights.length) {
		const openMean = openSeverity / openN / 3
		out.m6_sdr = round(Math.abs(openMean - out.m6_severity), 4)
	}
	return out
}

/** M7 — retaliation and consequence (optional module) */
function featuresM7(events) {
	const out = {}
	const rounds = events.filter((e) => e.event_type === "m7_round")
	if (!rounds.length) return out
	const aggressive = rounds.filter((r) => r.payload.weight >= 2)
	out.m7_n_rounds = rounds.length
	out.m7_repeat = aggressive.length ? round(aggressive.filter((r) => r.payload.would_repeat).length / aggressive.length, 3) : null
	out.m7_selfeval = aggressive.length ? round(mean(aggressive.map((r) => r.payload.fairness).filter((x) => x != null)), 2) : null
	out.m7_shift = round(mean(rounds.map((r) => (r.payload.repeat_weight ?? r.payload.weight) - r.payload.weight)), 3)
	return out
}

/* ------------------------------------------------------------------ *
 * Session-level QC + assembly
 * ------------------------------------------------------------------ */

function sessionQc(events, trials, features) {
	const flags = []
	const probes = events.filter((e) => e.event_type === "attention_probe")
	const probeFail = probes.filter((e) => e.payload.passed === false).length
	const probeRate = probes.length ? probeFail / probes.length : 0
	if (probes.length && probeRate > QC.PROBE_FAIL_MAX) flags.push("disengaged")

	const calib = events.find((e) => e.event_type === "calibration_result")
	const lag = calib ? calib.payload.input_lag_ms : null
	if (lag != null && lag >= QC.CALIB_LAG_MAX_MS) flags.push("rt_unreliable")

	if (events.some((e) => e.event_type === "distress_flag")) flags.push("distress_stop")
	if (features.m1_ssrt_flag === "ssrt_invalid") flags.push("ssrt_invalid")
	if (features.m6_validity_flag) flags.push(features.m6_validity_flag)
	if (!events.some((e) => e.event_type === "debrief_completed")) flags.push("debrief_missing")

	const excluded = trials.filter((t) => t.exclude).length

	// Split-half reliability on M1 go RTs (odd vs even trials), Spearman-Brown.
	const go = trials.filter((t) => t.module === "M1" && !t.exclude && t.rt_ms != null)
	let splitHalf = null
	if (go.length >= 20) {
		const odd = go.filter((_, i) => i % 2 === 1).map((t) => t.rt_ms)
		const even = go.filter((_, i) => i % 2 === 0).map((t) => t.rt_ms)
		const n = Math.min(odd.length, even.length)
		const a = odd.slice(0, n)
		const b = even.slice(0, n)
		const ma = mean(a)
		const mb = mean(b)
		let num = 0
		let da = 0
		let db = 0
		for (let i = 0; i < n; i++) {
			num += (a[i] - ma) * (b[i] - mb)
			da += (a[i] - ma) ** 2
			db += (b[i] - mb) ** 2
		}
		const r = da && db ? num / Math.sqrt(da * db) : 0
		splitHalf = round((2 * r) / (1 + r), 3)
		if (splitHalf != null && splitHalf < 0.6) flags.push("unreliable_session")
	}

	if (features.m1_rt_unreliable && flags.indexOf("rt_unreliable") === -1) flags.push("rt_unreliable")

	const reasons = {}
	for (const t of trials) {
		if (!t.exclude) continue
		const r = t.exclude_reason || "unspecified"
		reasons[r] = (reasons[r] || 0) + 1
	}

	return {
		flags,
		input_lag_ms: lag,
		frame_jitter_ms: calib ? calib.payload.frame_jitter_ms : null,
		attention_probe_fail_rate: round(probeRate, 3),
		probe_fail_rate: round(probeRate, 3),
		trials_total: trials.length,
		trials_excluded: excluded,
		exclusion_rate: trials.length ? round(excluded / trials.length, 3) : null,
		exclusion_reasons: reasons,
		focus_losses: events.filter((e) => e.event_type === "focus_lost").length,
		debrief_completed: events.some((e) => e.event_type === "debrief_completed"),
		split_half_m1: splitHalf,
		split_half_reliability: splitHalf,
	}
}

/**
 * L4 is intentionally disabled (§7.1). Standardised dimension scores require
 * normative parameters that do not exist before the validation study.
 */
const L4_ENABLED = false

function scoreSession(session, events) {
	const trials = buildTrials(events)
	const features = {
		...featuresM1(trials),
		...featuresM2(trials),
		...featuresM3(trials, events),
		...featuresM4(trials),
		...choiceFeatures(events, "M5", "m5"),
		...featuresM6(events),
		...featuresM7(events),
	}
	return {
		session,
		qc: sessionQc(events, trials, features),
		features,
		dimensions: L4_ENABLED ? {} : null,
		dimensions_note:
			"L4 standardised dimension scores are disabled until the validation study in \u00a78 produces age-banded norms. Raw features and sample-relative percentiles only.",
		schema_version: "1.0.0",
		scoring_version: "1.0.0",
	}
}

/* ------------------------------------------------------------------ *
 * Cohort views and exports
 * ------------------------------------------------------------------ */

function allScored(store) {
	return store
		.listSessions()
		.map((s) => {
			const events = store.readEvents(s.sessionId)
			if (!events.length) return null
			return scoreSession(s, events)
		})
		.filter(Boolean)
}

function percentileOf(values, x) {
	if (!values.length || x == null) return null
	const below = values.filter((v) => v < x).length
	return round((below / values.length) * 100, 1)
}

function cohortSummary(store) {
	const scored = allScored(store)
	const keys = new Set()
	for (const s of scored) for (const k of Object.keys(s.features)) if (typeof s.features[k] === "number") keys.add(k)

	const dist = {}
	for (const k of keys) {
		const vals = scored.map((s) => s.features[k]).filter((v) => typeof v === "number")
		dist[k] = { n: vals.length, mean: round(mean(vals), 4), sd: round(sd(vals), 4), median: round(median(vals), 4) }
	}

	const withPercentiles = scored.map((s) => {
		const p = {}
		for (const k of keys) {
			const vals = scored.map((x) => x.features[k]).filter((v) => typeof v === "number")
			p[k] = percentileOf(vals, s.features[k])
		}
		return { sessionId: s.session.sessionId, participantId: s.session.participantId, percentiles: p }
	})

	return { n_sessions: scored.length, distributions: dist, participants: withPercentiles, note: "Sample-relative percentiles, not norms." }
}

function csvEscape(v) {
	if (v === null || v === undefined) return ""
	const s = String(v)
	return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function featuresCsv(store) {
	const scored = allScored(store)
	const keys = new Set()
	for (const s of scored) for (const k of Object.keys(s.features)) keys.add(k)
	const cols = ["sessionId", "participantId", "ageBand", "profile", "startedAt", "qc_flags", "exclusion_rate", "input_lag_ms", ...[...keys].sort()]
	const rows = [cols.join(",")]
	for (const s of scored) {
		rows.push(
			[
				s.session.sessionId,
				s.session.participantId,
				s.session.ageBand,
				s.session.profile,
				s.session.startedAt,
				s.qc.flags.join("|"),
				s.qc.exclusion_rate,
				s.qc.input_lag_ms,
				...[...keys].sort().map((k) => s.features[k]),
			]
				.map(csvEscape)
				.join(","),
		)
	}
	return rows.join("\n")
}

function trialsCsv(store, sessionId) {
	const sessions = sessionId ? [store.getSession(sessionId)].filter(Boolean) : store.listSessions()
	const cols = [
		"sessionId",
		"participantId",
		"module",
		"block",
		"trial_index",
		"emotion",
		"level",
		"rule_epoch",
		"is_nogo",
		"is_stop",
		"is_rigged",
		"ssd_ms",
		"rt_ms",
		"outcome",
		"correct",
		"duration_ms",
		"quit",
		"interactions",
		"frame_jitter_ms",
		"exclude",
	]
	const rows = [cols.join(",")]
	for (const s of sessions) {
		const trials = buildTrials(store.readEvents(s.sessionId))
		for (const t of trials) {
			rows.push([s.sessionId, s.participantId, ...cols.slice(2).map((c) => t[c])].map(csvEscape).join(","))
		}
	}
	return rows.join("\n")
}

/* ------------------------------------------------------------------ *
 * Codebook — every metric with formula, units, direction, confounds
 * ------------------------------------------------------------------ */

const CODEBOOK = {
	m1_commission: { dim: "D1", formula: "commissions / no-go trials", units: "0-1", direction: "lower = better inhibition", confounds: "attention, fatigue, ADHD" },
	m1_dprime: { dim: "D1", formula: "z(H) - z(FA), log-linear corrected", units: "-3..5", direction: "higher = better discrimination", confounds: "vision, comprehension" },
	m1_ssrt: { dim: "D1", formula: "nth go RT - mean SSD (integration method)", units: "ms", direction: "lower = faster stopping", confounds: "requires p(respond) 0.25-0.75" },
	m1_rtcv: { dim: "D1", formula: "SD(goRT)/mean(goRT)", units: "ratio", direction: "lower = more consistent", confounds: "attention lapses" },
	m1_pes: { dim: "D1", formula: "meanRT(n+1|error) - meanRT(n+1|correct)", units: "ms", direction: "near zero = weak error monitoring", confounds: "trial count" },
	m1_emo_cost: { dim: "D2", formula: "commission(angry) - commission(neutral)", units: "-1..1", direction: "higher = anger-specific inhibition failure", confounds: "stimulus set validity" },
	m2_lisas: { dim: "D1", formula: "meanRT + (SD_RT/SD_PE) * PE", units: "ms-equivalent", direction: "lower = better", confounds: "gaming experience, device" },
	m2_decay: { dim: "D1", formula: "slope(LISAS ~ level)", units: "ms/level", direction: "higher = worse under pressure", confounds: "motivation" },
	m3_ttq: { dim: "D3", formula: "median(time to quit) on rigged trials", units: "s", direction: "non-monotonic: both extremes informative", confounds: "task interest" },
	m3_effort_auc: { dim: "D3", formula: "normalised cumulative interaction over rigged trials", units: "0-1", direction: "higher = more sustained effort", confounds: "motor style" },
	m3_anger_delta: { dim: "D3", formula: "anger(post-rigged) - anger(baseline)", units: "-4..4", direction: "higher = greater affective reactivity", confounds: "self-report floor" },
	m4_switch_cost: { dim: "D3", formula: "meanRT(3 after change) - meanRT(3 before)", units: "ms", direction: "higher = costlier switching", confounds: "rule salience" },
	m4_persev: { dim: "D3", formula: "consecutive old-rule responses after change", units: "trials", direction: "higher = more rigid", confounds: "learning rate" },
	m5_severity: { dim: "D5", formula: "sum(w) / (3 * n events)", units: "0-1", direction: "higher = more retaliatory", confounds: "social desirability" },
	m5_escalation: { dim: "D5", formula: "slope(w ~ event order)", units: "weight/event", direction: "positive = hardening", confounds: "few events" },
	m5_latency: { dim: "D5", formula: "median decision time where w >= 2", units: "ms", direction: "lower = more impulsive retaliation", confounds: "reading speed" },
	m6_hab: { dim: "D4", formula: "hostile attributions / ambiguous vignettes", units: "0-1", direction: "higher = stronger hostile attribution bias", confounds: "comprehension, culture; null if validity checks fail" },
	m6_anger_amb: { dim: "D4", formula: "mean anger rating, ambiguous vignettes", units: "1-5", direction: "higher = more anger under uncertainty", confounds: "scale use" },
	m6_expectancy: { dim: "D6", formula: "aggressive choices rated 'better outcome' / aggressive choices", units: "0-1", direction: "higher = proactive marker", confounds: "few aggressive choices" },
	m6_sdr: { dim: "covariate", formula: "|severity(open-ended) - severity(forced-choice)|", units: "0-1", direction: "higher = more impression management", confounds: "keyword coding is a placeholder" },
	m7_repeat: { dim: "D6", formula: "would-repeat / aggressive choices", units: "0-1", direction: "higher = stable retaliatory preference", confounds: "single event" },
}

module.exports = {
	buildTrials,
	scoreSession,
	cohortSummary,
	featuresCsv,
	trialsCsv,
	CODEBOOK,
	QC,
	_stats: { mean, sd, median, slope, probit },
}
