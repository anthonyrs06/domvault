# LinkedIn update post — Domvault: the brain's first performance review (2026-08 v2, post-ship)

> PUBLISHED 2026-08-20 as a LinkedIn ARTICLE (per Dom -- article, not post) with a short feed teaser.
> URL: https://www.linkedin.com/pulse/my-second-brains-first-performance-review-dom-sadarangani-faz0e/
> Teaser: "I gave my second brain a performance review. It failed on something embarrassingly human -- it forgot to write things down..."

Six weeks ago I posted that my self-hosted second brain had started writing back — a scheduled job proposes "sparks" (cheap half-ideas linking two notes that have never met), and the good ones get promoted into full synthesis notes. (Honest note, same as always: I design and direct it; an AI agent writes most of the code.)

This week I gave it its first real performance review. Three findings, and one relaunch.

**1. The brain forgot to commit its own thoughts.**
The synthesis engine had been running every week, faithfully writing sparks and frameworks to disk — and never committing them to the repo. From every other surface's point of view, weeks of thinking simply didn't exist. The best part: months ago the brain itself generated a spark called "write-through index vs stale brain" — a warning that an index nobody updates is worse than no index. It diagnosed its own failure mode before committing it. The fix wasn't more AI; it was a contract. Every run now ends with a consistency check (does the ledger agree with the files?) and a commit. Memory that isn't consolidated isn't memory.

**2. I ruled on all 45 backlogged ideas myself — one by one.**
The engine generates; it doesn't get to decide what its ideas are worth. The triage: 31 promoted to full frameworks, 12 folded into existing ones as single increments, 1 deleted, 1 sent back for a falsification test. The interesting part is what the review revealed about the generator: nearly every spark it produces is an A-meets-B bridge between two fields. A recent paper measured exactly this bias in LLM-generated research ideas — and my queue was the evidence, sitting there before I'd read the paper. The machine has a *pattern*, not a quality problem. Knowing which one you have changes the fix.

**3. Speculative ideas now carry their tier on their face.**
Two of the 31 promotions came from sources I'd flagged as junk — metaphysical carousels, uncited claims. They earned promotion because they generate good questions, not because they're true. So their published form carries `evidence: speculative` in the metadata and a plain-language "do not cite as evidence" line in the first paragraph. The rule underneath: speculative material may *generate* hypotheses; it may never *support* them. An idea advances only by being re-derived from independent verifiable sources. That one rule did more for the vault's integrity this week than any amount of retrieval tuning — it even shipped a math paper to SSRN under the same discipline, with its own failed experiment reported in the abstract.

After the review, an agent fleet turned the 45 rulings into finished work in one evening — 31 new frameworks written, 12 folds merged, every ledger reconciled. My job was taste; the machine's job was throughput. That division is the whole thesis.

**And the Constellation got rebuilt around the one thing that matters.**
The public explorer used to show my published notes as dots in space. But the lesson the brain recorded at its own creation was: "a second brain is not the pile of notes — it's the edges." So now the edges are the show. Fly through it: real constellation lines between related ideas (the bright bridges are cross-domain connections), land on any planet to read the actual framework, and every note you visit sketches *your own* constellation across the universe. First visit opens on the universe growing from a single idea — labeled honestly as a simulation, because the real dates were flat, and refusing to fake data is the house style.

No install, ~30 seconds: https://dys5315.github.io/domvault/constellation/

Engine is source-available (PolyForm Noncommercial): https://github.com/dys5315/domvault
