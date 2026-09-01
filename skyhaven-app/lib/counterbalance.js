/**
 * Deterministic counterbalancing (protocol §2.3 C10, §5 M6).
 *
 * Derived from a hash of the participant code so the same participant always
 * gets the same assignment, and the assignment cannot be re-rolled by
 * restarting the session.
 */

const crypto = require("crypto")

const EMOTION_ORDERS = [
	["neutral", "happy", "angry"],
	["neutral", "angry", "happy"],
	["happy", "neutral", "angry"],
	["happy", "angry", "neutral"],
	["angry", "neutral", "happy"],
	["angry", "happy", "neutral"],
]

// Baseline is always first and M7 always last (§4). Only the middle rotates.
const MODULE_ORDERS = [
	["M1", "M2", "M3", "M4", "M5", "M6"],
	["M1", "M2", "M5", "M6", "M3", "M4"],
	["M6", "M1", "M2", "M3", "M4", "M5"],
	["M1", "M6", "M3", "M4", "M2", "M5"],
]

function hashInt(str) {
	const h = crypto.createHash("sha256").update(String(str)).digest()
	return h.readUInt32BE(0)
}

/**
 * Vignette intent assignment. Each child sees each scenario once; which intent
 * version they see is rotated across participants so the design is balanced at
 * the sample level (§5 M6).
 *
 * 12 scenarios: 6 ambiguous (scored), 3 hostile + 3 benign (validity checks).
 */
function vignetteAssignment(seed, count) {
	const pattern = []
	for (let i = 0; i < count; i++) {
		const slot = (i + seed) % 4
		if (slot === 0 || slot === 1) pattern.push("ambiguous")
		else if (slot === 2) pattern.push("hostile")
		else pattern.push("benign")
	}
	return pattern
}

function forParticipant(participantId) {
	const seed = hashInt(participantId)
	return {
		seed,
		emotionOrder: EMOTION_ORDERS[seed % EMOTION_ORDERS.length],
		moduleOrder: MODULE_ORDERS[(seed >> 3) % MODULE_ORDERS.length],
		vignetteIntents: vignetteAssignment(seed % 4, 12),
	}
}

module.exports = { forParticipant, EMOTION_ORDERS, MODULE_ORDERS }
