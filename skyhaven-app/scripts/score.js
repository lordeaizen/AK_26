#!/usr/bin/env node
/**
 * Offline scorer / exporter. Reads the local event logs and prints a summary,
 * then writes CSV exports to data/exports/.
 *
 *   node scripts/score.js                 all sessions, summary table
 *   node scripts/score.js ses_abc123      one session, full feature dump
 */

const fs = require("fs")
const path = require("path")
const store = require("../lib/store")
const scoring = require("../lib/scoring")

store.init()

const target = process.argv[2]
const sessions = store.listSessions()

if (!sessions.length) {
	console.log("No sessions found. Play one at http://localhost:3000 or run: npm run simulate")
	process.exit(0)
}

function show(scored) {
	const s = scored.session
	console.log("")
	console.log("  " + s.sessionId + "  participant " + s.participantId + "  (" + s.ageBand + ", " + s.profile + ")")
	console.log("  events " + scored.event_count + "  trials " + scored.qc.trials_total + "  excluded " + scored.qc.trials_excluded)
	console.log("  QC flags: " + (scored.qc.flags.length ? scored.qc.flags.join(", ") : "none"))
	console.log("  " + scored.dimensions_note)
	console.log("")
	const keys = Object.keys(scored.features).sort()
	for (const k of keys) {
		const meta = scoring.CODEBOOK[k]
		const v = scored.features[k]
		console.log("    " + k.padEnd(28) + String(typeof v === "object" ? JSON.stringify(v) : v).padEnd(14) + (meta ? meta.label : ""))
	}
}

if (target) {
	const session = store.getSession(target)
	if (!session) {
		console.error("Unknown session: " + target)
		process.exit(1)
	}
	show(scoring.scoreSession(session, store.readEvents(target)))
} else {
	console.log("")
	console.log("  session            participant   trials  excl  flags")
	console.log("  " + "-".repeat(70))
	for (const s of sessions) {
		const events = store.readEvents(s.sessionId)
		if (!events.length) continue
		const r = scoring.scoreSession(s, events)
		console.log(
			"  " + s.sessionId.padEnd(18) + String(s.participantId).padEnd(13) + String(r.qc.trials_total).padEnd(8) + String(r.qc.trials_excluded).padEnd(6) + (r.qc.flags.join(",") || "none"),
		)
	}
	console.log("")
	console.log("  Run: node scripts/score.js <sessionId>  for the full feature dump.")
}

const outDir = path.join(store.ROOT, "exports")
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, "features.csv"), scoring.featuresCsv(store))
fs.writeFileSync(path.join(outDir, "trials.csv"), scoring.trialsCsv(store))
console.log("")
console.log("  Wrote data/exports/features.csv and data/exports/trials.csv")
console.log("")
