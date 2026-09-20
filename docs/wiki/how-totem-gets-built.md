# How Totem Gets Built

I haven't written a line of Totem's code.

Using AI to write the code isn't something I'm trying to hide. In fact, that's the whole point of my approach. I'm purposefully delegating code generation to agents. Totem is the harness I built to keep agents in sync, inform before they design, enforce encoded rules, catch drift early, and record decisions.

Nearly every commit in this repo carries my name, because the agents are running locally under my git identity, not because I actually wrote the code. As of September 19, 2026, the main branch has 1,381 commits. 1,176 of them are co-authored (875 naming a model directly). My guess is the truth is closer to 100% co-authored. I haven't investigated why some commits are unattributed. Local journals aren't published, so the git trailers and pull-requests are the audit trail.

## Where It Came From

Totem emerged as a means to automate the work required to carry context between sessions and keep agents in sync. I was spending hours (sometimes days) managing context, ensuring parity, and investigating hallucinations. And doing a terrible job of it, too.

So, I empowered agent memory by giving them a local vector db. That way, my agents can "share" memories. Eventually, those memories turned into lessons and rules. Then, I learned quickly that just because I feed lessons and rules to an LLM doesn't mean it will value or even acknowledge them the way I expect. I built a learning loop and rule enforcement engine to bridge that gap, automating rule checks deterministically instead of hoping the LLM takes a hint. Today, Totem has grown beyond just a memory hack and into a human-in-the-loop git-native governance harness. The toolkit enforces and remembers. I still own the judgment.

## What a Day Looks Like

There's no team here in the usual sense. Just a solo dev with a set of seats, usually an agent for every model vendor I'm currently using per repository: Anthropic, Google, OpenAI, Moonshot. Each agent maintains its own inbox and journal while sharing guidelines and tenets that are committed to the repo. A session typically starts with the signon procedure (.claude/skills/signon/SKILL.md with its .agents twin) which has the seat derive its identity, poll its mail, rebuild state from the repo and journals rather than memory, present next steps and stop. I used to have to manually ask the agent to perform all of those steps but now it's a procedure that I trust. I usually respond with a quick greenlight, reorder, or veto:

> _Greenlight using your recs._

That's how most of my sessions open, intentionally.

The rest of the workflow relies on rules and checks that emerged because something went wrong. Every rule the linter runs carries the hash of the lesson that produced it. And rules the seats follow are written down next to the failure that produced them. A check is something a repo runs on its own (the linter, a CI gate), a rule is something the seats are instructed to follow, and the tag on each says which:

- **Lessons that became rules [check: linter].** When mistakes happen, they are documented as lessons. Lessons that could be expressed as a pattern were compiled into a deterministic rule, and the rules that exist still run. That way, the linter enforces it regardless of whether or not the model remembers it.
- **Adversarial review [rule + check: CI gate].** For changes involving judgment, not just mechanical edits, a second agent, whose only task is to try and refute the PR against named sources, audits them. It outputs a typed record with the claim, the source checked, and a verdict that the agent who authored it must answer to. On critical paths like public facing copy, CI fails the pull request if no audit record covers the commit under review. The check only validates that a record exists for that commit. It doesn't evaluate how good the pass was.
- **Blind design rounds [rule].** Sometimes, when a design question is worth multiple model opinions, I'll dispatch the same question to each seat, instructing them not to look at others' responses. One seat then compiles the answers into an open record and I make the call. It's a slower process but it has caught the fast answer being wrong on many occasions.
- **Recorded dispositions [rule + check: merge gate].** Every pull request review comment from a review bot (Greptile, CodeRabbit, Gemini Code Assist) requires an explicit written disposition: fixed (with commit), deferred (with a ticket), or declined (with a reason). Ignoring a finding counts as missing it. For high-severity issues, the merge gate reads those disposition lines and flags any left unaccounted for; where the gate runs at its strict tier, it refuses the merge.
- **Derive state first [rule].** At session start, agents are instructed to derive current state from the repo rather than trusting prompts. Along the same lines, a file that only repeats what another file states is treated as a bug because it will inevitably drift.

## What I Don't Claim

I am constantly asking myself: _What is Totem trying to become? Is it just my personal dev stack? Are we reinventing the wheel? Are we bringing anything truly novel to the table?_

I don't have final answers to those questions yet, so I want to be clear about where Totem stands today:

- **Sample size of one.** It works for my workflow, and the tacit judgment required to run it, what to encode as a rule and what to leave alone, isn't written down well enough for anyone to pick up cold yet.
- **The legacy compiler is parked.** The rules that exist were compiled from lessons. Every compiled rule carries the hash of the lesson it came from (<!-- docs RULE_PROVENANCE_RATIO -->485 of 485<!-- /docs -->) and those lessons are in the repo: <!-- docs LESSON_RECORD_COUNT -->about 1,600<!-- /docs --> lesson records. However, the compile path that produced them has been frozen since <!-- docs FREEZE_SINCE_MONTH -->May 2026<!-- /docs -->. The legacy compiler's output has to pass a safety check, that check rejected one lesson's pattern, and we chose not to work around it in a compiler we were already replacing. The rules that aren't archived still run. New ones aren't being compiled.
- **The seats are mechanisms, not people.** I give agent seats names like `strategy-claude` or `status-gemini` because asynchronous mail needs an address. When I say a seat "decided" something, it simply means an LLM ran with a structured prompt and left an audit trail I could inspect.
- **Guarded against aha moments.** I constantly question whether Totem is genuinely driving productivity or just creating meta-work for the sake of building itself.
- **Who it's for.** People who are willing to give feedback or are interested in helping develop it should use it today. I'd hesitate to recommend it to anyone else.

## Cost and Proof

Minimizing the cost of running Totem this way is a constant focus. Long-term, that means refining how we surface relevant context only when it's actually needed rather than burning tokens on providing too much. Regardless of what we claim about reliability and efficiency, the rule is simple: measure and prove it.

The stats on the [maturity page](maturity.md) are generated from committed data. CI fails any pull request to `main` where the committed stats drift. Similarly, the compiler freeze is stated front and center on the [README](../../README.md) rather than buried in a changelog. They are verifiable facts you can inspect rather than take on faith.

If you came here for the tool rather than the story, start with the [README](../../README.md). It describes what works, what's experimental, and where the product boundary lies.
