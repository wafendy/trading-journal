export type EntryType = 'buy_limit' | 'buy_stop';
export type EntrySignal = 'btb' | 'buy_lautan' | 'buy_magenta' | 'hawk1' | 'buy_spec' | 'no_signal';
export type TradeStatus = 'pending' | 'filled' | 'exited';
export type VerifyDays = 5 | 7 | 10 | 14;
export type DudDecision = null | 'keep' | 'exit';

export interface TradeRow {
  id: number;
  ticker: string;
  upeti: number;
  entryPrice: number;
  slPrice: number;
  tpPrice: number | null;
  entryType: EntryType;
  entrySignal: EntrySignal;
  earningsDate: string | null;
  notes: string | null;
  verifyDays: number;
  status: TradeStatus;
  fillDate: string | null;
  fillPrice: number | null;
  dudDecision: DudDecision;
  exitPrice: number | null;
  exitDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeDTO extends TradeRow {
  shares: number;
  realizedPnl: number | null;
  rMultiple: number | null;
  dudFlagged: boolean;
}
