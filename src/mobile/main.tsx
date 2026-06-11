import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { BarChart3, Building2, FileText, Home, Leaf, ReceiptText, Settings, Users } from 'lucide-react';
import arkLogoUrl from '../shared/assets/ark-tarim-logo.svg';
import { BUNDLED_FIREBASE_SETTINGS } from '../shared/firebase/defaultSettings';
import { formatDateTr, formatGramAsKg, formatKurus } from '../shared/formatters';
import './styles.css';

interface FarmerDoc {
  id: string;
  name: string;
  nickname?: string | null;
  phone?: string | null;
  village?: string | null;
  note?: string | null;
  isActive?: number | boolean;
  totalGram?: number;
  totalAmountKurus?: number;
  paidAmountKurus?: number;
  balanceKurus?: number;
  receiptCount?: number;
  deletedAt?: string | null;
}

interface CompanyDoc {
  id: string;
  name: string;
  authorizedPerson?: string | null;
  phone?: string | null;
  city?: string | null;
  note?: string | null;
  isActive?: number | boolean;
  totalGram?: number;
  totalAmountKurus?: number;
  collectedAmountKurus?: number;
  balanceKurus?: number;
  receiptCount?: number;
  deletedAt?: string | null;
}

interface ReceiptDoc {
  id: string;
  receiptNo: string;
  seasonId?: string;
  date: string;
  dateKey?: string;
  timeText: string;
  farmerId?: string;
  farmerName: string;
  companyId?: string;
  companyName: string;
  apricotTypeId?: string;
  apricotTypeName: string;
  grossQuantityGram?: number;
  crateCount?: number;
  crateTareGram?: number;
  quantityGram: number;
  unitPriceKurus?: number;
  totalAmountKurus: number;
  note?: string | null;
  isCancelled?: number | boolean;
  deletedAt?: string | null;
}

interface FarmerPaymentDoc {
  id: string;
  seasonId?: string;
  farmerId?: string;
  farmerName: string;
  date: string;
  dateKey?: string;
  amountKurus: number;
  paymentMethod?: PaymentMethod;
  note?: string | null;
  isCancelled?: number | boolean;
  deletedAt?: string | null;
}

interface CompanyPaymentDoc {
  id: string;
  seasonId?: string;
  companyId?: string;
  companyName: string;
  date: string;
  dateKey?: string;
  amountKurus: number;
  paymentMethod?: PaymentMethod;
  note?: string | null;
  isCancelled?: number | boolean;
  deletedAt?: string | null;
}

interface ApricotTypeDoc {
  id: string;
  name: string;
  sortOrder?: number;
  isActive?: number | boolean;
  deletedAt?: string | null;
}

interface MobileData {
  farmers: FarmerDoc[];
  companies: CompanyDoc[];
  apricotTypes: ApricotTypeDoc[];
  receipts: ReceiptDoc[];
  farmerPayments: FarmerPaymentDoc[];
  companyPayments: CompanyPaymentDoc[];
}

interface DailyCompanyRow {
  id: string;
  name: string;
  dateKey: string;
  date: string;
  quantityGram: number;
  amountKurus: number;
  receiptCount: number;
}

interface CompanyTodayRow {
  id: string;
  name: string;
  quantityGram: number;
  amountKurus: number;
  receiptCount: number;
}

interface MobileDeviceInfo {
  id: string;
  code: string;
  name: string;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error' | 'missing-config';
type MobileView =
  | 'overview'
  | 'receipts'
  | 'farmers'
  | 'companies'
  | 'apricotTypes'
  | 'farmerPayments'
  | 'companyPayments'
  | 'reports'
  | 'settings';
type PaymentMethod = 'cash' | 'bank' | 'other';
type OperationMode = 'receipt' | 'farmerPayment' | 'companyPayment' | 'farmer' | 'company';

const MOBILE_DEVICE_ID_KEY = 'arkTarim.mobileDeviceId';
const DEFAULT_SEASON_YEAR = 2026;
const DEFAULT_SEASON_NAME = '2026 Kayısı Sezonu';
const DEFAULT_SEASON_ID = 'season-2026-kayisi';

const emptyData: MobileData = {
  farmers: [],
  companies: [],
  apricotTypes: [],
  receipts: [],
  farmerPayments: [],
  companyPayments: []
};

const tabs: Array<{ key: MobileView; label: string; helper: string; icon: typeof Home }> = [
  { key: 'overview', label: 'Ana Sayfa', helper: 'Özet', icon: Home },
  { key: 'receipts', label: 'Alım İşlemleri', helper: 'Fiş', icon: ReceiptText },
  { key: 'farmers', label: 'Çiftçiler', helper: 'Kart', icon: Users },
  { key: 'companies', label: 'Firmalar', helper: 'Kart', icon: Building2 },
  { key: 'apricotTypes', label: 'Kayısı Çeşitleri', helper: 'Liste', icon: Leaf },
  { key: 'farmerPayments', label: 'Çiftçi Ödemeleri', helper: 'Ara ödeme', icon: FileText },
  { key: 'companyPayments', label: 'Firma Ödemeleri', helper: 'Tahsilat', icon: FileText },
  { key: 'reports', label: 'Raporlar', helper: 'Özet', icon: BarChart3 },
  { key: 'settings', label: 'Ayarlar', helper: 'Cihaz', icon: Settings }
];

const operationModes: Array<{ key: OperationMode; label: string }> = [
  { key: 'receipt', label: 'Alım Fişi' },
  { key: 'farmerPayment', label: 'Çiftçi Ödemesi' },
  { key: 'companyPayment', label: 'Firma Tahsilatı' },
  { key: 'farmer', label: 'Yeni Çiftçi' },
  { key: 'company', label: 'Yeni Firma' }
];

function requiredEnv(key: string): string {
  return String(import.meta.env[key] ?? '').trim();
}

function getFirebaseConfig(): Record<string, string> | null {
  const config = {
    apiKey: requiredEnv('VITE_FIREBASE_API_KEY') || BUNDLED_FIREBASE_SETTINGS.apiKey,
    authDomain: requiredEnv('VITE_FIREBASE_AUTH_DOMAIN') || BUNDLED_FIREBASE_SETTINGS.authDomain,
    projectId: requiredEnv('VITE_FIREBASE_PROJECT_ID') || BUNDLED_FIREBASE_SETTINGS.projectId,
    storageBucket: requiredEnv('VITE_FIREBASE_STORAGE_BUCKET') || BUNDLED_FIREBASE_SETTINGS.storageBucket,
    messagingSenderId:
      requiredEnv('VITE_FIREBASE_MESSAGING_SENDER_ID') || BUNDLED_FIREBASE_SETTINGS.messagingSenderId,
    appId: requiredEnv('VITE_FIREBASE_APP_ID') || BUNDLED_FIREBASE_SETTINGS.appId
  };

  if (!config.apiKey || !config.projectId || !config.appId) {
    return null;
  }

  return config;
}

function getFirebaseApp() {
  const config = getFirebaseConfig();

  if (!config) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(config);
}

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateMobileDeviceId(): string {
  const existing = localStorage.getItem(MOBILE_DEVICE_ID_KEY)?.trim();

  if (existing) {
    return existing;
  }

  const nextId = newLocalId();
  localStorage.setItem(MOBILE_DEVICE_ID_KEY, nextId);

  return nextId;
}

function mobileCodeFromNumber(value: number): string {
  return `MOB${String(value).padStart(2, '0')}`;
}

async function ensureMobileDevice(user: User): Promise<MobileDeviceInfo> {
  const app = getFirebaseApp();

  if (!app) {
    throw new Error('Mobil Firebase ayarı eksik.');
  }

  const db = getFirestore(app);
  const id = getOrCreateMobileDeviceId();
  const deviceRef = doc(db, 'mobileDevices', id);
  const existingDevice = await getDoc(deviceRef);

  if (existingDevice.exists()) {
    const data = existingDevice.data() as { code?: unknown; name?: unknown };
    const code = String(data.code ?? '').trim();

    if (code) {
      return {
        id,
        code,
        name: String(data.name ?? `Mobil Cihaz ${code}`)
      };
    }
  }

  return runTransaction(db, async (transaction) => {
    const currentDevice = await transaction.get(deviceRef);

    if (currentDevice.exists()) {
      const data = currentDevice.data() as { code?: unknown; name?: unknown };
      const code = String(data.code ?? '').trim();

      if (code) {
        return {
          id,
          code,
          name: String(data.name ?? `Mobil Cihaz ${code}`)
        };
      }
    }

    const counterRef = doc(db, 'counters', 'mobileDevices');
    const counterSnapshot = await transaction.get(counterRef);
    const lastNumber = counterSnapshot.exists() ? asNumber(counterSnapshot.data().lastNumber) : 0;
    const nextNumber = lastNumber + 1;
    const code = mobileCodeFromNumber(nextNumber);
    const name = `Mobil Cihaz ${code}`;

    transaction.set(
      counterRef,
      {
        lastNumber: nextNumber,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
    transaction.set(
      deviceRef,
      {
        id,
        code,
        name,
        userEmail: user.email ?? null,
        userAgent: navigator.userAgent,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    return { id, code, name };
  });
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isActive(value: number | boolean | undefined): boolean {
  return value === undefined || value === true || value === 1;
}

function isCancelled(value: number | boolean | undefined): boolean {
  return value === true || value === 1;
}

function todayDateKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${now.getFullYear()}${month}${day}`;
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase('tr-TR').trim();
}

function normalizePersonKey(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
}

function farmerDisplayName(farmer: Pick<FarmerDoc, 'name' | 'nickname'>): string {
  return farmer.nickname ? `${farmer.name} (${farmer.nickname})` : farmer.name;
}

function containsSearch(search: string, ...values: Array<string | number | null | undefined>): boolean {
  const query = normalizeText(search);

  if (!query) {
    return true;
  }

  return values.some((value) => normalizeText(String(value ?? '')).includes(query));
}

function paymentMethodLabel(method: PaymentMethod | undefined): string {
  if (method === 'bank') {
    return 'Banka';
  }

  if (method === 'other') {
    return 'Diğer';
  }

  return 'Nakit';
}

function dateSortValue(item: { date?: string; dateKey?: string; timeText?: string }): string {
  return `${item.dateKey ?? item.date ?? ''}-${item.timeText ?? ''}`;
}

function mapDoc<T extends { id: string }>(id: string, data: Record<string, unknown>): T {
  return {
    id,
    ...data
  } as T;
}

function nonDeletedActivePayment<T extends { deletedAt?: string | null; isCancelled?: number | boolean }>(item: T) {
  return !item.deletedAt && !isCancelled(item.isCancelled);
}

async function loadMobileData(): Promise<MobileData> {
  const app = getFirebaseApp();

  if (!app) {
    throw new Error('missing-config');
  }

  if (!getAuth(app).currentUser) {
    throw new Error('auth-required');
  }

  const db = getFirestore(app);
  const [
    farmersSnapshot,
    companiesSnapshot,
    apricotTypesSnapshot,
    receiptsSnapshot,
    farmerPaymentsSnapshot,
    companyPaymentsSnapshot
  ] =
    await Promise.all([
      getDocs(collection(db, 'farmers')),
      getDocs(collection(db, 'companies')),
      getDocs(collection(db, 'apricotTypes')),
      getDocs(collection(db, 'purchaseReceipts')),
      getDocs(collection(db, 'farmerPayments')),
      getDocs(collection(db, 'companyPayments'))
    ]);

  const farmers = farmersSnapshot.docs
    .map((doc) => mapDoc<FarmerDoc>(doc.id, doc.data()))
    .filter((farmer) => !farmer.deletedAt && isActive(farmer.isActive))
    .sort((first, second) => first.name.localeCompare(second.name, 'tr-TR'));

  const companies = companiesSnapshot.docs
    .map((doc) => mapDoc<CompanyDoc>(doc.id, doc.data()))
    .filter((company) => !company.deletedAt && isActive(company.isActive))
    .sort((first, second) => first.name.localeCompare(second.name, 'tr-TR'));

  const apricotTypes = apricotTypesSnapshot.docs
    .map((doc) => mapDoc<ApricotTypeDoc>(doc.id, doc.data()))
    .filter((type) => !type.deletedAt && isActive(type.isActive))
    .sort((first, second) => asNumber(first.sortOrder) - asNumber(second.sortOrder) || first.name.localeCompare(second.name, 'tr-TR'));

  const receipts = receiptsSnapshot.docs
    .map((doc) => mapDoc<ReceiptDoc>(doc.id, doc.data()))
    .filter((receipt) => !receipt.deletedAt && !isCancelled(receipt.isCancelled))
    .sort((first, second) => dateSortValue(second).localeCompare(dateSortValue(first)));

  const farmerPayments = farmerPaymentsSnapshot.docs
    .map((doc) => mapDoc<FarmerPaymentDoc>(doc.id, doc.data()))
    .filter(nonDeletedActivePayment)
    .sort((first, second) => dateSortValue(second).localeCompare(dateSortValue(first)));

  const companyPayments = companyPaymentsSnapshot.docs
    .map((doc) => mapDoc<CompanyPaymentDoc>(doc.id, doc.data()))
    .filter(nonDeletedActivePayment)
    .sort((first, second) => dateSortValue(second).localeCompare(dateSortValue(first)));

  return { farmers, companies, apricotTypes, receipts, farmerPayments, companyPayments };
}

function sumBy<T>(items: T[], mapper: (item: T) => number): number {
  return items.reduce((total, item) => total + mapper(item), 0);
}

function shortDate(value: string | undefined): string {
  if (!value) {
    return '-';
  }

  return formatDateTr(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function toInputDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

function currentTimeText(): string {
  const now = new Date();
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');

  return `${hour}:${minute}`;
}

function dateToDateKey(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Tarih geçerli olmalı.');
  }

  return date.replace(/-/g, '');
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} boş bırakılamaz.`);
  }

  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeWhatsAppPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  if (digits.startsWith('90') && digits.length >= 12) {
    return digits;
  }

  if (digits.startsWith('0') && digits.length === 11) {
    return `90${digits.slice(1)}`;
  }

  if (digits.startsWith('5') && digits.length === 10) {
    return `90${digits}`;
  }

  return digits.length >= 10 ? digits : null;
}

function parseLocaleNumber(value: string): number {
  const clean = value.trim().replace(/\s/g, '');

  if (!clean) {
    return 0;
  }

  if (clean.includes(',')) {
    return Number(clean.replace(/\./g, '').replace(',', '.'));
  }

  if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    return Number(clean.replace(/\./g, ''));
  }

  return Number(clean);
}

function parseKgToGram(value: string): number {
  return Math.round(parseLocaleNumber(value) * 1000);
}

function parseTlToKurus(value: string): number {
  return Math.round(parseLocaleNumber(value) * 100);
}

function getMobileFirestore() {
  const app = getFirebaseApp();

  if (!app) {
    throw new Error('Mobil Firebase ayarı eksik.');
  }

  if (!getAuth(app).currentUser) {
    throw new Error('Mobil giriş yapılmalı.');
  }

  return getFirestore(app);
}

function createdSyncFields(id: string, sourceTable: string, timestamp: string) {
  return {
    id,
    cloudId: null,
    localId: id,
    sourceTable,
    syncStatus: 'synced',
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    version: 1,
    syncedAt: serverTimestamp()
  };
}

function updateSyncFields(timestamp: string, version: unknown) {
  return {
    syncStatus: 'synced',
    updatedAt: timestamp,
    version: asNumber(version) + 1,
    syncedAt: serverTimestamp()
  };
}

async function ensureMobileSeasonId(): Promise<string> {
  const db = getMobileFirestore();
  const seasonsSnapshot = await getDocs(collection(db, 'seasons'));
  const existingSeason = seasonsSnapshot.docs.find((seasonDoc) => {
    const data = seasonDoc.data() as { year?: unknown; deletedAt?: unknown };
    return !data.deletedAt && asNumber(data.year) === DEFAULT_SEASON_YEAR;
  });

  if (existingSeason) {
    return existingSeason.id;
  }

  const timestamp = nowIso();

  await setDoc(
    doc(db, 'seasons', DEFAULT_SEASON_ID),
    {
      ...createdSyncFields(DEFAULT_SEASON_ID, 'seasons', timestamp),
      name: DEFAULT_SEASON_NAME,
      year: DEFAULT_SEASON_YEAR,
      startDate: null,
      endDate: null,
      isActive: 1
    },
    { merge: true }
  );

  return DEFAULT_SEASON_ID;
}

function readActiveName(
  exists: boolean,
  data: Record<string, unknown> | undefined,
  label: string
): { name: string; version: number } {
  if (!exists || !data || data.deletedAt || !isActive(data.isActive as number | boolean | undefined)) {
    throw new Error(`${label} bulunamadı veya pasif.`);
  }

  return {
    name:
      label === 'Çiftçi'
        ? farmerDisplayName({
            name: requiredText(String(data.name ?? ''), label),
            nickname: optionalText(String(data.nickname ?? ''))
          })
        : requiredText(String(data.name ?? ''), label),
    version: asNumber(data.version)
  };
}

async function createMobileFarmer(input: {
  name: string;
  nickname: string;
  phone: string;
  village: string;
  note: string;
}): Promise<FarmerDoc> {
  const db = getMobileFirestore();
  const id = newLocalId();
  const timestamp = nowIso();
  const name = requiredText(input.name, 'Çiftçi adı');
  const nickname = optionalText(input.nickname);
  const existingSnapshot = await getDocs(collection(db, 'farmers'));
  const sameNameFarmers = existingSnapshot.docs
    .map((document) => mapDoc<FarmerDoc>(document.id, document.data()))
    .filter((farmer) => !farmer.deletedAt && normalizePersonKey(farmer.name) === normalizePersonKey(name));

  if (sameNameFarmers.length > 0 && !nickname) {
    throw new Error(`${name} adında kayıt zaten var. Karışıklık olmaması için lakap girin veya mevcut kaydı kontrol edin.`);
  }

  if (
    nickname &&
    sameNameFarmers.some((farmer) => normalizePersonKey(farmer.nickname) === normalizePersonKey(nickname))
  ) {
    throw new Error(`${name} (${nickname}) kaydı zaten var. Mevcut kaydı kontrol edin.`);
  }

  const farmer: FarmerDoc = {
    id,
    name,
    nickname,
    phone: optionalText(input.phone),
    village: optionalText(input.village),
    note: optionalText(input.note),
    isActive: 1,
    totalGram: 0,
    totalAmountKurus: 0,
    paidAmountKurus: 0,
    balanceKurus: 0,
    receiptCount: 0,
    deletedAt: null
  };

  await setDoc(doc(db, 'farmers', id), {
    ...createdSyncFields(id, 'farmers', timestamp),
    ...farmer
  });

  return farmer;
}

async function createMobileCompany(input: {
  name: string;
  authorizedPerson: string;
  phone: string;
  city: string;
  note: string;
}): Promise<CompanyDoc> {
  const db = getMobileFirestore();
  const id = newLocalId();
  const timestamp = nowIso();
  const name = requiredText(input.name, 'Firma adı');
  const company: CompanyDoc = {
    id,
    name,
    authorizedPerson: optionalText(input.authorizedPerson),
    phone: optionalText(input.phone),
    city: optionalText(input.city),
    note: optionalText(input.note),
    isActive: 1,
    totalGram: 0,
    totalAmountKurus: 0,
    collectedAmountKurus: 0,
    balanceKurus: 0,
    receiptCount: 0,
    deletedAt: null
  };

  await setDoc(doc(db, 'companies', id), {
    ...createdSyncFields(id, 'companies', timestamp),
    ...company
  });

  return company;
}

async function createMobilePurchaseReceipt(input: {
  mobileDevice: MobileDeviceInfo;
  date: string;
  timeText: string;
  farmerId: string;
  companyId: string;
  apricotTypeId: string;
  grossQuantityGram: number;
  crateCount: number;
  crateTareGram: number;
  quantityGram: number;
  unitPriceKurus: number;
  note: string;
}): Promise<ReceiptDoc> {
  const db = getMobileFirestore();
  const seasonId = await ensureMobileSeasonId();
  const date = requiredText(input.date, 'Tarih');
  const dateKey = dateToDateKey(date);
  const timeText = requiredText(input.timeText, 'Saat');
  const grossQuantityGram = Math.round(Number(input.grossQuantityGram || input.quantityGram));
  const crateCount = Math.max(0, Math.round(Number(input.crateCount || 0)));
  const crateTareGram = Math.round(Number(input.crateTareGram || 0));
  const totalTareGram = crateCount * crateTareGram;
  const quantityGram = Math.round(Number(input.quantityGram || grossQuantityGram - totalTareGram));
  const unitPriceKurus = Math.round(Number(input.unitPriceKurus));

  if (!Number.isFinite(grossQuantityGram) || grossQuantityGram <= 0) {
    throw new Error('Brüt kg sıfırdan büyük olmalı.');
  }

  if (!Number.isFinite(crateCount) || crateCount < 0) {
    throw new Error('Kasa adedi geçerli olmalı.');
  }

  if (![1000, 2000, 3000, 4000].includes(crateTareGram)) {
    throw new Error('Dara 1, 2, 3 veya 4 kg seçilmeli.');
  }

  if (totalTareGram >= grossQuantityGram) {
    throw new Error('Toplam dara brüt kilodan fazla olamaz.');
  }

  if (!Number.isFinite(quantityGram) || quantityGram <= 0) {
    throw new Error('Kg sıfırdan büyük olmalı.');
  }

  if (!Number.isFinite(unitPriceKurus) || unitPriceKurus <= 0) {
    throw new Error('Birim fiyat sıfırdan büyük olmalı.');
  }

  const id = newLocalId();
  const receiptRef = doc(db, 'purchaseReceipts', id);
  const farmerRef = doc(db, 'farmers', requiredText(input.farmerId, 'Çiftçi'));
  const companyRef = doc(db, 'companies', requiredText(input.companyId, 'Firma'));
  const apricotTypeRef = doc(db, 'apricotTypes', requiredText(input.apricotTypeId, 'Kayısı çeşidi'));
  const counterRef = doc(db, 'receiptNumberCounters', `${dateKey}-${input.mobileDevice.code}`);
  const timestamp = nowIso();

  return runTransaction(db, async (transaction) => {
    const [farmerSnapshot, companySnapshot, apricotTypeSnapshot, counterSnapshot] = await Promise.all([
      transaction.get(farmerRef),
      transaction.get(companyRef),
      transaction.get(apricotTypeRef),
      transaction.get(counterRef)
    ]);
    const farmerData = farmerSnapshot.data();
    const companyData = companySnapshot.data();
    const apricotTypeData = apricotTypeSnapshot.data();
    const farmer = readActiveName(farmerSnapshot.exists(), farmerData, 'Çiftçi');
    const company = readActiveName(companySnapshot.exists(), companyData, 'Firma');
    const apricotType = readActiveName(apricotTypeSnapshot.exists(), apricotTypeData, 'Kayısı çeşidi');
    const nextNumber = (counterSnapshot.exists() ? asNumber(counterSnapshot.data().lastNumber) : 0) + 1;
    const receiptNo = `${dateKey}-${input.mobileDevice.code}-${String(nextNumber).padStart(4, '0')}`;
    const totalAmountKurus = Math.round((quantityGram * unitPriceKurus) / 1000);
    const receipt: ReceiptDoc = {
      id,
      receiptNo,
      seasonId,
      date,
      dateKey,
      timeText,
      farmerId: input.farmerId,
      farmerName: farmer.name,
      companyId: input.companyId,
      companyName: company.name,
      apricotTypeId: input.apricotTypeId,
      apricotTypeName: apricotType.name,
      grossQuantityGram,
      crateCount,
      crateTareGram,
      quantityGram,
      unitPriceKurus,
      totalAmountKurus,
      note: optionalText(input.note),
      isCancelled: 0,
      deletedAt: null
    };

    transaction.set(
      counterRef,
      {
        id: `${dateKey}-${input.mobileDevice.code}`,
        dateKey,
        deviceCode: input.mobileDevice.code,
        lastNumber: nextNumber,
        updatedAt: timestamp,
        syncedAt: serverTimestamp()
      },
      { merge: true }
    );

    transaction.set(receiptRef, {
      ...createdSyncFields(id, 'purchase_receipts', timestamp),
      ...receipt,
      sourceDeviceId: input.mobileDevice.id,
      sourceDeviceCode: input.mobileDevice.code,
      cancelledAt: null,
      cancelReason: null
    });

    transaction.set(
      farmerRef,
      {
        totalGram: asNumber(farmerData?.totalGram) + quantityGram,
        totalAmountKurus: asNumber(farmerData?.totalAmountKurus) + totalAmountKurus,
        balanceKurus: asNumber(farmerData?.balanceKurus) + totalAmountKurus,
        receiptCount: asNumber(farmerData?.receiptCount) + 1,
        ...updateSyncFields(timestamp, farmer.version)
      },
      { merge: true }
    );

    transaction.set(
      companyRef,
      {
        totalGram: asNumber(companyData?.totalGram) + quantityGram,
        totalAmountKurus: asNumber(companyData?.totalAmountKurus) + totalAmountKurus,
        balanceKurus: asNumber(companyData?.balanceKurus) + totalAmountKurus,
        receiptCount: asNumber(companyData?.receiptCount) + 1,
        ...updateSyncFields(timestamp, company.version)
      },
      { merge: true }
    );

    return receipt;
  });
}

async function createMobileFarmerPayment(input: {
  farmerId: string;
  date: string;
  amountKurus: number;
  paymentMethod: PaymentMethod;
  note: string;
}): Promise<FarmerPaymentDoc> {
  const db = getMobileFirestore();
  const seasonId = await ensureMobileSeasonId();
  const id = newLocalId();
  const timestamp = nowIso();
  const farmerRef = doc(db, 'farmers', requiredText(input.farmerId, 'Çiftçi'));
  const paymentRef = doc(db, 'farmerPayments', id);
  const date = requiredText(input.date, 'Tarih');
  const dateKey = dateToDateKey(date);
  const amountKurus = Math.round(Number(input.amountKurus));

  if (!Number.isFinite(amountKurus) || amountKurus <= 0) {
    throw new Error('Ödeme tutarı sıfırdan büyük olmalı.');
  }

  return runTransaction(db, async (transaction) => {
    const farmerSnapshot = await transaction.get(farmerRef);
    const farmerData = farmerSnapshot.data();
    const farmer = readActiveName(farmerSnapshot.exists(), farmerData, 'Çiftçi');
    const payment: FarmerPaymentDoc = {
      id,
      seasonId,
      farmerId: input.farmerId,
      farmerName: farmer.name,
      date,
      dateKey,
      amountKurus,
      paymentMethod: input.paymentMethod,
      note: optionalText(input.note),
      isCancelled: 0,
      deletedAt: null
    };

    transaction.set(paymentRef, {
      ...createdSyncFields(id, 'farmer_payments', timestamp),
      ...payment,
      cancelledAt: null,
      cancelReason: null
    });
    transaction.set(
      farmerRef,
      {
        paidAmountKurus: asNumber(farmerData?.paidAmountKurus) + amountKurus,
        balanceKurus: asNumber(farmerData?.balanceKurus) - amountKurus,
        ...updateSyncFields(timestamp, farmer.version)
      },
      { merge: true }
    );

    return payment;
  });
}

async function createMobileCompanyPayment(input: {
  companyId: string;
  date: string;
  amountKurus: number;
  paymentMethod: PaymentMethod;
  note: string;
}): Promise<CompanyPaymentDoc> {
  const db = getMobileFirestore();
  const seasonId = await ensureMobileSeasonId();
  const id = newLocalId();
  const timestamp = nowIso();
  const companyRef = doc(db, 'companies', requiredText(input.companyId, 'Firma'));
  const paymentRef = doc(db, 'companyPayments', id);
  const date = requiredText(input.date, 'Tarih');
  const dateKey = dateToDateKey(date);
  const amountKurus = Math.round(Number(input.amountKurus));

  if (!Number.isFinite(amountKurus) || amountKurus <= 0) {
    throw new Error('Tahsilat tutarı sıfırdan büyük olmalı.');
  }

  return runTransaction(db, async (transaction) => {
    const companySnapshot = await transaction.get(companyRef);
    const companyData = companySnapshot.data();
    const company = readActiveName(companySnapshot.exists(), companyData, 'Firma');
    const payment: CompanyPaymentDoc = {
      id,
      seasonId,
      companyId: input.companyId,
      companyName: company.name,
      date,
      dateKey,
      amountKurus,
      paymentMethod: input.paymentMethod,
      note: optionalText(input.note),
      isCancelled: 0,
      deletedAt: null
    };

    transaction.set(paymentRef, {
      ...createdSyncFields(id, 'company_payments', timestamp),
      ...payment,
      cancelledAt: null,
      cancelReason: null
    });
    transaction.set(
      companyRef,
      {
        collectedAmountKurus: asNumber(companyData?.collectedAmountKurus) + amountKurus,
        balanceKurus: asNumber(companyData?.balanceKurus) - amountKurus,
        ...updateSyncFields(timestamp, company.version)
      },
      { merge: true }
    );

    return payment;
  });
}

function findFarmerPhone(
  farmers: FarmerDoc[],
  farmerId: string | undefined,
  farmerName: string | undefined
): string | null {
  const farmer =
    farmers.find((item) => item.id === farmerId) ??
    farmers.find((item) => item.name === farmerName || farmerDisplayName(item) === farmerName);

  return farmer?.phone ?? null;
}

async function sharePlainText(title: string, text: string, phone?: string | null): Promise<void> {
  const whatsappPhone = normalizeWhatsAppPhone(phone);

  if (whatsappPhone) {
    window.open(`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    return;
  }

  if (navigator.share) {
    await navigator.share({ title, text });
    return;
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
}

function receiptShareText(receipt: ReceiptDoc): string {
  return [
    'Ali Rıza Karga TARIM',
    `Alım Fişi: ${receipt.receiptNo}`,
    `Tarih: ${shortDate(receipt.date)} ${receipt.timeText}`,
    `Çiftçi: ${receipt.farmerName}`,
    `Firma: ${receipt.companyName}`,
    `Cins: ${receipt.apricotTypeName}`,
    `Brüt: ${formatGramAsKg(asNumber(receipt.grossQuantityGram || receipt.quantityGram))}`,
    receipt.crateCount ? `Dara: ${receipt.crateCount} kasa x ${formatGramAsKg(asNumber(receipt.crateTareGram))}` : '',
    `Net: ${formatGramAsKg(asNumber(receipt.quantityGram))}`,
    `Birim fiyat: ${formatKurus(asNumber(receipt.unitPriceKurus))}`,
    `Toplam: ${formatKurus(asNumber(receipt.totalAmountKurus))}`,
    receipt.note ? `Not: ${receipt.note}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

async function shareReceipt(receipt: ReceiptDoc, farmerPhone?: string | null): Promise<void> {
  await sharePlainText(`Alım Fişi ${receipt.receiptNo}`, receiptShareText(receipt), farmerPhone);
}

function receiptTareText(receipt: ReceiptDoc): string {
  return receipt.crateCount ? `${receipt.crateCount} kasa x ${formatGramAsKg(asNumber(receipt.crateTareGram))}` : '-';
}

function ReceiptPrintCopy({ receipt, copyLabel }: { receipt: ReceiptDoc; copyLabel: string }): JSX.Element {
  return (
    <section className="receipt-print-copy">
      <header className="receipt-copy-header">
        <img src={arkLogoUrl} alt="" aria-hidden="true" />
        <div>
          <strong>Ali Rıza Karga TARIM</strong>
          <span>Kayısı Alım Fişi</span>
        </div>
        <em>{copyLabel}</em>
      </header>
      <div className="receipt-copy-meta">
        <div>
          <span>Fiş No</span>
          <strong>{receipt.receiptNo}</strong>
        </div>
        <div>
          <span>Tarih</span>
          <strong>{shortDate(receipt.date)} {receipt.timeText}</strong>
        </div>
      </div>
      <div className="receipt-copy-grid">
        <div>
          <span>Çiftçi</span>
          <strong>{receipt.farmerName}</strong>
        </div>
        <div>
          <span>Firma</span>
          <strong>{receipt.companyName}</strong>
        </div>
        <div>
          <span>Cins</span>
          <strong>{receipt.apricotTypeName}</strong>
        </div>
        <div>
          <span>Brüt</span>
          <strong>{formatGramAsKg(asNumber(receipt.grossQuantityGram || receipt.quantityGram))}</strong>
        </div>
        <div>
          <span>Kasa / Dara</span>
          <strong>{receiptTareText(receipt)}</strong>
        </div>
        <div>
          <span>Net</span>
          <strong>{formatGramAsKg(asNumber(receipt.quantityGram))}</strong>
        </div>
        <div>
          <span>Birim fiyat</span>
          <strong>{formatKurus(asNumber(receipt.unitPriceKurus))}</strong>
        </div>
        <div className="receipt-copy-total">
          <span>Toplam</span>
          <strong>{formatKurus(asNumber(receipt.totalAmountKurus))}</strong>
        </div>
      </div>
      <div className="receipt-copy-note">
        <span>Not</span>
        <strong>{receipt.note || '-'}</strong>
      </div>
      <footer className="receipt-copy-signatures">
        <span>Teslim Eden</span>
        <span>Teslim Alan</span>
      </footer>
    </section>
  );
}

function ReceiptPrintSheet({ receipt }: { receipt: ReceiptDoc }): JSX.Element {
  return (
    <article className="mobile-receipt-print-sheet" aria-hidden="true">
      <ReceiptPrintCopy receipt={receipt} copyLabel="ÇİFTÇİ NÜSHASI" />
      <div className="receipt-cut-line"><span>Kesim çizgisi</span></div>
      <ReceiptPrintCopy receipt={receipt} copyLabel="ARŞİV NÜSHASI" />
    </article>
  );
}

function farmerPaymentShareText(payment: FarmerPaymentDoc): string {
  return [
    'Ali Rıza Karga TARIM',
    'Çiftçi Ödeme Fişi',
    `Tarih: ${shortDate(payment.date)}`,
    `Çiftçi: ${payment.farmerName}`,
    `Tutar: ${formatKurus(asNumber(payment.amountKurus))}`,
    `Yöntem: ${paymentMethodLabel(payment.paymentMethod)}`,
    payment.note ? `Not: ${payment.note}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function companyPaymentShareText(payment: CompanyPaymentDoc): string {
  return [
    'Ali Rıza Karga TARIM',
    'Firma Tahsilat Fişi',
    `Tarih: ${shortDate(payment.date)}`,
    `Firma: ${payment.companyName}`,
    `Tutar: ${formatKurus(asNumber(payment.amountKurus))}`,
    `Yöntem: ${paymentMethodLabel(payment.paymentMethod)}`,
    payment.note ? `Not: ${payment.note}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

async function shareFarmerPayment(payment: FarmerPaymentDoc, farmerPhone?: string | null): Promise<void> {
  await sharePlainText('Çiftçi Ödeme Fişi', farmerPaymentShareText(payment), farmerPhone);
}

async function shareCompanyPayment(payment: CompanyPaymentDoc): Promise<void> {
  await sharePlainText('Firma Tahsilat Fişi', companyPaymentShareText(payment));
}

function App(): JSX.Element {
  const [state, setState] = useState<LoadState>('idle');
  const [data, setData] = useState<MobileData>(emptyData);
  const [error, setError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [mobileDevice, setMobileDevice] = useState<MobileDeviceInfo | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState<MobileView>('overview');
  const [search, setSearch] = useState('');
  const [selectedFarmerId, setSelectedFarmerId] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);

  const refresh = async (options?: { silent?: boolean }): Promise<void> => {
    if (!options?.silent) {
      setState('loading');
    }
    setError(null);

    try {
      const loaded = await loadMobileData();
      setData(loaded);
      setState('ready');
    } catch (loadError) {
      if (loadError instanceof Error && loadError.message === 'missing-config') {
        setState('missing-config');
        return;
      }

      if (loadError instanceof Error && loadError.message === 'auth-required') {
        setState('idle');
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Veriler alınamadı.');
      setState('error');
    }
  };

  useEffect(() => {
    const app = getFirebaseApp();

    if (!app) {
      setState('missing-config');
      return undefined;
    }

    return onAuthStateChanged(getAuth(app), (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        setDeviceError(null);
        ensureMobileDevice(currentUser)
          .then(setMobileDevice)
          .catch((deviceLoadError: unknown) => {
            setDeviceError(
              deviceLoadError instanceof Error ? deviceLoadError.message : 'Mobil cihaz kodu alınamadı.'
            );
          });
        refresh();
      } else {
        setState('idle');
        setMobileDevice(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refresh({ silent: true });
    }, 10_000);

    return () => window.clearInterval(intervalId);
  }, [user]);

  const login = async (): Promise<void> => {
    const app = getFirebaseApp();

    if (!app) {
      setState('missing-config');
      return;
    }

    setState('loading');
    setError(null);

    try {
      await signInWithEmailAndPassword(getAuth(app), email.trim(), password);
      setPassword('');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Giriş yapılamadı.');
      setState('error');
    }
  };

  const logout = async (): Promise<void> => {
    const app = getFirebaseApp();

    if (!app) {
      return;
    }

    await signOut(getAuth(app));
    setData(emptyData);
    setMobileDevice(null);
  };

  const todayKey = useMemo(() => todayDateKey(), []);

  const overview = useMemo(() => {
    const receipts = data.receipts;
    const todayReceipts = receipts.filter((receipt) => (receipt.dateKey ?? '') === todayKey);
    const totalGram = sumBy(receipts, (receipt) => asNumber(receipt.quantityGram));
    const totalAmountKurus = sumBy(receipts, (receipt) => asNumber(receipt.totalAmountKurus));
    const farmerBalanceKurus = sumBy(data.farmers, (farmer) => asNumber(farmer.balanceKurus));
    const companyBalanceKurus = sumBy(data.companies, (company) => asNumber(company.balanceKurus));

    return {
      todayGram: sumBy(todayReceipts, (receipt) => asNumber(receipt.quantityGram)),
      todayAmountKurus: sumBy(todayReceipts, (receipt) => asNumber(receipt.totalAmountKurus)),
      todayReceiptCount: todayReceipts.length,
      totalGram,
      totalAmountKurus,
      farmerBalanceKurus,
      companyBalanceKurus
    };
  }, [data, todayKey]);

  const filteredReceipts = useMemo(
    () =>
      data.receipts.filter((receipt) =>
        containsSearch(
          search,
          receipt.receiptNo,
          receipt.farmerName,
          receipt.companyName,
          receipt.apricotTypeName,
          receipt.date,
          receipt.timeText
        )
      ),
    [data.receipts, search]
  );

  const filteredFarmers = useMemo(
    () =>
      data.farmers.filter((farmer) =>
        containsSearch(search, farmer.name, farmer.nickname, farmer.phone, farmer.village, farmer.balanceKurus, farmer.totalGram)
      ),
    [data.farmers, search]
  );

  const filteredCompanies = useMemo(
    () =>
      data.companies.filter((company) =>
        containsSearch(
          search,
          company.name,
          company.authorizedPerson,
          company.phone,
          company.city,
          company.balanceKurus,
          company.totalGram
        )
      ),
    [data.companies, search]
  );

  const selectedReceipt = useMemo(
    () => data.receipts.find((receipt) => receipt.id === selectedReceiptId) ?? filteredReceipts[0] ?? null,
    [data.receipts, filteredReceipts, selectedReceiptId]
  );

  const selectedFarmer = useMemo(
    () => data.farmers.find((farmer) => farmer.id === selectedFarmerId) ?? filteredFarmers[0] ?? null,
    [data.farmers, filteredFarmers, selectedFarmerId]
  );

  const selectedCompany = useMemo(
    () => data.companies.find((company) => company.id === selectedCompanyId) ?? filteredCompanies[0] ?? null,
    [data.companies, filteredCompanies, selectedCompanyId]
  );

  const farmerReceipts = useMemo(() => {
    if (!selectedFarmer) {
      return [];
    }

    return data.receipts.filter(
      (receipt) => receipt.farmerId === selectedFarmer.id || receipt.farmerName === selectedFarmer.name
    );
  }, [data.receipts, selectedFarmer]);

  const farmerPayments = useMemo(() => {
    if (!selectedFarmer) {
      return [];
    }

    return data.farmerPayments.filter(
      (payment) => payment.farmerId === selectedFarmer.id || payment.farmerName === selectedFarmer.name
    );
  }, [data.farmerPayments, selectedFarmer]);

  const companyReceipts = useMemo(() => {
    if (!selectedCompany) {
      return [];
    }

    return data.receipts.filter(
      (receipt) => receipt.companyId === selectedCompany.id || receipt.companyName === selectedCompany.name
    );
  }, [data.receipts, selectedCompany]);

  const companyPayments = useMemo(() => {
    if (!selectedCompany) {
      return [];
    }

    return data.companyPayments.filter(
      (payment) => payment.companyId === selectedCompany.id || payment.companyName === selectedCompany.name
    );
  }, [data.companyPayments, selectedCompany]);

  const companyDailyRows = useMemo(() => {
    const grouped = new Map<string, DailyCompanyRow>();

    for (const receipt of companyReceipts) {
      const dateKey = receipt.dateKey ?? receipt.date;
      const row =
        grouped.get(dateKey) ??
        ({
          id: dateKey,
          name: receipt.companyName,
          dateKey,
          date: receipt.date,
          quantityGram: 0,
          amountKurus: 0,
          receiptCount: 0
        } satisfies DailyCompanyRow);

      row.quantityGram += asNumber(receipt.quantityGram);
      row.amountKurus += asNumber(receipt.totalAmountKurus);
      row.receiptCount += 1;
      grouped.set(dateKey, row);
    }

    return Array.from(grouped.values()).sort((first, second) => second.dateKey.localeCompare(first.dateKey));
  }, [companyReceipts]);

  const todayCompanyRows = useMemo(() => {
    const grouped = new Map<string, CompanyTodayRow>();

    for (const receipt of data.receipts) {
      if ((receipt.dateKey ?? '') !== todayKey) {
        continue;
      }

      const id = receipt.companyId ?? receipt.companyName;
      const row =
        grouped.get(id) ??
        ({
          id,
          name: receipt.companyName,
          quantityGram: 0,
          amountKurus: 0,
          receiptCount: 0
        } satisfies CompanyTodayRow);

      row.quantityGram += asNumber(receipt.quantityGram);
      row.amountKurus += asNumber(receipt.totalAmountKurus);
      row.receiptCount += 1;
      grouped.set(id, row);
    }

    return Array.from(grouped.values()).sort((first, second) => second.quantityGram - first.quantityGram);
  }, [data.receipts, todayKey]);

  const setViewAndSearch = (nextView: MobileView): void => {
    setView(nextView);
    setSearch('');
  };

  const handleMobileCreated = async (target?: { type: 'receipt' | 'farmer' | 'company'; id: string }): Promise<void> => {
    await refresh();

    if (!target) {
      return;
    }

    if (target.type === 'receipt') {
      setSelectedReceiptId(target.id);
      setView('receipts');
    }

    if (target.type === 'farmer') {
      setSelectedFarmerId(target.id);
      setView('farmers');
    }

    if (target.type === 'company') {
      setSelectedCompanyId(target.id);
      setView('companies');
    }
  };

  const activeTab = useMemo(() => tabs.find((tab) => tab.key === view) ?? tabs[0], [view]);

  return (
    <div className="mobile-app-shell">
      <aside className="mobile-sidebar">
        <div className="mobile-brand">
          <img className="mobile-brand-logo" src={arkLogoUrl} alt="" aria-hidden="true" />
          <div>
            <strong>Ali Rıza Karga TARIM</strong>
            <span>Kurumsal Tarım Paneli</span>
          </div>
        </div>

        {user ? (
          <nav className="mobile-tabs" aria-label="Mobil ekranlar">
            {tabs.map((tab) => {
              const Icon = tab.icon;

              return (
                <button
                  key={tab.key}
                  className={tab.key === view ? 'active' : ''}
                  onClick={() => setViewAndSearch(tab.key)}
                  type="button"
                >
                  <Icon size={18} />
                  <span className="mobile-nav-text">
                    <strong>{tab.label}</strong>
                    <small>{tab.helper}</small>
                  </span>
                </button>
              );
            })}
          </nav>
        ) : null}
      </aside>

      <main className="mobile-workspace">
        <header className="mobile-header">
          <div>
            <p className="eyebrow">{view === 'overview' ? 'Çalışma sezonu' : activeTab.label}</p>
            <h1>2026 Kayısı Sezonu</h1>
          </div>
          {user ? (
            <div className="mobile-header-actions">
              <div className="mobile-device-badge">
                <small>Cihaz</small>
                <strong>{mobileDevice?.code ?? 'Hazırlanıyor'}</strong>
              </div>
              <button className="ghost-button" onClick={() => void refresh()} disabled={state === 'loading'}>
                Yenile
              </button>
            </div>
          ) : null}
        </header>

      {state === 'missing-config' ? (
        <section className="notice">
          Mobil Firebase ayarları eksik. Masaüstündeki Firebase ayarı tamamlanınca telefondan veriler okunur.
        </section>
      ) : null}

      {state === 'error' ? <section className="notice danger">{error}</section> : null}
      {deviceError ? <section className="notice danger">{deviceError}</section> : null}

      {!user && state !== 'missing-config' ? (
        <section className="mobile-panel login-panel">
          <div className="panel-title">
            <h2>Giriş</h2>
            <span>Firebase</span>
          </div>
          <div className="login-form">
            <label>
              <span>E-posta</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              <span>Şifre</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <button onClick={login} disabled={state === 'loading'}>
              Giriş Yap
            </button>
          </div>
        </section>
      ) : null}

      {user ? (
        <>
          <section className="notice">
            <span>{user.email} ile giriş yapıldı.</span>
            <button className="ghost-button" onClick={logout}>
              Çıkış
            </button>
          </section>

          {view === 'receipts' || view === 'farmers' || view === 'companies' ? (
            <label className="mobile-search">
              <span>Arama</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  view === 'receipts'
                    ? 'Fiş, çiftçi, firma, cins ara'
                    : view === 'farmers'
                      ? 'Çiftçi, köy, telefon ara'
                      : 'Firma, yetkili, şehir ara'
                }
              />
            </label>
          ) : null}

          {view === 'overview' ? (
            <OverviewView
              overview={overview}
              receipts={data.receipts}
              todayCompanyRows={todayCompanyRows}
              state={state}
              onOpenReceipt={(receiptId) => {
                setSelectedReceiptId(receiptId);
                setView('receipts');
              }}
            />
          ) : null}

          {view === 'receipts' ? (
            <ReceiptsView
              entryForm={
                <MobileReceiptForm
                  farmers={data.farmers}
                  companies={data.companies}
                  apricotTypes={data.apricotTypes}
                  mobileDevice={mobileDevice}
                  onCreated={handleMobileCreated}
                />
              }
              receipts={filteredReceipts}
              farmers={data.farmers}
              selectedReceipt={selectedReceipt}
              onSelectReceipt={setSelectedReceiptId}
            />
          ) : null}

          {view === 'farmers' ? (
            <FarmersView
              entryForm={<MobileFarmerForm onCreated={handleMobileCreated} />}
              farmers={filteredFarmers}
              selectedFarmer={selectedFarmer}
              farmerReceipts={farmerReceipts}
              farmerPayments={farmerPayments}
              onSelectFarmer={setSelectedFarmerId}
              onOpenReceipt={(receiptId) => {
                setSelectedReceiptId(receiptId);
                setView('receipts');
              }}
            />
          ) : null}

          {view === 'companies' ? (
            <CompaniesView
              entryForm={<MobileCompanyForm onCreated={handleMobileCreated} />}
              companies={filteredCompanies}
              selectedCompany={selectedCompany}
              companyReceipts={companyReceipts}
              companyPayments={companyPayments}
              companyDailyRows={companyDailyRows}
              onSelectCompany={setSelectedCompanyId}
              onOpenReceipt={(receiptId) => {
                setSelectedReceiptId(receiptId);
                setView('receipts');
              }}
            />
          ) : null}

          {view === 'apricotTypes' ? <ApricotTypesView apricotTypes={data.apricotTypes} /> : null}

          {view === 'farmerPayments' ? (
            <FarmerPaymentsView
              farmers={data.farmers}
              payments={data.farmerPayments}
              onCreated={handleMobileCreated}
            />
          ) : null}

          {view === 'companyPayments' ? (
            <CompanyPaymentsView
              companies={data.companies}
              payments={data.companyPayments}
              onCreated={handleMobileCreated}
            />
          ) : null}

          {view === 'reports' ? <MobileReportsView overview={overview} data={data} /> : null}

          {view === 'settings' ? (
            <MobileSettingsView userEmail={user.email ?? '-'} mobileDevice={mobileDevice} onLogout={logout} />
          ) : null}
        </>
      ) : null}
      </main>
    </div>
  );
}

function OperationsView({
  data,
  mobileDevice,
  onCreated
}: {
  data: MobileData;
  mobileDevice: MobileDeviceInfo | null;
  onCreated: (target?: { type: 'receipt' | 'farmer' | 'company'; id: string }) => Promise<void>;
}): JSX.Element {
  const [mode, setMode] = useState<OperationMode>('receipt');
  const activeFarmers = data.farmers.filter((farmer) => isActive(farmer.isActive));
  const activeCompanies = data.companies.filter((company) => isActive(company.isActive));
  const activeApricotTypes = data.apricotTypes.filter((type) => isActive(type.isActive));

  return (
    <section className="mobile-panel operation-panel">
      <div className="panel-title">
        <h2>Mobil İşlemler</h2>
        <span>{mobileDevice?.code ?? 'Cihaz hazırlanıyor'}</span>
      </div>

      {!mobileDevice ? (
        <p className="inline-warning">Mobil cihaz kodu alınmadan kayıt girilemez. Birkaç saniye sonra tekrar dene.</p>
      ) : null}

      <div className="operation-switch" role="tablist" aria-label="Mobil işlem seçimi">
        {operationModes.map((operation) => (
          <button
            key={operation.key}
            className={operation.key === mode ? 'active' : ''}
            onClick={() => setMode(operation.key)}
            type="button"
          >
            {operation.label}
          </button>
        ))}
      </div>

      {mode === 'receipt' ? (
        <MobileReceiptForm
          farmers={activeFarmers}
          companies={activeCompanies}
          apricotTypes={activeApricotTypes}
          mobileDevice={mobileDevice}
          onCreated={onCreated}
        />
      ) : null}

      {mode === 'farmerPayment' ? (
        <MobileFarmerPaymentForm farmers={activeFarmers} onCreated={onCreated} />
      ) : null}

      {mode === 'companyPayment' ? (
        <MobileCompanyPaymentForm companies={activeCompanies} onCreated={onCreated} />
      ) : null}

      {mode === 'farmer' ? <MobileFarmerForm onCreated={onCreated} /> : null}
      {mode === 'company' ? <MobileCompanyForm onCreated={onCreated} /> : null}
    </section>
  );
}

function MobileReceiptForm({
  farmers,
  companies,
  apricotTypes,
  mobileDevice,
  onCreated
}: {
  farmers: FarmerDoc[];
  companies: CompanyDoc[];
  apricotTypes: ApricotTypeDoc[];
  mobileDevice: MobileDeviceInfo | null;
  onCreated: (target?: { type: 'receipt' | 'farmer' | 'company'; id: string }) => Promise<void>;
}): JSX.Element {
  const [form, setForm] = useState({
    date: toInputDate(new Date()),
    timeText: currentTimeText(),
    farmerId: '',
    companyId: '',
    apricotTypeId: '',
    quantityKg: '',
    crateCount: '',
    crateTareKg: '2',
    unitPriceTl: '',
    note: ''
  });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [createdReceipt, setCreatedReceipt] = useState<ReceiptDoc | null>(null);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      farmerId: current.farmerId || farmers[0]?.id || '',
      companyId: current.companyId || companies[0]?.id || '',
      apricotTypeId: current.apricotTypeId || apricotTypes[0]?.id || ''
    }));
  }, [farmers, companies, apricotTypes]);

  const grossQuantityGram = parseKgToGram(form.quantityKg);
  const crateCount = Math.max(0, Math.round(Number(form.crateCount || 0)));
  const crateTareGram = parseKgToGram(form.crateTareKg);
  const tareGram = crateCount * crateTareGram;
  const quantityGram = Math.max(0, grossQuantityGram - tareGram);
  const unitPriceKurus = parseTlToKurus(form.unitPriceTl);
  const totalKurus =
    quantityGram > 0 && unitPriceKurus > 0 ? Math.round((quantityGram * unitPriceKurus) / 1000) : 0;
  const canSave = Boolean(
    mobileDevice && form.farmerId && form.companyId && form.apricotTypeId && quantityGram > 0 && unitPriceKurus > 0
  );
  const createdReceiptFarmerPhone = createdReceipt
    ? findFarmerPhone(farmers, createdReceipt.farmerId, createdReceipt.farmerName)
    : null;

  const submit = async (): Promise<void> => {
    if (!mobileDevice) {
      setError('Mobil cihaz kodu hazırlanmadı.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setStatus(null);

    try {
      const receipt = await createMobilePurchaseReceipt({
        mobileDevice,
        date: form.date,
        timeText: form.timeText,
        farmerId: form.farmerId,
        companyId: form.companyId,
        apricotTypeId: form.apricotTypeId,
        grossQuantityGram,
        crateCount,
        crateTareGram,
        quantityGram,
        unitPriceKurus,
        note: form.note
      });
      setCreatedReceipt(receipt);
      setStatus(`Fiş kaydedildi: ${receipt.receiptNo}`);
      setForm((current) => ({ ...current, timeText: currentTimeText(), quantityKg: '', crateCount: '', note: '' }));
      await onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Fiş kaydedilemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="operation-body">
      <div className="form-grid">
        <label>
          <span>Tarih</span>
          <input
            type="date"
            value={form.date}
            onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
          />
        </label>
        <label>
          <span>Saat</span>
          <input
            type="time"
            value={form.timeText}
            onChange={(event) => setForm((current) => ({ ...current, timeText: event.target.value }))}
          />
        </label>
        <label>
          <span>Çiftçi</span>
          <select
            value={form.farmerId}
            onChange={(event) => setForm((current) => ({ ...current, farmerId: event.target.value }))}
          >
            <option value="">Seç</option>
            {farmers.map((farmer) => (
              <option key={farmer.id} value={farmer.id}>
                {farmerDisplayName(farmer)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Firma</span>
          <select
            value={form.companyId}
            onChange={(event) => setForm((current) => ({ ...current, companyId: event.target.value }))}
          >
            <option value="">Seç</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Kayısı cinsi</span>
          <select
            value={form.apricotTypeId}
            onChange={(event) => setForm((current) => ({ ...current, apricotTypeId: event.target.value }))}
          >
            <option value="">Seç</option>
            {apricotTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Brüt kg</span>
          <input
            inputMode="decimal"
            value={form.quantityKg}
            onChange={(event) => setForm((current) => ({ ...current, quantityKg: event.target.value }))}
            placeholder="1480"
          />
        </label>
        <label>
          <span>Kasa adedi</span>
          <input
            inputMode="numeric"
            value={form.crateCount}
            onChange={(event) => setForm((current) => ({ ...current, crateCount: event.target.value }))}
            placeholder="0"
          />
        </label>
        <label>
          <span>Kasa darası</span>
          <select
            value={form.crateTareKg}
            onChange={(event) => setForm((current) => ({ ...current, crateTareKg: event.target.value }))}
          >
            <option value="1">1 kg</option>
            <option value="2">2 kg</option>
            <option value="3">3 kg</option>
            <option value="4">4 kg</option>
          </select>
        </label>
        <Info label="Net kg" value={`${formatGramAsKg(quantityGram)} / dara ${formatGramAsKg(tareGram)}`} />
        <label>
          <span>Birim fiyat</span>
          <input
            inputMode="decimal"
            value={form.unitPriceTl}
            onChange={(event) => setForm((current) => ({ ...current, unitPriceTl: event.target.value }))}
            placeholder="75"
          />
        </label>
        <Info label="Toplam" value={formatKurus(totalKurus)} />
      </div>
      <label className="full-label">
        <span>Not</span>
        <input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      {status ? <p className="form-success">{status}</p> : null}
      <button onClick={submit} disabled={!canSave || isSaving} type="button">
        Fişi Kaydet
      </button>
      {createdReceipt ? <MobileReceiptPrintCard receipt={createdReceipt} farmerPhone={createdReceiptFarmerPhone} /> : null}
    </div>
  );
}

function MobileFarmerPaymentForm({
  farmers,
  onCreated
}: {
  farmers: FarmerDoc[];
  onCreated: (target?: { type: 'receipt' | 'farmer' | 'company'; id: string }) => Promise<void>;
}): JSX.Element {
  const [form, setForm] = useState({
    farmerId: '',
    date: toInputDate(new Date()),
    amountTl: '',
    paymentMethod: 'cash' as PaymentMethod,
    note: ''
  });
  const [createdPayment, setCreatedPayment] = useState<FarmerPaymentDoc | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const amountKurus = parseTlToKurus(form.amountTl);
  const createdPaymentFarmerPhone = createdPayment
    ? findFarmerPhone(farmers, createdPayment.farmerId, createdPayment.farmerName)
    : null;

  useEffect(() => {
    setForm((current) => ({ ...current, farmerId: current.farmerId || farmers[0]?.id || '' }));
  }, [farmers]);

  const submit = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);
    setStatus(null);

    try {
      const payment = await createMobileFarmerPayment({
        farmerId: form.farmerId,
        date: form.date,
        amountKurus,
        paymentMethod: form.paymentMethod,
        note: form.note
      });
      setCreatedPayment(payment);
      setStatus('Çiftçi ödemesi kaydedildi.');
      setForm((current) => ({ ...current, amountTl: '', note: '' }));
      await onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Ödeme kaydedilemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="operation-body">
      <div className="form-grid">
        <label>
          <span>Çiftçi</span>
          <select
            value={form.farmerId}
            onChange={(event) => setForm((current) => ({ ...current, farmerId: event.target.value }))}
          >
            <option value="">Seç</option>
            {farmers.map((farmer) => (
              <option key={farmer.id} value={farmer.id}>
                {farmerDisplayName(farmer)} · {formatKurus(asNumber(farmer.balanceKurus))}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Tarih</span>
          <input
            type="date"
            value={form.date}
            onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
          />
        </label>
        <label>
          <span>Tutar</span>
          <input
            inputMode="decimal"
            value={form.amountTl}
            onChange={(event) => setForm((current) => ({ ...current, amountTl: event.target.value }))}
            placeholder="10000"
          />
        </label>
        <label>
          <span>Yöntem</span>
          <select
            value={form.paymentMethod}
            onChange={(event) =>
              setForm((current) => ({ ...current, paymentMethod: event.target.value as PaymentMethod }))
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
        <input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      {status ? <p className="form-success">{status}</p> : null}
      <button onClick={submit} disabled={!form.farmerId || amountKurus <= 0 || isSaving} type="button">
        Ödemeyi Kaydet
      </button>
      {createdPayment ? (
        <MobilePaymentPrintCard
          title="Çiftçi Ödeme Fişi"
          payment={createdPayment}
          onShare={() => shareFarmerPayment(createdPayment, createdPaymentFarmerPhone)}
        />
      ) : null}
    </div>
  );
}

function MobileCompanyPaymentForm({
  companies,
  onCreated
}: {
  companies: CompanyDoc[];
  onCreated: (target?: { type: 'receipt' | 'farmer' | 'company'; id: string }) => Promise<void>;
}): JSX.Element {
  const [form, setForm] = useState({
    companyId: '',
    date: toInputDate(new Date()),
    amountTl: '',
    paymentMethod: 'cash' as PaymentMethod,
    note: ''
  });
  const [createdPayment, setCreatedPayment] = useState<CompanyPaymentDoc | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const amountKurus = parseTlToKurus(form.amountTl);

  useEffect(() => {
    setForm((current) => ({ ...current, companyId: current.companyId || companies[0]?.id || '' }));
  }, [companies]);

  const submit = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);
    setStatus(null);

    try {
      const payment = await createMobileCompanyPayment({
        companyId: form.companyId,
        date: form.date,
        amountKurus,
        paymentMethod: form.paymentMethod,
        note: form.note
      });
      setCreatedPayment(payment);
      setStatus('Firma tahsilatı kaydedildi.');
      setForm((current) => ({ ...current, amountTl: '', note: '' }));
      await onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Tahsilat kaydedilemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="operation-body">
      <div className="form-grid">
        <label>
          <span>Firma</span>
          <select
            value={form.companyId}
            onChange={(event) => setForm((current) => ({ ...current, companyId: event.target.value }))}
          >
            <option value="">Seç</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name} · {formatKurus(asNumber(company.balanceKurus))}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Tarih</span>
          <input
            type="date"
            value={form.date}
            onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
          />
        </label>
        <label>
          <span>Tutar</span>
          <input
            inputMode="decimal"
            value={form.amountTl}
            onChange={(event) => setForm((current) => ({ ...current, amountTl: event.target.value }))}
            placeholder="10000"
          />
        </label>
        <label>
          <span>Yöntem</span>
          <select
            value={form.paymentMethod}
            onChange={(event) =>
              setForm((current) => ({ ...current, paymentMethod: event.target.value as PaymentMethod }))
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
        <input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      {status ? <p className="form-success">{status}</p> : null}
      <button onClick={submit} disabled={!form.companyId || amountKurus <= 0 || isSaving} type="button">
        Tahsilatı Kaydet
      </button>
      {createdPayment ? (
        <MobilePaymentPrintCard
          title="Firma Tahsilat Fişi"
          payment={createdPayment}
          onShare={() => shareCompanyPayment(createdPayment)}
        />
      ) : null}
    </div>
  );
}

function MobileFarmerForm({
  onCreated
}: {
  onCreated: (target?: { type: 'receipt' | 'farmer' | 'company'; id: string }) => Promise<void>;
}): JSX.Element {
  const [form, setForm] = useState({ name: '', nickname: '', phone: '', village: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);

    try {
      const farmer = await createMobileFarmer(form);
      setForm({ name: '', nickname: '', phone: '', village: '', note: '' });
      await onCreated({ type: 'farmer', id: farmer.id });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Çiftçi kaydedilemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="operation-body">
      <div className="form-grid">
        <label>
          <span>Çiftçi adı</span>
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label>
          <span>Lakap</span>
          <input
            value={form.nickname}
            onChange={(event) => setForm((current) => ({ ...current, nickname: event.target.value }))}
            placeholder="Aynı isim varsa zorunlu"
          />
        </label>
        <label>
          <span>Telefon</span>
          <input
            inputMode="tel"
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
          />
        </label>
        <label>
          <span>Köy</span>
          <input
            value={form.village}
            onChange={(event) => setForm((current) => ({ ...current, village: event.target.value }))}
          />
        </label>
        <label>
          <span>Not</span>
          <input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
        </label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <button onClick={submit} disabled={!form.name.trim() || isSaving} type="button">
        Çiftçiyi Kaydet
      </button>
    </div>
  );
}

function MobileCompanyForm({
  onCreated
}: {
  onCreated: (target?: { type: 'receipt' | 'farmer' | 'company'; id: string }) => Promise<void>;
}): JSX.Element {
  const [form, setForm] = useState({ name: '', authorizedPerson: '', phone: '', city: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);

    try {
      const company = await createMobileCompany(form);
      setForm({ name: '', authorizedPerson: '', phone: '', city: '', note: '' });
      await onCreated({ type: 'company', id: company.id });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Firma kaydedilemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="operation-body">
      <div className="form-grid">
        <label>
          <span>Firma adı</span>
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label>
          <span>Yetkili</span>
          <input
            value={form.authorizedPerson}
            onChange={(event) => setForm((current) => ({ ...current, authorizedPerson: event.target.value }))}
          />
        </label>
        <label>
          <span>Telefon</span>
          <input
            inputMode="tel"
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
          />
        </label>
        <label>
          <span>Şehir</span>
          <input value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} />
        </label>
      </div>
      <label className="full-label">
        <span>Not</span>
        <input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button onClick={submit} disabled={!form.name.trim() || isSaving} type="button">
        Firmayı Kaydet
      </button>
    </div>
  );
}

function MobileReceiptPrintCard({
  receipt,
  farmerPhone
}: {
  receipt: ReceiptDoc;
  farmerPhone?: string | null;
}): JSX.Element {
  return (
    <article className="mobile-print-card">
      <div className="mobile-print-head">
        <div>
          <span>Ali Rıza Karga TARIM</span>
          <strong>Alım Fişi</strong>
        </div>
        <em>{receipt.receiptNo}</em>
      </div>
      <div className="mobile-print-grid">
        <Info label="Tarih" value={`${shortDate(receipt.date)} ${receipt.timeText}`} />
        <Info label="Çiftçi" value={receipt.farmerName} />
        <Info label="Firma" value={receipt.companyName} />
        <Info label="Cins" value={receipt.apricotTypeName} />
        <Info label="Brüt kg" value={formatGramAsKg(asNumber(receipt.grossQuantityGram || receipt.quantityGram))} />
        <Info
          label="Kasa / Dara"
          value={receipt.crateCount ? `${receipt.crateCount} kasa x ${formatGramAsKg(asNumber(receipt.crateTareGram))}` : '-'}
        />
        <Info label="Net kg" value={formatGramAsKg(asNumber(receipt.quantityGram))} />
        <Info label="Toplam" value={formatKurus(asNumber(receipt.totalAmountKurus))} />
      </div>
      <ReceiptPrintSheet receipt={receipt} />
      <div className="detail-actions">
        <button type="button" onClick={() => void shareReceipt(receipt, farmerPhone)}>
          Paylaş
        </button>
        <button type="button" className="ghost-button" onClick={() => window.print()}>
          Yazdır
        </button>
      </div>
    </article>
  );
}

function MobilePaymentPrintCard({
  title,
  payment,
  onShare
}: {
  title: string;
  payment: FarmerPaymentDoc | CompanyPaymentDoc;
  onShare: () => Promise<void>;
}): JSX.Element {
  const name = 'farmerName' in payment ? payment.farmerName : payment.companyName;

  return (
    <article className="mobile-print-card">
      <div className="mobile-print-head">
        <div>
          <span>Ali Rıza Karga TARIM</span>
          <strong>{title}</strong>
        </div>
        <em>{payment.id.slice(0, 8).toUpperCase()}</em>
      </div>
      <div className="mobile-print-grid">
        <Info label="Tarih" value={shortDate(payment.date)} />
        <Info label="Ad" value={name} />
        <Info label="Tutar" value={formatKurus(asNumber(payment.amountKurus))} />
        <Info label="Yöntem" value={paymentMethodLabel(payment.paymentMethod)} />
      </div>
      <div className="detail-actions">
        <button type="button" onClick={() => void onShare()}>
          Paylaş
        </button>
        <button type="button" className="ghost-button" onClick={() => window.print()}>
          Yazdır
        </button>
      </div>
    </article>
  );
}

function OverviewView({
  overview,
  receipts,
  todayCompanyRows,
  state,
  onOpenReceipt
}: {
  overview: {
    todayGram: number;
    todayAmountKurus: number;
    todayReceiptCount: number;
    totalGram: number;
    totalAmountKurus: number;
    farmerBalanceKurus: number;
    companyBalanceKurus: number;
  };
  receipts: ReceiptDoc[];
  todayCompanyRows: CompanyTodayRow[];
  state: LoadState;
  onOpenReceipt: (receiptId: string) => void;
}): JSX.Element {
  return (
    <>
      <section className="mobile-stats">
        <article>
          <span>Bugünkü Kg</span>
          <strong>{formatGramAsKg(overview.todayGram)}</strong>
        </article>
        <article>
          <span>Bugünkü Tutar</span>
          <strong>{formatKurus(overview.todayAmountKurus)}</strong>
        </article>
        <article>
          <span>Bugünkü Fiş</span>
          <strong>{overview.todayReceiptCount}</strong>
        </article>
        <article>
          <span>Toplam Alım</span>
          <strong>{formatGramAsKg(overview.totalGram)}</strong>
        </article>
        <article>
          <span>Sezon Tutarı</span>
          <strong>{formatKurus(overview.totalAmountKurus)}</strong>
        </article>
        <article>
          <span>Çiftçi Bakiyesi</span>
          <strong>{formatKurus(overview.farmerBalanceKurus)}</strong>
        </article>
        <article>
          <span>Firma Bakiyesi</span>
          <strong>{formatKurus(overview.companyBalanceKurus)}</strong>
        </article>
        <article>
          <span>Durum</span>
          <strong>{state === 'loading' ? 'Yenileniyor' : 'Hazır'}</strong>
        </article>
      </section>

      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Bugünkü Firma Alımları</h2>
          <span>{todayCompanyRows.length}</span>
        </div>
        <div className="mobile-list">
          {todayCompanyRows.map((row) => (
            <article key={row.id} className="mobile-row">
              <div>
                <strong>{row.name}</strong>
                <span>{row.receiptCount} fiş</span>
              </div>
              <div>
                <strong>{formatGramAsKg(row.quantityGram)}</strong>
                <span>{formatKurus(row.amountKurus)}</span>
              </div>
            </article>
          ))}
          {todayCompanyRows.length === 0 ? <p className="empty">Bugün firma alımı yok.</p> : null}
        </div>
      </section>

      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Son Alım Fişleri</h2>
          <span>{receipts.length}</span>
        </div>
        <div className="mobile-list">
          {receipts.slice(0, 10).map((receipt) => (
            <button key={receipt.id} className="row-button" onClick={() => onOpenReceipt(receipt.id)} type="button">
              <ReceiptRow receipt={receipt} />
            </button>
          ))}
          {receipts.length === 0 ? <p className="empty">Kayıt yok.</p> : null}
        </div>
      </section>
    </>
  );
}

function ReceiptsView({
  entryForm,
  receipts,
  farmers,
  selectedReceipt,
  onSelectReceipt
}: {
  entryForm: JSX.Element;
  receipts: ReceiptDoc[];
  farmers: FarmerDoc[];
  selectedReceipt: ReceiptDoc | null;
  onSelectReceipt: (receiptId: string) => void;
}): JSX.Element {
  return (
    <section className="mobile-page-stack">
      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Yeni Alım Fişi</h2>
          <span>Kayıt</span>
        </div>
        {entryForm}
      </section>
      <section className="split-view">
      <div className="mobile-panel">
        <div className="panel-title">
          <h2>Alım Fişleri</h2>
          <span>{receipts.length}</span>
        </div>
        <div className="mobile-list">
          {receipts.map((receipt) => (
            <button
              key={receipt.id}
              className={`row-button ${selectedReceipt?.id === receipt.id ? 'selected' : ''}`}
              onClick={() => onSelectReceipt(receipt.id)}
              type="button"
            >
              <ReceiptRow receipt={receipt} />
            </button>
          ))}
          {receipts.length === 0 ? <p className="empty">Aramaya uygun fiş yok.</p> : null}
        </div>
      </div>

      <ReceiptDetail receipt={selectedReceipt} farmers={farmers} />
    </section>
    </section>
  );
}

function FarmersView({
  entryForm,
  farmers,
  selectedFarmer,
  farmerReceipts,
  farmerPayments,
  onSelectFarmer,
  onOpenReceipt
}: {
  entryForm: JSX.Element;
  farmers: FarmerDoc[];
  selectedFarmer: FarmerDoc | null;
  farmerReceipts: ReceiptDoc[];
  farmerPayments: FarmerPaymentDoc[];
  onSelectFarmer: (farmerId: string) => void;
  onOpenReceipt: (receiptId: string) => void;
}): JSX.Element {
  return (
    <section className="mobile-page-stack">
      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Yeni Çiftçi</h2>
          <span>Kart</span>
        </div>
        {entryForm}
      </section>
      <section className="split-view">
      <div className="mobile-panel">
        <div className="panel-title">
          <h2>Çiftçiler</h2>
          <span>{farmers.length}</span>
        </div>
        <div className="mobile-list">
          {farmers.map((farmer) => (
            <button
              key={farmer.id}
              className={`row-button ${selectedFarmer?.id === farmer.id ? 'selected' : ''}`}
              onClick={() => onSelectFarmer(farmer.id)}
              type="button"
            >
              <article className="mobile-row">
                <div>
                  <strong>{farmerDisplayName(farmer)}</strong>
                  <span>{[farmer.village, farmer.phone].filter(Boolean).join(' · ') || 'Bilgi yok'}</span>
                </div>
                <div>
                  <strong>{formatKurus(asNumber(farmer.balanceKurus))}</strong>
                  <span>{formatGramAsKg(asNumber(farmer.totalGram))}</span>
                </div>
              </article>
            </button>
          ))}
          {farmers.length === 0 ? <p className="empty">Aramaya uygun çiftçi yok.</p> : null}
        </div>
      </div>

      <FarmerDetail
        farmer={selectedFarmer}
        receipts={farmerReceipts}
        payments={farmerPayments}
        onOpenReceipt={onOpenReceipt}
      />
    </section>
    </section>
  );
}

function CompaniesView({
  entryForm,
  companies,
  selectedCompany,
  companyReceipts,
  companyPayments,
  companyDailyRows,
  onSelectCompany,
  onOpenReceipt
}: {
  entryForm: JSX.Element;
  companies: CompanyDoc[];
  selectedCompany: CompanyDoc | null;
  companyReceipts: ReceiptDoc[];
  companyPayments: CompanyPaymentDoc[];
  companyDailyRows: DailyCompanyRow[];
  onSelectCompany: (companyId: string) => void;
  onOpenReceipt: (receiptId: string) => void;
}): JSX.Element {
  return (
    <section className="mobile-page-stack">
      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Yeni Firma</h2>
          <span>Kart</span>
        </div>
        {entryForm}
      </section>
      <section className="split-view">
      <div className="mobile-panel">
        <div className="panel-title">
          <h2>Firmalar</h2>
          <span>{companies.length}</span>
        </div>
        <div className="mobile-list">
          {companies.map((company) => (
            <button
              key={company.id}
              className={`row-button ${selectedCompany?.id === company.id ? 'selected' : ''}`}
              onClick={() => onSelectCompany(company.id)}
              type="button"
            >
              <article className="mobile-row">
                <div>
                  <strong>{company.name}</strong>
                  <span>{[company.authorizedPerson, company.city, company.phone].filter(Boolean).join(' · ') || 'Bilgi yok'}</span>
                </div>
                <div>
                  <strong>{formatKurus(asNumber(company.balanceKurus))}</strong>
                  <span>{formatGramAsKg(asNumber(company.totalGram))}</span>
                </div>
              </article>
            </button>
          ))}
          {companies.length === 0 ? <p className="empty">Aramaya uygun firma yok.</p> : null}
        </div>
      </div>

      <CompanyDetail
        company={selectedCompany}
        receipts={companyReceipts}
        payments={companyPayments}
        dailyRows={companyDailyRows}
        onOpenReceipt={onOpenReceipt}
      />
    </section>
    </section>
  );
}

function ApricotTypesView({ apricotTypes }: { apricotTypes: ApricotTypeDoc[] }): JSX.Element {
  return (
    <section className="mobile-panel">
      <div className="panel-title">
        <h2>Kayısı Çeşitleri</h2>
        <span>{apricotTypes.length}</span>
      </div>
      <div className="mobile-list">
        {apricotTypes.map((type) => (
          <article key={type.id} className="mobile-row compact">
            <div>
              <strong>{type.name}</strong>
              <span>Sıra {asNumber(type.sortOrder)}</span>
            </div>
            <div>
              <strong>{isActive(type.isActive) ? 'Aktif' : 'Pasif'}</strong>
            </div>
          </article>
        ))}
        {apricotTypes.length === 0 ? <p className="empty">Kayısı çeşidi yok.</p> : null}
      </div>
    </section>
  );
}

function FarmerPaymentsView({
  farmers,
  payments,
  onCreated
}: {
  farmers: FarmerDoc[];
  payments: FarmerPaymentDoc[];
  onCreated: (target?: { type: 'receipt' | 'farmer' | 'company'; id: string }) => Promise<void>;
}): JSX.Element {
  return (
    <section className="mobile-page-stack">
      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Çiftçi Ödemesi</h2>
          <span>Ara ödeme</span>
        </div>
        <MobileFarmerPaymentForm farmers={farmers} onCreated={onCreated} />
      </section>
      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Ödeme Kayıtları</h2>
          <span>{payments.length}</span>
        </div>
        <div className="mobile-list">
          {payments.map((payment) => (
            <article key={payment.id} className="mobile-row compact">
              <div>
                <strong>{payment.farmerName}</strong>
                <span>
                  {shortDate(payment.date)} · {paymentMethodLabel(payment.paymentMethod)}
                </span>
                <small>{payment.note || ''}</small>
              </div>
              <div>
                <strong>{formatKurus(asNumber(payment.amountKurus))}</strong>
                <span>{isCancelled(payment.isCancelled) ? 'İptal' : 'Geçerli'}</span>
              </div>
            </article>
          ))}
          {payments.length === 0 ? <p className="empty">Ödeme kaydı yok.</p> : null}
        </div>
      </section>
    </section>
  );
}

function CompanyPaymentsView({
  companies,
  payments,
  onCreated
}: {
  companies: CompanyDoc[];
  payments: CompanyPaymentDoc[];
  onCreated: (target?: { type: 'receipt' | 'farmer' | 'company'; id: string }) => Promise<void>;
}): JSX.Element {
  return (
    <section className="mobile-page-stack">
      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Firma Ödemesi</h2>
          <span>Tahsilat</span>
        </div>
        <MobileCompanyPaymentForm companies={companies} onCreated={onCreated} />
      </section>
      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Tahsilat Kayıtları</h2>
          <span>{payments.length}</span>
        </div>
        <div className="mobile-list">
          {payments.map((payment) => (
            <article key={payment.id} className="mobile-row compact">
              <div>
                <strong>{payment.companyName}</strong>
                <span>
                  {shortDate(payment.date)} · {paymentMethodLabel(payment.paymentMethod)}
                </span>
                <small>{payment.note || ''}</small>
              </div>
              <div>
                <strong>{formatKurus(asNumber(payment.amountKurus))}</strong>
                <span>{isCancelled(payment.isCancelled) ? 'İptal' : 'Geçerli'}</span>
              </div>
            </article>
          ))}
          {payments.length === 0 ? <p className="empty">Tahsilat kaydı yok.</p> : null}
        </div>
      </section>
    </section>
  );
}

function MobileReportsView({
  overview,
  data
}: {
  overview: {
    todayGram: number;
    todayAmountKurus: number;
    todayReceiptCount: number;
    totalGram: number;
    totalAmountKurus: number;
    farmerBalanceKurus: number;
    companyBalanceKurus: number;
  };
  data: MobileData;
}): JSX.Element {
  const [selectedFarmerId, setSelectedFarmerId] = useState('');

  useEffect(() => {
    if (!data.farmers.length) {
      setSelectedFarmerId('');
      return;
    }

    if (!selectedFarmerId || !data.farmers.some((farmer) => farmer.id === selectedFarmerId)) {
      setSelectedFarmerId(data.farmers[0].id);
    }
  }, [data.farmers, selectedFarmerId]);

  const selectedFarmer = useMemo(
    () => data.farmers.find((farmer) => farmer.id === selectedFarmerId) ?? null,
    [data.farmers, selectedFarmerId]
  );
  const activeFarmerPayments = data.farmerPayments.filter((payment) => !isCancelled(payment.isCancelled));
  const activeCompanyPayments = data.companyPayments.filter((payment) => !isCancelled(payment.isCancelled));
  const paidToFarmersKurus = sumBy(activeFarmerPayments, (payment) => asNumber(payment.amountKurus));
  const collectedFromCompaniesKurus = sumBy(activeCompanyPayments, (payment) => asNumber(payment.amountKurus));
  const farmerStatementReceipts = selectedFarmer
    ? data.receipts.filter((receipt) => receipt.farmerId === selectedFarmer.id || receipt.farmerName === selectedFarmer.name)
    : [];
  const farmerStatementPayments = selectedFarmer
    ? activeFarmerPayments.filter(
        (payment) => payment.farmerId === selectedFarmer.id || payment.farmerName === selectedFarmer.name
      )
    : [];

  const companyDailyReports = useMemo(() => {
    const grouped = new Map<
      string,
      { id: string; companyName: string; date: string; dateKey: string; totalGram: number; totalAmountKurus: number; receiptCount: number }
    >();

    for (const receipt of data.receipts) {
      const dateKey = receipt.dateKey ?? receipt.date;
      const companyId = receipt.companyId ?? receipt.companyName;
      const key = `${companyId}-${dateKey}`;
      const row =
        grouped.get(key) ??
        ({
          id: key,
          companyName: receipt.companyName,
          date: receipt.date,
          dateKey,
          totalGram: 0,
          totalAmountKurus: 0,
          receiptCount: 0
        } satisfies {
          id: string;
          companyName: string;
          date: string;
          dateKey: string;
          totalGram: number;
          totalAmountKurus: number;
          receiptCount: number;
        });

      row.totalGram += asNumber(receipt.quantityGram);
      row.totalAmountKurus += asNumber(receipt.totalAmountKurus);
      row.receiptCount += 1;
      grouped.set(key, row);
    }

    return Array.from(grouped.values()).sort((first, second) => {
      const dateCompare = second.dateKey.localeCompare(first.dateKey);
      return dateCompare || first.companyName.localeCompare(second.companyName, 'tr-TR');
    });
  }, [data.receipts]);

  const companyBreakdown = useMemo(() => {
    const grouped = new Map<
      string,
      { id: string; name: string; totalGram: number; totalAmountKurus: number; receiptCount: number }
    >();

    for (const receipt of data.receipts) {
      const id = receipt.companyId ?? receipt.companyName;
      const row =
        grouped.get(id) ??
        ({ id, name: receipt.companyName, totalGram: 0, totalAmountKurus: 0, receiptCount: 0 } satisfies {
          id: string;
          name: string;
          totalGram: number;
          totalAmountKurus: number;
          receiptCount: number;
        });

      row.totalGram += asNumber(receipt.quantityGram);
      row.totalAmountKurus += asNumber(receipt.totalAmountKurus);
      row.receiptCount += 1;
      grouped.set(id, row);
    }

    return Array.from(grouped.values()).sort((first, second) => second.totalGram - first.totalGram);
  }, [data.receipts]);

  const typeBreakdown = useMemo(() => {
    const grouped = new Map<
      string,
      { id: string; name: string; totalGram: number; totalAmountKurus: number; receiptCount: number }
    >();

    for (const receipt of data.receipts) {
      const id = receipt.apricotTypeId ?? receipt.apricotTypeName;
      const row =
        grouped.get(id) ??
        ({ id, name: receipt.apricotTypeName, totalGram: 0, totalAmountKurus: 0, receiptCount: 0 } satisfies {
          id: string;
          name: string;
          totalGram: number;
          totalAmountKurus: number;
          receiptCount: number;
        });

      row.totalGram += asNumber(receipt.quantityGram);
      row.totalAmountKurus += asNumber(receipt.totalAmountKurus);
      row.receiptCount += 1;
      grouped.set(id, row);
    }

    return Array.from(grouped.values()).sort((first, second) => second.totalGram - first.totalGram);
  }, [data.receipts]);

  return (
    <section className="mobile-page-stack">
      <section className="mobile-stats">
        <article>
          <span>Toplam Alım</span>
          <strong>{formatGramAsKg(overview.totalGram)}</strong>
        </article>
        <article>
          <span>Toplam Tutar</span>
          <strong>{formatKurus(overview.totalAmountKurus)}</strong>
        </article>
        <article>
          <span>Fiş Sayısı</span>
          <strong>{data.receipts.length}</strong>
        </article>
        <article>
          <span>Çiftçi Sayısı</span>
          <strong>{data.farmers.length}</strong>
        </article>
        <article>
          <span>Firma Sayısı</span>
          <strong>{data.companies.length}</strong>
        </article>
        <article>
          <span>Çiftçiye Ödenen</span>
          <strong>{formatKurus(paidToFarmersKurus)}</strong>
        </article>
        <article>
          <span>Firmadan Alınan</span>
          <strong>{formatKurus(collectedFromCompaniesKurus)}</strong>
        </article>
        <article>
          <span>Çiftçi Bakiyesi</span>
          <strong>{formatKurus(overview.farmerBalanceKurus)}</strong>
        </article>
        <article>
          <span>Firma Bakiyesi</span>
          <strong>{formatKurus(overview.companyBalanceKurus)}</strong>
        </article>
      </section>

      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Çiftçi Ekstresi</h2>
          <span>{selectedFarmer ? formatKurus(asNumber(selectedFarmer.balanceKurus)) : '-'}</span>
        </div>
        <div className="operation-body">
          <label>
            <span>Çiftçi</span>
            <select value={selectedFarmerId} onChange={(event) => setSelectedFarmerId(event.target.value)}>
              {data.farmers.map((farmer) => (
                <option key={farmer.id} value={farmer.id}>
                  {farmerDisplayName(farmer)}
                </option>
              ))}
            </select>
          </label>
          {selectedFarmer ? (
            <div className="mini-stats no-border">
              <Info label="Toplam Kg" value={formatGramAsKg(asNumber(selectedFarmer.totalGram))} />
              <Info label="Toplam Alacak" value={formatKurus(asNumber(selectedFarmer.totalAmountKurus))} />
              <Info label="Ödenen" value={formatKurus(asNumber(selectedFarmer.paidAmountKurus))} />
              <Info label="Kalan" value={formatKurus(asNumber(selectedFarmer.balanceKurus))} />
            </div>
          ) : null}
        </div>
        <SubList title="Alımlar" count={farmerStatementReceipts.length}>
          {farmerStatementReceipts.slice(0, 8).map((receipt) => (
            <article key={receipt.id} className="mobile-row compact">
              <div>
                <strong>{shortDate(receipt.date)} · {receipt.receiptNo}</strong>
                <span>{receipt.companyName} · {receipt.apricotTypeName}</span>
              </div>
              <div>
                <strong>{formatGramAsKg(asNumber(receipt.quantityGram))}</strong>
                <span>{formatKurus(asNumber(receipt.totalAmountKurus))}</span>
              </div>
            </article>
          ))}
          {farmerStatementReceipts.length === 0 ? <p className="empty small">Alım yok.</p> : null}
        </SubList>
        <SubList title="Ödemeler" count={farmerStatementPayments.length}>
          {farmerStatementPayments.slice(0, 6).map((payment) => (
            <article key={payment.id} className="mobile-row compact">
              <div>
                <strong>{shortDate(payment.date)}</strong>
                <span>{paymentMethodLabel(payment.paymentMethod)}</span>
              </div>
              <div>
                <strong>{formatKurus(asNumber(payment.amountKurus))}</strong>
              </div>
            </article>
          ))}
          {farmerStatementPayments.length === 0 ? <p className="empty small">Ödeme yok.</p> : null}
        </SubList>
      </section>

      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Firma Alım Listeleri</h2>
          <span>{companyDailyReports.length}</span>
        </div>
        <div className="mobile-list">
          {companyDailyReports.slice(0, 20).map((row) => (
            <article key={row.id} className="mobile-row">
              <div>
                <strong>{shortDate(row.date)} · {row.companyName}</strong>
                <span>{row.receiptCount} fiş</span>
              </div>
              <div>
                <strong>{formatGramAsKg(row.totalGram)}</strong>
                <span>{formatKurus(row.totalAmountKurus)}</span>
              </div>
            </article>
          ))}
          {companyDailyReports.length === 0 ? <p className="empty">Firma alımı yok.</p> : null}
        </div>
      </section>

      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Firma Bazlı Alım</h2>
          <span>{companyBreakdown.length}</span>
        </div>
        <div className="mobile-list">
          {companyBreakdown.map((row) => (
            <article key={row.id} className="mobile-row">
              <div>
                <strong>{row.name}</strong>
                <span>{row.receiptCount} fiş</span>
              </div>
              <div>
                <strong>{formatGramAsKg(row.totalGram)}</strong>
                <span>{formatKurus(row.totalAmountKurus)}</span>
              </div>
            </article>
          ))}
          {companyBreakdown.length === 0 ? <p className="empty">Kayıt yok.</p> : null}
        </div>
      </section>

      <section className="mobile-panel">
        <div className="panel-title">
          <h2>Cins Bazlı Alım</h2>
          <span>{typeBreakdown.length}</span>
        </div>
        <div className="mobile-list">
          {typeBreakdown.map((row) => (
            <article key={row.id} className="mobile-row">
              <div>
                <strong>{row.name}</strong>
                <span>{row.receiptCount} fiş</span>
              </div>
              <div>
                <strong>{formatGramAsKg(row.totalGram)}</strong>
                <span>{formatKurus(row.totalAmountKurus)}</span>
              </div>
            </article>
          ))}
          {typeBreakdown.length === 0 ? <p className="empty">Kayıt yok.</p> : null}
        </div>
      </section>
    </section>
  );
}

function MobileSettingsView({
  userEmail,
  mobileDevice,
  onLogout
}: {
  userEmail: string;
  mobileDevice: MobileDeviceInfo | null;
  onLogout: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="mobile-panel">
      <div className="panel-title">
        <h2>Ayarlar</h2>
        <span>{mobileDevice?.code ?? 'Cihaz'}</span>
      </div>
      <div className="detail-grid">
        <Info label="Online hesap" value={userEmail} />
        <Info label="Cihaz kodu" value={mobileDevice?.code ?? 'Hazırlanıyor'} />
        <Info label="Cihaz adı" value={mobileDevice?.name ?? '-'} />
        <Info label="Senkron" value="Firebase" />
      </div>
      <div className="detail-actions">
        <button type="button" className="ghost-button" onClick={() => void onLogout()}>
          Çıkış Yap
        </button>
      </div>
    </section>
  );
}

function ReceiptRow({ receipt }: { receipt: ReceiptDoc }): JSX.Element {
  return (
    <article className="mobile-row">
      <div>
        <strong>{receipt.farmerName}</strong>
        <span>
          {receipt.companyName} · {receipt.apricotTypeName}
        </span>
        <small>
          {shortDate(receipt.date)} {receipt.timeText} · {receipt.receiptNo}
        </small>
      </div>
      <div>
        <strong>{formatGramAsKg(asNumber(receipt.quantityGram))}</strong>
        <small>{formatGramAsKg(asNumber(receipt.grossQuantityGram || receipt.quantityGram))} brüt</small>
        <span>{formatKurus(asNumber(receipt.totalAmountKurus))}</span>
      </div>
    </article>
  );
}

function ReceiptDetail({
  receipt,
  farmers
}: {
  receipt: ReceiptDoc | null;
  farmers: FarmerDoc[];
}): JSX.Element {
  if (!receipt) {
    return (
      <section className="mobile-panel detail-panel">
        <div className="panel-title">
          <h2>Fiş Detayı</h2>
          <span>Boş</span>
        </div>
        <p className="empty">Fiş seçilmedi.</p>
      </section>
    );
  }

  return (
    <section className="mobile-panel detail-panel">
      <div className="panel-title">
        <h2>Fiş Detayı</h2>
        <span>{receipt.receiptNo}</span>
      </div>
      <div className="detail-actions">
        <button
          type="button"
          onClick={() => void shareReceipt(receipt, findFarmerPhone(farmers, receipt.farmerId, receipt.farmerName))}
        >
          Paylaş
        </button>
        <button type="button" className="ghost-button" onClick={() => window.print()}>
          Yazdır
        </button>
      </div>
      <div className="detail-grid">
        <Info label="Tarih" value={`${shortDate(receipt.date)} ${receipt.timeText}`} />
        <Info label="Çiftçi" value={receipt.farmerName} />
        <Info label="Firma" value={receipt.companyName} />
        <Info label="Cins" value={receipt.apricotTypeName} />
        <Info label="Brüt kg" value={formatGramAsKg(asNumber(receipt.grossQuantityGram || receipt.quantityGram))} />
        <Info
          label="Kasa / Dara"
          value={receipt.crateCount ? `${receipt.crateCount} kasa x ${formatGramAsKg(asNumber(receipt.crateTareGram))}` : '-'}
        />
        <Info label="Net kg" value={formatGramAsKg(asNumber(receipt.quantityGram))} />
        <Info label="Birim fiyat" value={formatKurus(asNumber(receipt.unitPriceKurus))} />
        <Info label="Toplam" value={formatKurus(asNumber(receipt.totalAmountKurus))} />
        <Info label="Not" value={receipt.note || '-'} />
      </div>
      <ReceiptPrintSheet receipt={receipt} />
    </section>
  );
}

function FarmerDetail({
  farmer,
  receipts,
  payments,
  onOpenReceipt
}: {
  farmer: FarmerDoc | null;
  receipts: ReceiptDoc[];
  payments: FarmerPaymentDoc[];
  onOpenReceipt: (receiptId: string) => void;
}): JSX.Element {
  if (!farmer) {
    return (
      <section className="mobile-panel detail-panel">
        <div className="panel-title">
          <h2>Çiftçi Detayı</h2>
          <span>Boş</span>
        </div>
        <p className="empty">Çiftçi seçilmedi.</p>
      </section>
    );
  }

  return (
    <section className="mobile-panel detail-panel">
      <div className="panel-title">
        <h2>{farmerDisplayName(farmer)}</h2>
        <span>{receipts.length} fiş</span>
      </div>
      <div className="mobile-account-banner">
        <span>Kalan alacak</span>
        <strong>{formatKurus(asNumber(farmer.balanceKurus))}</strong>
      </div>
      <div className="mini-stats">
        <Info label="Toplam Kg" value={formatGramAsKg(asNumber(farmer.totalGram))} />
        <Info label="Alım Tutarı" value={formatKurus(asNumber(farmer.totalAmountKurus))} />
        <Info label="Ödenen" value={formatKurus(asNumber(farmer.paidAmountKurus))} />
        <Info label="Bakiye" value={formatKurus(asNumber(farmer.balanceKurus))} />
      </div>
      <div className="detail-grid">
        <Info label="Köy" value={farmer.village || '-'} />
        <Info label="Telefon" value={farmer.phone || '-'} />
      </div>
      <SubList title="Alım Fişleri" count={receipts.length}>
        {receipts.slice(0, 12).map((receipt) => (
          <button key={receipt.id} className="row-button compact" onClick={() => onOpenReceipt(receipt.id)} type="button">
            <ReceiptRow receipt={receipt} />
          </button>
        ))}
        {receipts.length === 0 ? <p className="empty small">Alım fişi yok.</p> : null}
      </SubList>
      <SubList title="Ödemeler" count={payments.length}>
        {payments.slice(0, 10).map((payment) => (
          <article key={payment.id} className="mobile-row compact">
            <div>
              <strong>{shortDate(payment.date)}</strong>
              <span>{paymentMethodLabel(payment.paymentMethod)}</span>
            </div>
            <div>
              <strong>{formatKurus(asNumber(payment.amountKurus))}</strong>
              <span>{payment.note || ''}</span>
            </div>
          </article>
        ))}
        {payments.length === 0 ? <p className="empty small">Ödeme yok.</p> : null}
      </SubList>
    </section>
  );
}

function CompanyDetail({
  company,
  receipts,
  payments,
  dailyRows,
  onOpenReceipt
}: {
  company: CompanyDoc | null;
  receipts: ReceiptDoc[];
  payments: CompanyPaymentDoc[];
  dailyRows: DailyCompanyRow[];
  onOpenReceipt: (receiptId: string) => void;
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

  const selectedDayReceipts = useMemo(
    () => receipts.filter((receipt) => (receipt.dateKey ?? receipt.date) === selectedDateKey),
    [receipts, selectedDateKey]
  );
  const selectedDay = dailyRows.find((row) => row.dateKey === selectedDateKey) ?? null;

  if (!company) {
    return (
      <section className="mobile-panel detail-panel">
        <div className="panel-title">
          <h2>Firma Detayı</h2>
          <span>Boş</span>
        </div>
        <p className="empty">Firma seçilmedi.</p>
      </section>
    );
  }

  return (
    <section className="mobile-panel detail-panel">
      <div className="panel-title">
        <h2>{company.name}</h2>
        <span>{receipts.length} fiş</span>
      </div>
      <div className="mobile-account-banner">
        <span>Firma bakiyesi</span>
        <strong>{formatKurus(asNumber(company.balanceKurus))}</strong>
      </div>
      <div className="mini-stats">
        <Info label="Toplam Kg" value={formatGramAsKg(asNumber(company.totalGram))} />
        <Info label="Alım Tutarı" value={formatKurus(asNumber(company.totalAmountKurus))} />
        <Info label="Alınan" value={formatKurus(asNumber(company.collectedAmountKurus))} />
        <Info label="Bakiye" value={formatKurus(asNumber(company.balanceKurus))} />
      </div>
      <div className="detail-grid">
        <Info label="Yetkili" value={company.authorizedPerson || '-'} />
        <Info label="Şehir" value={company.city || '-'} />
        <Info label="Telefon" value={company.phone || '-'} />
      </div>
      <SubList title="Günlere Göre Alım" count={dailyRows.length}>
        {dailyRows.slice(0, 12).map((row) => (
          <button
            key={row.id}
            className={`row-button compact ${selectedDateKey === row.dateKey ? 'selected' : ''}`}
            onClick={() => setSelectedDateKey(row.dateKey)}
            type="button"
          >
            <article className="mobile-row compact">
              <div>
                <strong>{shortDate(row.date)}</strong>
                <span>{row.receiptCount} fiş</span>
              </div>
              <div>
                <strong>{formatGramAsKg(row.quantityGram)}</strong>
                <span>{formatKurus(row.amountKurus)}</span>
              </div>
            </article>
          </button>
        ))}
        {dailyRows.length === 0 ? <p className="empty small">Günlük alım yok.</p> : null}
      </SubList>
      <SubList title={selectedDay ? `${shortDate(selectedDay.date)} Fişleri` : 'Gün Fişleri'} count={selectedDayReceipts.length}>
        {selectedDayReceipts.map((receipt) => (
          <button key={receipt.id} className="row-button compact" onClick={() => onOpenReceipt(receipt.id)} type="button">
            <ReceiptRow receipt={receipt} />
          </button>
        ))}
        {selectedDayReceipts.length === 0 ? <p className="empty small">Seçili güne ait fiş yok.</p> : null}
      </SubList>
      <SubList title="Tahsilatlar" count={payments.length}>
        {payments.slice(0, 10).map((payment) => (
          <article key={payment.id} className="mobile-row compact">
            <div>
              <strong>{shortDate(payment.date)}</strong>
              <span>{paymentMethodLabel(payment.paymentMethod)}</span>
            </div>
            <div>
              <strong>{formatKurus(asNumber(payment.amountKurus))}</strong>
              <span>{payment.note || ''}</span>
            </div>
          </article>
        ))}
        {payments.length === 0 ? <p className="empty small">Tahsilat yok.</p> : null}
      </SubList>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <article className="info-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SubList({ title, count, children }: { title: string; count: number; children: React.ReactNode }): JSX.Element {
  return (
    <section className="sub-list">
      <div className="sub-list-title">
        <strong>{title}</strong>
        <span>{count}</span>
      </div>
      <div className="mobile-list">{children}</div>
    </section>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
