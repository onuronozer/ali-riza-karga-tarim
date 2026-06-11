export interface DeviceInfo {
  id: string | null;
  deviceCode: string | null;
  deviceName: string | null;
  isConfigured: boolean;
  updatedAt: string | null;
}

export interface SaveDeviceInput {
  deviceCode: string;
  deviceName?: string;
}

export interface FirebaseSettings {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  authEmail: string;
  authPassword: string;
}

export interface SyncStatus {
  isConfigured: boolean;
  pendingCount: number;
  errorCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface SyncResult extends SyncStatus {
  pushedCount: number;
  pulledCount: number;
}

export interface SystemPing {
  ok: boolean;
  appName: string;
  version: string;
}

export interface MaintenanceResetResult {
  localDeletedCount: number;
  firebaseDeletedCount: number;
  firebaseSkipped: boolean;
}

export interface MaintenanceResetInput {
  password: string;
  confirmation: string;
}

export interface SeasonListItem {
  id: string;
  name: string;
  year: number;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
}

export interface SaveSeasonInput {
  id?: string;
  name: string;
  year: number;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
}

export interface FarmerListItem {
  id: string;
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

export interface SaveFarmerInput {
  id?: string;
  name: string;
  nickname?: string | null;
  phone?: string | null;
  village?: string | null;
  note?: string | null;
  isActive?: boolean;
}

export interface CompanyListItem {
  id: string;
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

export interface SaveCompanyInput {
  id?: string;
  name: string;
  authorizedPerson?: string | null;
  phone?: string | null;
  city?: string | null;
  note?: string | null;
  isActive?: boolean;
}

export interface ApricotTypeListItem {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface SaveApricotTypeInput {
  id?: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface DashboardOverview {
  todayTotalGram: number;
  todayTotalAmountKurus: number;
  farmerBalanceTotalKurus: number;
  companyBalanceTotalKurus: number;
  todayPaidToFarmersKurus: number;
  todayCollectedFromCompaniesKurus: number;
  farmerCount: number;
  companyCount: number;
}

export interface PurchaseReceiptListItem {
  id: string;
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
}

export interface SavePurchaseReceiptInput {
  date: string;
  timeText: string;
  farmerId: string;
  companyId: string;
  apricotTypeId: string;
  grossQuantityGram?: number;
  crateCount?: number;
  crateTareGram?: number;
  quantityGram: number;
  unitPriceKurus: number;
  note?: string | null;
}

export type PaymentMethod = 'cash' | 'bank' | 'other';

export interface FarmerPaymentListItem {
  id: string;
  seasonId: string;
  farmerId: string;
  farmerName: string;
  date: string;
  dateKey: string;
  amountKurus: number;
  paymentMethod: PaymentMethod;
  note: string | null;
  isCancelled: boolean;
}

export interface CompanyPaymentListItem {
  id: string;
  seasonId: string;
  companyId: string;
  companyName: string;
  date: string;
  dateKey: string;
  amountKurus: number;
  paymentMethod: PaymentMethod;
  note: string | null;
  isCancelled: boolean;
}

export interface SaveFarmerPaymentInput {
  farmerId: string;
  date: string;
  amountKurus: number;
  paymentMethod: PaymentMethod;
  note?: string | null;
}

export interface SaveCompanyPaymentInput {
  companyId: string;
  date: string;
  amountKurus: number;
  paymentMethod: PaymentMethod;
  note?: string | null;
}

export interface CancelInput {
  id: string;
  reason: string;
}

export interface ReportOverview {
  totalGram: number;
  totalAmountKurus: number;
  receiptCount: number;
  farmerCount: number;
  companyCount: number;
  paidToFarmersKurus: number;
  collectedFromCompaniesKurus: number;
  farmerBalanceTotalKurus: number;
  companyBalanceTotalKurus: number;
}

export interface ReportBreakdownItem {
  name: string;
  totalGram: number;
  totalAmountKurus: number;
  receiptCount: number;
}

export interface ReportsSnapshot {
  overview: ReportOverview;
  byCompany: ReportBreakdownItem[];
  byType: ReportBreakdownItem[];
}

export interface AppApi {
  system: {
    ping: () => Promise<SystemPing>;
  };
  settings: {
    getDevice: () => Promise<DeviceInfo>;
    saveDevice: (input: SaveDeviceInput) => Promise<DeviceInfo>;
    getFirebaseSettings: () => Promise<FirebaseSettings>;
    saveFirebaseSettings: (input: FirebaseSettings) => Promise<FirebaseSettings>;
  };
  sync: {
    getStatus: () => Promise<SyncStatus>;
    runNow: () => Promise<SyncResult>;
  };
  maintenance: {
    resetTestData: (input: MaintenanceResetInput) => Promise<MaintenanceResetResult>;
  };
  seasons: {
    list: () => Promise<SeasonListItem[]>;
    getActive: () => Promise<SeasonListItem | null>;
    save: (input: SaveSeasonInput) => Promise<SeasonListItem>;
    setActive: (id: string) => Promise<SeasonListItem>;
  };
  farmers: {
    list: (search?: string) => Promise<FarmerListItem[]>;
    save: (input: SaveFarmerInput) => Promise<FarmerListItem>;
    deactivate: (id: string) => Promise<void>;
  };
  companies: {
    list: (search?: string) => Promise<CompanyListItem[]>;
    save: (input: SaveCompanyInput) => Promise<CompanyListItem>;
    deactivate: (id: string) => Promise<void>;
  };
  apricotTypes: {
    list: () => Promise<ApricotTypeListItem[]>;
    save: (input: SaveApricotTypeInput) => Promise<ApricotTypeListItem>;
    deactivate: (id: string) => Promise<void>;
  };
  dashboard: {
    getOverview: () => Promise<DashboardOverview>;
  };
  purchases: {
    list: () => Promise<PurchaseReceiptListItem[]>;
    create: (input: SavePurchaseReceiptInput) => Promise<PurchaseReceiptListItem>;
    cancel: (input: CancelInput) => Promise<void>;
  };
  farmerPayments: {
    list: () => Promise<FarmerPaymentListItem[]>;
    create: (input: SaveFarmerPaymentInput) => Promise<FarmerPaymentListItem>;
    cancel: (input: CancelInput) => Promise<void>;
  };
  companyPayments: {
    list: () => Promise<CompanyPaymentListItem[]>;
    create: (input: SaveCompanyPaymentInput) => Promise<CompanyPaymentListItem>;
    cancel: (input: CancelInput) => Promise<void>;
  };
  reports: {
    getSnapshot: () => Promise<ReportsSnapshot>;
  };
}
