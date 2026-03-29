## Lesson — Use bash [[ =~ ]] not echo | grep

**Tags:** bash, performance

Use native regex matching like `[[ $var =~ pattern ]]` instead of `echo | grep` for variable extraction in hooks. This avoids unnecessary subshells and adheres to project-specific shell constraints for Claude Code hooks.
