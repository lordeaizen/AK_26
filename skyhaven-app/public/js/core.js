/* Skyhaven core: config, telemetry, timing, UI primitives, stimuli.
 * No frameworks, no build step. */

window.Sky = window.Sky || {}

/* ------------------------------------------------------------------ *
 * 1. Run profiles
 *  demo = playable in ~8 minutes, for testing the pipeline end to end
 *  full = the trial counts specified in the protocol (§5)
 * ------------------------------------------------------------------ */
Sky.PROFILES = {
	demo: {
		label: "Demo (~8 min)",
		m1TrialsPerBlock: 32,
		m1Practice: 8,
		m2TrialsPerLevel: 6,
		m3Trials: 6,
		m3RiggedIndexes: [2, 4],
		m3CapMs: 20000,
		m4TrialsPerEpoch: 8,
		m4Epochs: 4,
		m5Events: 6,
		m6Vignettes: 6,
		washoutMs: 15000,
	},
	full: {
		label: "Full protocol (~38 min)",
		m1TrialsPerBlock: 160,
		m1Practice: 16,
		m2TrialsPerLevel: 20,
		m3Trials: 8,
		m3RiggedIndexes: [2, 4, 5],
		m3CapMs: 45000,
		m4TrialsPerEpoch: 12,
		m4Epochs: 4,
		m5Events: 6,
		m6Vignettes: 12,
		washoutMs: 90000,
	},
}

Sky.cfg = Sky.PROFILES.demo

/* Fixed task parameters (§5). Changing these changes the instrument. */
Sky.PARAMS = {
	m1: { goRatio: 0.75, stopFraction: 0.25, stimMs: 500, windowMs: 1000, itiMin: 800, itiMax: 1400, ssdStart: 250, ssdStep: 50, ssdMin: 50, ssdMax: 800 },
	m2: { levels: [1.0, 1.25, 1.5, 1.8, 2.2], baseTravelMs: 2600, decoyFromLevel: 3 },
	m3: { keyCount: 4, riggedKeyCount: 3 },
	m5: { weights: { ignore: 0, help: 0, assert: 1, instrumental: 2, retaliate: 3 } },
}

/* ------------------------------------------------------------------ *
 * 2. Timing quality monitor
 * ------------------------------------------------------------------ */
Sky.quality = { frame_jitter_ms: null, input_lag_ms: null, window_focused: true, refresh_hz: null }

;(function frameMonitor() {
	var last = null
	var deltas = []
	function tick(t) {
		if (last != null) {
			deltas.push(t - last)
			if (deltas.length > 90) deltas.shift()
			var m = deltas.reduce(function (s, x) {
				return s + x
			}, 0) / deltas.length
			var j = deltas.reduce(function (s, x) {
				return s + Math.abs(x - m)
			}, 0) / deltas.length
			Sky.quality.frame_jitter_ms = Math.round(j * 100) / 100
			Sky.quality.refresh_hz = Math.round(1000 / m)
		}
		last = t
		requestAnimationFrame(tick)
	}
	requestAnimationFrame(tick)
})()

window.addEventListener("blur", function () {
	Sky.quality.window_focused = false
	if (Sky.T && Sky.T.sessionId) Sky.T.event("focus_lost", {})
})
window.addEventListener("focus", function () {
	Sky.quality.window_focused = true
	if (Sky.T && Sky.T.sessionId) Sky.T.event("focus_gained", {})
})

/* Input lag proxy: delay between the OS event timestamp and our handler. */
document.addEventListener(
	"pointerdown",
	function (ev) {
		if (typeof ev.timeStamp === "number" && ev.timeStamp > 0) {
			var lag = performance.now() - ev.timeStamp
			if (lag >= 0 && lag < 500) {
				Sky.quality.input_lag_ms = Sky.quality.input_lag_ms == null ? lag : Sky.quality.input_lag_ms * 0.8 + lag * 0.2
			}
		}
	},
	true,
)

/* ------------------------------------------------------------------ *
 * 3. Telemetry — buffered, idempotent, offline-tolerant (§6.4)
 * ------------------------------------------------------------------ */
var CACHE_KEY = "skyhaven_pending_events"

Sky.T = {
	sessionId: null,
	participantId: null,
	ctx: { module: "session", block: null, trial_index: 0 },
	buffer: [],
	sending: false,

	newId: function () {
		return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
	},

	start: function (session) {
		this.sessionId = session.sessionId
		this.participantId = session.participantId
		try {
			var pending = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]")
			if (pending.length) this.buffer = pending.concat(this.buffer)
		} catch (e) {}
		var self = this
		setInterval(function () {
			self.flush()
		}, 3000)
		window.addEventListener("beforeunload", function () {
			self.persist()
		})
	},

	setContext: function (ctx) {
		this.ctx = Object.assign({}, this.ctx, ctx)
	},

	event: function (type, payload, override) {
		var ctx = Object.assign({}, this.ctx, override || {})
		var ev = {
			event_id: this.newId(),
			session_id: this.sessionId,
			participant_id: this.participantId,
			module: ctx.module,
			block: ctx.block,
			trial_index: ctx.trial_index,
			event_type: type,
			t_client_mono: Math.round(performance.now() * 100) / 100,
			t_client_wall: new Date().toISOString(),
			payload: payload || {},
			quality: {
				frame_jitter_ms: Sky.quality.frame_jitter_ms,
				input_lag_ms: Sky.quality.input_lag_ms == null ? null : Math.round(Sky.quality.input_lag_ms * 10) / 10,
				window_focused: Sky.quality.window_focused,
			},
			schema_version: "1.0.0",
		}
		this.buffer.push(ev)
		if (this.buffer.length >= 40) this.flush()
		return ev
	},

	persist: function () {
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify(this.buffer))
		} catch (e) {}
	},

	flush: function () {
		if (this.sending || !this.buffer.length || !this.sessionId) return Promise.resolve()
		var batch = this.buffer.slice()
		this.sending = true
		var self = this
		return fetch("/api/events", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionId: this.sessionId, events: batch }),
		})
			.then(function (r) {
				if (!r.ok) throw new Error("bad status " + r.status)
				// remove exactly what we sent; anything added meanwhile stays queued
				var sent = {}
				batch.forEach(function (e) {
					sent[e.event_id] = 1
				})
				self.buffer = self.buffer.filter(function (e) {
					return !sent[e.event_id]
				})
				try {
					localStorage.removeItem(CACHE_KEY)
				} catch (e) {}
			})
			.catch(function () {
				self.persist() // keep for retry; server dedupes by event_id
			})
			.then(function () {
				self.sending = false
			})
	},
}

/* ------------------------------------------------------------------ *
 * 4. Deterministic RNG (seeded per participant)
 * ------------------------------------------------------------------ */
Sky.rng = (function () {
	var s = 12345
	return {
		seed: function (n) {
			s = (n >>> 0) || 12345
		},
		next: function () {
			s ^= s << 13
			s >>>= 0
			s ^= s >> 17
			s ^= s << 5
			s >>>= 0
			return s / 4294967296
		},
		int: function (min, max) {
			return min + Math.floor(this.next() * (max - min + 1))
		},
		pick: function (arr) {
			return arr[Math.floor(this.next() * arr.length)]
		},
		shuffle: function (arr) {
			var a = arr.slice()
			for (var i = a.length - 1; i > 0; i--) {
				var j = Math.floor(this.next() * (i + 1))
				var t = a[i]
				a[i] = a[j]
				a[j] = t
			}
			return a
		},
	}
})()

/* ------------------------------------------------------------------ *
 * 5. UI primitives
 * ------------------------------------------------------------------ */
Sky.ui = {
	stage: function () {
		return document.getElementById("stage")
	},

	el: function (tag, attrs, children) {
		var n = document.createElement(tag)
		attrs = attrs || {}
		for (var k in attrs) {
			if (k === "class") n.className = attrs[k]
			else if (k === "html") n.innerHTML = attrs[k]
			else if (k === "text") n.textContent = attrs[k]
			else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2).toLowerCase(), attrs[k])
			else if (k === "style") n.setAttribute("style", attrs[k])
			else n.setAttribute(k, attrs[k])
		}
		;(children || []).forEach(function (c) {
			if (c == null) return
			n.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
		})
		return n
	},

	clear: function () {
		var s = this.stage()
		while (s.firstChild) s.removeChild(s.firstChild)
		return s
	},

	show: function (nodes) {
		var s = this.clear()
		;(Array.isArray(nodes) ? nodes : [nodes]).forEach(function (n) {
			if (n) s.appendChild(n)
		})
		return s
	},

	hud: function (text, sub) {
		document.getElementById("hud-title").textContent = text || ""
		document.getElementById("hud-sub").textContent = sub || ""
	},

	progress: function (pct) {
		document.getElementById("progress-fill").style.width = Math.max(0, Math.min(100, pct)) + "%"
	},

	/** A full-screen card with a title, body nodes and one or more buttons. */
	card: function (opts) {
		var ui = this
		var btns = (opts.buttons || []).map(function (b) {
			return ui.el("button", { class: "btn " + (b.kind || "primary"), onclick: b.onClick }, [b.label])
		})
		return ui.el("div", { class: "card" }, [
			opts.eyebrow ? ui.el("div", { class: "eyebrow", text: opts.eyebrow }) : null,
			opts.title ? ui.el("h2", { text: opts.title }) : null,
			opts.bodyHtml ? ui.el("div", { class: "body", html: opts.bodyHtml }) : null,
			opts.body || null,
			btns.length ? ui.el("div", { class: "btn-row" }, btns) : null,
		])
	},

	/** Await a single button press on a simple message screen. */
	prompt: function (opts) {
		var ui = this
		return new Promise(function (resolve) {
			var buttons = (opts.buttons || [{ label: "Continue", value: "ok" }]).map(function (b) {
				return {
					label: b.label,
					kind: b.kind,
					onClick: function () {
						resolve(b.value === undefined ? b.label : b.value)
					},
				}
			})
			ui.show(ui.card({ eyebrow: opts.eyebrow, title: opts.title, bodyHtml: opts.bodyHtml, body: opts.body, buttons: buttons }))
		})
	},
}

Sky.sleep = function (ms) {
	return new Promise(function (r) {
		setTimeout(r, ms)
	})
}

/* ------------------------------------------------------------------ *
 * 6. Stimuli
 *
 * IMPORTANT (§10 limitation L3): these are schematic, code-drawn faces.
 * They are NOT a validated affect stimulus set. Before any research use,
 * replace faceSVG() with licensed images from a validated child-appropriate
 * set (e.g. NIMH-ChEFS, CAFE, Radboud Faces) and re-run the validity study.
 * ------------------------------------------------------------------ */
Sky.faceSVG = function (emotion, size) {
	size = size || 190
	var brow, mouth, skin
	if (emotion === "angry") {
		brow = '<path d="M28 38 L48 46" /><path d="M92 38 L72 46" />'
		mouth = '<path d="M40 90 Q60 76 80 90" />'
		skin = "#f6d5c4"
	} else if (emotion === "happy") {
		brow = '<path d="M30 40 Q39 34 48 40" /><path d="M72 40 Q81 34 90 40" />'
		mouth = '<path d="M38 82 Q60 102 82 82" />'
		skin = "#f6d5c4"
	} else {
		brow = '<path d="M30 40 L48 40" /><path d="M72 40 L90 40" />'
		mouth = '<path d="M42 88 L78 88" />'
		skin = "#f6d5c4"
	}
	return (
		'<svg viewBox="0 0 120 130" width="' +
		size +
		'" height="' +
		size * 1.08 +
		'" aria-label="' +
		emotion +
		' face">' +
		'<ellipse cx="60" cy="65" rx="46" ry="56" fill="' +
		skin +
		'" stroke="#2b2b3a" stroke-width="3"/>' +
		'<circle cx="42" cy="58" r="6" fill="#2b2b3a"/><circle cx="78" cy="58" r="6" fill="#2b2b3a"/>' +
		'<g stroke="#2b2b3a" stroke-width="5" fill="none" stroke-linecap="round">' +
		brow +
		mouth +
		"</g></svg>"
	)
}

/* Pictorial 1-5 rating (SAM-style), returns the chosen value and logs it. */
Sky.rate = function (opts) {
	var ui = Sky.ui
	return new Promise(function (resolve) {
		var t0 = performance.now()
		var row = ui.el("div", { class: "scale-row" })
		var labels = opts.labels || ["Not at all", "A little", "Medium", "A lot", "Very much"]
		for (var i = 1; i <= 5; i++) {
			;(function (v) {
				var level = ["happy", "neutral", "neutral", "angry", "angry"][v - 1]
				var b = ui.el("button", {
					class: "scale-btn",
					onclick: function () {
						Sky.T.event("rating_given", {
							scale: opts.scale,
							point: opts.point,
							value: v,
							decision_ms: Math.round(performance.now() - t0),
						})
						resolve(v)
					},
				})
				b.innerHTML = '<span class="scale-face">' + Sky.faceSVG(level, 54) + "</span>"
				b.appendChild(ui.el("span", { class: "scale-label", text: labels[v - 1] }))
				row.appendChild(b)
			})(i)
		}
		ui.show(ui.card({ eyebrow: opts.eyebrow || "How do you feel?", title: opts.question, body: row }))
	})
}

/* Short beep for the stop signal (Web Audio, no asset files). */
Sky.beep = function (freq, ms) {
	try {
		Sky._ac = Sky._ac || new (window.AudioContext || window.webkitAudioContext)()
		var ac = Sky._ac
		var osc = ac.createOscillator()
		var gain = ac.createGain()
		osc.frequency.value = freq || 880
		gain.gain.value = 0.08
		osc.connect(gain).connect(ac.destination)
		osc.start()
		osc.stop(ac.currentTime + (ms || 120) / 1000)
	} catch (e) {}
}

/**
 * Response window used by the timed tasks.
 * Resolves as soon as the child taps/presses space, or when the window closes.
 */
Sky.awaitResponse = function (windowMs, opts) {
	opts = opts || {}
	return new Promise(function (resolve) {
		var done = false
		var t0 = opts.t0 == null ? performance.now() : opts.t0

		function finish(responded, ev) {
			if (done) return
			done = true
			clearTimeout(timer)
			document.removeEventListener("pointerdown", onTap)
			document.removeEventListener("keydown", onKey)
			resolve({
				responded: responded,
				rt_ms: responded ? Math.round((performance.now() - t0) * 10) / 10 : null,
				pointer: responded ? (ev && ev.pointerType) || "key" : null,
				target: responded && ev ? ev.target : null,
			})
		}
		function onTap(ev) {
			if (ev.target.closest && ev.target.closest(".no-capture")) return
			finish(true, ev)
		}
		function onKey(ev) {
			if (ev.code === "Space") {
				ev.preventDefault()
				finish(true, ev)
			}
		}
		var timer = setTimeout(function () {
			finish(false, null)
		}, windowMs)
		document.addEventListener("pointerdown", onTap)
		document.addEventListener("keydown", onKey)
	})
}
