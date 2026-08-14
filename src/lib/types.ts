export type EntryType = 'buy_limit' | 'buy_stop' | 'sell_limit' | 'sell_stop';
export type TradeDirection = 'long' | 'short';
export type EntrySignal =
  | 'btb' | 'buy_lautan' | 'buy_magenta' | 'hawk1' | 'buy_spec' | 'no_signal'
  | 'bbb' | 'sell_lautan' | 'sell_magenta' | 'spec_sell' | 'red_bear' | 'bear_detected' | 'green_bull';
export type TradeStatus = 'pending' | 'filled' | 'exited';
export type VerifyDays = 5 | 10 | 15 | 20 | 25;
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
  direction: TradeDirection;
  earningsDate: string | null;
  notes: string | null;
  verifyDays: number;
  status: TradeStatus;
  fillDate: string | null;
  fillPrice: number | null;
  fillShares: number | null;
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
