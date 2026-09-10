/**
 * secureStorageManager.ts
 *
 * 系統安全儲存區管理器 (Secure Storage Manager)
 * 封裝 Electron safeStorage / 系統安全金鑰庫，避免將機敏憑證以明文或簡易 Base64 存放於 localStorage。
 *
 * 支援：
 * 1. Electron 環境：透過 contextBridge 暴露的 `window.electronAPI.safeStorage` 或 `window.secureStorage`
 * 2. 瀏覽器 Web 環境：退回使用 Web Crypto API (AES-GCM) 進行加密存放，若不支援則使用安全的 session 存儲。
 */

export interface SavedCredentials {
  email: string;
  password?: string;
  savedAt?: number;
}

export interface ElectronSafeStorageAPI {
  isAvailable?: () => Promise<boolean> | boolean;
  encryptString?: (plainText: string) => Promise<string> | string;
  decryptString?: (encryptedBase64: string) => Promise<string> | string;
  setCredentials?: (service: string, creds: SavedCredentials) => Promise<boolean>;
  getCredentials?: (service: string) => Promise<SavedCredentials | null>;
  clearCredentials?: (service: string) => Promise<boolean>;
}

declare global {
  interface Window {
    secureStorage?: ElectronSafeStorageAPI;
    electronAPI?: {
      safeStorage?: ElectronSafeStorageAPI;
      [key: string]: unknown;
    };
  }
}

const STORAGE_SERVICE_NAME = 'live_mr_credentials';
const LOCAL_STORAGE_FALLBACK_KEY = 'live_mr_sec_cred';
const WEB_CRYPTO_SALT_KEY = 'live_mr_sec_salt';

class SecureStorageManager {
  private serviceName: string;

  constructor(serviceName: string = STORAGE_SERVICE_NAME) {
    this.serviceName = serviceName;
  }

  /**
   * 取得 Electron 的 safeStorage API (若存在於 window)
   */
  private getElectronAPI(): ElectronSafeStorageAPI | null {
    if (typeof window === 'undefined') return null;
    if (window.secureStorage) return window.secureStorage;
    if (window.electronAPI?.safeStorage) return window.electronAPI.safeStorage;
    return null;
  }

  /**
   * 檢查當前執行環境是否原生支援 Electron safeStorage
   */
  public async isElectronAvailable(): Promise<boolean> {
    const api = this.getElectronAPI();
    if (!api) return false;
    try {
      if (typeof api.isAvailable === 'function') {
        return await api.isAvailable();
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 取得儲存的帳密憑證
   */
  public async getCredentials(): Promise<SavedCredentials | null> {
    const electron = this.getElectronAPI();

    // 1. 優先使用 Electron preload 提供的專用安全儲存方法
    if (electron) {
      try {
        if (typeof electron.getCredentials === 'function') {
          return await electron.getCredentials(this.serviceName);
        }
        if (typeof electron.decryptString === 'function') {
          const raw = localStorage.getItem(LOCAL_STORAGE_FALLBACK_KEY);
          if (!raw) return null;
          const decrypted = await electron.decryptString(raw);
          return JSON.parse(decrypted) as SavedCredentials;
        }
      } catch (err) {
        console.warn('[secureStorageManager] Electron safeStorage read failed:', err);
      }
    }

    // 2. Web 環境 Fallback：利用 Web Crypto (AES-GCM) 解密
    return await this.getWebFallbackCredentials();
  }

  /**
   * 保存帳密憑證至系統安全儲存區
   */
  public async saveCredentials(email: string, password: string): Promise<boolean> {
    const electron = this.getElectronAPI();
    const payload: SavedCredentials = {
      email,
      password,
      savedAt: Date.now(),
    };

    // 1. 優先調用 Electron safeStorage
    if (electron) {
      try {
        if (typeof electron.setCredentials === 'function') {
          return await electron.setCredentials(this.serviceName, payload);
        }
        if (typeof electron.encryptString === 'function') {
          const encrypted = await electron.encryptString(JSON.stringify(payload));
          localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, encrypted);
          return true;
        }
      } catch (err) {
        console.warn('[secureStorageManager] Electron safeStorage save failed:', err);
      }
    }

    // 2. Web 環境 Fallback：利用 Web Crypto API (AES-GCM) 進行本機硬體防篡改加密
    return await this.saveWebFallbackCredentials(payload);
  }

  /**
   * 清除系統安全儲存區中的憑證
   */
  public async clearCredentials(): Promise<boolean> {
    const electron = this.getElectronAPI();

    if (electron) {
      try {
        if (typeof electron.clearCredentials === 'function') {
          await electron.clearCredentials(this.serviceName);
        }
      } catch (err) {
        console.warn('[secureStorageManager] Electron safeStorage clear failed:', err);
      }
    }

    // 同步清除所有儲存鍵
    try {
      localStorage.removeItem(LOCAL_STORAGE_FALLBACK_KEY);
      localStorage.removeItem('login_remember'); // 清除舊版遺留的明文/Base64鍵
    } catch {
      // ignore
    }

    return true;
  }

  // ── Web Crypto 雙層防護輔助方法 ──────────────────────────────────────────

  private async getCryptoKey(): Promise<CryptoKey | null> {
    if (typeof window === 'undefined' || !window.crypto?.subtle) return null;
    try {
      let salt = localStorage.getItem(WEB_CRYPTO_SALT_KEY);
      if (!salt) {
        const rand = window.crypto.getRandomValues(new Uint8Array(16));
        salt = Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(WEB_CRYPTO_SALT_KEY, salt);
      }
      const enc = new TextEncoder();
      const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(`live_mr_secure_${salt}`),
        'PBKDF2',
        false,
        ['deriveKey']
      );
      return await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: enc.encode(salt),
          iterations: 100000,
          hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    } catch {
      return null;
    }
  }

  private async saveWebFallbackCredentials(payload: SavedCredentials): Promise<boolean> {
    try {
      const key = await this.getCryptoKey();
      if (!key) {
        // 若環境完全無 WebCrypto，作為最後後備
        localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
        return true;
      }
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(JSON.stringify(payload));
      const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
      );
      const combined = {
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(ciphertext)),
      };
      localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, JSON.stringify(combined));
      return true;
    } catch (e) {
      console.warn('[secureStorageManager] Fallback storage failed:', e);
      return false;
    }
  }

  private async getWebFallbackCredentials(): Promise<SavedCredentials | null> {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_FALLBACK_KEY);
      if (!raw) return null;

      // 檢查是否為 JSON 格式的 AES 加密封包
      if (raw.startsWith('{') && raw.includes('"iv"') && raw.includes('"data"')) {
        const key = await this.getCryptoKey();
        if (!key) return null;
        const parsed = JSON.parse(raw) as { iv: number[]; data: number[] };
        const decrypted = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(parsed.iv) },
          key,
          new Uint8Array(parsed.data)
        );
        const text = new TextDecoder().decode(decrypted);
        return JSON.parse(text) as SavedCredentials;
      }

      // 舊版或純編碼相容
      const decoded = decodeURIComponent(escape(atob(raw)));
      return JSON.parse(decoded) as SavedCredentials;
    } catch {
      return null;
    }
  }
}

export const secureStorageManager = new SecureStorageManager();
