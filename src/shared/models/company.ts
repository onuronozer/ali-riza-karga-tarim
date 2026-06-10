import type { SyncFields } from './sync';

export interface Company extends SyncFields {
  name: string;
  authorizedPerson: string | null;
  phone: string | null;
  city: string | null;
  note: string | null;
  isActive: boolean;
  totalGram: number;
  totalAmountKurus: number;
  collectedAmountKurus: number;
  balanceKurus: number;
  receiptCount: number;
}
