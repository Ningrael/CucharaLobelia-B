// src/utils/communityMods.js
// ─────────────────────────────────────────────────────────────────────────────
// Servicios de Firestore para el Taller Comunitario (Community Workshop)
// Motor Neutral: Solo almacena metadatos y URLs públicas compartidas por la comunidad.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  orderBy,
  where,
  serverTimestamp,
  increment
} from 'firebase/firestore';

const COMMUNITY_MODS_COLLECTION = 'community_mods';
const MOD_REVIEWS_SUBCOLLECTION = 'reviews';
const MOD_REPORTS_COLLECTION = 'mod_reports';

// ── Sanear cadenas de texto ──────────────────────────────────────────────────
export function cleanText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim();
}

// ── 1. Obtener todos los mods comunitarios ──────────────────────────────────
export async function fetchCommunityMods() {
  try {
    const q = query(
      collection(db, COMMUNITY_MODS_COLLECTION),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    const mods = [];
    snap.forEach((docSnap) => {
      mods.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });
    return mods;
  } catch (err) {
    console.warn('Error fetching community mods:', err);
    return [];
  }
}

// ── 2. Publicar un nuevo mod en la comunidad ────────────────────────────────
export async function publishCommunityMod(user, modData) {
  if (!user || !user.uid) {
    return { success: false, error: 'Debes iniciar sesión para publicar un mod.' };
  }

  const name = cleanText(modData.name || modData.modName);
  const author = cleanText(modData.author || modData.modAuthor || user.displayName || 'Comunidad');
  const jsonUrl = (modData.jsonUrl || '').trim();
  const description = cleanText(modData.description || '');
  const version = cleanText(modData.version || modData.modVersion || '1.0.0');
  const capabilities = Array.isArray(modData.capabilities) ? modData.capabilities : [];
  const hasOfflinePdf = Boolean(modData.hasOfflinePdf);
  const communityLink = cleanText(modData.communityLink || '');

  if (!name) return { success: false, error: 'El nombre del mod es obligatorio.' };
  if (!jsonUrl.startsWith('http://') && !jsonUrl.startsWith('https://')) {
    return { success: false, error: 'Introduce una URL pública válida (ej: https://raw.githubusercontent.com/.../mod.json).' };
  }

  try {
    const docRef = await addDoc(collection(db, COMMUNITY_MODS_COLLECTION), {
      name,
      author,
      authorUid: user.uid,
      authorEmail: user.email || '',
      authorAvatar: user.photoURL || null,
      jsonUrl,
      description,
      version,
      capabilities,
      hasOfflinePdf,
      communityLink,
      ratingAvg: 0,
      ratingCount: 0,
      ratingAvgLatest: 0,
      ratingCountLatest: 0,
      installsCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return {
      success: true,
      modId: docRef.id,
      mod: {
        id: docRef.id,
        name,
        author,
        authorUid: user.uid,
        jsonUrl,
        description,
        version,
        capabilities,
        hasOfflinePdf,
        communityLink,
        ratingAvg: 0,
        ratingCount: 0,
        ratingAvgLatest: 0,
        ratingCountLatest: 0,
        installsCount: 0
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── 3. Actualizar un mod existente (Autor o Admin) ───────────────────────────
export async function updateCommunityMod(modDocId, user, updateData, isAdmin = false) {
  if (!user || !user.uid) return { success: false, error: 'No autorizado.' };

  try {
    const docRef = doc(db, COMMUNITY_MODS_COLLECTION, modDocId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return { success: false, error: 'El mod no existe.' };

    const currentData = snap.data();
    if (currentData.authorUid !== user.uid && !isAdmin) {
      return { success: false, error: 'Solo el autor o un administrador puede editar este mod.' };
    }

    const newVersion = cleanText(updateData.version || currentData.version);
    const versionChanged = newVersion !== currentData.version;

    const payload = {
      name: cleanText(updateData.name || currentData.name),
      author: cleanText(updateData.author || currentData.author),
      jsonUrl: (updateData.jsonUrl || currentData.jsonUrl).trim(),
      description: cleanText(updateData.description || currentData.description),
      version: newVersion,
      capabilities: Array.isArray(updateData.capabilities) ? updateData.capabilities : currentData.capabilities,
      hasOfflinePdf: updateData.hasOfflinePdf !== undefined ? Boolean(updateData.hasOfflinePdf) : Boolean(currentData.hasOfflinePdf),
      communityLink: cleanText(updateData.communityLink !== undefined ? updateData.communityLink : currentData.communityLink),
      updatedAt: serverTimestamp()
    };

    // Si cambió la versión, recalculamos las métricas de la última versión
    if (versionChanged) {
      payload.ratingAvgLatest = 0;
      payload.ratingCountLatest = 0;
    }

    await updateDoc(docRef, payload);

    // Si cambió la versión, recalcular estadísticas
    if (versionChanged) {
      await recalculateModRatings(modDocId, newVersion);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── 4. Eliminar un mod comunitario (Autor o Admin) ───────────────────────────
export async function deleteCommunityMod(modDocId, user, isAdmin = false) {
  if (!user || !user.uid) return { success: false, error: 'No autorizado.' };

  try {
    const docRef = doc(db, COMMUNITY_MODS_COLLECTION, modDocId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return { success: true };

    const data = snap.data();
    if (data.authorUid !== user.uid && !isAdmin) {
      return { success: false, error: 'Solo el autor o un administrador puede eliminar este mod.' };
    }

    // Eliminar subcolección de reseñas
    try {
      const reviewsSnap = await getDocs(collection(db, COMMUNITY_MODS_COLLECTION, modDocId, MOD_REVIEWS_SUBCOLLECTION));
      const deletePromises = [];
      reviewsSnap.forEach((rDoc) => {
        deletePromises.push(deleteDoc(rDoc.ref));
      });
      await Promise.all(deletePromises);
    } catch (_) {}

    await deleteDoc(docRef);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── 5. Incrementar contador de instalaciones ────────────────────────────────
export async function incrementModInstalls(modDocId) {
  if (!modDocId) return;
  try {
    const docRef = doc(db, COMMUNITY_MODS_COLLECTION, modDocId);
    await updateDoc(docRef, {
      installsCount: increment(1)
    });
  } catch (_) {}
}

// ── 6. Obtener reseñas de un mod ────────────────────────────────────────────
export async function fetchModReviews(modDocId) {
  if (!modDocId) return [];
  try {
    const q = query(
      collection(db, COMMUNITY_MODS_COLLECTION, modDocId, MOD_REVIEWS_SUBCOLLECTION),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    const reviews = [];
    snap.forEach((docSnap) => {
      reviews.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });
    return reviews;
  } catch (err) {
    console.warn('Error fetching mod reviews:', err);
    return [];
  }
}

// ── 7. Guardar o editar reseña (1 por usuario) ──────────────────────────────
export async function saveModReview(modDocId, user, rating, comment, currentModVersion) {
  if (!user || !user.uid) return { success: false, error: 'Debes iniciar sesión para valorar.' };
  if (!rating || rating < 1 || rating > 5) return { success: false, error: 'La valoración debe ser de 1 a 5 estrellas.' };

  try {
    const reviewRef = doc(db, COMMUNITY_MODS_COLLECTION, modDocId, MOD_REVIEWS_SUBCOLLECTION, user.uid);
    const existingSnap = await getDoc(reviewRef);

    const isUpdate = existingSnap.exists();
    const payload = {
      rating: Number(rating),
      comment: cleanText(comment || ''),
      userUid: user.uid,
      userName: cleanText(user.displayName || user.email?.split('@')[0] || 'Jugador'),
      userAvatar: user.photoURL || null,
      version: cleanText(currentModVersion || '1.0.0'),
      updatedAt: serverTimestamp()
    };

    if (!isUpdate) {
      payload.createdAt = serverTimestamp();
    }

    await setDoc(reviewRef, payload, { merge: true });

    // Recalcular métricas de puntuación en el documento principal
    await recalculateModRatings(modDocId, currentModVersion);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── 8. Eliminar reseña del usuario ──────────────────────────────────────────
export async function deleteModReview(modDocId, userUid, currentModVersion) {
  if (!userUid) return { success: false, error: 'No autorizado.' };
  try {
    const reviewRef = doc(db, COMMUNITY_MODS_COLLECTION, modDocId, MOD_REVIEWS_SUBCOLLECTION, userUid);
    await deleteDoc(reviewRef);
    await recalculateModRatings(modDocId, currentModVersion);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Helper: Recalcular promedios histórico y de última versión ──────────────
async function recalculateModRatings(modDocId, currentModVersion) {
  try {
    const snap = await getDocs(collection(db, COMMUNITY_MODS_COLLECTION, modDocId, MOD_REVIEWS_SUBCOLLECTION));
    let totalScore = 0;
    let totalCount = 0;
    let latestScore = 0;
    let latestCount = 0;

    snap.forEach((rDoc) => {
      const data = rDoc.data();
      const r = Number(data.rating) || 0;
      if (r >= 1 && r <= 5) {
        totalScore += r;
        totalCount++;
        if (data.version === currentModVersion) {
          latestScore += r;
          latestCount++;
        }
      }
    });

    const ratingAvg = totalCount > 0 ? parseFloat((totalScore / totalCount).toFixed(1)) : 0;
    const ratingAvgLatest = latestCount > 0 ? parseFloat((latestScore / latestCount).toFixed(1)) : 0;

    const docRef = doc(db, COMMUNITY_MODS_COLLECTION, modDocId);
    await updateDoc(docRef, {
      ratingAvg,
      ratingCount: totalCount,
      ratingAvgLatest,
      ratingCountLatest: latestCount
    });
  } catch (err) {
    console.warn('Error recalculating ratings:', err);
  }
}

// ── 9. Reportar Bug / Fallo directamente al Creador (Vía MP in-app) ───────────
export async function reportBugToCreator(creatorUid, mod, reportingUser, bugDetails) {
  if (!reportingUser || !reportingUser.uid) {
    return { success: false, error: 'Debes iniciar sesión para reportar un bug al creador.' };
  }
  if (!creatorUid) {
    return { success: false, error: 'No se encontró el identificador del autor.' };
  }
  if (!bugDetails || !bugDetails.trim()) {
    return { success: false, error: 'Por favor, describe el fallo detectado.' };
  }

  const senderUid = reportingUser.uid;
  const senderName = cleanText(reportingUser.displayName || reportingUser.email?.split('@')[0] || 'Jugador');
  const recipientUid = creatorUid;

  if (senderUid === recipientUid) {
    return { success: false, error: 'No puedes reportarte un bug a ti mismo.' };
  }

  try {
    const chatId = [senderUid, recipientUid].sort().join('_');
    const chatDocRef = doc(db, 'chats', chatId);
    const chatSnap = await getDoc(chatDocRef);

    const reportMsg = `🐛 [REPORTE DE BUG - MOD: "${mod.name}" v${mod.version}]\n` +
      `👤 Reportado por: ${senderName}\n\n` +
      `📝 Detalle del fallo:\n${cleanText(bugDetails)}`;

    if (!chatSnap.exists()) {
      await setDoc(chatDocRef, {
        participants: [senderUid, recipientUid],
        lastMessage: `🐛 Reporte de bug en mod "${mod.name}"`,
        lastUpdated: new Date(),
        unread: {
          [recipientUid]: true,
          [senderUid]: false
        },
        nicks: {
          [senderUid]: senderName,
          [recipientUid]: mod.author || 'Creador de Mod'
        }
      });
    } else {
      await updateDoc(chatDocRef, {
        lastMessage: `🐛 Reporte de bug en mod "${mod.name}"`,
        lastUpdated: new Date(),
        [`unread.${recipientUid}`]: true
      });
    }

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    await addDoc(messagesRef, {
      senderId: senderUid,
      senderName,
      text: reportMsg,
      type: 'mod_bug_report',
      modId: mod.id,
      modName: mod.name,
      modVersion: mod.version,
      timestamp: new Date()
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── 10. Reportar Contenido / Enlace Caído a los Administradores ───────────────
export async function reportModToAdmin(modDocId, mod, reportingUser, reason, details) {
  if (!reportingUser || !reportingUser.uid) {
    return { success: false, error: 'Debes iniciar sesión para enviar un reporte a los administradores.' };
  }

  try {
    await addDoc(collection(db, MOD_REPORTS_COLLECTION), {
      modDocId,
      modName: mod.name || 'Sin nombre',
      modAuthor: mod.author || 'Desconocido',
      modAuthorUid: mod.authorUid || null,
      modJsonUrl: mod.jsonUrl || '',
      modVersion: mod.version || '',
      reporterUid: reportingUser.uid,
      reporterName: cleanText(reportingUser.displayName || reportingUser.email || 'Usuario'),
      reporterEmail: reportingUser.email || '',
      reason: cleanText(reason || 'other'),
      details: cleanText(details || ''),
      status: 'pending', // 'pending' | 'resolved' | 'dismissed'
      createdAt: serverTimestamp()
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
