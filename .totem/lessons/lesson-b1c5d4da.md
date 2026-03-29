## Lesson — Always use 'cd ... || exit 1' in shell scripts

**Tags:** bash, devops

Always append `|| exit 1` to `cd` commands within shell scripts. This ensures the script terminates immediately if a directory change fails, preventing subsequent commands from running in an unintended or invalid directory context.
