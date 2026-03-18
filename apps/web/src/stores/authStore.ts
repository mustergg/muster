/**
 * Auth store — manages the user's session state.
 *
 * Uses Zustand for simple, boilerplate-free global state.
 * The private key is held in memory only — never written to state storage.
 */

import { create } from 'zustand';
import {
  generateKeyPair,
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
  /** In-memory keypair — never persisted. null when logged out. */
  _keypair: KeyPair | null;

  /**
   * Try to restore session from the last active keystore in IndexedDB.
   * Succeeds silently if found; does nothing if not.
   * Note: this only restores the public key — the private key requires
   * the password, so the user still has to log in.
   */
  rehydrate: () => Promise<void>;

  /**
   * Create a new account: generates keypair, encrypts private key,
   * saves keystore to IndexedDB.
   */
  signup: (username: string, password: string) => Promise<void>;

  /**
   * Load an existing keystore from IndexedDB and decrypt the private key.
   */
  login: (username: string, password: string) => Promise<void>;

  /**
   * Clear the in-memory keypair and mark the user as logged out.
   * The keystore remains in IndexedDB for the next login.
   */
  logout: () => void;

  /**
   * Export the keystore entry as a JSON string for backup.
   * The private key is still encrypted — this is safe to save to disk.
   */
  exportKeystore: (username: string) => Promise<string>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  isAuthenticated: false,
  username:        null,
  publicKeyHex:    null,
  _keypair:        null,

  rehydrate: async () => {
    const usernames = await listKeystoreUsernamesFromIDB();
    if (usernames.length === 0) return;
    // Pre-populate the last known username so the login form can prefill it
    const lastUsername = usernames[usernames.length - 1];
    if (lastUsername) {
      const entry = await loadKeystoreFromIDB(lastUsername);
      if (entry) {
        set({ username: entry.username, publicKeyHex: entry.publicKeyHex });
      }
    }
  },

  signup: async (username, password) => {
    // Validate username format: 3–32 chars, alphanumeric + _ -
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      throw new Error('auth.errors.usernameInvalid');
    }
    if (password.length < 8) {
      throw new Error('auth.errors.passwordTooShort');
    }

    // Check if username already exists locally
    const existing = await loadKeystoreFromIDB(username);
    if (existing) throw new Error('auth.errors.usernameTaken');

    const keypair = await generateKeyPair();
    const entry   = await createKeystoreEntry(keypair, username, password);
    await saveKeystoreToIDB(entry);

    set({
      isAuthenticated: true,
      username,
      publicKeyHex: toHex(keypair.publicKey),
      _keypair: keypair,
    });
  },

  login: async (username, password) => {
    const entry = await loadKeystoreFromIDB(username);
    if (!entry) throw new Error('auth.errors.accountNotFound');

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
    });
  },

  logout: () => {
    set({ isAuthenticated: false, _keypair: null });
    // Note: username + publicKeyHex are kept so the login form can prefill
  },

  exportKeystore: async (username) => {
    const entry = await loadKeystoreFromIDB(username);
    if (!entry) throw new Error('auth.errors.accountNotFound');
    return JSON.stringify(entry, null, 2);
  },
}));

/** Get the current user's keypair from outside React components (e.g. in core network code) */
export function getCurrentKeypair(): KeyPair | null {
  return useAuthStore.getState()._keypair;
}
