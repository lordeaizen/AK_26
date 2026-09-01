/* M6 stimulus set: 12 Skyhaven-world scenarios, each written in three intent
 * versions. Which version a child sees is assigned server-side
 * (lib/counterbalance.js) so the design is balanced across the sample.
 *
 * ambiguous = cause genuinely unclear   -> scored for hostile attribution bias
 * hostile   = intent unambiguously mean -> validity check (should be read as hostile)
 * benign    = clearly an accident       -> validity check (should NOT be read as hostile)
 *
 * Every version keeps the outcome identical and changes only the cue about
 * intent — the manipulation the HAB literature requires.
 */

window.Sky = window.Sky || {}

Sky.VIGNETTES = [
	{
		id: "v01_bridge",
		title: "The rope bridge",
		base: "You are crossing the rope bridge to Cloud Market carrying your basket of sky-berries. Another flyer, Tem, moves past you and your basket tips. The berries fall through the clouds.",
		versions: {
			ambiguous: "You did not see how it happened. Tem keeps flying and does not look back.",
			hostile: "You clearly see Tem look straight at your basket, grin, and knock it hard with an elbow.",
			benign: "You clearly see a gust of wind push Tem sideways, and Tem calls out 'Sorry! I lost control!'",
		},
		comprehension: { q: "What happened to your berries?", options: ["They fell through the clouds", "You gave them to Tem", "You ate them"], correct: 0 },
	},
	{
		id: "v02_team",
		title: "The lantern team",
		base: "Two teams are being picked for the Lantern Race. You wait to be chosen. When the teams are read out, your name is not on either list.",
		versions: {
			ambiguous: "The team captains are talking quietly and do not look over at you.",
			hostile: "You hear a captain say loudly, 'Don't pick them, they always ruin it.'",
			benign: "A captain runs over: 'Your name got smudged on the list — you're with us!' but the race has already started.",
		},
		comprehension: { q: "What happened in the story?", options: ["You were left off the team lists", "You won the race", "You picked the teams"], correct: 0 },
	},
	{
		id: "v03_credit",
		title: "The stolen credit",
		base: "You spent two days building the wind-vane for the Sky Fair. At the fair, Rill is standing beside it explaining how it works, and the judge writes Rill's name on the prize card.",
		versions: {
			ambiguous: "You do not hear what Rill said to the judge before you arrived.",
			hostile: "You hear Rill say clearly, 'I built all of it myself — nobody helped me.'",
			benign: "You hear Rill say, 'This was mostly my friend's work,' but the judge writes the wrong name anyway.",
		},
		comprehension: { q: "Whose name went on the prize card?", options: ["Rill's", "Yours", "The judge's"], correct: 0 },
	},
	{
		id: "v04_bump",
		title: "The market crowd",
		base: "You are carrying a glass sky-lamp through the busy Cloud Market. Someone bumps into you from behind and the lamp cracks.",
		versions: {
			ambiguous: "You turn around and see several people walking past. You cannot tell who did it.",
			hostile: "You turn around and see Bex, who says, 'That's what you get,' and walks off laughing.",
			benign: "You turn around and see Bex tripping over a loose rope, saying, 'Oh no, are you okay?'",
		},
		comprehension: { q: "What happened to the lamp?", options: ["It cracked", "You sold it", "It flew away"], correct: 0 },
	},
	{
		id: "v05_laugh",
		title: "The laughing group",
		base: "You walk into the workshop where a group of children are talking. As you come in, they stop and start laughing.",
		versions: {
			ambiguous: "You cannot hear what they were talking about before you arrived.",
			hostile: "You hear one of them say your name and then imitate the way you walk.",
			benign: "You hear the end of a joke about a goat wearing goggles, and one of them waves you over to join.",
		},
		comprehension: { q: "What did the group do when you came in?", options: ["They laughed", "They left", "They gave you a gift"], correct: 0 },
	},
	{
		id: "v06_turn",
		title: "The skipped turn",
		base: "You have been waiting a long time for your turn on the glider. When the keeper calls the next name, someone else steps up and flies instead of you.",
		versions: {
			ambiguous: "The keeper is busy with the ropes and does not look at the list.",
			hostile: "The other child looks at you, says 'Too slow,' and pushes in front.",
			benign: "The keeper apologises: 'I read the list upside down — you're next, I promise.'",
		},
		comprehension: { q: "Who used the glider?", options: ["Someone else", "You", "Nobody"], correct: 0 },
	},
	{
		id: "v07_blame",
		title: "The broken gate",
		base: "The workshop gate is broken. The keeper looks around the room and says your name as the one who must have done it. You did not touch the gate.",
		versions: {
			ambiguous: "You do not know why the keeper picked your name.",
			hostile: "Another child points at you and says, 'It was definitely them,' while smirking at you.",
			benign: "The keeper explains that your tool bag was found next to the gate, and asks if you know anything.",
		},
		comprehension: { q: "Who was blamed for the gate?", options: ["You", "The keeper", "Nobody"], correct: 0 },
	},
	{
		id: "v08_message",
		title: "The unanswered message",
		base: "You send a sky-note to your friend asking to meet at the tower after the bell. The bell rings and you wait. Your friend does not come and does not reply.",
		versions: {
			ambiguous: "You do not know whether the note arrived.",
			hostile: "Later you see your friend at the market with someone else, holding your note, saying 'I just didn't feel like it.'",
			benign: "Later you find your note still stuck in the delivery chute — it never left the tower.",
		},
		comprehension: { q: "What happened at the tower?", options: ["Your friend did not come", "Your friend came early", "You forgot to go"], correct: 0 },
	},
	{
		id: "v09_score",
		title: "The competition score",
		base: "You and Kessa both finish the sky-course. The scorekeeper announces that Kessa won by one point. You were sure you were ahead.",
		versions: {
			ambiguous: "You did not see the scoreboard during the last lap.",
			hostile: "You see Kessa quietly change a number on the board while the scorekeeper looks away.",
			benign: "The scorekeeper shows you the recording, and Kessa really did cross first by a hand's width.",
		},
		comprehension: { q: "Who was announced as the winner?", options: ["Kessa", "You", "Both of you"], correct: 0 },
	},
	{
		id: "v10_spill",
		title: "The spilled paint",
		base: "You are finishing your banner for the festival. Someone walks past your table and blue paint spills across the middle of it.",
		versions: {
			ambiguous: "You were looking down at your brush and did not see how the pot tipped.",
			hostile: "You see the person pick up the pot, tip it over your banner on purpose, and walk away.",
			benign: "You see the person catch their sleeve on the pot, and they immediately start helping you clean it.",
		},
		comprehension: { q: "What happened to your banner?", options: ["Paint spilled on it", "It won a prize", "It blew away"], correct: 0 },
	},
	{
		id: "v11_seat",
		title: "The saved seat",
		base: "At the story circle you leave your cushion for a moment to get water. When you come back, someone else is sitting on it and your things are on the floor.",
		versions: {
			ambiguous: "The other child is looking at the storyteller and does not turn around.",
			hostile: "The other child says, 'I moved your stuff. It's my seat now,' and turns their back.",
			benign: "The other child jumps up: 'I didn't know this was taken — here, I'll help you pick your things up.'",
		},
		comprehension: { q: "What did you find when you came back?", options: ["Someone in your seat", "Your seat empty", "The circle finished"], correct: 0 },
	},
	{
		id: "v12_tool",
		title: "The missing tool",
		base: "Your favourite wind-spanner is missing from your bench. Later you see it in Doran's tool roll.",
		versions: {
			ambiguous: "You do not know how it got there. Doran is working quietly and has not mentioned it.",
			hostile: "Doran sees you looking and says, 'Finders keepers. Try to take it back.'",
			benign: "Doran walks over: 'I found this on the floor by the door — I was about to ask whose it was.'",
		},
		comprehension: { q: "Where did you see your spanner?", options: ["In Doran's tool roll", "In the river", "On your bench"], correct: 0 },
	},
]

/* Forced-choice response options (§5 M6, severity weights from Appendix A).
 * 0 = non-aggressive / help-seeking, 1 = assertive verbal,
 * 2 = instrumental / indirect retaliation, 3 = direct retaliation. */
Sky.VIGNETTE_ACTIONS = [
	{ id: "ignore", label: "Say nothing and carry on", category: "avoidant", weight: 0 },
	{ id: "ask", label: "Ask them what happened", category: "verbal_resolution", weight: 1 },
	{ id: "adult", label: "Tell the keeper or an adult", category: "help_seeking", weight: 0 },
	{ id: "exclude", label: "Leave them out of the next game", category: "instrumental", weight: 2 },
	{ id: "getback", label: "Do the same thing back to them", category: "retaliation", weight: 3 },
]

/* M5 in-world provocation choices (same weighting scheme). */
Sky.PROVOCATION_ACTIONS = [
	{ id: "ignore", label: "Ignore it and keep going", category: "avoidant", weight: 0 },
	{ id: "help", label: "Ask the keeper for help", category: "help_seeking", weight: 0 },
	{ id: "complain", label: "Tell them to stop", category: "assertive", weight: 1 },
	{ id: "block", label: "Block their path so they lose time", category: "instrumental", weight: 2 },
	{ id: "even", label: "Knock their lantern down too", category: "retaliation", weight: 3 },
]

/* M5 scripted setbacks: a personified rival, escalating but bounded (§9.3). */
Sky.PROVOCATION_EVENTS = [
	{ id: "p1", text: "You are almost at the first checkpoint when Vex swoops past and knocks your marker off the ledge. You have to fly back and get it." },
	{ id: "p2", text: "You reach the rope run. Vex has already cut the shortest rope, so you take the long way round and lose your lead." },
	{ id: "p3", text: "At the lantern stand, Vex takes the last full lantern just before you reach it and holds it up so you can see." },
	{ id: "p4", text: "You find a good gust to ride. Vex slides in front of you and blocks it, and your glider drops two levels." },
	{ id: "p5", text: "You are one step from the checkpoint when Vex slams the gate and says, 'Nice try.'" },
	{ id: "p6", text: "At the finish, the keeper gives Vex the ribbon. Vex looks straight at you and shrugs." },
]
