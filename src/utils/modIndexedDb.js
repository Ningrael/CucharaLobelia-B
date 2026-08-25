// src/utils/modIndexedDb.js
// ─────────────────────────────────────────────────────────────────────────────
// Motor de Almacenamiento Local en IndexedDB para Mods de La Cuchara de Lobelia.
// Permite almacenar paquetes de mods, JSONs y archivos binarios (PDFs) en el
// navegador del cliente de forma 100% offline y sin almacenamiento en servidores.
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'LobeliaModsDB';
const DB_VERSION = 1;

let dbInstance = null;

/**
 * Abre o inicializa la base de datos IndexedDB local
 */
export function openModDb() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('[IndexedDB] No disponible en este entorno. Se usará localStorage como fallback.');
      return resolve(null);
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Almacén de Mods instalados (clave primaria: modId)
      if (!db.objectStoreNames.contains('installed_mods')) {
        db.createObjectStore('installed_mods', { keyPath: 'modId' });
      }

      // Almacén de asignación de capas activas (clave primaria: layer)
      if (!db.objectStoreNames.contains('active_layers')) {
        db.createObjectStore('active_layers', { keyPath: 'layer' });
      }

      // Almacén de archivos binarios/Blobs (PDFs, mapas, imágenes)
      if (!db.objectStoreNames.contains('mod_blobs')) {
        db.createObjectStore('mod_blobs', { keyPath: 'blobKey' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[IndexedDB] Error al abrir la base de datos:', event.target.error);
      resolve(null); // Fallback suave
    };
  });
}

/**
 * Guarda o actualiza un mod completo en IndexedDB
 */
export async function saveModToIndexedDb(modData) {
  if (!modData || !modData.modId) return false;

  const db = await openModDb();
  if (!db) {
    // Fallback a localStorage
    try {
      localStorage.setItem(`lobelia_mod_cache_${modData.modId}`, JSON.stringify(modData));
      return true;
    } catch (_) {
      return false;
    }
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('installed_mods', 'readwrite');
      const store = tx.objectStore('installed_mods');
      const item = {
        ...modData,
        installedAt: modData.installedAt || new Date().toISOString()
      };
      const req = store.put(item);

      req.onsuccess = () => resolve(true);
      req.onerror = (err) => {
        console.error('[IndexedDB] Error guardando mod:', err);
        resolve(false);
      };
    } catch (err) {
      console.error('[IndexedDB] Excepción guardando mod:', err);
      resolve(false);
    }
  });
}

/**
 * Recupera un mod por su modId desde IndexedDB
 */
export async function getModFromIndexedDb(modId) {
  if (!modId) return null;

  const db = await openModDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(`lobelia_mod_cache_${modId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('installed_mods', 'readonly');
      const store = tx.objectStore('installed_mods');
      const req = store.get(modId);

      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result);
        } else {
          // Fallback a localStorage
          try {
            const raw = localStorage.getItem(`lobelia_mod_cache_${modId}`);
            resolve(raw ? JSON.parse(raw) : null);
          } catch (_) {
            resolve(null);
          }
        }
      };

      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Lista todos los mods instalados en IndexedDB
 */
export async function getAllInstalledModsFromDb() {
  const db = await openModDb();
  if (!db) {
    try {
      const listRaw = localStorage.getItem('lobelia_installed_mods');
      return listRaw ? JSON.parse(listRaw) : [];
    } catch (_) {
      return [];
    }
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('installed_mods', 'readonly');
      const store = tx.objectStore('installed_mods');
      const req = store.getAll();

      req.onsuccess = () => {
        const results = req.result || [];
        resolve(results.map(m => ({
          modId: m.modId,
          modName: m.modName,
          modVersion: m.modVersion,
          modAuthor: m.modAuthor,
          description: m.description,
          capabilities: m.capabilities || [],
          installedAt: m.installedAt
        })));
      };

      req.onerror = () => resolve([]);
    } catch (_) {
      resolve([]);
    }
  });
}

/**
 * Elimina un mod de IndexedDB
 */
export async function deleteModFromIndexedDb(modId) {
  if (!modId) return false;

  const db = await openModDb();
  if (!db) {
    localStorage.removeItem(`lobelia_mod_cache_${modId}`);
    return true;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('installed_mods', 'readwrite');
      const store = tx.objectStore('installed_mods');
      const req = store.delete(modId);

      req.onsuccess = () => {
        localStorage.removeItem(`lobelia_mod_cache_${modId}`);
        resolve(true);
      };
      req.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Guarda un archivo binario (Blob/ArrayBuffer de PDF) en IndexedDB
 */
export async function saveBlobToDb(blobKey, blobData, mimeType = 'application/pdf') {
  const db = await openModDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('mod_blobs', 'readwrite');
      const store = tx.objectStore('mod_blobs');
      const item = {
        blobKey,
        data: blobData,
        mimeType,
        savedAt: new Date().toISOString()
      };
      const req = store.put(item);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Obtiene un archivo binario desde IndexedDB por su blobKey
 */
export async function getBlobFromDb(blobKey) {
  if (!blobKey) return null;
  const db = await openModDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('mod_blobs', 'readonly');
      const store = tx.objectStore('mod_blobs');
      const req = store.get(blobKey);
      req.onsuccess = () => {
        resolve(req.result ? req.result.data : null);
      };
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Comprueba si un Blob ya está almacenado localmente
 */
export async function hasBlobInDb(blobKey) {
  if (!blobKey) return false;
  const db = await openModDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('mod_blobs', 'readonly');
      const store = tx.objectStore('mod_blobs');
      const req = store.getKey(blobKey);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Elimina todos los Blobs asociados a un mod (blobKey comienza por "modId:")
 */
export async function deleteBlobsForMod(modId) {
  if (!modId) return false;
  const db = await openModDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('mod_blobs', 'readwrite');
      const store = tx.objectStore('mod_blobs');
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const keys = req.result || [];
        const prefix = `${modId}:`;
        keys.forEach(k => {
          if (typeof k === 'string' && k.startsWith(prefix)) {
            store.delete(k);
          }
        });
        resolve(true);
      };
      req.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Guarda una asignación de capa activa en IndexedDB
 */
export async function setDbActiveLayer(layer, modId) {
  const db = await openModDb();
  if (!db) return;

  try {
    const tx = db.transaction('active_layers', 'readwrite');
    const store = tx.objectStore('active_layers');
    store.put({ layer, modId, updatedAt: new Date().toISOString() });
  } catch (_) {}
}

/**
 * Recupera todas las capas activas desde IndexedDB
 */
export async function getDbActiveLayers() {
  const db = await openModDb();
  if (!db) return {};

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('active_layers', 'readonly');
      const store = tx.objectStore('active_layers');
      const req = store.getAll();

      req.onsuccess = () => {
        const map = {};
        (req.result || []).forEach(item => {
          map[item.layer] = item.modId;
        });
        resolve(map);
      };
      req.onerror = () => resolve({});
    } catch (_) {
      resolve({});
    }
  });
}

