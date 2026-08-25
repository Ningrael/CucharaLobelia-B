import { db } from './firebase';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  serverTimestamp,
  addDoc
} from 'firebase/firestore';
import {
  saveModToIndexedDb,
  getModFromIndexedDb,
  getAllInstalledModsFromDb,
  deleteModFromIndexedDb,
  setDbActiveLayer,
  getDbActiveLayers,
  saveBlobToDb,
  getBlobFromDb,
  deleteBlobsForMod
} from './modIndexedDb';

// ── SCHEMA VERSION & CONSTANTS ────────────────────────────────────────────────
export const SUPPORTED_SCHEMA_VERSION = '1.0';
const MOD_CACHE_PREFIX = 'lobelia_mod_data_';
const INSTALLED_MODS_LIST_KEY = 'lobelia_installed_mods_list';
const ACTIVE_LAYERS_KEY = 'lobelia_active_layers';

export const MOD_LAYERS = {
  MISSIONS: 'missions',
  RULES_AI: 'rules_ai',
  ARMY_BUILDER: 'army_builder',
  DUELS: 'duels'
};

const REQUIRED_MOD_FIELDS = [
  'modId',
  'modName',
  'modVersion',
  'modAuthor',
  'gameSystem',
  'schemaVersion'
];

export function notifyModChange(detail = {}) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lobelia_mod_changed', { detail }));
  }
}

// ── CATÁLOGO PÚBLICO DE WORKSHOP (MOTOR NEUTRAL VACÍO POR DEFECTO) ────────────
export const PUBLIC_MOD_REGISTRY = [];

// ── SANITIZACIÓN DE SEGURIDAD CONTRA INYECCIONES Y XSS ────────────────────────
export function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim();
}

export function sanitizeMod(modJson) {
  if (!modJson || typeof modJson !== 'object') return null;
  const clean = { ...modJson };

  clean.modId = sanitizeString(clean.modId);
  clean.modName = sanitizeString(clean.modName);
  clean.modVersion = sanitizeString(clean.modVersion);
  clean.modAuthor = sanitizeString(clean.modAuthor);
  clean.description = sanitizeString(clean.description);
  clean.gameSystem = sanitizeString(clean.gameSystem);
  clean.schemaVersion = sanitizeString(clean.schemaVersion || '1.0');

  if (Array.isArray(clean.capabilities)) {
    clean.capabilities = clean.capabilities.map(c => sanitizeString(c));
  } else {
    clean.capabilities = [];
    if (clean.missionPdfs) clean.capabilities.push('missions');
    if (clean.rulesKnowledge && clean.rulesKnowledge.length > 0) clean.capabilities.push('rules_ai');
    if (clean.factions && clean.factions.length > 0) clean.capabilities.push('army_builder', 'duels');
  }

  if (Array.isArray(clean.factions)) {
    clean.factions = clean.factions.map(f => ({
      ...f,
      factionId: sanitizeString(f.factionId),
      factionName: sanitizeString(f.factionName),
      side: ['good', 'evil', 'neutral'].includes(f.side) ? f.side : 'neutral',
      armyBonus: sanitizeString(f.armyBonus || ''),
      models: Array.isArray(f.models) ? f.models.map(m => ({
        ...m,
        id: sanitizeString(m.id),
        name: sanitizeString(m.name),
        type: ['hero', 'warrior', 'monster', 'siege'].includes(m.type) ? m.type : 'warrior',
        heroicTier: sanitizeString(m.heroicTier || ''),
        points: typeof m.points === 'number' ? m.points : parseInt(m.points || 0, 10),
        movement: sanitizeString(m.movement || '6"'),
        fight: sanitizeString(m.fight || '3/4+'),
        strength: typeof m.strength === 'number' ? m.strength : 3,
        defense: typeof m.defense === 'number' ? m.defense : 4,
        attacks: typeof m.attacks === 'number' ? m.attacks : 1,
        wounds: typeof m.wounds === 'number' ? m.wounds : 1,
        courage: typeof m.courage === 'number' ? m.courage : 3,
        might: typeof m.might === 'number' ? m.might : 0,
        will: typeof m.might === 'number' ? m.will : 0,
        fate: typeof m.might === 'number' ? m.fate : 0,
        wargear: Array.isArray(m.wargear) ? m.wargear.map(w => sanitizeString(w)) : [],
        options: Array.isArray(m.options) ? m.options.map(o => ({
          name: sanitizeString(o.name),
          points: typeof o.points === 'number' ? o.points : parseInt(o.points || 0, 10),
          isBow: Boolean(o.isBow)
        })) : [],
        specialRules: Array.isArray(m.specialRules) ? m.specialRules.map(sr => ({
          name: sanitizeString(sr.name),
          description: sanitizeString(sr.description)
        })) : [],
        magicalPowers: Array.isArray(m.magicalPowers) ? m.magicalPowers.map(mp => ({
          name: sanitizeString(mp.name),
          range: sanitizeString(mp.range),
          difficulty: sanitizeString(mp.difficulty),
          duration: sanitizeString(mp.duration)
        })) : []
      })) : []
    }));
  }

  return clean;
}

// ── VALIDACIÓN DE SCHEMA ──────────────────────────────────────────────────────
export function validateModSchema(modJson) {
  const errors = [];
  const stats = { factions: 0, models: 0, missions: 0, rulesPages: 0, capabilities: [] };

  if (!modJson || typeof modJson !== 'object') {
    return { valid: false, errors: ['El archivo no es un objeto JSON válido.'], stats };
  }

  for (const field of REQUIRED_MOD_FIELDS) {
    if (!modJson[field]) {
      errors.push(`Campo obligatorio ausente en la cabecera: "${field}".`);
    }
  }

  if (modJson.schemaVersion && modJson.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    errors.push(
      `Versión de schema incompatible: "${modJson.schemaVersion}". Lobelia soporta schema "${SUPPORTED_SCHEMA_VERSION}".`
    );
  }

  // Comprobar capacidades
  if (modJson.missionPdfs && typeof modJson.missionPdfs === 'object') {
    stats.capabilities.push('missions');
    const m1 = Object.keys(modJson.missionPdfs.missions1v1 || {}).length;
    const m2 = Object.keys(modJson.missionPdfs.missions2v2 || {}).length;
    stats.missions = m1 + m2;
    if (stats.missions === 0 && (!modJson.missionPdfs.pools1v1 || modJson.missionPdfs.pools1v1.length === 0)) {
      errors.push('El bloque "missionPdfs" no contiene misiones válidas en "missions1v1", "missions2v2" ni "pools1v1".');
    }
  }

  if (Array.isArray(modJson.rulesKnowledge) && modJson.rulesKnowledge.length > 0) {
    stats.capabilities.push('rules_ai');
    stats.rulesPages = modJson.rulesKnowledge.length;
    modJson.rulesKnowledge.forEach((rk, idx) => {
      if (!rk.content || typeof rk.content !== 'string') {
        errors.push(`Ficha de reglamento en índice ${idx} no tiene "content" válido.`);
      }
    });
  }

  if (modJson.systemPrompt && typeof modJson.systemPrompt !== 'string') {
    errors.push('El campo "systemPrompt" debe ser una cadena de texto válida.');
  }

  if (Array.isArray(modJson.factions) && modJson.factions.length > 0) {
    stats.capabilities.push('army_builder', 'duels');
    stats.factions = modJson.factions.length;
    modJson.factions.forEach((f, idx) => {
      if (!f.factionId) errors.push(`La facción en índice ${idx} no tiene "factionId".`);
      if (!f.factionName) errors.push(`La facción en índice ${idx} no tiene "factionName".`);
      if (!['good', 'evil', 'neutral'].includes(f.side)) {
        errors.push(`Facción "${f.factionId || idx}" tiene "side" inválido. Permitidos: good, evil, neutral.`);
      }
      if (Array.isArray(f.models)) {
        stats.models += f.models.length;
        f.models.forEach((m, mIdx) => {
          if (!m.id) errors.push(`Miniatura en facción ${f.factionId} (índice ${mIdx}) no tiene "id".`);
          if (!m.name) errors.push(`Miniatura en facción ${f.factionId} (índice ${mIdx}) no tiene "name".`);
        });
      }
    });
  }

  if (stats.capabilities.length === 0) {
    errors.push('El mod no contiene ninguna función válida (misiones con PDFs, índice de reglas IA o facciones).');
  }

  return { valid: errors.length === 0, errors, stats };
}

// ── GESTIÓN DE CAPAS (LAYER MANAGER) ──────────────────────────────────────────
export function getActiveLayers(uid = null) {
  try {
    const raw = localStorage.getItem(ACTIVE_LAYERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {
    [MOD_LAYERS.MISSIONS]: null,
    [MOD_LAYERS.RULES_AI]: null,
    [MOD_LAYERS.ARMY_BUILDER]: null,
    [MOD_LAYERS.DUELS]: null
  };
}

export function setActiveLayer(uid, layer, modId) {
  const current = getActiveLayers(uid);
  current[layer] = modId;
  try {
    localStorage.setItem(ACTIVE_LAYERS_KEY, JSON.stringify(current));
    setDbActiveLayer(layer, modId);
  } catch (_) {}

  notifyModChange({ layer, modId });

  if (uid && db) {
    try {
      const userDocRef = doc(db, 'players', uid);
      setDoc(userDocRef, { modConfig: { activeLayers: current, updatedAt: new Date().toISOString() } }, { merge: true }).catch(() => {});
    } catch (_) {}
  }
}

export function setMasterActiveMod(uid, modId) {
  const modData = getModDataById(modId);
  const current = getActiveLayers(uid);

  if (!modData) {
    Object.keys(current).forEach(k => { current[k] = modId; });
  } else {
    const caps = modData.capabilities || [];
    if (caps.includes('missions')) current[MOD_LAYERS.MISSIONS] = modId;
    if (caps.includes('rules_ai')) current[MOD_LAYERS.RULES_AI] = modId;
    if (caps.includes('army_builder')) current[MOD_LAYERS.ARMY_BUILDER] = modId;
    if (caps.includes('duels')) current[MOD_LAYERS.DUELS] = modId;
    if (caps.length === 0) {
      Object.keys(current).forEach(k => { current[k] = modId; });
    }
  }

  try {
    localStorage.setItem(ACTIVE_LAYERS_KEY, JSON.stringify(current));
    Object.entries(current).forEach(([l, m]) => setDbActiveLayer(l, m));
  } catch (_) {}

  notifyModChange({ masterModId: modId });

  if (uid && db) {
    try {
      const userDocRef = doc(db, 'players', uid);
      setDoc(userDocRef, { modConfig: { activeLayers: current, updatedAt: new Date().toISOString() } }, { merge: true }).catch(() => {});
    } catch (_) {}
  }
}

// ── ALMACENAMIENTO LOCAL E INSTALACIÓN ─────────────────────────────────────────
export function getModDataById(modId) {
  if (!modId) return null;
  try {
    const raw = localStorage.getItem(`${MOD_CACHE_PREFIX}${modId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function getActiveModData(uid, layer) {
  const layers = getActiveLayers(uid);
  const modId = layers[layer];
  if (!modId) return null;
  return getModDataById(modId);
}

export async function getActiveMod(uid = null, layer = MOD_LAYERS.ARMY_BUILDER) {
  const mod = getActiveModData(uid, layer);
  return { success: !!mod, mod, error: mod ? null : 'No active mod found' };
}

export async function getInstalledMods(uid = null) {
  let list = [];
  try {
    const raw = localStorage.getItem(INSTALLED_MODS_LIST_KEY);
    if (raw) list = JSON.parse(raw);
  } catch (_) {}

  // Sincronizar desde IndexedDB si está disponible
  try {
    const dbList = await getAllInstalledModsFromDb();
    if (dbList && dbList.length > 0) {
      const map = new Map();
      list.forEach(m => map.set(m.modId, m));
      dbList.forEach(m => map.set(m.modId, { ...map.get(m.modId), ...m }));
      list = Array.from(map.values());
      localStorage.setItem(INSTALLED_MODS_LIST_KEY, JSON.stringify(list));
    }
  } catch (_) {}

  return list;
}

/**
 * Descarga y almacena en IndexedDB todos los PDFs de un mod de misiones para modo Offline
 */
export async function downloadAndCacheMissionPdfs(modJson, onProgress) {
  if (!modJson || !modJson.missionPdfs) return { success: true, count: 0 };
  const pdfConfig = modJson.missionPdfs;
  const rawBase = pdfConfig.baseUrl || '';

  const targets = [];
  const addTarget = (file) => {
    if (file && typeof file === 'string') {
      const clean = file.replace(/^\//, '');
      if (!targets.includes(clean)) targets.push(clean);
    }
  };

  ['missions1v1', 'missions2v2'].forEach(key => {
    const map = pdfConfig[key] || {};
    Object.values(map).forEach(entry => {
      if (typeof entry === 'string') addTarget(entry);
      else if (typeof entry === 'object' && entry) {
        addTarget(entry.file);
        addTarget(entry.fileEs || entry.file_es);
        addTarget(entry.fileEn || entry.file_en);
      }
    });
  });

  let downloaded = 0;
  for (let i = 0; i < targets.length; i++) {
    const targetFile = targets[i];
    const fullUrl = (targetFile.startsWith('http://') || targetFile.startsWith('https://'))
      ? targetFile
      : `${rawBase.replace(/\/$/, '')}/${targetFile}`;

    try {
      if (onProgress) onProgress(i + 1, targets.length, targetFile);
      const res = await fetch(fullUrl);
      if (res.ok) {
        const blob = await res.blob();
        const blobKey = `${modJson.modId}:${targetFile}`;
        await saveBlobToDb(blobKey, blob, 'application/pdf');
        downloaded++;
      }
    } catch (err) {
      console.warn(`[ModManager] Could not cache PDF ${targetFile}:`, err);
    }
  }

  return { success: true, count: downloaded, total: targets.length };
}

/**
 * Instala un mod a partir de su objeto JSON y lo persiste en IndexedDB + localStorage
 */
export async function installMod(uid, modJson, sourceUrl = '') {
  const sanitized = sanitizeMod(modJson);
  const validation = validateModSchema(sanitized);

  if (!validation.valid) {
    return { success: false, error: validation.errors.join(' | ') };
  }

  try {
    // 1. Guardar en IndexedDB y localStorage del navegador
    await saveModToIndexedDb(sanitized);
    localStorage.setItem(`${MOD_CACHE_PREFIX}${sanitized.modId}`, JSON.stringify(sanitized));

    // 2. Actualizar lista de instalados
    const installed = await getInstalledMods(uid);
    const existingIdx = installed.findIndex(m => m.modId === sanitized.modId);
    const meta = {
      modId: sanitized.modId,
      modName: sanitized.modName,
      modVersion: sanitized.modVersion,
      modAuthor: sanitized.modAuthor,
      description: sanitized.description,
      capabilities: sanitized.capabilities || [],
      installedAt: new Date().toISOString(),
      sourceUrl: sourceUrl || 'local_file'
    };

    if (existingIdx >= 0) {
      installed[existingIdx] = meta;
    } else {
      installed.push(meta);
    }
    localStorage.setItem(INSTALLED_MODS_LIST_KEY, JSON.stringify(installed));

    // 3. Activar automáticamente para sus capacidades
    setMasterActiveMod(uid, sanitized.modId);
    notifyModChange({ installedModId: sanitized.modId });

    // 4. Sincronizar metadatos en Firestore si hay usuario logueado
    if (uid && db) {
      try {
        const userDocRef = doc(db, 'players', uid);
        const activeLayers = getActiveLayers(uid);
        await setDoc(userDocRef, {
          modConfig: {
            installedModsMeta: installed,
            activeLayers: activeLayers,
            lastInstalledModId: sanitized.modId,
            updatedAt: new Date().toISOString()
          }
        }, { merge: true });
      } catch (_) {}
    }

    return { success: true, mod: sanitized };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Instala un mod con 1-Clic desde una URL externa (GitHub Releases / CDN)
 */
export async function installModFromUrl(uid, downloadUrl) {
  if (!downloadUrl) return { success: false, error: 'URL de descarga inválida.' };

  try {
    let json = null;

    // Estrategias de URLs con CORS habilitado
    const urlsToTry = [downloadUrl];

    const ghMatch = downloadUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/releases\/download\/([^\/]+)|\/blob\/([^\/]+)|\/raw\/([^\/]+))?\/(.+)$/);
    if (ghMatch) {
      const owner = ghMatch[1];
      const repo = ghMatch[2];
      const tagOrBranch = ghMatch[3] || ghMatch[4] || ghMatch[5] || 'main';
      const filename = ghMatch[6];

      urlsToTry.unshift(
        `https://raw.githubusercontent.com/${owner}/${repo}/main/${filename}`,
        `https://raw.githubusercontent.com/${owner}/${repo}/${tagOrBranch}/${filename}`,
        `https://cdn.jsdelivr.net/gh/${owner}/${repo}@main/${filename}`,
        `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${tagOrBranch}/${filename}`
      );
    }

    for (const url of urlsToTry) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          json = await res.json();
          if (json && (json.modId || json.modName)) {
            break;
          }
        }
      } catch (_) {}
    }

    if (!json) {
      throw new Error('No se pudo descargar el archivo JSON del mod. Verifica que el archivo exista y sea público.');
    }

    return await installMod(uid, json, downloadUrl);
  } catch (err) {
    return { success: false, error: `Error descargando mod: ${err.message}` };
  }
}

/**
 * Desinstala un mod completamente
 */
export async function uninstallMod(uid, modId) {
  try {
    await deleteModFromIndexedDb(modId);
    await deleteBlobsForMod(modId);
    localStorage.removeItem(`${MOD_CACHE_PREFIX}${modId}`);

    const installed = await getInstalledMods(uid);
    const filtered = installed.filter(m => m.modId !== modId);
    localStorage.setItem(INSTALLED_MODS_LIST_KEY, JSON.stringify(filtered));

    const layers = getActiveLayers(uid);
    let changed = false;
    Object.keys(layers).forEach(layer => {
      if (layers[layer] === modId) {
        layers[layer] = null;
        changed = true;
      }
    });

    if (changed) {
      localStorage.setItem(ACTIVE_LAYERS_KEY, JSON.stringify(layers));
    }

    notifyModChange({ uninstalledModId: modId });

    if (uid && db) {
      try {
        const userDocRef = doc(db, 'players', uid);
        await setDoc(userDocRef, {
          modConfig: {
            installedModsMeta: filtered,
            activeLayers: layers,
            updatedAt: new Date().toISOString()
          }
        }, { merge: true });
      } catch (_) {}
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── GETTERS DESACOPLADOS PARA LAS VISTAS BASE ─────────────────────────────────

// Caché en memoria para URLs de Blobs ya generadas
const blobUrlCache = new Map();

/**
 * Obtiene la URL del PDF de una misión desde el mod de misiones activo (Offline o Remoto).
 * Si no hay ningún mod de misiones activo, devuelve NULL.
 */
export function getMissionPdfUrl(missionName, lang = 'es', mode = '1vs1', uid = null) {
  const modData = getActiveModData(uid, MOD_LAYERS.MISSIONS);
  if (!modData || !modData.missionPdfs) return null;

  const pdfConfig = modData.missionPdfs;
  const mapKey = mode === '2vs2' ? 'missions2v2' : 'missions1v1';
  const missionEntry = pdfConfig[mapKey]?.[missionName];

  if (!missionEntry) return null;

  const isEn = (lang === 'en' || lang === 'EN');
  const targetFile = (isEn
    ? (missionEntry.fileEn || missionEntry.file_en || missionEntry.file_EN)
    : (missionEntry.fileEs || missionEntry.file_es || missionEntry.file_ES))
    || missionEntry.file;

  if (!targetFile) return null;

  // 1. Si tenemos un blob en memoria para este archivo, usarlo directamente
  const blobKey = `${modData.modId}:${targetFile.replace(/^\//, '')}`;
  if (blobUrlCache.has(blobKey)) {
    return blobUrlCache.get(blobKey);
  }

  // 2. Comprobar si es URL absoluta
  if (targetFile.startsWith('http://') || targetFile.startsWith('https://')) {
    return targetFile;
  }

  const rawBase = pdfConfig.baseUrl || '';
  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  
  if (rawBase.startsWith('http://') || rawBase.startsWith('https://')) {
    return `${rawBase.replace(/\/$/, '')}/${targetFile.replace(/^\//, '')}`;
  }

  const cleanBase = rawBase.replace(/^\//, '').replace(/\/$/, '');
  const cleanFile = targetFile.replace(/^\//, '');

  if (cleanFile.startsWith(cleanBase)) {
    return `${basePath}/${cleanFile}`;
  }

  return `${basePath}/${cleanBase}/${cleanFile}`;
}

/**
 * Resuelve de forma asíncrona la URL del PDF, priorizando el Blob offline en IndexedDB
 */
export async function getMissionPdfUrlAsync(missionName, lang = 'es', mode = '1vs1', uid = null) {
  const modData = getActiveModData(uid, MOD_LAYERS.MISSIONS);
  if (!modData || !modData.missionPdfs) return null;

  const pdfConfig = modData.missionPdfs;
  const mapKey = mode === '2vs2' ? 'missions2v2' : 'missions1v1';
  const missionEntry = pdfConfig[mapKey]?.[missionName];

  if (!missionEntry) return null;

  const isEn = (lang === 'en' || lang === 'EN');
  const targetFile = (isEn
    ? (missionEntry.fileEn || missionEntry.file_en || missionEntry.file_EN)
    : (missionEntry.fileEs || missionEntry.file_es || missionEntry.file_ES))
    || missionEntry.file;

  if (!targetFile) return null;

  const blobKey = `${modData.modId}:${targetFile.replace(/^\//, '')}`;
  try {
    const cachedBlob = await getBlobFromDb(blobKey);
    if (cachedBlob) {
      const objUrl = URL.createObjectURL(cachedBlob instanceof Blob ? cachedBlob : new Blob([cachedBlob], { type: 'application/pdf' }));
      blobUrlCache.set(blobKey, objUrl);
      return objUrl;
    }
  } catch (_) {}

  return getMissionPdfUrl(missionName, lang, mode, uid);
}

export const SUPERADMIN_EMAILS = [
  'sosamatias@gmail.com',
  'matias@lobelia.com',
  'admin@lobelia.com',
  'cuchara@lobelia.com'
];

export async function submitModForReview(submission, user = null) {
  if (!db) return { success: false, error: 'Base de datos no disponible.' };
  if (!user || !user.uid) return { success: false, error: 'Debes iniciar sesión para enviar un mod.' };

  try {
    const subId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const userDocRef = doc(db, 'players', user.uid);
    
    const newSubmission = {
      ...submission,
      id: subId,
      submittedBy: user.uid,
      submittedByEmail: user.email || submission.contactEmail || '',
      status: 'pending',
      submittedAt: new Date().toISOString()
    };

    await setDoc(userDocRef, {
      submittedMods: {
        [subId]: newSubmission
      }
    }, { merge: true });

    return { success: true, id: subId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function getPendingSubmissions() {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, 'players'));
    const pendingList = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (data && data.submittedMods) {
        Object.entries(data.submittedMods).forEach(([sId, sub]) => {
          if (sub && sub.status === 'pending') {
            pendingList.push({ ...sub, id: sId, ownerUid: docSnap.id });
          }
        });
      }
    });
    return pendingList;
  } catch (err) {
    console.warn('[ModManager] Error fetching pending submissions:', err);
  }
  return [];
}

export async function approveModSubmission(submission, adminUser = null) {
  if (!db || !submission) return { success: false, error: 'Error de base de datos.' };
  if (!adminUser || !adminUser.uid) return { success: false, error: 'Usuario no autenticado.' };

  try {
    const modId = submission.modId || submission.id || `mod_${Date.now()}`;
    const adminDocRef = doc(db, 'players', adminUser.uid);
    
    const approvedMod = {
      ...submission,
      modId,
      isVerified: true,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: adminUser.email || 'SuperAdmin'
    };

    // 1. Guardar en los mods públicos del admin/plataforma
    await setDoc(adminDocRef, {
      publicMods: {
        [modId]: approvedMod
      }
    }, { merge: true });

    // 2. Marcar en el documento del creador como aprobado
    const creatorUid = submission.submittedBy || submission.ownerUid;
    if (creatorUid) {
      try {
        const creatorDocRef = doc(db, 'players', creatorUid);
        await setDoc(creatorDocRef, {
          submittedMods: {
            [submission.id]: {
              ...submission,
              status: 'approved',
              approvedAt: new Date().toISOString()
            }
          }
        }, { merge: true });
      } catch (_) {}
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function rejectModSubmission(submissionId, reason = '', adminUser = null, ownerUid = null) {
  if (!db || !submissionId) return { success: false, error: 'ID inválido.' };

  try {
    if (ownerUid) {
      const creatorDocRef = doc(db, 'players', ownerUid);
      const snap = await getDoc(creatorDocRef);
      const existing = snap.exists() ? snap.data().submittedMods?.[submissionId] || {} : {};

      await setDoc(creatorDocRef, {
        submittedMods: {
          [submissionId]: {
            ...existing,
            status: 'rejected',
            rejectionReason: reason,
            rejectedAt: new Date().toISOString(),
            rejectedBy: adminUser?.email || 'SuperAdmin'
          }
        }
      }, { merge: true });
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function getPublicModsRegistry() {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, 'players'));
    const publicList = [];
    const seenModIds = new Set();

    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (data && data.publicMods) {
        Object.values(data.publicMods).forEach(mod => {
          if (mod && mod.modId && !seenModIds.has(mod.modId)) {
            seenModIds.add(mod.modId);
            publicList.push(mod);
          }
        });
      }
    });
    return publicList;
  } catch (err) {
    console.warn('[ModManager] Error fetching public mods from Firestore:', err);
  }
  return [];
}

/**
 * Obtiene el índice de reglas para el Árbitro IA desde el mod de reglas activo.
 * Si no hay mod activo, devuelve array vacío.
 */
export function getRulesKnowledgeFromMod(uid = null) {
  const modData = getActiveModData(uid, MOD_LAYERS.RULES_AI);
  if (!modData || !Array.isArray(modData.rulesKnowledge)) return [];
  return modData.rulesKnowledge;
}

/**
 * Obtiene la directriz de personalidad o prompt personalizado del mod de Árbitro IA activo.
 */
export function getAiPromptFromMod(uid = null) {
  const modData = getActiveModData(uid, MOD_LAYERS.RULES_AI);
  if (!modData) return null;
  return modData.systemInstruction || modData.systemPrompt || null;
}

/**
 * Obtiene las facciones del mod de listas activo.
 */
export function getArmyBuilderFactions(uid = null) {
  const modData = getActiveModData(uid, MOD_LAYERS.ARMY_BUILDER);
  if (!modData || !Array.isArray(modData.factions)) return [];
  return modData.factions;
}

// ── CONSULTAS DE PERFILES ─────────────────────────────────────────────────────

export function searchModels(modData, queryStr = '', filters = {}) {
  if (!modData?.factions) return [];
  const q = queryStr.toLowerCase().trim();
  const results = [];

  for (const faction of modData.factions) {
    if (filters.side && faction.side !== filters.side) continue;
    if (filters.factionId && faction.factionId !== filters.factionId) continue;

    for (const model of (faction.models || [])) {
      if (filters.type && model.type !== filters.type) continue;
      if (q && !model.name.toLowerCase().includes(q)) continue;

      results.push({
        ...model,
        factionId: faction.factionId,
        factionName: faction.factionName,
        side: faction.side,
        baseCost: model.points || 0
      });
    }
  }

  return results;
}

export function getHeroes(modData, filters = {}) {
  return searchModels(modData, '', { ...filters, type: 'hero' });
}

export function getWarriorsByFaction(modData, factionId) {
  return searchModels(modData, '', { factionId, type: 'warrior' });
}

export function getFactions(modData) {
  if (!modData?.factions) return [];
  return modData.factions.map(f => ({
    factionId: f.factionId,
    factionName: f.factionName,
    side: f.side,
    armyBonus: f.armyBonus || '',
    modelCount: (f.models || []).length
  }));
}
