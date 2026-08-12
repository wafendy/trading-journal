import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const entryType = z.enum(['buy_limit', 'buy_stop', 'sell_limit', 'sell_stop']);
const entrySignal = z.enum(['btb', 'buy_lautan', 'buy_magenta', 'hawk1', 'buy_spec', 'no_signal']);
const direction = z.enum(['long', 'short']);
const verifyDays = z.union([z.literal(5), z.literal(7), z.literal(10), z.literal(14)]);

export const createTradeSchema = z.object({
  ticker: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  upeti: z.number().positive(),
  entryPrice: z.number().positive(),
  slPrice: z.number().positive(),
  tpPrice: z.number().positive().nullable().optional(),
  entryType,
  entrySignal,
  direction: direction.default('long'),
  earningsDate: isoDate,
  notes: z.string().max(2000).nullable().optional(),
  verifyDays,
})
  // Stop/target sit on opposite sides of entry depending on direction:
  // long → SL below, TP at/above entry; short → SL above, TP at/below entry.
  .refine((d) => (d.direction === 'short' ? d.slPrice > d.entryPrice : d.slPrice < d.entryPrice), {
    message: 'slPrice must be on the loss side of entry (below for long, above for short)',
    path: ['slPrice'],
  })
  .refine((d) => d.tpPrice == null || (d.direction === 'short' ? d.tpPrice <= d.entryPrice : d.tpPrice >= d.entryPrice), {
    message: 'tpPrice must be on the profit side of entry (at/above for long, at/below for short)',
    path: ['tpPrice'],
  });

export const patchTradeSchema = z.object({
  ticker: z.string().min(1).max(10).transform((s) => s.toUpperCase()).optional(),
  upeti: z.number().positive().optional(),
  entryPrice: z.number().positive().optional(),
  slPrice: z.number().positive().optional(),
  tpPrice: z.number().positive().nullable().optional(),
  entryType: entryType.optional(),
  entrySignal: entrySignal.optional(),
  direction: direction.optional(),
  earningsDate: isoDate.optional(),
  notes: z.string().max(2000).nullable().optional(),
  verifyDays: verifyDays.optional(),
  // History corrections: exit values + entry basis. Left optional/lenient so a
  // partial fix isn't blocked by cross-field rules that only apply at creation.
  fillPrice: z.number().positive().optional(),
  fillShares: z.number().int().positive().nullable().optional(),
  fillDate: isoDate.optional(),
  exitPrice: z.number().positive().optional(),
  exitDate: isoDate.optional(),
});

export const fillSchema = z.object({ fillDate: isoDate, fillPrice: z.number().positive(), fillShares: z.number().int().positive().optional() });
export const settingsSchema = z.object({
  upeti: z.number().positive().optional(),
  verifyDays: verifyDays.optional(),
});
export const cancelSchema = z.object({});
export const exitSchema = z.object({ exitPrice: z.number().positive(), exitDate: isoDate });
export const dudDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('keep') }),
  z.object({ decision: z.literal('exit'), exitPrice: z.number().positive(), exitDate: isoDate }),
]);

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type PatchTradeInput = z.infer<typeof patchTradeSchema>;
export type FillInput = z.infer<typeof fillSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
export type ExitInput = z.infer<typeof exitSchema>;
export type DudDecisionInput = z.infer<typeof dudDecisionSchema>;
