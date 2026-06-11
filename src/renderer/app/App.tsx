import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Building2,
  FileText,
  Home,
  Leaf,
  Pencil,
  Printer,
  ReceiptText,
  RefreshCw,
  Settings,
  Trash2,
  Users,
  Wifi,
  WifiOff
} from 'lucide-react';
import type {
  ApricotTypeListItem,
  CompanyPaymentListItem,
  CompanyListItem,
  DeviceInfo,
  FarmerPaymentListItem,
  FarmerListItem,
  FirebaseSettings,
  PaymentMethod,
  PurchaseReceiptListItem,
  ReportsSnapshot,
  SaveApricotTypeInput,
  SaveCompanyInput,
  SaveCompanyPaymentInput,
  SaveFarmerInput,
  SaveFarmerPaymentInput,
  SavePurchaseReceiptInput,
  SaveSeasonInput,
  SeasonListItem
} from '../../shared/ipc-contracts/app-api';
import arkLogoUrl from '../../shared/assets/ark-tarim-logo.svg';
import { APP_NAME, DEFAULT_DEVICE_CODE_EXAMPLES } from '../../shared/constants/app';
import { formatDateTr, formatGramAsKg, formatKurus, parseKgToGram, parseTlToKurus } from '../../shared/formatters';

type PageKey =
  | 'dashboard'
  | 'purchases'
  | 'farmers'
  | 'companies'
  | 'apricotTypes'
  | 'farmerPayments'
  | 'companyPayments'
  | 'reports'
  | 'settings';

interface CompanyDailyPrintData {
  companyId: string;
  companyName: string;
  date: string;
  dateKey: string;
  receipts: PurchaseReceiptListItem[];
  totalGram: number;
  totalAmountKurus: number;
  receiptCount: number;
}

interface FarmerStatementPrintData {
  farmer: FarmerListItem;
  receipts: PurchaseReceiptListItem[];
  payments: FarmerPaymentListItem[];
  totalGram: number;
  totalPurchaseKurus: number;
  paidKurus: number;
  balanceKurus: number;
}

interface CompanyAccountDailyRow {
  date: string;
  dateKey: string;
  totalGram: number;
  totalAmountKurus: number;
  receiptCount: number;
}

type ReportPrintTarget =
  | { kind: 'companyDaily'; data: CompanyDailyPrintData }
  | { kind: 'farmerStatement'; data: FarmerStatementPrintData }
  | { kind: 'season'; snapshot: ReportsSnapshot };

const menuItems: Array<{ key: PageKey; label: string; icon: typeof Home }> = [
  { key: 'dashboard', label: 'Ana Sayfa', icon: Home },
  { key: 'purchases', label: 'Alım İşlemleri', icon: ReceiptText },
  { key: 'farmers', label: 'Çiftçiler', icon: Users },
  { key: 'companies', label: 'Firmalar', icon: Building2 },
  { key: 'apricotTypes', label: 'Kayısı Çeşitleri', icon: Leaf },
  { key: 'farmerPayments', label: 'Çiftçi Ödemeleri', icon: FileText },
  { key: 'companyPayments', label: 'Firma Ödemeleri', icon: Printer },
  { key: 'reports', label: 'Raporlar', icon: BarChart3 },
  { key: 'settings', label: 'Ayarlar', icon: Settings }
];

type AutoSyncVisualState = 'disabled' | 'offline' | 'ready' | 'pending' | 'syncing' | 'error';

interface AutoSyncState {
  visualState: AutoSyncVisualState;
  label: string;
  pendingCount: number;
  isSyncing: boolean;
}

const AUTO_SYNC_RETRY_MS = 10_000;
const AUTO_SYNC_ERROR_RETRY_MS = 120_000;
const AUTO_SYNC_IDLE_PULL_MS = 10_000;

function invalidateOperationalQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['active-season'] });
  queryClient.invalidateQueries({ queryKey: ['seasons'] });
  queryClient.invalidateQueries({ queryKey: ['farmers'] });
  queryClient.invalidateQueries({ queryKey: ['companies'] });
  queryClient.invalidateQueries({ queryKey: ['apricot-types'] });
  queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
  queryClient.invalidateQueries({ queryKey: ['farmer-payments'] });
  queryClient.invalidateQueries({ queryKey: ['company-payments'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] });
  queryClient.invalidateQueries({ queryKey: ['reports-snapshot'] });
  queryClient.invalidateQueries({ queryKey: ['sync-status'] });
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'İşlem tamamlanamadı.';
}

function useAutoSync(): AutoSyncState {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastAutoSyncError, setLastAutoSyncError] = useState<string | null>(null);
  const isSyncingRef = useRef(false);
  const lastAttemptAtRef = useRef(0);

  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => window.arkTarim.sync.getStatus(),
    refetchInterval: 10_000
  });

  useEffect(() => {
    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!syncStatus?.isConfigured || !isOnline || isSyncingRef.current) {
      return;
    }

    let cancelled = false;

    const runIfDue = (): void => {
      if (cancelled || isSyncingRef.current) {
        return;
      }

      const now = Date.now();
      const hasPendingRows = syncStatus.pendingCount > 0;
      const retryMs = lastAutoSyncError
        ? AUTO_SYNC_ERROR_RETRY_MS
        : hasPendingRows
          ? AUTO_SYNC_RETRY_MS
          : AUTO_SYNC_IDLE_PULL_MS;

      if (now - lastAttemptAtRef.current < retryMs) {
        return;
      }

      lastAttemptAtRef.current = now;
      isSyncingRef.current = true;
      setIsSyncing(true);

      window.arkTarim.sync
        .runNow()
        .then(() => {
          if (cancelled) {
            return;
          }

          setLastAutoSyncError(null);
          invalidateOperationalQueries(queryClient);
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }

          setLastAutoSyncError(asErrorMessage(error));
          queryClient.invalidateQueries({ queryKey: ['sync-status'] });
        })
        .finally(() => {
          if (!cancelled) {
            isSyncingRef.current = false;
            setIsSyncing(false);
          }
        });
    };

    runIfDue();
    const intervalId = window.setInterval(runIfDue, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (isSyncingRef.current) {
        isSyncingRef.current = false;
      }
    };
  }, [isOnline, lastAutoSyncError, queryClient, syncStatus?.isConfigured, syncStatus?.pendingCount]);

  const pendingCount = syncStatus?.pendingCount ?? 0;

  if (!syncStatus?.isConfigured) {
    return {
      visualState: 'disabled',
      label: 'Online hesap bekliyor',
      pendingCount,
      isSyncing
    };
  }

  if (!isOnline) {
    return {
      visualState: 'offline',
      label: pendingCount > 0 ? `${pendingCount} kayıt bekliyor` : 'Çevrimdışı',
      pendingCount,
      isSyncing
    };
  }

  if (isSyncing) {
    return {
      visualState: 'syncing',
      label: 'Otomatik senkron',
      pendingCount,
      isSyncing
    };
  }

  if (lastAutoSyncError || syncStatus.lastError) {
    return {
      visualState: 'error',
      label: pendingCount > 0 ? 'Senkron tekrar denenecek' : 'Senkron uyarısı',
      pendingCount,
      isSyncing
    };
  }

  if (pendingCount > 0) {
    return {
      visualState: 'pending',
      label: `${pendingCount} kayıt gönderiliyor`,
      pendingCount,
      isSyncing
    };
  }

  return {
    visualState: 'ready',
    label: 'Oto senkron açık',
    pendingCount,
    isSyncing
  };
}

function getPurchasesApi(): typeof window.arkTarim.purchases {
  const api = window.arkTarim as typeof window.arkTarim & {
    purchases?: Partial<typeof window.arkTarim.purchases>;
  };

  if (!api.purchases || !api.purchases.list || !api.purchases.create || !api.purchases.cancel) {
    throw new Error('Alım fişi bağlantısı yenilenmedi. Uygulamayı tamamen kapatıp tekrar npm.cmd run dev ile açın.');
  }

  return api.purchases as typeof window.arkTarim.purchases;
}

function DeviceSettings({ device }: { device: DeviceInfo | undefined }): JSX.Element {
  const queryClient = useQueryClient();
  const [deviceCode, setDeviceCode] = useState(device?.deviceCode ?? '');
  const [deviceName, setDeviceName] = useState(device?.deviceName ?? '');
  const [firebaseForm, setFirebaseForm] = useState<FirebaseSettings>({
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
    authEmail: '',
    authPassword: ''
  });
  const [showFirebaseAdvanced, setShowFirebaseAdvanced] = useState(false);
  const [showMaintenanceTools, setShowMaintenanceTools] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmText, setResetConfirmText] = useState('');

  const { data: firebaseSettings } = useQuery({
    queryKey: ['firebase-settings'],
    queryFn: () => window.arkTarim.settings.getFirebaseSettings()
  });

  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => window.arkTarim.sync.getStatus()
  });

  useEffect(() => {
    setDeviceCode(device?.deviceCode ?? '');
    setDeviceName(device?.deviceName ?? '');
  }, [device]);

  useEffect(() => {
    if (!firebaseSettings) {
      return;
    }

    setFirebaseForm(firebaseSettings);
  }, [firebaseSettings]);

  const saveDeviceMutation = useMutation({
    mutationFn: () =>
      window.arkTarim.settings.saveDevice({
        deviceCode,
        deviceName
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device'] });
    }
  });

  const saveFirebaseMutation = useMutation({
    mutationFn: () => window.arkTarim.settings.saveFirebaseSettings(firebaseForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firebase-settings'] });
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
    }
  });

  const syncNowMutation = useMutation({
    mutationFn: () => window.arkTarim.sync.runNow(),
    onSuccess: () => {
      invalidateOperationalQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
    },
    onError: () => {
      setShowFirebaseAdvanced(true);
    }
  });

  const resetDataMutation = useMutation({
    mutationFn: () =>
      window.arkTarim.maintenance.resetTestData({
        password: resetPassword,
        confirmation: resetConfirmText
      }),
    onSuccess: () => {
      setResetPassword('');
      setResetConfirmText('');
      invalidateOperationalQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['firebase-settings'] });
      queryClient.invalidateQueries({ queryKey: ['device'] });
    }
  });

  return (
    <>
      <section className="panel settings-panel" aria-labelledby="device-title">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Ayarlar</p>
            <h2 id="device-title">Cihaz Kodu</h2>
          </div>
          <span className={device?.isConfigured ? 'status-pill ready' : 'status-pill warning'}>
            {device?.isConfigured ? 'Hazır' : 'Zorunlu'}
          </span>
        </div>

        <div className="settings-grid">
          <label>
            <span>Cihaz kodu</span>
            <input
              value={deviceCode}
              onChange={(event) => setDeviceCode(event.target.value.toUpperCase())}
              placeholder={DEFAULT_DEVICE_CODE_EXAMPLES[0]}
              maxLength={16}
            />
          </label>

          <label>
            <span>Cihaz adı</span>
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="Ofis bilgisayarı"
            />
          </label>
        </div>

        {saveDeviceMutation.isError ? (
          <p className="form-error">{asErrorMessage(saveDeviceMutation.error)}</p>
        ) : null}

        {saveDeviceMutation.isSuccess ? <p className="form-success">Cihaz kaydedildi.</p> : null}

        <button
          className="primary-action"
          onClick={() => saveDeviceMutation.mutate()}
          disabled={saveDeviceMutation.isPending}
        >
          <Settings size={18} />
          Kaydet
        </button>
      </section>

      <section className="panel settings-panel" aria-labelledby="firebase-title">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Online yedek</p>
            <h2 id="firebase-title">Firebase Senkron</h2>
          </div>
          <span className={syncStatus?.isConfigured ? 'status-pill ready' : 'status-pill warning'}>
            {syncStatus?.isConfigured ? 'Hesap hazır' : 'Hesap bekliyor'}
          </span>
        </div>

        <section className="stats-grid sync-stats">
          <article className="stat-card">
            <span>Bekleyen kayıt</span>
            <strong>{syncStatus?.pendingCount ?? 0}</strong>
          </article>
          <article className="stat-card">
            <span>Hatalı kayıt</span>
            <strong>{syncStatus?.errorCount ?? 0}</strong>
          </article>
          <article className="stat-card">
            <span>Son senkron</span>
            <strong>{syncStatus?.lastSyncAt ? formatDateTr(syncStatus.lastSyncAt) : '-'}</strong>
          </article>
          <article className="stat-card">
            <span>Durum</span>
            <strong>{syncStatus?.isConfigured ? 'Hazır' : 'Eksik'}</strong>
          </article>
        </section>

        {showFirebaseAdvanced ? (
          <div className="settings-grid firebase-account-grid">
            <label>
              <span>Online hesap e-postası</span>
              <input
                value={firebaseForm.authEmail}
                onChange={(event) => setFirebaseForm((value) => ({ ...value, authEmail: event.target.value }))}
              />
            </label>
            <label>
              <span>Kullanıcı şifresi</span>
              <input
                type="password"
                value={firebaseForm.authPassword}
                onChange={(event) => setFirebaseForm((value) => ({ ...value, authPassword: event.target.value }))}
              />
            </label>
            <div className="connection-summary">
              <span>Proje</span>
              <strong>{firebaseForm.projectId || 'alirizakarga'}</strong>
            </div>
          </div>
        ) : null}

        {saveFirebaseMutation.isError ? (
          <p className="form-error">{asErrorMessage(saveFirebaseMutation.error)}</p>
        ) : null}
        {syncNowMutation.isError ? <p className="form-error">{asErrorMessage(syncNowMutation.error)}</p> : null}
        {syncStatus?.lastError ? <p className="form-error">Son hata: {syncStatus.lastError}</p> : null}
        {saveFirebaseMutation.isSuccess ? <p className="form-success">Firebase ayarları kaydedildi.</p> : null}
        {syncNowMutation.isSuccess ? (
          <p className="form-success">
            {syncNowMutation.data.pushedCount} kayıt gönderildi, {syncNowMutation.data.pulledCount} kayıt alındı.
          </p>
        ) : null}

        <div className="form-actions">
          {showFirebaseAdvanced ? (
            <button
              className="primary-action"
              onClick={() => saveFirebaseMutation.mutate()}
              disabled={saveFirebaseMutation.isPending}
            >
              <Settings size={18} />
              Bağlantıyı Kaydet
            </button>
          ) : null}
          <button className="ghost-action" onClick={() => syncNowMutation.mutate()} disabled={syncNowMutation.isPending}>
            <WifiOff size={18} />
            Şimdi Senkronize Et
          </button>
          <button className="ghost-action" onClick={() => setShowFirebaseAdvanced((value) => !value)}>
            <Settings size={18} />
            {showFirebaseAdvanced ? 'Hesabı Kapat' : 'Online Hesabı Düzenle'}
          </button>
        </div>
      </section>

      <section className="panel settings-panel maintenance-panel" aria-labelledby="reset-title">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Bakım</p>
            <h2 id="reset-title">Gelişmiş Bakım</h2>
          </div>
          <button className="ghost-action compact-button" onClick={() => setShowMaintenanceTools((value) => !value)}>
            {showMaintenanceTools ? 'Kapat' : 'Aç'}
          </button>
        </div>

        {showMaintenanceTools ? (
          <>
            <p className="muted-text">
              Bu alan sadece deneme verilerini temizlemek için kullanılır. Cihaz kodu ve Firebase bağlantı ayarları kalır.
            </p>

            <div className="settings-grid">
              <label>
                <span>Bakım şifresi</span>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  placeholder="Bakım şifresi"
                />
              </label>
              <label>
                <span>Onay metni</span>
                <input
                  value={resetConfirmText}
                  onChange={(event) => setResetConfirmText(event.target.value.toUpperCase())}
                  placeholder="SIFIRLA"
                />
              </label>
            </div>

            {resetDataMutation.isError ? <p className="form-error">{asErrorMessage(resetDataMutation.error)}</p> : null}
            {resetDataMutation.isSuccess ? (
              <p className="form-success">
                Sıfırlama tamamlandı. Yerel {resetDataMutation.data.localDeletedCount} kayıt temizlendi
                {resetDataMutation.data.firebaseSkipped
                  ? '. Firebase ayarı olmadığı için online temizlik atlandı.'
                  : `, Firebase ${resetDataMutation.data.firebaseDeletedCount} kayıt temizlendi.`}
              </p>
            ) : null}

            <button
              className="inline-danger reset-action"
              onClick={() => resetDataMutation.mutate()}
              disabled={!resetPassword.trim() || resetConfirmText !== 'SIFIRLA' || resetDataMutation.isPending}
            >
              Tüm Deneme Verilerini Sıfırla
            </button>
          </>
        ) : (
          <p className="muted-text">Deneme verilerini temizleme aracı kapalıdır.</p>
        )}
      </section>
    </>
  );
}

function DashboardPage({
  setPage
}: {
  setPage: (page: PageKey) => void;
}): JSX.Element {
  const { data: overview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => window.arkTarim.dashboard.getOverview()
  });

  const { data: receipts } = useQuery({
    queryKey: ['purchase-receipts', 'dashboard'],
    queryFn: () => getPurchasesApi().list()
  });

  const today = toInputDate(new Date());
  const todayCompanyRows = Array.from(
    (receipts ?? [])
      .filter((receipt) => receipt.date === today && !receipt.isCancelled)
      .reduce((groups, receipt) => {
        const current = groups.get(receipt.companyId) ?? {
          companyName: receipt.companyName,
          totalGram: 0,
          totalAmountKurus: 0,
          receiptCount: 0
        };

        current.totalGram += receipt.quantityGram;
        current.totalAmountKurus += receipt.totalAmountKurus;
        current.receiptCount += 1;
        groups.set(receipt.companyId, current);

        return groups;
      }, new Map<string, { companyName: string; totalGram: number; totalAmountKurus: number; receiptCount: number }>())
      .values()
  ).sort((first, second) => first.companyName.localeCompare(second.companyName, 'tr-TR'));

  const dashboardStats = [
    { label: 'Bugünkü Alım Kg', value: formatGramAsKg(overview?.todayTotalGram ?? 0) },
    { label: 'Bugünkü Alım Tutarı', value: formatKurus(overview?.todayTotalAmountKurus ?? 0) },
    { label: 'Toplam Çiftçi Bakiyesi', value: formatKurus(overview?.farmerBalanceTotalKurus ?? 0) },
    { label: 'Toplam Firma Bakiyesi', value: formatKurus(overview?.companyBalanceTotalKurus ?? 0) },
    { label: 'Bugün Çiftçilere Ödenen', value: formatKurus(overview?.todayPaidToFarmersKurus ?? 0) },
    { label: 'Bugün Firmalardan Alınan', value: formatKurus(overview?.todayCollectedFromCompaniesKurus ?? 0) },
    { label: 'Toplam Çiftçi Sayısı', value: String(overview?.farmerCount ?? 0) },
    { label: 'Toplam Firma Sayısı', value: String(overview?.companyCount ?? 0) }
  ];

  return (
    <>
      <section className="stats-grid" aria-label="Dashboard">
        {dashboardStats.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </section>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
          <div>
            <p className="eyebrow">Bugün</p>
            <h2>Firma Alımları</h2>
          </div>
          <button className="ghost-action" onClick={() => setPage('purchases')}>
            Liste
          </button>
        </div>
          <DataTable
            columns={['Firma', 'Kg', 'Tutar', 'Fiş']}
            rows={todayCompanyRows.map((row) => [
              row.companyName,
              formatGramAsKg(row.totalGram),
              formatKurus(row.totalAmountKurus),
              String(row.receiptCount)
            ])}
          />
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Kısayol</p>
              <h2>Hızlı İşlemler</h2>
            </div>
          </div>
          <div className="quick-actions">
            <button onClick={() => setPage('purchases')}>
              <ReceiptText size={18} />
              Yeni Alım Fişi
            </button>
            <button onClick={() => setPage('farmerPayments')}>
              <Users size={18} />
              Çiftçi Ödemesi
            </button>
            <button onClick={() => setPage('companyPayments')}>
              <Building2 size={18} />
              Firma Ödemesi
            </button>
            <button onClick={() => setPage('reports')}>
              <BarChart3 size={18} />
              Raporlar
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function toInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function toInputTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${hour}:${minute}`;
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR');
}

function farmerDisplayName(farmer: Pick<FarmerListItem, 'name' | 'nickname'>): string {
  return farmer.nickname ? `${farmer.name} (${farmer.nickname})` : farmer.name;
}

function sortReceiptOldestFirst(a: PurchaseReceiptListItem, b: PurchaseReceiptListItem): number {
  const dateCompare = a.dateKey.localeCompare(b.dateKey);

  if (dateCompare !== 0) {
    return dateCompare;
  }

  return a.timeText.localeCompare(b.timeText);
}

function sortPaymentOldestFirst(a: FarmerPaymentListItem, b: FarmerPaymentListItem): number {
  return a.dateKey.localeCompare(b.dateKey);
}

function sortCompanyPaymentOldestFirst(a: CompanyPaymentListItem, b: CompanyPaymentListItem): number {
  return a.dateKey.localeCompare(b.dateKey);
}

function PurchasesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const now = new Date();
  const [quantityKg, setQuantityKg] = useState('');
  const [crateCountText, setCrateCountText] = useState('');
  const [crateTareKg, setCrateTareKg] = useState('2');
  const [unitPriceTl, setUnitPriceTl] = useState('');
  const [farmerSearch, setFarmerSearch] = useState('');
  const [isFarmerSearchOpen, setIsFarmerSearchOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; receiptNo: string; reason: string } | null>(null);
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [printReceipt, setPrintReceipt] = useState<PurchaseReceiptListItem | null>(null);
  const [form, setForm] = useState<SavePurchaseReceiptInput>({
    date: toInputDate(now),
    timeText: toInputTime(now),
    farmerId: '',
    companyId: '',
    apricotTypeId: '',
    quantityGram: 0,
    unitPriceKurus: 0,
    note: ''
  });

  const { data: farmers } = useQuery({
    queryKey: ['farmers', 'purchase-form'],
    queryFn: () => window.arkTarim.farmers.list()
  });

  const { data: companies } = useQuery({
    queryKey: ['companies', 'purchase-form'],
    queryFn: () => window.arkTarim.companies.list()
  });

  const { data: apricotTypes } = useQuery({
    queryKey: ['apricot-types'],
    queryFn: () => window.arkTarim.apricotTypes.list()
  });

  const { data: receipts } = useQuery({
    queryKey: ['purchase-receipts'],
    queryFn: () => getPurchasesApi().list()
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => getPurchasesApi().cancel({ id, reason }),
    onSuccess: () => {
      setCancelTarget(null);
      setCancelReasonError(null);
      invalidateOperationalQueries(queryClient);
    }
  });

  const activeFarmers = (farmers ?? []).filter((farmer) => farmer.isActive);
  const filteredFarmers = activeFarmers.filter((farmer) => {
    const query = normalizeSearch(farmerSearch);

    if (!query) {
      return true;
    }

    return [farmer.name, farmer.nickname ?? '', farmer.phone ?? '', farmer.village ?? '']
      .map((value) => normalizeSearch(value))
      .some((value) => value.includes(query));
  });
  const activeCompanies = (companies ?? []).filter((company) => company.isActive);
  const activeApricotTypes = (apricotTypes ?? []).filter((type) => type.isActive);
  const grossQuantityGram = parseKgToGram(quantityKg);
  const crateCount = Math.max(0, Math.round(Number(crateCountText || 0)));
  const crateTareGram = parseKgToGram(crateTareKg);
  const tareGram = crateCount * crateTareGram;
  const quantityGram = Math.max(0, grossQuantityGram - tareGram);
  const unitPriceKurus = parseTlToKurus(unitPriceTl);
  const totalAmountKurus = Math.round((quantityGram * unitPriceKurus) / 1000);

  const createMutation = useMutation({
    mutationFn: (shouldPrint: boolean) =>
      getPurchasesApi().create({
        ...form,
        grossQuantityGram,
        crateCount,
        crateTareGram,
        quantityGram,
        unitPriceKurus
      }),
    onSuccess: (receipt, shouldPrint) => {
      setQuantityKg('');
      setCrateCountText('');
      setForm((value) => ({
        ...value,
        date: toInputDate(new Date()),
        timeText: toInputTime(new Date()),
        farmerId: '',
        quantityGram: 0,
        unitPriceKurus: 0,
        note: ''
      }));
      setFarmerSearch('');
      setIsFarmerSearchOpen(false);
      if (shouldPrint) {
        setPrintReceipt(receipt);
      }
      invalidateOperationalQueries(queryClient);
    }
  });

  return (
    <>
      {printReceipt ? <ReceiptPrintPreview receipt={printReceipt} onClose={() => setPrintReceipt(null)} /> : null}
      <div className="purchase-grid">
      <section className="panel purchase-form-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Alım</p>
            <h2>Yeni Alım Fişi</h2>
          </div>
          <span className="status-pill ready">2026</span>
        </div>

        <div className="form-grid purchase-form-grid">
          <label>
            <span>Tarih</span>
            <input
              type="date"
              value={form.date}
              onChange={(event) => setForm((value) => ({ ...value, date: event.target.value }))}
            />
          </label>
          <label>
            <span>Saat</span>
            <input
              type="time"
              value={form.timeText}
              onChange={(event) => setForm((value) => ({ ...value, timeText: event.target.value }))}
            />
          </label>
          <div className="combo-field">
            <label>
              <span>Çiftçi</span>
              <input
                value={farmerSearch}
                onFocus={() => setIsFarmerSearchOpen(true)}
                onChange={(event) => {
                  const value = event.target.value;
                  setFarmerSearch(value);
                  setIsFarmerSearchOpen(true);
                  const selectedFarmer = activeFarmers.find((farmer) => farmer.id === form.farmerId);

                  if (selectedFarmer && normalizeSearch(farmerDisplayName(selectedFarmer)) !== normalizeSearch(value)) {
                    setForm((current) => ({ ...current, farmerId: '' }));
                  }
                }}
                placeholder="Çiftçi adı, telefon veya köy yaz"
              />
            </label>
            {isFarmerSearchOpen ? (
              <div className="combo-results">
                {filteredFarmers.length === 0 ? (
                  <div className="combo-empty">Eşleşen çiftçi yok.</div>
                ) : (
                  filteredFarmers.slice(0, 8).map((farmer) => (
                    <button
                      type="button"
                      key={farmer.id}
                      className={form.farmerId === farmer.id ? 'combo-option selected' : 'combo-option'}
                      onClick={() => {
                        setForm((value) => ({ ...value, farmerId: farmer.id }));
                        setFarmerSearch(farmerDisplayName(farmer));
                        setIsFarmerSearchOpen(false);
                      }}
                    >
                      <strong>{farmerDisplayName(farmer)}</strong>
                      <span>{[farmer.village, farmer.phone].filter(Boolean).join(' · ') || 'Bilgi yok'}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <label>
            <span>Firma</span>
            <select
              value={form.companyId}
              onChange={(event) => setForm((value) => ({ ...value, companyId: event.target.value }))}
            >
              <option value="">Seç</option>
              {activeCompanies.map((company) => (
                <option value={company.id} key={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Kayısı cinsi</span>
            <select
              value={form.apricotTypeId}
              onChange={(event) => setForm((value) => ({ ...value, apricotTypeId: event.target.value }))}
            >
              <option value="">Seç</option>
              {activeApricotTypes.map((type) => (
                <option value={type.id} key={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Brüt kg</span>
            <input
              autoFocus
              inputMode="decimal"
              value={quantityKg}
              onChange={(event) => setQuantityKg(event.target.value)}
              placeholder="1000"
            />
          </label>
          <label>
            <span>Kasa adedi</span>
            <input
              inputMode="numeric"
              value={crateCountText}
              onChange={(event) => setCrateCountText(event.target.value)}
              placeholder="0"
            />
          </label>
          <label>
            <span>Kasa darası</span>
            <select value={crateTareKg} onChange={(event) => setCrateTareKg(event.target.value)}>
              <option value="1">1 kg</option>
              <option value="2">2 kg</option>
              <option value="3">3 kg</option>
              <option value="4">4 kg</option>
            </select>
          </label>
          <div className="net-weight-box">
            <span>Net kg</span>
            <strong>{formatGramAsKg(quantityGram)}</strong>
            <small>Dara: {formatGramAsKg(tareGram)}</small>
          </div>
          <label>
            <span>Birim fiyat</span>
            <input
              inputMode="decimal"
              value={unitPriceTl}
              onChange={(event) => setUnitPriceTl(event.target.value)}
              placeholder="24"
            />
          </label>
          <label>
            <span>Toplam</span>
            <input value={formatKurus(totalAmountKurus)} readOnly />
          </label>
        </div>

        <label className="full-label">
          <span>Not</span>
          <input
            value={form.note ?? ''}
            onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))}
          />
        </label>

        {createMutation.isError ? <p className="form-error">{asErrorMessage(createMutation.error)}</p> : null}
        {createMutation.isSuccess ? (
          <p className="form-success">Fiş kaydedildi: {createMutation.data.receiptNo}</p>
        ) : null}

        <div className="form-actions">
          <button
            className="primary-action"
            onClick={() => createMutation.mutate(false)}
            disabled={createMutation.isPending}
          >
            <ReceiptText size={18} />
            Kaydet
          </button>
          <button
            className="ghost-action"
            onClick={() => createMutation.mutate(true)}
            disabled={createMutation.isPending}
          >
            <Printer size={18} />
            Kaydet ve Yazdır
          </button>
          <button
            className="ghost-action"
            onClick={() => {
              setQuantityKg('');
              setCrateCountText('');
              setCrateTareKg('2');
              setUnitPriceTl('');
              setForm((value) => ({
                ...value,
                farmerId: '',
                note: '',
                quantityGram: 0,
                unitPriceKurus: 0
              }));
            }}
          >
            Temizle
          </button>
        </div>
      </section>

      <section className="panel list-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Son kayıtlar</p>
            <h2>Alım Fişleri</h2>
          </div>
        </div>
        {cancelMutation.isError ? <p className="form-error">{asErrorMessage(cancelMutation.error)}</p> : null}
        {cancelMutation.isSuccess ? <p className="form-success">Fiş iptal edildi.</p> : null}
        {cancelTarget ? (
          <div className="cancel-box">
            <div>
              <strong>{cancelTarget.receiptNo} iptal edilecek</strong>
              <span>İptal nedeni girip onayla.</span>
            </div>
            <input
              autoFocus
              value={cancelTarget.reason}
              onChange={(event) => {
                setCancelReasonError(null);
                setCancelTarget((value) => (value ? { ...value, reason: event.target.value } : value));
              }}
              placeholder="Örn. yanlış kg girildi"
            />
            {cancelReasonError ? <p className="form-error">{cancelReasonError}</p> : null}
            <div className="form-actions">
              <button
                className="inline-danger"
                disabled={cancelMutation.isPending}
                onClick={() => {
                  const reason = cancelTarget.reason.trim();

                  if (!reason) {
                    setCancelReasonError('İptal nedeni yazılmalı.');
                    return;
                  }

                  cancelMutation.mutate({ id: cancelTarget.id, reason });
                }}
              >
                İptali Onayla
              </button>
              <button className="ghost-action" onClick={() => setCancelTarget(null)}>
                Vazgeç
              </button>
            </div>
          </div>
        ) : null}
        <DataTable
          columns={['Fiş No', 'Tarih', 'Çiftçi', 'Firma', 'Cins', 'Kg', 'Tutar', 'Durum', 'İşlem']}
          rows={(receipts ?? []).map((receipt) => [
            receipt.receiptNo,
            `${formatDateTr(receipt.date)} ${receipt.timeText}`,
            receipt.farmerName,
            receipt.companyName,
            receipt.apricotTypeName,
            `${formatGramAsKg(receipt.grossQuantityGram || receipt.quantityGram)} brüt / ${formatGramAsKg(receipt.quantityGram)} net`,
            formatKurus(receipt.totalAmountKurus),
            receipt.isCancelled ? 'İptal' : 'Geçerli',
            receipt.isCancelled ? (
              <button className="ghost-action compact-button" key={receipt.id} onClick={() => setPrintReceipt(receipt)}>
                Yazdır
              </button>
            ) : (
              <div className="row-actions" key={receipt.id}>
                <button className="ghost-action compact-button" onClick={() => setPrintReceipt(receipt)}>
                  Yazdır
                </button>
                <button
                  className="inline-danger"
                  disabled={cancelMutation.isPending}
                  onClick={() => {
                    setCancelReasonError(null);
                    setCancelTarget({ id: receipt.id, receiptNo: receipt.receiptNo, reason: '' });
                  }}
                >
                  İptal Et
                </button>
              </div>
            )
          ])}
        />
      </section>
      </div>
    </>
  );
}

function ReceiptPrintPreview({
  receipt,
  onClose
}: {
  receipt: PurchaseReceiptListItem;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="print-modal">
      <div className="print-actions">
        <button className="primary-action" onClick={() => window.print()}>
          <Printer size={18} />
          Yazdır
        </button>
        <button className="ghost-action" onClick={onClose}>
          Kapat
        </button>
      </div>

      <div className="print-size-hint">Alım fişi A5 dikey boyutta hazırlanır. Yazıcı ekranında kağıt boyutu A5 seçili olmalı.</div>

      <article className="receipt-print-sheet">
        <section className="receipt-print-copy">
        <div className="receipt-copy-label">ÇİFTÇİ NÜSHASI</div>
        <header className="receipt-print-header">
          <img src={arkLogoUrl} alt="" aria-hidden="true" />
          <div>
            <h2>Ali Rıza Karga TARIM</h2>
            <strong>KAYISI ALIM FİŞİ</strong>
          </div>
          {receipt.isCancelled ? <span>İPTAL</span> : null}
        </header>

        <section className="receipt-print-meta">
          <div>
            <span>Fiş No</span>
            <strong>{receipt.receiptNo}</strong>
          </div>
          <div>
            <span>Tarih</span>
            <strong>{formatDateTr(receipt.date)}</strong>
          </div>
          <div>
            <span>Saat</span>
            <strong>{receipt.timeText}</strong>
          </div>
        </section>

        <section className="receipt-print-table">
          <div>
            <span>Çiftçi / Müstahsil</span>
            <strong>{receipt.farmerName}</strong>
          </div>
          <div>
            <span>Firma</span>
            <strong>{receipt.companyName}</strong>
          </div>
          <div>
            <span>Kayısı Cinsi</span>
            <strong>{receipt.apricotTypeName}</strong>
          </div>
          <div>
            <span>Miktar</span>
            <strong>{formatGramAsKg(receipt.grossQuantityGram || receipt.quantityGram)} brüt</strong>
          </div>
          <div>
            <span>Kasa / Dara</span>
            <strong>{receipt.crateCount ? `${receipt.crateCount} kasa x ${formatGramAsKg(receipt.crateTareGram)}` : '-'}</strong>
          </div>
          <div>
            <span>Net Miktar</span>
            <strong>{formatGramAsKg(receipt.quantityGram)}</strong>
          </div>
          <div>
            <span>Birim Fiyat</span>
            <strong>{formatKurus(receipt.unitPriceKurus)}</strong>
          </div>
          <div>
            <span>Toplam Tutar</span>
            <strong>{formatKurus(receipt.totalAmountKurus)}</strong>
          </div>
        </section>

        <section className="receipt-print-note">
          <span>Not</span>
          <p>{receipt.note ?? '-'}</p>
        </section>

        <footer className="receipt-print-signatures">
          <div>
            <span>Teslim Eden</span>
          </div>
          <div>
            <span>Teslim Alan</span>
          </div>
        </footer>
        </section>
        <div className="receipt-cut-line"><span>Kesim çizgisi</span></div>
        <section className="receipt-print-copy">
        <div className="receipt-copy-label">ARŞİV NÜSHASI</div>
        <header className="receipt-print-header">
          <img src={arkLogoUrl} alt="" aria-hidden="true" />
          <div>
            <h2>Ali Rıza Karga TARIM</h2>
            <strong>KAYISI ALIM FİŞİ</strong>
          </div>
          {receipt.isCancelled ? <span>İPTAL</span> : null}
        </header>

        <section className="receipt-print-meta">
          <div>
            <span>Fiş No</span>
            <strong>{receipt.receiptNo}</strong>
          </div>
          <div>
            <span>Tarih</span>
            <strong>{formatDateTr(receipt.date)}</strong>
          </div>
          <div>
            <span>Saat</span>
            <strong>{receipt.timeText}</strong>
          </div>
        </section>

        <section className="receipt-print-table">
          <div>
            <span>Çiftçi / Müstahsil</span>
            <strong>{receipt.farmerName}</strong>
          </div>
          <div>
            <span>Firma</span>
            <strong>{receipt.companyName}</strong>
          </div>
          <div>
            <span>Kayısı Cinsi</span>
            <strong>{receipt.apricotTypeName}</strong>
          </div>
          <div>
            <span>Miktar</span>
            <strong>{formatGramAsKg(receipt.grossQuantityGram || receipt.quantityGram)} brüt</strong>
          </div>
          <div>
            <span>Kasa / Dara</span>
            <strong>{receipt.crateCount ? `${receipt.crateCount} kasa x ${formatGramAsKg(receipt.crateTareGram)}` : '-'}</strong>
          </div>
          <div>
            <span>Net Miktar</span>
            <strong>{formatGramAsKg(receipt.quantityGram)}</strong>
          </div>
          <div>
            <span>Birim Fiyat</span>
            <strong>{formatKurus(receipt.unitPriceKurus)}</strong>
          </div>
          <div>
            <span>Toplam Tutar</span>
            <strong>{formatKurus(receipt.totalAmountKurus)}</strong>
          </div>
        </section>

        <section className="receipt-print-note">
          <span>Not</span>
          <p>{receipt.note ?? '-'}</p>
        </section>

        <footer className="receipt-print-signatures">
          <div>
            <span>Teslim Eden</span>
          </div>
          <div>
            <span>Teslim Alan</span>
          </div>
        </footer>
        </section>
      </article>
    </div>
  );
}

function FarmersPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<FarmerListItem | null>(null);
  const [selectedFarmerId, setSelectedFarmerId] = useState('');
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [printTarget, setPrintTarget] = useState<ReportPrintTarget | null>(null);
  const [form, setForm] = useState<SaveFarmerInput>({ name: '', nickname: '', phone: '', village: '', note: '' });

  const { data: farmers } = useQuery({
    queryKey: ['farmers', search],
    queryFn: () => window.arkTarim.farmers.list(search)
  });

  const { data: receipts } = useQuery({
    queryKey: ['purchase-receipts', 'farmers-account'],
    queryFn: () => getPurchasesApi().list()
  });

  const { data: farmerPayments } = useQuery({
    queryKey: ['farmer-payments', 'farmers-account'],
    queryFn: () => window.arkTarim.farmerPayments.list()
  });

  useEffect(() => {
    if (!farmers?.length) {
      setSelectedFarmerId('');
      return;
    }

    if (!selectedFarmerId || !farmers.some((farmer) => farmer.id === selectedFarmerId)) {
      setSelectedFarmerId(farmers[0].id);
    }
  }, [farmers, selectedFarmerId]);

  useEffect(() => {
    if (!editing) {
      setForm({ name: '', nickname: '', phone: '', village: '', note: '' });
      return;
    }

    setForm({
      id: editing.id,
      name: editing.name,
      nickname: editing.nickname ?? '',
      phone: editing.phone ?? '',
      village: editing.village ?? '',
      note: editing.note ?? '',
      isActive: editing.isActive
    });
  }, [editing]);

  const saveMutation = useMutation({
    mutationFn: () => window.arkTarim.farmers.save(form),
    onSuccess: () => {
      setEditing(null);
      invalidateOperationalQueries(queryClient);
    }
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => window.arkTarim.farmers.deactivate(id),
    onSuccess: () => invalidateOperationalQueries(queryClient)
  });

  const selectedFarmer = useMemo(
    () => (farmers ?? []).find((farmer) => farmer.id === selectedFarmerId) ?? null,
    [farmers, selectedFarmerId]
  );

  const farmerReceipts = useMemo(
    () =>
      (receipts ?? [])
        .filter((receipt) => selectedFarmer && receipt.farmerId === selectedFarmer.id && !receipt.isCancelled)
        .sort(sortReceiptOldestFirst),
    [receipts, selectedFarmer]
  );

  const activeFarmerPayments = useMemo(
    () =>
      (farmerPayments ?? [])
        .filter((payment) => selectedFarmer && payment.farmerId === selectedFarmer.id && !payment.isCancelled)
        .sort(sortPaymentOldestFirst),
    [farmerPayments, selectedFarmer]
  );

  const farmerStatement = useMemo(() => {
    if (!selectedFarmer) {
      return null;
    }

    return {
      farmer: selectedFarmer,
      receipts: farmerReceipts,
      payments: activeFarmerPayments,
      totalGram: selectedFarmer.totalGram,
      totalPurchaseKurus: selectedFarmer.totalAmountKurus,
      paidKurus: selectedFarmer.paidAmountKurus,
      balanceKurus: selectedFarmer.balanceKurus
    } satisfies FarmerStatementPrintData;
  }, [activeFarmerPayments, farmerReceipts, selectedFarmer]);

  return (
    <>
      {printTarget ? <ReportPrintPreview target={printTarget} onClose={() => setPrintTarget(null)} /> : null}
      {isAccountOpen ? (
        <AccountModal title="Çiftçi Cari Penceresi" onClose={() => setIsAccountOpen(false)}>
          <FarmerAccountPanel
            statement={farmerStatement}
            onPrint={() => {
              if (farmerStatement) {
                setPrintTarget({ kind: 'farmerStatement', data: farmerStatement });
              }
            }}
          />
        </AccountModal>
      ) : null}
      <CrudLayout
        eyebrow="Ana kayıt"
        title="Çiftçiler"
        description="Müstahsil kayıtlarını ve şahsi cari hareketlerini buradan izle."
        form={
          <>
            <div className="form-grid">
              <label>
                <span>Ad soyad</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                />
              </label>
              <label>
                <span>Lakap</span>
                <input
                  value={form.nickname ?? ''}
                  onChange={(event) => setForm((value) => ({ ...value, nickname: event.target.value }))}
                  placeholder="Aynı isim varsa zorunlu"
                />
              </label>
              <label>
                <span>Telefon</span>
                <input
                  value={form.phone ?? ''}
                  onChange={(event) => setForm((value) => ({ ...value, phone: event.target.value }))}
                />
              </label>
              <label>
                <span>Köy</span>
                <input
                  value={form.village ?? ''}
                  onChange={(event) => setForm((value) => ({ ...value, village: event.target.value }))}
                />
              </label>
              <label>
                <span>Not</span>
                <input
                  value={form.note ?? ''}
                  onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))}
                />
              </label>
            </div>
            {saveMutation.isError ? <p className="form-error">{asErrorMessage(saveMutation.error)}</p> : null}
            <div className="form-actions">
              <button className="primary-action" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {editing ? 'Güncelle' : 'Kaydet'}
              </button>
              {editing ? (
                <button className="ghost-action" onClick={() => setEditing(null)}>
                  Vazgeç
                </button>
              ) : null}
            </div>
          </>
        }
        list={
          <>
            <ListToolbar search={search} onSearchChange={setSearch} placeholder="Çiftçi ara" />
            <DataTable
              columns={['Ad', 'Telefon', 'Köy', 'Kg', 'Alım', 'Alacak', 'Fiş', 'İşlem']}
              rows={(farmers ?? []).map((farmer) => ({
                className: 'clickable-row',
                onClick: () => {
                  setSelectedFarmerId(farmer.id);
                  setIsAccountOpen(true);
                },
                cells: [
                  farmerDisplayName(farmer),
                  farmer.phone ?? '-',
                  farmer.village ?? '-',
                  formatGramAsKg(farmer.totalGram),
                  formatKurus(farmer.totalAmountKurus),
                  formatKurus(farmer.balanceKurus),
                  String(farmer.receiptCount),
                  <div className="row-actions" key={farmer.id}>
                    <RowActions
                      onEdit={() => {
                        setSelectedFarmerId(farmer.id);
                        setEditing(farmer);
                      }}
                      onDeactivate={() => {
                        if (window.confirm(`${farmerDisplayName(farmer)} kaydı pasifleştirilsin mi?`)) {
                          deactivateMutation.mutate(farmer.id);
                        }
                      }}
                    />
                  </div>
                ]
              }))}
            />
          </>
        }
      />
    </>
  );
}

function FarmerAccountPanel({
  statement,
  onPrint
}: {
  statement: FarmerStatementPrintData | null;
  onPrint: () => void;
}): JSX.Element {
  if (!statement) {
    return (
      <section className="account-panel">
        <div className="account-empty">
          <p className="eyebrow">Şahsi pencere</p>
          <h3>Çiftçi seç</h3>
          <span>Listeden bir çiftçi seçince toplam ürün, alacak ve hareketleri burada görünür.</span>
        </div>
      </section>
    );
  }

  const recentReceipts = [...statement.receipts].reverse().slice(0, 8);
  const recentPayments = [...statement.payments].reverse().slice(0, 6);

  return (
    <section className="account-panel">
      <div className="account-hero">
        <div>
          <p className="eyebrow">Şahsi pencere</p>
          <h3>{farmerDisplayName(statement.farmer)}</h3>
          <span>{[statement.farmer.village, statement.farmer.phone].filter(Boolean).join(' · ') || 'Bilgi yok'}</span>
        </div>
        <div className={statement.balanceKurus > 0 ? 'account-balance due' : 'account-balance clear'}>
          <span>Kalan alacak</span>
          <strong>{formatKurus(statement.balanceKurus)}</strong>
        </div>
      </div>

      <div className="account-stats">
        <article>
          <span>Toplam ürün</span>
          <strong>{formatGramAsKg(statement.totalGram)}</strong>
        </article>
        <article>
          <span>Toplam alım</span>
          <strong>{formatKurus(statement.totalPurchaseKurus)}</strong>
        </article>
        <article>
          <span>Ödenen</span>
          <strong>{formatKurus(statement.paidKurus)}</strong>
        </article>
        <article>
          <span>Fiş</span>
          <strong>{statement.farmer.receiptCount}</strong>
        </article>
      </div>

      <div className="account-actions">
        <button className="ghost-action" onClick={onPrint}>
          <Printer size={18} />
          Ekstre Yazdır
        </button>
      </div>

      <AccountSection title="Son Alım Fişleri" count={statement.receipts.length}>
        {recentReceipts.map((receipt) => (
          <article className="account-row" key={receipt.id}>
            <div>
              <strong>{formatDateTr(receipt.date)} · {receipt.receiptNo}</strong>
              <span>{receipt.companyName} · {receipt.apricotTypeName}</span>
            </div>
            <div>
              <strong>{formatGramAsKg(receipt.quantityGram)}</strong>
              <span>{formatKurus(receipt.totalAmountKurus)}</span>
            </div>
          </article>
        ))}
        {recentReceipts.length === 0 ? <p className="account-empty-line">Alım fişi yok.</p> : null}
      </AccountSection>

      <AccountSection title="Ödemeler" count={statement.payments.length}>
        {recentPayments.map((payment) => (
          <article className="account-row" key={payment.id}>
            <div>
              <strong>{formatDateTr(payment.date)}</strong>
              <span>{paymentMethodLabel(payment.paymentMethod)}{payment.note ? ` · ${payment.note}` : ''}</span>
            </div>
            <div>
              <strong>{formatKurus(payment.amountKurus)}</strong>
            </div>
          </article>
        ))}
        {recentPayments.length === 0 ? <p className="account-empty-line">Ödeme yok.</p> : null}
      </AccountSection>
    </section>
  );
}

function CompaniesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CompanyListItem | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [printTarget, setPrintTarget] = useState<ReportPrintTarget | null>(null);
  const [form, setForm] = useState<SaveCompanyInput>({
    name: '',
    authorizedPerson: '',
    phone: '',
    city: '',
    note: ''
  });

  const { data: companies } = useQuery({
    queryKey: ['companies', search],
    queryFn: () => window.arkTarim.companies.list(search)
  });

  const { data: receipts } = useQuery({
    queryKey: ['purchase-receipts', 'companies-account'],
    queryFn: () => getPurchasesApi().list()
  });

  const { data: companyPayments } = useQuery({
    queryKey: ['company-payments', 'companies-account'],
    queryFn: () => window.arkTarim.companyPayments.list()
  });

  useEffect(() => {
    if (!companies?.length) {
      setSelectedCompanyId('');
      return;
    }

    if (!selectedCompanyId || !companies.some((company) => company.id === selectedCompanyId)) {
      setSelectedCompanyId(companies[0].id);
    }
  }, [companies, selectedCompanyId]);

  useEffect(() => {
    if (!editing) {
      setForm({ name: '', authorizedPerson: '', phone: '', city: '', note: '' });
      return;
    }

    setForm({
      id: editing.id,
      name: editing.name,
      authorizedPerson: editing.authorizedPerson ?? '',
      phone: editing.phone ?? '',
      city: editing.city ?? '',
      note: editing.note ?? '',
      isActive: editing.isActive
    });
  }, [editing]);

  const saveMutation = useMutation({
    mutationFn: () => window.arkTarim.companies.save(form),
    onSuccess: () => {
      setEditing(null);
      invalidateOperationalQueries(queryClient);
    }
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => window.arkTarim.companies.deactivate(id),
    onSuccess: () => invalidateOperationalQueries(queryClient)
  });

  const selectedCompany = useMemo(
    () => (companies ?? []).find((company) => company.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  );

  const companyReceipts = useMemo(
    () =>
      (receipts ?? [])
        .filter((receipt) => selectedCompany && receipt.companyId === selectedCompany.id && !receipt.isCancelled)
        .sort(sortReceiptOldestFirst),
    [receipts, selectedCompany]
  );

  const activeCompanyPayments = useMemo(
    () =>
      (companyPayments ?? [])
        .filter((payment) => selectedCompany && payment.companyId === selectedCompany.id && !payment.isCancelled)
        .sort(sortCompanyPaymentOldestFirst),
    [companyPayments, selectedCompany]
  );

  const companyDailyRows = useMemo(() => {
    const grouped = new Map<string, CompanyAccountDailyRow>();

    for (const receipt of companyReceipts) {
      const current =
        grouped.get(receipt.dateKey) ??
        ({
          date: receipt.date,
          dateKey: receipt.dateKey,
          totalGram: 0,
          totalAmountKurus: 0,
          receiptCount: 0
        } satisfies CompanyAccountDailyRow);

      current.totalGram += receipt.quantityGram;
      current.totalAmountKurus += receipt.totalAmountKurus;
      current.receiptCount += 1;
      grouped.set(receipt.dateKey, current);
    }

    return Array.from(grouped.values()).sort((first, second) => second.dateKey.localeCompare(first.dateKey));
  }, [companyReceipts]);

  const companyDailyPrintReports = useMemo(() => {
    if (!selectedCompany) {
      return new Map<string, CompanyDailyPrintData>();
    }

    const reports = new Map<string, CompanyDailyPrintData>();

    for (const receipt of companyReceipts) {
      const current =
        reports.get(receipt.dateKey) ??
        ({
          companyId: selectedCompany.id,
          companyName: selectedCompany.name,
          date: receipt.date,
          dateKey: receipt.dateKey,
          receipts: [],
          totalGram: 0,
          totalAmountKurus: 0,
          receiptCount: 0
        } satisfies CompanyDailyPrintData);

      current.receipts.push(receipt);
      current.totalGram += receipt.quantityGram;
      current.totalAmountKurus += receipt.totalAmountKurus;
      current.receiptCount += 1;
      reports.set(receipt.dateKey, current);
    }

    for (const report of reports.values()) {
      report.receipts = [...report.receipts].sort(sortReceiptOldestFirst);
    }

    return reports;
  }, [companyReceipts, selectedCompany]);

  return (
    <>
      {printTarget ? <ReportPrintPreview target={printTarget} onClose={() => setPrintTarget(null)} /> : null}
      {isAccountOpen ? (
        <AccountModal title="Firma Cari Penceresi" onClose={() => setIsAccountOpen(false)}>
          <CompanyAccountPanel
            company={selectedCompany}
            receipts={companyReceipts}
            payments={activeCompanyPayments}
            dailyRows={companyDailyRows}
            onPrintDaily={(dateKey) => {
              const report = companyDailyPrintReports.get(dateKey);

              if (report) {
                setPrintTarget({ kind: 'companyDaily', data: report });
              }
            }}
          />
        </AccountModal>
      ) : null}
      <CrudLayout
        eyebrow="Ana kayıt"
        title="Firmalar"
        description="Kayısı alımı yapılan firmaların cari ve günlük alım hareketlerini yönet."
        form={
          <>
            <div className="form-grid">
              <label>
                <span>Firma adı</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                />
              </label>
              <label>
                <span>Yetkili</span>
                <input
                  value={form.authorizedPerson ?? ''}
                  onChange={(event) => setForm((value) => ({ ...value, authorizedPerson: event.target.value }))}
                />
              </label>
              <label>
                <span>Telefon</span>
                <input
                  value={form.phone ?? ''}
                  onChange={(event) => setForm((value) => ({ ...value, phone: event.target.value }))}
                />
              </label>
              <label>
                <span>Şehir</span>
                <input
                  value={form.city ?? ''}
                  onChange={(event) => setForm((value) => ({ ...value, city: event.target.value }))}
                />
              </label>
            </div>
            <label className="full-label">
              <span>Not</span>
              <input
                value={form.note ?? ''}
                onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))}
              />
            </label>
            {saveMutation.isError ? <p className="form-error">{asErrorMessage(saveMutation.error)}</p> : null}
            <div className="form-actions">
              <button className="primary-action" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {editing ? 'Güncelle' : 'Kaydet'}
              </button>
              {editing ? (
                <button className="ghost-action" onClick={() => setEditing(null)}>
                  Vazgeç
                </button>
              ) : null}
            </div>
          </>
        }
        list={
          <>
            <ListToolbar search={search} onSearchChange={setSearch} placeholder="Firma ara" />
            <DataTable
              columns={['Firma', 'Yetkili', 'Şehir', 'Kg', 'Alım', 'Bakiye', 'Fiş', 'İşlem']}
              rows={(companies ?? []).map((company) => ({
                className: 'clickable-row',
                onClick: () => {
                  setSelectedCompanyId(company.id);
                  setIsAccountOpen(true);
                },
                cells: [
                  company.name,
                  company.authorizedPerson ?? '-',
                  company.city ?? '-',
                  formatGramAsKg(company.totalGram),
                  formatKurus(company.totalAmountKurus),
                  formatKurus(company.balanceKurus),
                  String(company.receiptCount),
                  <div className="row-actions" key={company.id}>
                    <RowActions
                      onEdit={() => {
                        setSelectedCompanyId(company.id);
                        setEditing(company);
                      }}
                      onDeactivate={() => {
                        if (window.confirm(`${company.name} kaydı pasifleştirilsin mi?`)) {
                          deactivateMutation.mutate(company.id);
                        }
                      }}
                    />
                  </div>
                ]
              }))}
            />
          </>
        }
      />
    </>
  );
}

function CompanyAccountPanel({
  company,
  receipts,
  payments,
  dailyRows,
  onPrintDaily
}: {
  company: CompanyListItem | null;
  receipts: PurchaseReceiptListItem[];
  payments: CompanyPaymentListItem[];
  dailyRows: CompanyAccountDailyRow[];
  onPrintDaily: (dateKey: string) => void;
}): JSX.Element {
  const [selectedDateKey, setSelectedDateKey] = useState('');

  useEffect(() => {
    const firstDateKey = dailyRows[0]?.dateKey ?? '';

    if (!firstDateKey) {
      if (selectedDateKey) {
        setSelectedDateKey('');
      }
      return;
    }

    if (!dailyRows.some((row) => row.dateKey === selectedDateKey)) {
      setSelectedDateKey(firstDateKey);
    }
  }, [dailyRows, selectedDateKey]);

  const selectedDay = dailyRows.find((row) => row.dateKey === selectedDateKey) ?? null;
  const selectedDayReceipts = useMemo(
    () => receipts.filter((receipt) => receipt.dateKey === selectedDateKey),
    [receipts, selectedDateKey]
  );

  if (!company) {
    return (
      <section className="account-panel">
        <div className="account-empty">
          <p className="eyebrow">Firma penceresi</p>
          <h3>Firma seç</h3>
          <span>Listeden bir firma seçince gün gün alım ve tahsilat hareketleri burada görünür.</span>
        </div>
      </section>
    );
  }

  const recentPayments = [...payments].reverse().slice(0, 6);

  return (
    <section className="account-panel">
      <div className="account-hero">
        <div>
          <p className="eyebrow">Firma penceresi</p>
          <h3>{company.name}</h3>
          <span>{[company.authorizedPerson, company.city, company.phone].filter(Boolean).join(' · ') || 'Bilgi yok'}</span>
        </div>
        <div className={company.balanceKurus > 0 ? 'account-balance due' : 'account-balance clear'}>
          <span>Firma bakiyesi</span>
          <strong>{formatKurus(company.balanceKurus)}</strong>
        </div>
      </div>

      <div className="account-stats">
        <article>
          <span>Toplam ürün</span>
          <strong>{formatGramAsKg(company.totalGram)}</strong>
        </article>
        <article>
          <span>Toplam alım</span>
          <strong>{formatKurus(company.totalAmountKurus)}</strong>
        </article>
        <article>
          <span>Tahsilat</span>
          <strong>{formatKurus(company.collectedAmountKurus)}</strong>
        </article>
        <article>
          <span>Fiş</span>
          <strong>{company.receiptCount}</strong>
        </article>
      </div>

      <AccountSection title="Gün Gün Alım" count={dailyRows.length}>
        {dailyRows.map((row) => (
          <button
            className={`account-row-button ${selectedDateKey === row.dateKey ? 'selected' : ''}`}
            key={row.dateKey}
            onClick={() => setSelectedDateKey(row.dateKey)}
            type="button"
          >
            <article className="account-row action-row">
              <div>
                <strong>{formatDateTr(row.date)}</strong>
                <span>{row.receiptCount} fiş · {formatKurus(row.totalAmountKurus)}</span>
              </div>
              <div>
                <strong>{formatGramAsKg(row.totalGram)}</strong>
                <button
                  className="inline-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPrintDaily(row.dateKey);
                  }}
                >
                  Yazdır
                </button>
              </div>
            </article>
          </button>
        ))}
        {dailyRows.length === 0 ? <p className="account-empty-line">Günlük alım yok.</p> : null}
      </AccountSection>

      <AccountSection title={selectedDay ? `${formatDateTr(selectedDay.date)} Fişleri` : 'Gün Fişleri'} count={selectedDayReceipts.length}>
        {selectedDayReceipts.map((receipt) => (
          <article className="account-row" key={receipt.id}>
            <div>
              <strong>{formatDateTr(receipt.date)} · {receipt.receiptNo}</strong>
              <span>{receipt.farmerName} · {receipt.apricotTypeName}</span>
            </div>
            <div>
              <strong>{formatGramAsKg(receipt.quantityGram)}</strong>
              <span>{formatKurus(receipt.totalAmountKurus)}</span>
            </div>
          </article>
        ))}
        {selectedDayReceipts.length === 0 ? <p className="account-empty-line">Seçili güne ait fiş yok.</p> : null}
      </AccountSection>

      <AccountSection title="Tahsilatlar" count={payments.length}>
        {recentPayments.map((payment) => (
          <article className="account-row" key={payment.id}>
            <div>
              <strong>{formatDateTr(payment.date)}</strong>
              <span>{paymentMethodLabel(payment.paymentMethod)}{payment.note ? ` · ${payment.note}` : ''}</span>
            </div>
            <div>
              <strong>{formatKurus(payment.amountKurus)}</strong>
            </div>
          </article>
        ))}
        {recentPayments.length === 0 ? <p className="account-empty-line">Tahsilat yok.</p> : null}
      </AccountSection>
    </section>
  );
}

function AccountModal({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="account-modal" role="dialog" aria-modal="true" aria-label={title}>
      <section className="account-modal-window">
        <header className="account-modal-header">
          <div>
            <p className="eyebrow">Cari</p>
            <h2>{title}</h2>
          </div>
          <button className="ghost-action" onClick={onClose}>
            Kapat
          </button>
        </header>
        <div className="account-modal-body">{children}</div>
      </section>
    </div>
  );
}

function AccountSection({
  title,
  count,
  children
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="account-section">
      <div className="account-section-title">
        <strong>{title}</strong>
        <span>{count}</span>
      </div>
      <div className="account-section-body">{children}</div>
    </section>
  );
}

function ApricotTypesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ApricotTypeListItem | null>(null);
  const [form, setForm] = useState<SaveApricotTypeInput>({ name: '', sortOrder: 0 });

  const { data: apricotTypes } = useQuery({
    queryKey: ['apricot-types'],
    queryFn: () => window.arkTarim.apricotTypes.list()
  });

  const nextSortOrder = useMemo(
    () => (apricotTypes ?? []).reduce((highest, type) => Math.max(highest, type.sortOrder), 0) + 1,
    [apricotTypes]
  );

  useEffect(() => {
    if (!editing) {
      setForm((current) => ({
        name: current.id ? '' : current.name,
        sortOrder: current.id
          ? nextSortOrder
          : current.sortOrder && current.sortOrder > 0
            ? current.sortOrder
            : nextSortOrder
      }));
      return;
    }

    setForm({
      id: editing.id,
      name: editing.name,
      sortOrder: editing.sortOrder,
      isActive: editing.isActive
    });
  }, [editing, nextSortOrder]);

  const saveMutation = useMutation({
    mutationFn: () =>
      window.arkTarim.apricotTypes.save(editing ? form : { ...form, sortOrder: undefined }),
    onSuccess: (savedType) => {
      setForm({ name: '', sortOrder: savedType.sortOrder + 1 });
      setEditing(null);
      invalidateOperationalQueries(queryClient);
    }
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => window.arkTarim.apricotTypes.deactivate(id),
    onSuccess: () => invalidateOperationalQueries(queryClient)
  });

  return (
    <CrudLayout
      eyebrow="Ana kayıt"
      title="Kayısı Çeşitleri"
      description="Alım fişinde hızlı seçilecek cinsleri sırala."
      form={
        <>
          <div className="form-grid compact-form-grid">
            <label>
              <span>Çeşit adı</span>
              <input
                autoFocus
                value={form.name}
                onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
              />
            </label>
            <label>
              <span>{editing ? 'Sıra' : 'Sıradaki sıra'}</span>
              <input
                type="number"
                value={form.sortOrder ?? 0}
                disabled={!editing}
                onChange={(event) => setForm((value) => ({ ...value, sortOrder: Number(event.target.value) }))}
              />
            </label>
          </div>
          {saveMutation.isError ? <p className="form-error">{asErrorMessage(saveMutation.error)}</p> : null}
          <div className="form-actions">
            <button className="primary-action" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {editing ? 'Güncelle' : 'Kaydet'}
            </button>
            {editing ? (
              <button className="ghost-action" onClick={() => setEditing(null)}>
                Vazgeç
              </button>
            ) : null}
          </div>
        </>
      }
      list={
        <DataTable
          columns={['Çeşit', 'Sıra', 'Durum', 'İşlem']}
          rows={(apricotTypes ?? []).map((type) => [
            type.name,
            String(type.sortOrder),
            type.isActive ? 'Aktif' : 'Pasif',
            <RowActions
              key={type.id}
              onEdit={() => setEditing(type)}
              onDeactivate={() => {
                if (window.confirm(`${type.name} pasifleştirilsin mi?`)) {
                  deactivateMutation.mutate(type.id);
                }
              }}
            />
          ])}
        />
      }
    />
  );
}

function paymentMethodLabel(method: PaymentMethod): string {
  if (method === 'cash') {
    return 'Nakit';
  }

  if (method === 'bank') {
    return 'Banka';
  }

  return 'Diğer';
}

function FarmerPaymentsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [amountTl, setAmountTl] = useState('');
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string; reason: string } | null>(null);
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [printPayment, setPrintPayment] = useState<FarmerPaymentListItem | null>(null);
  const [form, setForm] = useState<SaveFarmerPaymentInput>({
    farmerId: '',
    date: toInputDate(new Date()),
    amountKurus: 0,
    paymentMethod: 'cash',
    note: ''
  });

  const { data: farmers } = useQuery({
    queryKey: ['farmers', 'payment-form'],
    queryFn: () => window.arkTarim.farmers.list()
  });

  const { data: payments } = useQuery({
    queryKey: ['farmer-payments'],
    queryFn: () => window.arkTarim.farmerPayments.list()
  });

  const amountKurus = parseTlToKurus(amountTl);
  const activeFarmers = (farmers ?? []).filter((farmer) => farmer.isActive);

  const createMutation = useMutation({
    mutationFn: () =>
      window.arkTarim.farmerPayments.create({
        ...form,
        amountKurus
      }),
    onSuccess: (payment) => {
      setAmountTl('');
      setForm((value) => ({ ...value, date: toInputDate(new Date()), amountKurus: 0, note: '' }));
      setPrintPayment(payment);
      invalidateOperationalQueries(queryClient);
    }
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      window.arkTarim.farmerPayments.cancel({ id, reason }),
    onSuccess: () => {
      setCancelTarget(null);
      setCancelReasonError(null);
      invalidateOperationalQueries(queryClient);
    }
  });

  return (
    <>
      {printPayment ? <FarmerPaymentPrintPreview payment={printPayment} onClose={() => setPrintPayment(null)} /> : null}
      <PaymentLayout
        eyebrow="Çiftçi"
        title="Çiftçi Ödemesi"
        description="Çiftçiye yapılan ara ödemeleri gir."
        form={
          <>
            <div className="form-grid">
              <label>
                <span>Çiftçi</span>
                <select
                  autoFocus
                  value={form.farmerId}
                  onChange={(event) => setForm((value) => ({ ...value, farmerId: event.target.value }))}
                >
                  <option value="">Seç</option>
                  {activeFarmers.map((farmer) => (
                    <option value={farmer.id} key={farmer.id}>
                      {farmerDisplayName(farmer)} · {formatKurus(farmer.balanceKurus)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Tarih</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((value) => ({ ...value, date: event.target.value }))}
                />
              </label>
              <label>
                <span>Tutar</span>
                <input value={amountTl} onChange={(event) => setAmountTl(event.target.value)} placeholder="10000" />
              </label>
              <label>
                <span>Yöntem</span>
                <select
                  value={form.paymentMethod}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, paymentMethod: event.target.value as PaymentMethod }))
                  }
                >
                  <option value="cash">Nakit</option>
                  <option value="bank">Banka</option>
                  <option value="other">Diğer</option>
                </select>
              </label>
            </div>
            <label className="full-label">
              <span>Not</span>
              <input
                value={form.note ?? ''}
                onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))}
              />
            </label>
            {createMutation.isError ? <p className="form-error">{asErrorMessage(createMutation.error)}</p> : null}
            {createMutation.isSuccess ? <p className="form-success">Ödeme kaydedildi, fiş hazırlandı.</p> : null}
            <button className="primary-action" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              Kaydet ve Yazdır
            </button>
          </>
        }
        table={
          <>
            {cancelMutation.isError ? <p className="form-error">{asErrorMessage(cancelMutation.error)}</p> : null}
            {cancelMutation.isSuccess ? <p className="form-success">Ödeme iptal edildi.</p> : null}
            {cancelTarget ? (
              <PaymentCancelBox
                title={`${cancelTarget.name} ödemesi iptal edilecek`}
                reason={cancelTarget.reason}
                reasonError={cancelReasonError}
                isPending={cancelMutation.isPending}
                onReasonChange={(reason) => {
                  setCancelReasonError(null);
                  setCancelTarget((value) => (value ? { ...value, reason } : value));
                }}
                onConfirm={() => {
                  const reason = cancelTarget.reason.trim();

                  if (!reason) {
                    setCancelReasonError('İptal nedeni yazılmalı.');
                    return;
                  }

                  cancelMutation.mutate({ id: cancelTarget.id, reason });
                }}
                onClose={() => setCancelTarget(null)}
              />
            ) : null}
            <PaymentsTable
              rows={(payments ?? []).map((payment) => ({
                id: payment.id,
                date: payment.date,
                name: payment.farmerName,
                amountKurus: payment.amountKurus,
                method: payment.paymentMethod,
                note: payment.note,
                isCancelled: payment.isCancelled
              }))}
              onCancel={(id, name) => setCancelTarget({ id, name, reason: '' })}
              onPrint={(id) => {
                const payment = payments?.find((item) => item.id === id);
                if (payment) {
                  setPrintPayment(payment);
                }
              }}
            />
          </>
        }
      />
    </>
  );
}

function FarmerPaymentPrintPreview({
  payment,
  onClose
}: {
  payment: FarmerPaymentListItem;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="print-modal">
      <div className="print-actions">
        <button className="primary-action" onClick={() => window.print()}>
          <Printer size={18} />
          Yazdır
        </button>
        <button className="ghost-action" onClick={onClose}>
          Kapat
        </button>
      </div>

      <div className="print-size-hint">Çiftçi ödeme fişi A5 dikey boyutta hazırlanır.</div>

      <article className="payment-print-sheet">
        <header className="receipt-print-header">
          <div>
            <h2>Ali Rıza Karga TARIM</h2>
            <strong>ÇİFTÇİ ÖDEME FİŞİ</strong>
          </div>
          {payment.isCancelled ? <span>İPTAL</span> : null}
        </header>

        <section className="receipt-print-meta">
          <div>
            <span>Fiş No</span>
            <strong>{payment.id.slice(0, 8).toUpperCase()}</strong>
          </div>
          <div>
            <span>Tarih</span>
            <strong>{formatDateTr(payment.date)}</strong>
          </div>
          <div>
            <span>Yöntem</span>
            <strong>{paymentMethodLabel(payment.paymentMethod)}</strong>
          </div>
        </section>

        <section className="receipt-print-table">
          <div>
            <span>Çiftçi</span>
            <strong>{payment.farmerName}</strong>
          </div>
          <div>
            <span>Ödenen Tutar</span>
            <strong>{formatKurus(payment.amountKurus)}</strong>
          </div>
        </section>

        <section className="receipt-print-note">
          <span>Not</span>
          <p>{payment.note ?? '-'}</p>
        </section>

        <footer className="receipt-print-signatures">
          <div>
            <span>Ödemeyi Alan</span>
          </div>
          <div>
            <span>Ödemeyi Yapan</span>
          </div>
        </footer>
      </article>
    </div>
  );
}

function CompanyPaymentsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [amountTl, setAmountTl] = useState('');
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string; reason: string } | null>(null);
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [form, setForm] = useState<SaveCompanyPaymentInput>({
    companyId: '',
    date: toInputDate(new Date()),
    amountKurus: 0,
    paymentMethod: 'cash',
    note: ''
  });

  const { data: companies } = useQuery({
    queryKey: ['companies', 'payment-form'],
    queryFn: () => window.arkTarim.companies.list()
  });

  const { data: payments } = useQuery({
    queryKey: ['company-payments'],
    queryFn: () => window.arkTarim.companyPayments.list()
  });

  const amountKurus = parseTlToKurus(amountTl);
  const activeCompanies = (companies ?? []).filter((company) => company.isActive);

  const createMutation = useMutation({
    mutationFn: () =>
      window.arkTarim.companyPayments.create({
        ...form,
        amountKurus
      }),
    onSuccess: () => {
      setAmountTl('');
      setForm((value) => ({ ...value, date: toInputDate(new Date()), amountKurus: 0, note: '' }));
      invalidateOperationalQueries(queryClient);
    }
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      window.arkTarim.companyPayments.cancel({ id, reason }),
    onSuccess: () => {
      setCancelTarget(null);
      setCancelReasonError(null);
      invalidateOperationalQueries(queryClient);
    }
  });

  return (
    <PaymentLayout
      eyebrow="Firma"
      title="Firma Tahsilatı"
      description="Firmadan alınan ödemeleri kaydet."
      form={
        <>
          <div className="form-grid">
            <label>
              <span>Firma</span>
              <select
                autoFocus
                value={form.companyId}
                onChange={(event) => setForm((value) => ({ ...value, companyId: event.target.value }))}
              >
                <option value="">Seç</option>
                {activeCompanies.map((company) => (
                  <option value={company.id} key={company.id}>
                    {company.name} · {formatKurus(company.balanceKurus)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Tarih</span>
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm((value) => ({ ...value, date: event.target.value }))}
              />
            </label>
            <label>
              <span>Tutar</span>
              <input value={amountTl} onChange={(event) => setAmountTl(event.target.value)} placeholder="10000" />
            </label>
            <label>
              <span>Yöntem</span>
              <select
                value={form.paymentMethod}
                onChange={(event) =>
                  setForm((value) => ({ ...value, paymentMethod: event.target.value as PaymentMethod }))
                }
              >
                <option value="cash">Nakit</option>
                <option value="bank">Banka</option>
                <option value="other">Diğer</option>
              </select>
            </label>
          </div>
          <label className="full-label">
            <span>Not</span>
            <input
              value={form.note ?? ''}
              onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))}
            />
          </label>
          {createMutation.isError ? <p className="form-error">{asErrorMessage(createMutation.error)}</p> : null}
          {createMutation.isSuccess ? <p className="form-success">Tahsilat kaydedildi.</p> : null}
          <button className="primary-action" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            Kaydet
          </button>
        </>
      }
      table={
        <>
          {cancelMutation.isError ? <p className="form-error">{asErrorMessage(cancelMutation.error)}</p> : null}
          {cancelMutation.isSuccess ? <p className="form-success">Tahsilat iptal edildi.</p> : null}
          {cancelTarget ? (
            <PaymentCancelBox
              title={`${cancelTarget.name} tahsilatı iptal edilecek`}
              reason={cancelTarget.reason}
              reasonError={cancelReasonError}
              isPending={cancelMutation.isPending}
              onReasonChange={(reason) => {
                setCancelReasonError(null);
                setCancelTarget((value) => (value ? { ...value, reason } : value));
              }}
              onConfirm={() => {
                const reason = cancelTarget.reason.trim();

                if (!reason) {
                  setCancelReasonError('İptal nedeni yazılmalı.');
                  return;
                }

                cancelMutation.mutate({ id: cancelTarget.id, reason });
              }}
              onClose={() => setCancelTarget(null)}
            />
          ) : null}
          <PaymentsTable
            rows={(payments ?? []).map((payment) => ({
              id: payment.id,
              date: payment.date,
              name: payment.companyName,
              amountKurus: payment.amountKurus,
              method: payment.paymentMethod,
              note: payment.note,
              isCancelled: payment.isCancelled
            }))}
            onCancel={(id, name) => setCancelTarget({ id, name, reason: '' })}
          />
        </>
      }
    />
  );
}

function PaymentLayout({
  eyebrow,
  title,
  description,
  form,
  table
}: {
  eyebrow: string;
  title: string;
  description: string;
  form: JSX.Element;
  table: JSX.Element;
}): JSX.Element {
  return (
    <div className="crud-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
        </div>
        <p className="panel-description">{description}</p>
        {form}
      </section>
      <section className="panel list-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Geçmiş</p>
            <h2>Ödeme Kayıtları</h2>
          </div>
        </div>
        {table}
      </section>
    </div>
  );
}

function PaymentsTable({
  rows,
  onCancel,
  onPrint
}: {
  rows: Array<{
    id: string;
    date: string;
    name: string;
    amountKurus: number;
    method: PaymentMethod;
    note: string | null;
    isCancelled: boolean;
  }>;
  onCancel: (id: string, name: string) => void;
  onPrint?: (id: string) => void;
}): JSX.Element {
  return (
    <DataTable
      columns={['Tarih', 'Ad', 'Tutar', 'Yöntem', 'Not', 'Durum', 'İşlem']}
      rows={rows.map((row) => [
        formatDateTr(row.date),
        row.name,
        formatKurus(row.amountKurus),
        paymentMethodLabel(row.method),
        row.note ?? '-',
        row.isCancelled ? 'İptal' : 'Geçerli',
        row.isCancelled ? (
          '-'
        ) : (
          <div className="inline-actions" key={row.id}>
            {onPrint ? (
              <button className="inline-action" onClick={() => onPrint(row.id)}>
                Yazdır
              </button>
            ) : null}
            <button className="inline-danger" onClick={() => onCancel(row.id, row.name)}>
              İptal Et
            </button>
          </div>
        )
      ])}
    />
  );
}

function PaymentCancelBox({
  title,
  reason,
  reasonError,
  isPending,
  onReasonChange,
  onConfirm,
  onClose
}: {
  title: string;
  reason: string;
  reasonError: string | null;
  isPending: boolean;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="cancel-box">
      <div>
        <strong>{title}</strong>
        <span>İptal nedeni girip onayla.</span>
      </div>
      <input autoFocus value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Örn. yanlış ödeme girildi" />
      {reasonError ? <p className="form-error">{reasonError}</p> : null}
      <div className="form-actions">
        <button className="inline-danger" disabled={isPending} onClick={onConfirm}>
          İptali Onayla
        </button>
        <button className="ghost-action" onClick={onClose}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

function ReportsPage(): JSX.Element {
  const [printTarget, setPrintTarget] = useState<ReportPrintTarget | null>(null);
  const [selectedFarmerId, setSelectedFarmerId] = useState('');

  const { data } = useQuery({
    queryKey: ['reports-snapshot'],
    queryFn: () => window.arkTarim.reports.getSnapshot()
  });

  const { data: receipts } = useQuery({
    queryKey: ['purchase-receipts', 'reports'],
    queryFn: () => getPurchasesApi().list()
  });

  const { data: farmers } = useQuery({
    queryKey: ['farmers', 'reports'],
    queryFn: () => window.arkTarim.farmers.list()
  });

  const { data: farmerPayments } = useQuery({
    queryKey: ['farmer-payments', 'reports'],
    queryFn: () => window.arkTarim.farmerPayments.list()
  });

  const snapshot: ReportsSnapshot = data ?? {
    overview: {
      totalGram: 0,
      totalAmountKurus: 0,
      receiptCount: 0,
      farmerCount: 0,
      companyCount: 0,
      paidToFarmersKurus: 0,
      collectedFromCompaniesKurus: 0,
      farmerBalanceTotalKurus: 0,
      companyBalanceTotalKurus: 0
    },
    byCompany: [],
    byType: []
  };

  useEffect(() => {
    if (selectedFarmerId || !farmers?.length) {
      return;
    }

    setSelectedFarmerId(farmers[0].id);
  }, [farmers, selectedFarmerId]);

  const printableReceipts = useMemo(
    () => (receipts ?? []).filter((receipt) => !receipt.isCancelled),
    [receipts]
  );

  const companyDailyReports = useMemo(() => {
    const grouped = new Map<string, CompanyDailyPrintData>();

    for (const receipt of printableReceipts) {
      const key = `${receipt.companyId}-${receipt.dateKey}`;
      const current =
        grouped.get(key) ??
        ({
          companyId: receipt.companyId,
          companyName: receipt.companyName,
          date: receipt.date,
          dateKey: receipt.dateKey,
          receipts: [],
          totalGram: 0,
          totalAmountKurus: 0,
          receiptCount: 0
        } satisfies CompanyDailyPrintData);

      current.receipts.push(receipt);
      current.totalGram += receipt.quantityGram;
      current.totalAmountKurus += receipt.totalAmountKurus;
      current.receiptCount += 1;
      grouped.set(key, current);
    }

    return Array.from(grouped.values())
      .map((report) => ({
        ...report,
        receipts: [...report.receipts].sort(sortReceiptOldestFirst)
      }))
      .sort((first, second) => {
        const dateCompare = second.dateKey.localeCompare(first.dateKey);

        if (dateCompare !== 0) {
          return dateCompare;
        }

        return first.companyName.localeCompare(second.companyName, 'tr-TR');
      });
  }, [printableReceipts]);

  const selectedFarmer = useMemo(
    () => (farmers ?? []).find((farmer) => farmer.id === selectedFarmerId) ?? null,
    [farmers, selectedFarmerId]
  );

  const farmerStatement = useMemo(() => {
    if (!selectedFarmer) {
      return null;
    }

    const farmerReceipts = printableReceipts
      .filter((receipt) => receipt.farmerId === selectedFarmer.id)
      .sort(sortReceiptOldestFirst);
    const activePayments = (farmerPayments ?? [])
      .filter((payment) => payment.farmerId === selectedFarmer.id && !payment.isCancelled)
      .sort(sortPaymentOldestFirst);
    const totalGram = farmerReceipts.reduce((total, receipt) => total + receipt.quantityGram, 0);
    const totalPurchaseKurus = farmerReceipts.reduce((total, receipt) => total + receipt.totalAmountKurus, 0);
    const paidKurus = activePayments.reduce((total, payment) => total + payment.amountKurus, 0);

    return {
      farmer: selectedFarmer,
      receipts: farmerReceipts,
      payments: activePayments,
      totalGram,
      totalPurchaseKurus,
      paidKurus,
      balanceKurus: totalPurchaseKurus - paidKurus
    } satisfies FarmerStatementPrintData;
  }, [farmerPayments, printableReceipts, selectedFarmer]);

  const stats = [
    { label: 'Toplam Alım', value: formatGramAsKg(snapshot.overview.totalGram) },
    { label: 'Toplam Tutar', value: formatKurus(snapshot.overview.totalAmountKurus) },
    { label: 'Fiş Sayısı', value: String(snapshot.overview.receiptCount) },
    { label: 'Çiftçi Sayısı', value: String(snapshot.overview.farmerCount) },
    { label: 'Firma Sayısı', value: String(snapshot.overview.companyCount) },
    { label: 'Çiftçiye Ödenen', value: formatKurus(snapshot.overview.paidToFarmersKurus) },
    { label: 'Firmadan Alınan', value: formatKurus(snapshot.overview.collectedFromCompaniesKurus) },
    { label: 'Çiftçi Bakiyesi', value: formatKurus(snapshot.overview.farmerBalanceTotalKurus) }
  ];

  return (
    <>
      {printTarget ? <ReportPrintPreview target={printTarget} onClose={() => setPrintTarget(null)} /> : null}
      <section className="stats-grid">
        {stats.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </section>

      <div className="content-grid reports-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Çıktı</p>
              <h2>Yazdırma Merkezi</h2>
            </div>
          </div>
          <div className="report-print-actions">
            <button className="ghost-action" onClick={() => setPrintTarget({ kind: 'season', snapshot })}>
              <Printer size={18} />
              Sezon Raporu
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Ekstre</p>
              <h2>Çiftçi Ekstresi</h2>
            </div>
          </div>
          <div className="form-grid report-filter-grid">
            <label>
              <span>Çiftçi</span>
              <select value={selectedFarmerId} onChange={(event) => setSelectedFarmerId(event.target.value)}>
                <option value="">Seç</option>
                {(farmers ?? []).map((farmer) => (
                  <option value={farmer.id} key={farmer.id}>
                    {farmerDisplayName(farmer)}
                  </option>
                ))}
              </select>
            </label>
            <div className="report-filter-summary">
              <span>Bakiye</span>
              <strong>{farmerStatement ? formatKurus(farmerStatement.balanceKurus) : '-'}</strong>
            </div>
          </div>
          <button
            className="primary-action"
            disabled={!farmerStatement}
            onClick={() => {
              if (farmerStatement) {
                setPrintTarget({ kind: 'farmerStatement', data: farmerStatement });
              }
            }}
          >
            <Printer size={18} />
            Ekstre Yazdır
          </button>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Günlük</p>
              <h2>Firma Alım Listeleri</h2>
            </div>
          </div>
          <DataTable
            columns={['Tarih', 'Firma', 'Kg', 'Fiş', 'İşlem']}
            rows={companyDailyReports.slice(0, 12).map((report) => [
              formatDateTr(report.date),
              report.companyName,
              formatGramAsKg(report.totalGram),
              String(report.receiptCount),
              <button
                className="ghost-action compact-button"
                key={`${report.companyId}-${report.dateKey}`}
                onClick={() => setPrintTarget({ kind: 'companyDaily', data: report })}
              >
                Yazdır
              </button>
            ])}
          />
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Dağılım</p>
              <h2>Firma Bazlı Alım</h2>
            </div>
          </div>
          <DataTable
            columns={['Firma', 'Kg', 'Tutar', 'Fiş']}
            rows={snapshot.byCompany.map((item) => [
              item.name,
              formatGramAsKg(item.totalGram),
              formatKurus(item.totalAmountKurus),
              String(item.receiptCount)
            ])}
          />
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Dağılım</p>
              <h2>Cins Bazlı Alım</h2>
            </div>
          </div>
          <DataTable
            columns={['Cins', 'Kg', 'Tutar', 'Fiş']}
            rows={snapshot.byType.map((item) => [
              item.name,
              formatGramAsKg(item.totalGram),
              formatKurus(item.totalAmountKurus),
              String(item.receiptCount)
            ])}
          />
        </section>
      </div>
    </>
  );
}

function ReportPrintPreview({
  target,
  onClose
}: {
  target: ReportPrintTarget;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="print-modal">
      <div className="print-actions wide">
        <button className="primary-action" onClick={() => window.print()}>
          <Printer size={18} />
          Yazdır
        </button>
        <button className="ghost-action" onClick={onClose}>
          Kapat
        </button>
      </div>

      {target.kind === 'companyDaily' ? <CompanyDailyPrintSheet data={target.data} /> : null}
      {target.kind === 'farmerStatement' ? <FarmerStatementPrintSheet data={target.data} /> : null}
      {target.kind === 'season' ? <SeasonReportPrintSheet snapshot={target.snapshot} /> : null}
    </div>
  );
}

function PrintDocumentHeader({ title, badge }: { title: string; badge?: string }): JSX.Element {
  return (
    <header className="report-print-header">
      <div>
        <h2>Ali Rıza Karga TARIM</h2>
        <strong>{title}</strong>
      </div>
      <span>{badge ?? '2026'}</span>
    </header>
  );
}

function CompanyDailyPrintSheet({ data }: { data: CompanyDailyPrintData }): JSX.Element {
  return (
    <article className="report-print-sheet">
      <PrintDocumentHeader title="FİRMA GÜNLÜK ALIM LİSTESİ" />
      <section className="print-summary-grid">
        <div>
          <span>Tarih</span>
          <strong>{formatDateTr(data.date)}</strong>
        </div>
        <div>
          <span>Firma</span>
          <strong>{data.companyName}</strong>
        </div>
        <div>
          <span>Toplam Kg</span>
          <strong>{formatGramAsKg(data.totalGram)}</strong>
        </div>
      </section>
      <table className="print-table">
        <thead>
          <tr>
            <th>No</th>
            <th>Saat</th>
            <th>Çiftçi</th>
            <th>Cins</th>
            <th>Kg</th>
          </tr>
        </thead>
        <tbody>
          {data.receipts.map((receipt) => (
            <tr key={receipt.id}>
              <td>{receipt.receiptNo}</td>
              <td>{receipt.timeText}</td>
              <td>{receipt.farmerName}</td>
              <td>{receipt.apricotTypeName}</td>
              <td>{formatGramAsKg(receipt.quantityGram)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="report-print-footer">
        <span>Hazırlayan</span>
        <span>Firma Yetkilisi</span>
      </footer>
    </article>
  );
}

function FarmerStatementPrintSheet({ data }: { data: FarmerStatementPrintData }): JSX.Element {
  return (
    <article className="report-print-sheet">
      <PrintDocumentHeader title="ÇİFTÇİ EKSTRESİ" />
      <section className="print-summary-grid">
        <div>
          <span>Çiftçi</span>
          <strong>{farmerDisplayName(data.farmer)}</strong>
        </div>
        <div>
          <span>Toplam Kg</span>
          <strong>{formatGramAsKg(data.totalGram)}</strong>
        </div>
        <div>
          <span>Toplam Alacak</span>
          <strong>{formatKurus(data.totalPurchaseKurus)}</strong>
        </div>
        <div>
          <span>Ödenen</span>
          <strong>{formatKurus(data.paidKurus)}</strong>
        </div>
        <div>
          <span>Kalan Bakiye</span>
          <strong>{formatKurus(data.balanceKurus)}</strong>
        </div>
      </section>

      <h3>Alımlar</h3>
      <table className="print-table">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Fiş No</th>
            <th>Firma</th>
            <th>Cins</th>
            <th>Kg</th>
            <th>Fiyat</th>
            <th>Tutar</th>
          </tr>
        </thead>
        <tbody>
          {data.receipts.length === 0 ? (
            <tr>
              <td colSpan={7}>Alım kaydı yok.</td>
            </tr>
          ) : (
            data.receipts.map((receipt) => (
              <tr key={receipt.id}>
                <td>{formatDateTr(receipt.date)}</td>
                <td>{receipt.receiptNo}</td>
                <td>{receipt.companyName}</td>
                <td>{receipt.apricotTypeName}</td>
                <td>{formatGramAsKg(receipt.quantityGram)}</td>
                <td>{formatKurus(receipt.unitPriceKurus)}</td>
                <td>{formatKurus(receipt.totalAmountKurus)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h3>Ödemeler</h3>
      <table className="print-table">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Yöntem</th>
            <th>Tutar</th>
            <th>Not</th>
          </tr>
        </thead>
        <tbody>
          {data.payments.length === 0 ? (
            <tr>
              <td colSpan={4}>Ödeme kaydı yok.</td>
            </tr>
          ) : (
            data.payments.map((payment) => (
              <tr key={payment.id}>
                <td>{formatDateTr(payment.date)}</td>
                <td>{paymentMethodLabel(payment.paymentMethod)}</td>
                <td>{formatKurus(payment.amountKurus)}</td>
                <td>{payment.note ?? '-'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </article>
  );
}

function SeasonReportPrintSheet({ snapshot }: { snapshot: ReportsSnapshot }): JSX.Element {
  return (
    <article className="report-print-sheet">
      <PrintDocumentHeader title="2026 KAYISI SEZONU RAPORU" />
      <section className="print-summary-grid">
        <div>
          <span>Toplam Kg</span>
          <strong>{formatGramAsKg(snapshot.overview.totalGram)}</strong>
        </div>
        <div>
          <span>Toplam Tutar</span>
          <strong>{formatKurus(snapshot.overview.totalAmountKurus)}</strong>
        </div>
        <div>
          <span>Fiş Sayısı</span>
          <strong>{snapshot.overview.receiptCount}</strong>
        </div>
        <div>
          <span>Çiftçi Bakiyesi</span>
          <strong>{formatKurus(snapshot.overview.farmerBalanceTotalKurus)}</strong>
        </div>
        <div>
          <span>Firma Bakiyesi</span>
          <strong>{formatKurus(snapshot.overview.companyBalanceTotalKurus)}</strong>
        </div>
      </section>

      <h3>Firma Bazlı Alım</h3>
      <table className="print-table">
        <thead>
          <tr>
            <th>Firma</th>
            <th>Kg</th>
            <th>Tutar</th>
            <th>Fiş</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.byCompany.length === 0 ? (
            <tr>
              <td colSpan={4}>Kayıt yok.</td>
            </tr>
          ) : (
            snapshot.byCompany.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td>{formatGramAsKg(item.totalGram)}</td>
                <td>{formatKurus(item.totalAmountKurus)}</td>
                <td>{item.receiptCount}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h3>Cins Bazlı Alım</h3>
      <table className="print-table">
        <thead>
          <tr>
            <th>Cins</th>
            <th>Kg</th>
            <th>Tutar</th>
            <th>Fiş</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.byType.length === 0 ? (
            <tr>
              <td colSpan={4}>Kayıt yok.</td>
            </tr>
          ) : (
            snapshot.byType.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td>{formatGramAsKg(item.totalGram)}</td>
                <td>{formatKurus(item.totalAmountKurus)}</td>
                <td>{item.receiptCount}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </article>
  );
}

function LegacyReportsPage(): JSX.Element {
  const { data } = useQuery({
    queryKey: ['reports-snapshot'],
    queryFn: () => window.arkTarim.reports.getSnapshot()
  });

  const snapshot: ReportsSnapshot = data ?? {
    overview: {
      totalGram: 0,
      totalAmountKurus: 0,
      receiptCount: 0,
      farmerCount: 0,
      companyCount: 0,
      paidToFarmersKurus: 0,
      collectedFromCompaniesKurus: 0,
      farmerBalanceTotalKurus: 0,
      companyBalanceTotalKurus: 0
    },
    byCompany: [],
    byType: []
  };

  const stats = [
    { label: 'Toplam Alım', value: formatGramAsKg(snapshot.overview.totalGram) },
    { label: 'Toplam Tutar', value: formatKurus(snapshot.overview.totalAmountKurus) },
    { label: 'Fiş Sayısı', value: String(snapshot.overview.receiptCount) },
    { label: 'Çiftçi Sayısı', value: String(snapshot.overview.farmerCount) },
    { label: 'Firma Sayısı', value: String(snapshot.overview.companyCount) },
    { label: 'Çiftçiye Ödenen', value: formatKurus(snapshot.overview.paidToFarmersKurus) },
    { label: 'Firmadan Alınan', value: formatKurus(snapshot.overview.collectedFromCompaniesKurus) },
    { label: 'Çiftçi Bakiyesi', value: formatKurus(snapshot.overview.farmerBalanceTotalKurus) }
  ];

  return (
    <>
      <section className="stats-grid">
        {stats.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </section>
      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Dağılım</p>
              <h2>Firma Bazlı Alım</h2>
            </div>
          </div>
          <DataTable
            columns={['Firma', 'Kg', 'Tutar', 'Fiş']}
            rows={snapshot.byCompany.map((item) => [
              item.name,
              formatGramAsKg(item.totalGram),
              formatKurus(item.totalAmountKurus),
              String(item.receiptCount)
            ])}
          />
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Dağılım</p>
              <h2>Cins Bazlı Alım</h2>
            </div>
          </div>
          <DataTable
            columns={['Cins', 'Kg', 'Tutar', 'Fiş']}
            rows={snapshot.byType.map((item) => [
              item.name,
              formatGramAsKg(item.totalGram),
              formatKurus(item.totalAmountKurus),
              String(item.receiptCount)
            ])}
          />
        </section>
      </div>
    </>
  );
}

function CrudLayout({
  eyebrow,
  title,
  description,
  form,
  list
}: {
  eyebrow: string;
  title: string;
  description: string;
  form: JSX.Element;
  list: JSX.Element;
}): JSX.Element {
  return (
    <div className="crud-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
        </div>
        <p className="panel-description">{description}</p>
        {form}
      </section>

      <section className="panel list-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Liste</p>
            <h2>Kayıtlar</h2>
          </div>
        </div>
        {list}
      </section>
    </div>
  );
}

function ListToolbar({
  search,
  onSearchChange,
  placeholder
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
}): JSX.Element {
  return (
    <div className="list-toolbar">
      <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

type DataTableCell = string | JSX.Element;
type DataTableRow =
  | DataTableCell[]
  | {
      cells: DataTableCell[];
      className?: string;
      onClick?: () => void;
    };

function DataTable({ columns, rows }: { columns: string[]; rows: DataTableRow[] }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="empty-table">Kayıt yok.</div>
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => {
              const cells = Array.isArray(row) ? row : row.cells;
              const onClick = Array.isArray(row) ? undefined : row.onClick;
              const className = Array.isArray(row) ? undefined : row.className;

              return (
                <tr
                  className={className}
                  key={rowIndex}
                  onClick={(event) => {
                    const target = event.target as HTMLElement;

                    if (target.closest('button, a, input, select, textarea')) {
                      return;
                    }

                    onClick?.();
                  }}
                >
                  {cells.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({
  onEdit,
  onDeactivate
}: {
  onEdit: () => void;
  onDeactivate: () => void;
}): JSX.Element {
  return (
    <div className="row-actions">
      <button className="icon-action" onClick={onEdit} title="Düzenle">
        <Pencil size={16} />
      </button>
      <button className="icon-action danger" onClick={onDeactivate} title="Pasifleştir">
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function PlaceholderPage({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <section className="panel placeholder-panel">
      <p className="eyebrow">Sonraki adım</p>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

export function App(): JSX.Element {
  const [page, setPage] = useState<PageKey>('dashboard');
  const autoSync = useAutoSync();

  const { data: device } = useQuery({
    queryKey: ['device'],
    queryFn: () => window.arkTarim.settings.getDevice()
  });

  const { data: activeSeason } = useQuery({
    queryKey: ['active-season'],
    queryFn: () => window.arkTarim.seasons.getActive()
  });

  const activeMenu = useMemo(() => menuItems.find((item) => item.key === page) ?? menuItems[0], [page]);
  const SyncIcon = autoSync.isSyncing ? RefreshCw : autoSync.visualState === 'offline' ? WifiOff : Wifi;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={arkLogoUrl} alt="" aria-hidden="true" />
          <div>
            <strong>{APP_NAME}</strong>
            <span>Kurumsal Tarım Paneli</span>
          </div>
        </div>

        <nav aria-label="Ana menü">
          {menuItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                className={item.key === page ? 'nav-item active' : 'nav-item'}
                key={item.key}
                onClick={() => setPage(item.key)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{page === 'dashboard' ? 'Çalışma sezonu' : activeMenu.label}</p>
            <h1>{activeSeason?.name ?? '2026 Kayısı Sezonu'}</h1>
          </div>

          <div className="topbar-actions">
            <div className={`sync-indicator ${autoSync.visualState}`}>
              <SyncIcon size={18} className={autoSync.isSyncing ? 'sync-spin' : undefined} />
              <span>{autoSync.label}</span>
            </div>
            <div className="device-badge">{device?.deviceCode ?? 'Cihaz kodu yok'}</div>
          </div>
        </header>

        {page === 'dashboard' ? (
          <DashboardPage setPage={setPage} />
        ) : null}

        {page === 'farmers' ? <FarmersPage /> : null}
        {page === 'companies' ? <CompaniesPage /> : null}
        {page === 'apricotTypes' ? <ApricotTypesPage /> : null}
        {page === 'settings' ? <DeviceSettings device={device} /> : null}

        {page === 'purchases' ? <PurchasesPage /> : null}

        {page === 'farmerPayments' ? <FarmerPaymentsPage /> : null}

        {page === 'companyPayments' ? <CompanyPaymentsPage /> : null}

        {page === 'reports' ? <ReportsPage /> : null}
      </main>
    </div>
  );
}
