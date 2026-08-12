import { sqliteTable, integer, real, text } from 'drizzle-orm/sqlite-core';

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticker: text('ticker').notNull(),
  upeti: real('upeti').notNull(),
  entryPrice: real('entry_price').notNull(),
  slPrice: real('sl_price').notNull(),
  tpPrice: real('tp_price'),
  entryType: text('entry_type').notNull(),
  entrySignal: text('entry_signal').notNull(),
  earningsDate: text('earnings_date'),
  notes: text('notes'),
  verifyDays: integer('verify_days').notNull(),
  status: text('status').notNull().default('pending'),
  fillDate: text('fill_date'),
  fillPrice: real('fill_price'),
  fillShares: integer('fill_shares'),
  dudDecision: text('dud_decision'),
  exitPrice: real('exit_price'),
  exitDate: text('exit_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
