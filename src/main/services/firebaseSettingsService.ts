import type { FirebaseSettings } from '../../shared/ipc-contracts/app-api';
import { BUNDLED_FIREBASE_SETTINGS } from '../../shared/firebase/defaultSettings';
import { getSettings, setSetting } from '../repositories/settingsRepository';

const FIREBASE_SETTING_KEYS = [
  'firebase_api_key',
  'firebase_auth_domain',
  'firebase_project_id',
  'firebase_storage_bucket',
  'firebase_messaging_sender_id',
  'firebase_app_id',
  'firebase_auth_email',
  'firebase_auth_password'
] as const;

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function requireText(value: string, label: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(`${label} boş bırakılamaz.`);
  }

  return normalized;
}

export function getFirebaseSettings(): FirebaseSettings {
  const settings = getSettings([...FIREBASE_SETTING_KEYS]);

  return {
    apiKey: BUNDLED_FIREBASE_SETTINGS.apiKey,
    authDomain: BUNDLED_FIREBASE_SETTINGS.authDomain,
    projectId: BUNDLED_FIREBASE_SETTINGS.projectId,
    storageBucket: BUNDLED_FIREBASE_SETTINGS.storageBucket,
    messagingSenderId: BUNDLED_FIREBASE_SETTINGS.messagingSenderId,
    appId: BUNDLED_FIREBASE_SETTINGS.appId,
    authEmail: settings.firebase_auth_email || BUNDLED_FIREBASE_SETTINGS.authEmail,
    authPassword: settings.firebase_auth_password || BUNDLED_FIREBASE_SETTINGS.authPassword
  };
}

export function saveFirebaseSettings(input: FirebaseSettings): FirebaseSettings {
  const settings: FirebaseSettings = {
    apiKey: requireText(input.apiKey, 'Firebase apiKey'),
    authDomain: normalizeText(input.authDomain),
    projectId: requireText(input.projectId, 'Firebase projectId'),
    storageBucket: normalizeText(input.storageBucket),
    messagingSenderId: normalizeText(input.messagingSenderId),
    appId: requireText(input.appId, 'Firebase appId'),
    authEmail: requireText(input.authEmail, 'Firebase kullanıcı e-postası'),
    authPassword: requireText(input.authPassword, 'Firebase kullanıcı şifresi')
  };

  setSetting('firebase_auth_email', settings.authEmail);
  setSetting('firebase_auth_password', settings.authPassword);

  return settings;
}

export function hasFirebaseSettings(settings = getFirebaseSettings()): boolean {
  return Boolean(settings.apiKey && settings.authDomain && settings.projectId && settings.appId && settings.authEmail && settings.authPassword);
}
