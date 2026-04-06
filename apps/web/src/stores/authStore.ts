/**
 * Auth store — manages the user's session state.
 *
 * R11-QOL3: Keystore is only saved to IDB after relay confirms auth.
 * Login validates input format. handleAuthFailure cleans up properly.
 */

import { create } from 'zustand';
import {
  deriveKeyPair,
  createKeystoreEntry,
  unlockKeystore,
  toHex,
  fromHex,
  type KeystoreEntry,
  type KeyPair,
} from '@muster/crypto';

// ─── IndexedDB key store ──────────────────────────────────────────────────────

const IDB_DB_NAME    = 'muster-keystore';
const IDB_STORE_NAME = 'keystores';
const IDB_VERSION    = 1;

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE_NAME, { keyPath: 'username' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function saveKeystoreToIDB(entry: KeystoreEntry): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function loadKeystoreFromIDB(username: string): Promise<KeystoreEntry | null> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE_NAME, 'readonly');
    const req = tx.objectStore(IDB_STORE_NAME).get(username);
    req.onsuccess = () => resolve((req.result as KeystoreEntry | undefined) ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function deleteKeystoreFromIDB(username: string): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).delete(username);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function listKeystoreUsernamesFromIDB(): Promise<string[]> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE_NAME, 'readonly');
    const req = tx.objectStore(IDB_STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror   = () => reject(req.error);
  });
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  publicKeyHex: string | null;
  _keypair: KeyPair | null;
  _authMode: 'login' | 'signup' | null;
  /** Keystore waiting to be saved — only persisted after relay confirms auth */
  _pendingKeystore: KeystoreEntry | null;
  /** Whether the local keystore already existed before this login */
  _hadLocalKeystore: boolean;

  rehydrate: () => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Called by networkStore when relay confirms auth — saves pending keystore */
  confirmAuth: () => Promise<void>;
  /** Called by networkStore when relay rejects auth — cleans up */
  handleAuthFailure: () => Promise<void>;
  exportKeystore: (username: string) => Promise<string>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  isAuthenticated: false,
  username:        null,
  publicKeyHex:    null,
  _keypair:        null,
  _authMode:       null,
  _pendingKeystore: null,
  _hadLocalKeystore: false,

  rehydrate: async () => {
    const usernames = await listKeystoreUsernamesFromIDB();
    if (usernames.length === 0) return;
    const lastUsername = usernames[usernames.length - 1];
    if (lastUsername) {
      const entry = await loadKeystoreFromIDB(lastUsername);
      if (entry) {
        set({ username: entry.username, publicKeyHex: entry.publicKeyHex });
      }
    }
  },

  signup: async (username, password) => {
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      throw new Error('auth.errors.usernameInvalid');
    }
    if (password.length < 8) {
      throw new Error('auth.errors.passwordTooShort');
    }

    const existing = await loadKeystoreFromIDB(username);
    if (existing) throw new Error('auth.errors.usernameTaken');

    const keypair = await deriveKeyPair(username, password);
    const entry   = await createKeystoreEntry(keypair, username, password);

    // Don't save to IDB yet — wait for relay to confirm
    set({
      isAuthenticated: true,
      username,
      publicKeyHex: toHex(keypair.publicKey),
      _keypair: keypair,
      _authMode: 'signup',
      _pendingKeystore: entry,
      _hadLocalKeystore: false,
    });
  },

  login: async (username, password) => {
    // Validate input — same rules as signup
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      throw new Error('auth.errors.usernameInvalid');
    }
    if (password.length < 8) {
      throw new Error('auth.errors.passwordTooShort');
    }

    const entry = await loadKeystoreFromIDB(username);

    if (entry) {
      // Fast path: local keystore exists — decrypt it
      const { unlockKeystore: unlock, getPublicKey } = await import('@muster/crypto');
      const privateKeyBytes = await unlock(entry, password);
      const publicKeyBytes  = await getPublicKey(privateKeyBytes);

      const keypair: KeyPair = {
        privateKey: privateKeyBytes,
        publicKey:  publicKeyBytes,
      };

      set({
        isAuthenticated: true,
        username,
        publicKeyHex: toHex(publicKeyBytes),
        _keypair: keypair,
        _authMode: 'login',
        _pendingKeystore: null,
        _hadLocalKeystore: true,
      });
    } else {
      // Cross-device login: derive keypair from credentials
      // Don't save keystore yet — wait for relay to confirm account exists
      const keypair = await deriveKeyPair(username, password);
      const newEntry = await createKeystoreEntry(keypair, username, password);

      set({
        isAuthenticated: true,
        username,
        publicKeyHex: toHex(keypair.publicKey),
        _keypair: keypair,
        _authMode: 'login',
        _pendingKeystore: newEntry,
        _hadLocalKeystore: false,
      });
    }
  },

  confirmAuth: async () => {
    const pending = get()._pendingKeystore;
    if (pending) {
      await saveKeystoreToIDB(pending);
      set({ _pendingKeystore: null });
      console.log('[auth] Keystore saved after relay confirmation');
    }
  },

  handleAuthFailure: async () => {
    const username = get().username;
    const hadLocal = get()._hadLocalKeystore;

    // If we didn't have a local keystore (cross-device login that failed),
    // there's nothing to clean up in IDB since we never saved
    // If we DID have a local keystore but relay rejected, delete it
    // (could be stale from a previous failed attempt)
    if (username && !hadLocal) {
      await deleteKeystoreFromIDB(username).catch(() => {});
    }

    set({
      isAuthenticated: false,
      _keypair: null,
      _authMode: null,
      _pendingKeystore: null,
      _hadLocalKeystore: false,
    });
  },

  logout: () => {
    set({
      isAuthenticated: false,
      _keypair: null,
      _authMode: null,
      _pendingKeystore: null,
      _hadLocalKeystore: false,
    });
  },

  exportKeystore: async (username) => {
    const entry = await loadKeystoreFromIDB(username);
    if (!entry) throw new Error('auth.errors.accountNotFound');
    return JSON.stringify(entry, null, 2);
  },
}));

export function getCurrentKeypair(): KeyPair | null {
  return useAuthStore.getState()._keypair;
}
(window as any).__authStore = useAuthStore;
