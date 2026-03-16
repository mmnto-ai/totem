## Lesson — Heavy dependencies or sub-command logic should be

**Tags:** cli, performance, nodejs

Heavy dependencies or sub-command logic should be dynamically imported within the command handler rather than at the top level to ensure fast CLI startup times. This prevents the main entry point from loading unnecessary modules when the user is only running basic commands or help flags.
