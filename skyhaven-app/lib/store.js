/**
 * L1 event store + session index.
 *
 * Design rules from the protocol:
 *  - events are append-only and never mutated
 *  - event_id is a client-generated idempotency key
 *  - the identity vault (L0) is NOT implemented here on purpose; this store
 *    holds pseudonymous participant codes only.
 */

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const ROOT = path.join(__dirname, "..", "data")
const EVENT_DIR = path.join(ROOT, "events")
const SESSION_FILE = path.join(ROOT, "sessions.json")

/** sessionId -> Set(event_id) for idempotency */
const seen = new Map()

function init() {
	fs.mkdirSync(EVENT_DIR, { recursive: true })
	if (!fs.existsSync(SESSION_FILE)) fs.writeFileSync(SESSION_FILE, "[]")
}

function safeId(id) {
	return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "")
}

function eventFile(sessionId) {
	return path.join(EVENT_DIR, safeId(sessionId) + ".jsonl")
}

function readSessions() {
	try {
		return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"))
	} catch (e) {
		return []
	}
}

function writeSessions(list) {
	fs.writeFileSync(SESSION_FILE, JSON.stringify(list, null, 2))
}

function createSession(meta) {
	const sessionId = "ses_" + crypto.randomBytes(5).toString("hex")
	const record = {
		sessionId,
		participantId: meta.participantId,
		ageBand: meta.ageBand,
		profile: meta.profile,
		m7Consented: meta.m7Consented,
		operator: meta.operator,
		startedAt: new Date().toISOString(),
		endedAt: null,
		completed: false,
		stoppedEarly: false,
		distress: false,
		schemaVersion: "1.0.0",
	}
	const list = readSessions()
	list.push(record)
	writeSessions(list)
	fs.writeFileSync(eventFile(sessionId), "")
	seen.set(sessionId, new Set())
	return record
}

function patchSession(sessionId, patch) {
	const list = readSessions()
	const idx = list.findIndex((s) => s.sessionId === sessionId)
	if (idx === -1) return null
	list[idx] = { ...list[idx], ...patch }
	writeSessions(list)
	return list[idx]
}

function getSession(sessionId) {
	return readSessions().find((s) => s.sessionId === sessionId) || null
}

function listSessions() {
	return readSessions().sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
}

function loadSeen(sessionId) {
	if (seen.has(sessionId)) return seen.get(sessionId)
	const set = new Set()
	for (const e of readEvents(sessionId)) set.add(e.event_id)
	seen.set(sessionId, set)
	return set
}

function appendEvents(sessionId, events) {
	const file = eventFile(sessionId)
	if (!fs.existsSync(file)) return { accepted: 0, duplicates: 0, error: "unknown session" }
	const set = loadSeen(sessionId)
	const recvIso = new Date().toISOString()
	let accepted = 0
	let duplicates = 0
	const lines = []

	for (const ev of events) {
		if (!ev || !ev.event_id) continue
		if (set.has(ev.event_id)) {
			duplicates++
			continue
		}
		set.add(ev.event_id)
		lines.push(JSON.stringify({ ...ev, session_id: sessionId, t_server_recv: recvIso }))
		accepted++
	}
	if (lines.length) fs.appendFileSync(file, lines.join("\n") + "\n")
	return { accepted, duplicates }
}

function readEvents(sessionId) {
	const file = eventFile(sessionId)
	if (!fs.existsSync(file)) return []
	return fs
		.readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line)
			} catch (e) {
				return null
			}
		})
		.filter(Boolean)
}

module.exports = {
	init,
	createSession,
	patchSession,
	getSession,
	listSessions,
	appendEvents,
	readEvents,
}
