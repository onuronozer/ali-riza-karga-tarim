import type { SyncFields } from './sync';

export interface PurchaseReceipt extends SyncFields {
  receiptNo: string;
  seasonId: string;
  date: string;
  dateKey: string;
  timeText: string;
  farmerId: string;
  farmerName: string;
  companyId: string;
  companyName: string;
  apricotTypeId: string;
  apricotTypeName: string;
  grossQuantityGram: number;
  crateCount: number;
  crateTareGram: number;
  quantityGram: number;
  unitPriceKurus: number;
  totalAmountKurus: number;
  note: string | null;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
}
