## Lesson — The LLM documentation generator consistently hallucinates

**Tags:** documentation, hallucination, totem-docs, shield-515, trap

The LLM documentation generator consistently hallucinates that issue #515 (Claude Code hooks for spec preflight and shield pre-push) was shipped and is a live feature. It was closed as not implemented. Every `totem docs` run re-introduces false references to #515. Manual verification of generated docs must check for this specific hallucination pattern. The hooks feature is tracked under #520 (automatic enforcement strategy) and has NOT been implemented.
