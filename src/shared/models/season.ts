import type { SyncFields } from './sync';

export interface Season extends SyncFields {
  name: string;
  year: number;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
}
