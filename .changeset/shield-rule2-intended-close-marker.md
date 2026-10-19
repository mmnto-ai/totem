---
'@mmnto/cli': patch
---

PreWriteShield (and the Gemini BeforeTool twin): the auto-close rule's refusal now tells the author the whole atom for an INTENDED close. A new line after the directive cure says to add `<!-- totem-close: owner/repo#N -->` on its own line as well, because the auto-close required check and `totem pr merge` authorize a close by that marker only, never by the keyword. The rule also reads past a `totem-close` marker (the HTML-comment form and the `Totem-Close:` trailer) before it scans, as the receipt's own matcher already does: the marker's text contains `close: owner/repo#N`, so on the shipped hook the cure the message now names was refused by the rule naming it (measured: exit 2 on a marker-only write). A keyword line beside a marker is still refused, and the bare-ref rule still wants the marker's ref qualified. The installed `.claude/hooks/PreWriteShield.cjs` is refreshed by `totem init`. mmnto-ai/totem#3103.
