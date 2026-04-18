## Lesson — Track line numbers in security allowlists

**Tags:** testing, security, regression
**Scope:** packages/pack-agent-security/test/**/*.ts

Allowlisting security violations by filename alone is insufficient; tracking line numbers or match counts prevents new violations from being introduced into already-exempted files.
