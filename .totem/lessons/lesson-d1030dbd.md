## Lesson — Wrap untrusted lesson content in XML delimiters

**Tags:** security, llm, prompt-engineering

Injecting untrusted lesson content directly into a system prompt creates a risk of instruction leakage or prompt injection. Wrapping this data in explicit XML delimiters and instructing the model to treat the blocks as data ensures that instructions within the content are not interpreted as system commands.
