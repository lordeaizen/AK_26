/**
 * Skyhaven — research server
 * Zero external dependencies. Node 18+.
 *
 * Implements the storage contract from the protocol (§6):
 *   L1 event store  -> data/events/<sessionId>.jsonl   (append-only, immutable)
 *   L2 trial table  -> reconstructed on demand by lib/scoring.js
 *   L3 features     -> computed on demand, never stored as source of truth
 *   L4 dimensions   -> DISABLED until norms exist (§7.1)
 */

const http = require("http")
const fs = require("fs")
const path = require("path")
const url = require("url")

const store = require("./lib/store")
const scoring = require("./lib/scoring")
const counterbalance = require("./lib/counterbalance")

const PORT = process.env.PORT || 3000
const PUBLIC_DIR = path.join(__dirname, "public")

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
}

function send(res, status, body, type) {
	res.writeHead(status, {
		"Content-Type": type || "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	})
	res.end(body)
}

function sendJson(res, status, obj) {
	send(res, status, JSON.stringify(obj, null, 2))
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let raw = ""
		let size = 0
		req.on("data", (c) => {
			size += c.length
			if (size > 8 * 1024 * 1024) {
				req.destroy()
				reject(new Error("payload too large"))
				return
			}
			raw += c
		})
		req.on("end", () => {
			if (!raw) return resolve({})
			try {
				resolve(JSON.parse(raw))
			} catch (e) {
				reject(new Error("invalid JSON body"))
			}
		})
		req.on("error", reject)
	})
}

function serveStatic(req, res, pathname) {
	const rel = pathname === "/" ? "/index.html" : pathname
	const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""))
	if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden", "text/plain")
	fs.readFile(filePath, (err, data) => {
		if (err) return send(res, 404, "Not found", "text/plain")
		send(res, 200, data, MIME[path.extname(filePath)] || "application/octet-stream")
	})
}

const server = http.createServer(async (req, res) => {
	const parsed = url.parse(req.url, true)
	const pathname = parsed.pathname

	try {
		/* ---------------- API ---------------- */

		// Start a session. Counterbalancing is decided server-side so it cannot
		// be influenced by the device or by a re-load (protocol §2.3 C10).
		if (req.method === "POST" && pathname === "/api/session/start") {
			const body = await readBody(req)
			const participantId = String(body.participantId || "").trim()
			if (!participantId) return sendJson(res, 400, { error: "participantId is required" })

			const session = store.createSession({
				participantId,
				ageBand: body.ageBand || "unknown",
				profile: body.profile === "full" ? "full" : "demo",
				m7Consented: !!body.m7Consented,
				operator: body.operator || "unspecified",
			})
			const assignment = counterbalance.forParticipant(participantId)
			store.patchSession(session.sessionId, { assignment })
			return sendJson(res, 200, { ...session, assignment })
		}

		// Append events. Idempotent: replaying the same event_id is a no-op,
		// so offline buffering + reconnect cannot duplicate data (§6.4).
		if (req.method === "POST" && pathname === "/api/events") {
			const body = await readBody(req)
			const sessionId = body.sessionId
			const events = Array.isArray(body.events) ? body.events : []
			if (!sessionId) return sendJson(res, 400, { error: "sessionId is required" })
			const result = store.appendEvents(sessionId, events)
			return sendJson(res, 200, result)
		}

		if (req.method === "POST" && pathname === "/api/session/end") {
			const body = await readBody(req)
			if (!body.sessionId) return sendJson(res, 400, { error: "sessionId is required" })
			store.patchSession(body.sessionId, {
				endedAt: new Date().toISOString(),
				completed: !!body.completed,
				stoppedEarly: !!body.stoppedEarly,
				distress: !!body.distress,
			})
			return sendJson(res, 200, { ok: true })
		}

		if (req.method === "GET" && pathname === "/api/sessions") {
			return sendJson(res, 200, { sessions: store.listSessions() })
		}

		if (req.method === "GET" && pathname.startsWith("/api/score/")) {
			const sessionId = decodeURIComponent(pathname.slice("/api/score/".length))
			const events = store.readEvents(sessionId)
			if (!events.length) return sendJson(res, 404, { error: "no events for session" })
			return sendJson(res, 200, scoring.scoreSession(store.getSession(sessionId), events))
		}

		// Sample-relative percentiles across all sessions. Deliberately NOT
		// z-scores: no normative sample exists yet (§7.1).
		if (req.method === "GET" && pathname === "/api/cohort") {
			return sendJson(res, 200, scoring.cohortSummary(store))
		}

		if (req.method === "GET" && pathname === "/api/export/features.csv") {
			const csv = scoring.featuresCsv(store)
			return send(res, 200, csv, "text/csv; charset=utf-8")
		}

		if (req.method === "GET" && pathname === "/api/export/trials.csv") {
			const sessionId = parsed.query.session
			const csv = scoring.trialsCsv(store, sessionId)
			return send(res, 200, csv, "text/csv; charset=utf-8")
		}

		if (req.method === "GET" && pathname === "/api/export/events.jsonl") {
			const sessionId = parsed.query.session
			const events = store.readEvents(sessionId)
			return send(
				res,
				200,
				events.map((e) => JSON.stringify(e)).join("\n"),
				"application/x-ndjson; charset=utf-8",
			)
		}

		if (req.method === "GET" && pathname === "/api/codebook") {
			return sendJson(res, 200, scoring.CODEBOOK)
		}

		if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "unknown endpoint" })

		/* ---------------- Static ---------------- */
		if (req.method === "GET") return serveStatic(req, res, pathname)
		return send(res, 405, "Method not allowed", "text/plain")
	} catch (err) {
		console.error("[skyhaven]", err)
		return sendJson(res, 500, { error: String(err.message || err) })
	}
})

store.init()
server.listen(PORT, () => {
	console.log("")
	console.log("  Skyhaven research build")
	console.log("  ------------------------------------------")
	console.log("  Game        http://localhost:" + PORT + "/")
	console.log("  Dashboard   http://localhost:" + PORT + "/dashboard.html")
	console.log("  Data        ./data/events/*.jsonl  (append-only)")
	console.log("")
	console.log("  Reminder: synthetic stimuli, no norms, L4 scoring disabled.")
	console.log("  Not for use with real participants without ethics approval.")
	console.log("")
})
