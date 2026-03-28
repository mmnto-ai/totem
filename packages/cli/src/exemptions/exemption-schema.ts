import { z } from 'zod';

// ─── Local: per-developer FP tracking (gitignored) ─────

const ExemptionPatternSchema = z.object({
  count: z.number().int().nonnegative(),
  sources: z.array(z.enum(['shield', 'bot'])),
  lastSeenAt: z.string().datetime(),
  sampleMessages: z.array(z.string()).max(3),
});

export const ExemptionLocalSchema = z.object({
  patterns: z.record(z.string(), ExemptionPatternSchema),
});

export type ExemptionLocal = z.infer<typeof ExemptionLocalSchema>;
export type ExemptionPattern = z.infer<typeof ExemptionPatternSchema>;

// ─── Shared: committed team-wide exemptions ─────────────

const SharedExemptionEntrySchema = z.object({
  patternId: z.string().min(1),
  label: z.string().min(1),
  reason: z.string(),
  promotedAt: z.string().datetime(),
  promotedBy: z.enum(['auto', 'manual']),
  sampleMessages: z.array(z.string()).max(3),
});

export const ExemptionSharedSchema = z.object({
  version: z.literal(1),
  exemptions: z.array(SharedExemptionEntrySchema),
});

export type ExemptionShared = z.infer<typeof ExemptionSharedSchema>;
export type SharedExemptionEntry = z.infer<typeof SharedExemptionEntrySchema>;

// ─── Defaults ───────────────────────────────────────────

export const EMPTY_LOCAL: ExemptionLocal = { patterns: {} };
export const EMPTY_SHARED: ExemptionShared = { version: 1, exemptions: [] };

// ─── Constants ──────────────────────────────────────────

export const PROMOTION_THRESHOLD = 3;
export const LOCAL_FILE = 'exemption-local.json';
export const SHARED_FILE = 'exemptions.json';
