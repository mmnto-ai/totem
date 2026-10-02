## Lesson — Port a vendor's rule from installed source, not its docs

**Tags:** integration, gemini-cli, porting, testing
**Scope:** packages/cli/src/commands/doctor.ts

The first Gemini workspace-trust row was written from Gemini CLI's documentation and was wrong three ways against 0.61.0's code. The single longest matching key wins (the row let an exact `DO_NOT_TRUST` win and otherwise any trusting ancestor). Paths are realpathed (a junctioned working directory gave a false pass). Case is folded on macOS as well as Windows. Read the installed source before specifying a port, then run the port against the vendor's own function on generated cases: the fold agreed with Gemini's function on 7,956 cases, and on 16,920 tilde-free cases in the last read, with zero disagreements (mmnto-ai/totem#2999).
