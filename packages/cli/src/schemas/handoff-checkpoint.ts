import { z } from 'zod';

export const HandoffCheckpointSchema = z.object({
  checkpoint_version: z.literal(1),
  timestamp: z.string().datetime(),
  branch: z.string(),
  open_prs: z.array(z.number()).default([]),
  active_files: z.array(z.string()),
  pending_decisions: z.array(z.string()).default([]),
  completed: z.array(z.string()).default([]),
  remaining: z.array(z.string()).default([]),
  context_hints: z.array(z.string()).default([]),
});

export type HandoffCheckpoint = z.infer<typeof HandoffCheckpointSchema>;
