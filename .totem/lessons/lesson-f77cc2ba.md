## Lesson — Background processes spawned by Git hooks should redirect

**Tags:** git, hooks, nodejs, devops

Background processes spawned by Git hooks should redirect both stdout and stderr to a log file to prevent Node.js stack traces from polluting the terminal mid-git-operation. While an application's quiet flag handles the UI layer, shell-level redirection is necessary to ensure OS-level containment of background output.
