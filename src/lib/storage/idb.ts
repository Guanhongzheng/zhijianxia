/**
 * IndexedDB 轻封装 —— 用于插件数据、壁papers、摘要历史等本地持久化。
 * 不引入额外依赖，直接使用浏览器原生 IndexedDB。
 */

const DB_NAME = 'zhijianxia';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打开本地数据库失败'));
  });
  return dbPromise;
}

/** 读取一个键的值 */
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDB();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

/** 写入一个键的值 */
export async function idbSet<T>(key: string, value: T): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

/** 删除一个键 */
export async function idbDel(key: string): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

/** 列出所有键 */
export async function idbKeys(): Promise<string[]> {
  try {
    const db = await openDB();
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** 按前缀批量删除 */
export async function idbDelByPrefix(prefix: string): Promise<number> {
  const keys = await idbKeys();
  const matched = keys.filter((k) => k.startsWith(prefix));
  await Promise.all(matched.map((k) => idbDel(k)));
  return matched.length;
}

/** 清空整个本地数据库 */
export async function idbClear(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略 */
  }
}

/** 以 Blob 形式存储用户上传的壁纸 */
export async function saveWallpaperBlob(key: string, blob: Blob): Promise<boolean> {
  return idbSet(key, blob);
}

/** 读取壁纸 Blob */
export async function getWallpaperBlob(key: string): Promise<Blob | undefined> {
  return idbGet<Blob>(key);
}

/** 释放已创建的 objectURL */
const objectUrls = new Set<string>();

export function createObjectURL(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

export function revokeObjectURL(url: string) {
  objectUrls.delete(url);
  URL.revokeObjectURL(url);
}
