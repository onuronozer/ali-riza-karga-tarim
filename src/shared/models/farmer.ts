import type { SyncFields } from './sync';

export interface Farmer extends SyncFields {
  name: string;
  nickname: string | null;
  phone: string | null;
  village: string | null;
  note: string | null;
  isActive: boolean;
  totalGram: number;
  totalAmountKurus: number;
  paidAmountKurus: number;
  balanceKurus: number;
  receiptCount: number;
}
