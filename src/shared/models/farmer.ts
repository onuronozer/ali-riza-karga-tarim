import type { SyncFields } from './sync';

export interface Farmer extends SyncFields {
  name: string;
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
