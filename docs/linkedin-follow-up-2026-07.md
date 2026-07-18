# LinkedIn follow-up post — Domvault, one month in (2026-07-01)

A month ago I posted about Domvault — the self-hosted second brain I built. (Honest note, same as last time: I designed and directed it; an AI agent wrote most of the code.) The pitch was simple: your notes stay plain Markdown on your machine, an agent proposes connections between them, and you publish only what you choose — signed and credited.

Here's what actually happened in the month since. Three things I find more interesting than the launch itself.

**1. The vault started writing back.**
A scheduled job generates "sparks" — cheap half-ideas linking two notes that have never met. Most die. The ones that survive review get promoted into full synthesis notes. Every note carries an origin field, so the graph shows authorship at a glance: amber for what was captured, purple for what the brain generated, plain for what I wrote myself. The purple region grows on a schedule, not on my effort.

**2. It graded its own publishability.**
Deciding what's safe to share is a real problem — some notes are teaching material, some are moats. So the publish rubric was composed out of the brain's own frameworks: the rubric pattern for scoring, FMEA for leak risk (Severity × Exploitability × Undetectability), moat analysis for what's actually defensible. The system that decides what the brain publishes was assembled from things the brain already knew. Advisory, never automatic — I review everything before it ships. But the shortlist writes itself.

**3. 52 frameworks made it through.**
Each one genericized, licensed, signed, and published as a planet in the Constellation — a zoomable universe where galaxies are topics, stars are brains, and planets are published notes. Browse them, no install needed: https://dys5315.github.io/domvault/constellation/ (what you'll see is a snapshot — the live publish/pull registry is offline while I move it off a free trial; the planets are real.)

Some numbers, honestly framed: the repo has 3 stars. It also had 96 unique cloners and 131 unique visitors in the last two weeks. I'll take that trade — stars are applause, clones are people taking the thing home.

At some point the loop had to close, so the brain wrote a note about its own creation. The lesson it recorded is the one I'd keep even if I deleted everything else:

"A second brain is not the pile of notes — it's the edges."

More tonight on where those 52 frameworks are headed.

Engine is source-available (PolyForm Noncommercial): https://github.com/dys5315/domvault
