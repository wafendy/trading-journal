import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const entryType = z.enum(['buy_limit', 'buy_stop']);
const entrySignal = z.enum(['btb', 'buy_lautan', 'buy_magenta', 'hawk1', 'buy_spec']);
const verifyDays = z.union([z.literal(5), z.literal(7), z.literal(10), z.literal(14)]);

export const createTradeSchema = z.object({
  ticker: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  upeti: z.number().positive(),
  entryPrice: z.number().positive(),
  slPrice: z.number().positive(),
  tpPrice: z.number().positive().nullable().optional(),
  entryType,
  entrySignal,
  entryDate: isoDate,
  earningsDate: isoDate,
  notes: z.string().max(2000).nullable().optional(),
  verifyDays,
})
  .refine((d) => d.slPrice < d.entryPrice, { message: 'slPrice must be below entryPrice', path: ['slPrice'] })
  .refine((d) => d.tpPrice == null || d.tpPrice >= d.entryPrice, { message: 'tpPrice must be at or above entryPrice', path: ['tpPrice'] });

export const patchTradeSchema = z.object({
  ticker: z.string().min(1).max(10).transform((s) => s.toUpperCase()).optional(),
  upeti: z.number().positive().optional(),
  entryPrice: z.number().positive().optional(),
  slPrice: z.number().positive().optional(),
  tpPrice: z.number().positive().nullable().optional(),
  entryType: entryType.optional(),
  entrySignal: entrySignal.optional(),
  entryDate: isoDate.optional(),
  earningsDate: isoDate.optional(),
  notes: z.string().max(2000).nullable().optional(),
  verifyDays: verifyDays.optional(),
});

export const fillSchema = z.object({ fillDate: isoDate });
export const cancelSchema = z.object({});
export const exitSchema = z.object({ exitPrice: z.number().positive(), exitDate: isoDate });
export const dudDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('keep') }),
  z.object({ decision: z.literal('exit'), exitPrice: z.number().positive(), exitDate: isoDate }),
]);

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type PatchTradeInput = z.infer<typeof patchTradeSchema>;
export type FillInput = z.infer<typeof fillSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
export type ExitInput = z.infer<typeof exitSchema>;
export type DudDecisionInput = z.infer<typeof dudDecisionSchema>;
