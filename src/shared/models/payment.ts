import type { SyncFields } from './sync';

export type PaymentMethod = 'cash' | 'bank' | 'other';

export interface FarmerPayment extends SyncFields {
  seasonId: string;
  farmerId: string;
  farmerName: string;
  date: string;
  dateKey: string;
  amountKurus: number;
  paymentMethod: PaymentMethod;
  note: string | null;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface CompanyPayment extends SyncFields {
  seasonId: string;
  companyId: string;
  companyName: string;
  date: string;
  dateKey: string;
  amountKurus: number;
  paymentMethod: PaymentMethod;
  note: string | null;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
}
