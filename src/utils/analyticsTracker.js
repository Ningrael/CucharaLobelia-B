// src/utils/analyticsTracker.js
import { db } from './firebase';
import { doc, getDoc, setDoc, updateDoc, increment, onSnapshot } from 'firebase/firestore';

const ADMIN_CONFIG_UID = 'xXhjkWRjh0hVBjcYr2qAAFRvGL82';
const SUMMARY_DOC_REF = () => doc(db, 'analytics', 'summary');
const ADMIN_DOC_REF = () => doc(db, 'players', ADMIN_CONFIG_UID);

// Detect device type
export function getDeviceType() {
  const ua = navigator.userAgent || '';
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  }
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}

// Detect operating system
export function getOperatingSystem() {
  const ua = navigator.userAgent || '';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Other';
}

export const ANALYTICS_CONSENT_KEY = 'lobelia_analytics_consent'; // 'granted' | 'denied'

export function getAnalyticsConsent() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ANALYTICS_CONSENT_KEY);
}

export function setAnalyticsConsent(consent) {
  if (typeof window === 'undefined') return;
  if (consent === 'granted') {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'granted');
  } else {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'denied');
    if (activeSession) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      activeSession = null;
    }
  }
}

let activeSession = null;
let heartbeatTimer = null;

/**
 * Initializes session tracking for current visit if GDPR consent is granted.
 * Heartbeat periodically updates time spent.
 */
export function initSessionTracking(currentUser, profile, lang = 'es') {
  // Verificación estricta de consentimiento previo (RGPD & Art. 22.2 LSSI)
  if (getAnalyticsConsent() !== 'granted') {
    return null;
  }

  if (activeSession) return activeSession;

  const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  const deviceType = getDeviceType();
  const os = getOperatingSystem();
  const isRegistered = !!currentUser;
  const username = profile?.username || (currentUser ? currentUser.email?.split('@')[0] : null);
  const userUid = currentUser?.uid || null;

  activeSession = {
    sessionId,
    userUid,
    startTime: Date.now(),
    lastHeartbeat: Date.now(),
    durationSeconds: 0,
    isRegistered,
    originallyCountedAsAnon: !isRegistered,
    hasConverted: false,
    username,
    deviceType,
    os,
    lang
  };

  // 1. Record session start in Firestore
  recordSessionStart(activeSession);

  // 2. Setup periodic heartbeat (every 30 seconds) to measure active session time
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!activeSession) return;
    const now = Date.now();
    const elapsedSinceLast = Math.round((now - activeSession.lastHeartbeat) / 1000);
    if (elapsedSinceLast >= 25 && elapsedSinceLast <= 120) {
      activeSession.durationSeconds += elapsedSinceLast;
      activeSession.lastHeartbeat = now;
      recordHeartbeat(elapsedSinceLast, activeSession);
    } else {
      activeSession.lastHeartbeat = now;
    }
  }, 30000);

  // 3. Handle page unload to flush remaining seconds
  window.addEventListener('beforeunload', () => {
    if (activeSession) {
      const now = Date.now();
      const finalSec = Math.round((now - activeSession.lastHeartbeat) / 1000);
      if (finalSec > 0 && finalSec < 120) {
        recordHeartbeat(finalSec, activeSession);
      }
    }
  });

  return activeSession;
}

/**
 * Update session info when user logs in/out during active browsing
 */
export function updateSessionUser(currentUser, profile) {
  if (!activeSession) return;
  const wasRegistered = activeSession.isRegistered;
  activeSession.isRegistered = !!currentUser;
  activeSession.userUid = currentUser?.uid || null;
  activeSession.username = profile?.username || (currentUser ? currentUser.email?.split('@')[0] : null);

  // If user just logged in during this session and was originally counted as anonymous
  if (!wasRegistered && currentUser && activeSession.originallyCountedAsAnon && !activeSession.hasConverted) {
    activeSession.hasConverted = true;
    activeSession.originallyCountedAsAnon = false;
    recordRegisteredConversion(activeSession);
  }
}

/**
 * Track specific feature usage (e.g. 'ai_query', 'calculator_run', 'mission_view', 'pdf_export')
 */
export async function trackFeature(featureName, meta = {}) {
  if (getAnalyticsConsent() !== 'granted') return;

  const today = new Date().toISOString().slice(0, 10);

  // Local storage quick caching
  try {
    const locKey = `lobelia_stat_${featureName}_${today}`;
    const cur = parseInt(localStorage.getItem(locKey) || '0', 10);
    localStorage.setItem(locKey, (cur + 1).toString());
  } catch (_) {}

  // Update in global Firestore analytics
  const updatePayload = {
    [`features.${featureName}`]: increment(1),
    [`daily.${today}.features.${featureName}`]: increment(1),
    updatedAt: new Date().toISOString()
  };

  await atomicUpdateAnalytics(updatePayload);

  // If registered user, also increment in user's profile
  if (activeSession?.isRegistered && activeSession.userUid) {
    try {
      const userDocRef = doc(db, 'players', activeSession.userUid);
      await updateDoc(userDocRef, {
        [`userAnalytics.features.${featureName}`]: increment(1),
        'userAnalytics.lastSeen': new Date().toISOString()
      });
    } catch (_) {}
  }
}

/**
 * Record a new session start in aggregated analytics and user profile
 */
async function recordSessionStart(session) {
  const today = new Date().toISOString().slice(0, 10);
  const isAnon = !session.isRegistered;

  const updatePayload = {
    'sessions.total': increment(1),
    'sessions.anonymous': increment(isAnon ? 1 : 0),
    'sessions.registered': increment(isAnon ? 0 : 1),
    [`devices.${session.deviceType}`]: increment(1),
    [`os.${session.os}`]: increment(1),
    [`languages.${session.lang || 'es'}`]: increment(1),
    [`daily.${today}.sessions.total`]: increment(1),
    [`daily.${today}.sessions.anonymous`]: increment(isAnon ? 1 : 0),
    [`daily.${today}.sessions.registered`]: increment(isAnon ? 0 : 1),
    updatedAt: new Date().toISOString()
  };

  // If registered user, append to recent active players list and update player profile
  if (session.isRegistered && session.username) {
    updateRecentUsersList(session.username, session.deviceType);

    if (session.userUid) {
      try {
        const userDocRef = doc(db, 'players', session.userUid);
        await updateDoc(userDocRef, {
          'userAnalytics.sessionsCount': increment(1),
          'userAnalytics.lastSeen': new Date().toISOString(),
          'userAnalytics.lastDevice': session.deviceType,
          'userAnalytics.lastOs': session.os
        });
      } catch (_) {}
    }
  }

  await atomicUpdateAnalytics(updatePayload);
}

/**
 * Record seconds elapsed in heartbeat
 */
async function recordHeartbeat(seconds, session) {
  if (seconds <= 0) return;
  const today = new Date().toISOString().slice(0, 10);

  const updatePayload = {
    'sessions.totalDurationSec': increment(seconds),
    [`daily.${today}.sessions.totalDurationSec`]: increment(seconds),
    updatedAt: new Date().toISOString()
  };

  await atomicUpdateAnalytics(updatePayload);

  // If registered user, also accumulate session time in player profile
  if (session.isRegistered && session.userUid) {
    try {
      const userDocRef = doc(db, 'players', session.userUid);
      await updateDoc(userDocRef, {
        'userAnalytics.totalDurationSec': increment(seconds),
        'userAnalytics.lastSeen': new Date().toISOString()
      });
    } catch (_) {}
  }
}

/**
 * Record conversion when user logs in during session
 */
async function recordRegisteredConversion(session) {
  const today = new Date().toISOString().slice(0, 10);

  const updatePayload = {
    'sessions.anonymous': increment(-1),
    'sessions.registered': increment(1),
    [`daily.${today}.sessions.anonymous`]: increment(-1),
    [`daily.${today}.sessions.registered`]: increment(1),
    updatedAt: new Date().toISOString()
  };

  if (session.username) {
    updateRecentUsersList(session.username, session.deviceType);
  }

  if (session.userUid) {
    try {
      const userDocRef = doc(db, 'players', session.userUid);
      await updateDoc(userDocRef, {
        'userAnalytics.sessionsCount': increment(1),
        'userAnalytics.lastSeen': new Date().toISOString(),
        'userAnalytics.lastDevice': session.deviceType,
        'userAnalytics.lastOs': session.os
      });
    } catch (_) {}
  }

  await atomicUpdateAnalytics(updatePayload);
}

/**
 * Helper to update recent active users in Firestore
 */
async function updateRecentUsersList(username, deviceType) {
  try {
    const adminDocRef = ADMIN_DOC_REF();
    const snap = await getDoc(adminDocRef);
    let recentUsers = [];
    if (snap.exists() && snap.data()?.analytics?.recentUsers) {
      recentUsers = snap.data().analytics.recentUsers;
    }

    // Filter out existing and prepend newest
    recentUsers = recentUsers.filter(u => u.username !== username);
    recentUsers.unshift({
      username,
      deviceType,
      lastSeen: new Date().toISOString()
    });

    // Keep last 15 users
    recentUsers = recentUsers.slice(0, 15);

    await setDoc(adminDocRef, {
      analytics: {
        recentUsers
      }
    }, { merge: true });
  } catch (err) {
    console.warn('[Analytics] Could not update recent users list:', err);
  }
}

/**
 * Resilient atomic updater for Firestore analytics
 */
async function atomicUpdateAnalytics(updatePayload) {
  // 1. Try updating analytics/summary
  try {
    const sumRef = SUMMARY_DOC_REF();
    await updateDoc(sumRef, updatePayload);
    return;
  } catch (err) {
    // If doc doesn't exist, create it with setDoc
    try {
      const sumRef = SUMMARY_DOC_REF();
      await setDoc(sumRef, updatePayload, { merge: true });
      return;
    } catch (_) {}
  }

  // 2. Resilient fallback to players/{adminUid}.analytics
  try {
    const adminRef = ADMIN_DOC_REF();
    const transformed = {};
    for (const [k, v] of Object.entries(updatePayload)) {
      transformed[`analytics.${k}`] = v;
    }
    await updateDoc(adminRef, transformed);
  } catch (err2) {
    try {
      const adminRef = ADMIN_DOC_REF();
      const transformed = {};
      for (const [k, v] of Object.entries(updatePayload)) {
        transformed[`analytics.${k}`] = v;
      }
      await setDoc(adminRef, transformed, { merge: true });
    } catch (_) {}
  }
}

/**
 * Sanitize and heal analytics data ensuring no negative counts and valid totals
 */
export function sanitizeAnalyticsData(data) {
  if (!data) return data;
  const clone = { ...data };

  if (clone.sessions) {
    const rawTotal = Math.max(0, clone.sessions.total || 0);
    const reg = Math.max(0, clone.sessions.registered || 0);
    let anon = clone.sessions.anonymous || 0;

    // Heal negative anonymous sessions
    if (anon < 0) {
      anon = Math.max(0, rawTotal - reg);
    }
    
    // Total must be at least the sum of registered and anonymous
    const realTotal = Math.max(rawTotal, reg + anon);

    clone.sessions = {
      ...clone.sessions,
      total: realTotal,
      registered: reg,
      anonymous: anon,
      totalDurationSec: Math.max(0, clone.sessions.totalDurationSec || 0)
    };
  }

  // Sanitize daily records if present
  if (clone.daily && typeof clone.daily === 'object') {
    const cleanDaily = {};
    for (const [dayKey, dayVal] of Object.entries(clone.daily)) {
      if (!dayVal || typeof dayVal !== 'object') continue;
      const dSess = dayVal.sessions || {};
      const dRawTot = Math.max(0, dSess.total || 0);
      const dReg = Math.max(0, dSess.registered || 0);
      let dAnon = dSess.anonymous || 0;
      if (dAnon < 0) dAnon = Math.max(0, dRawTot - dReg);
      const dTot = Math.max(dRawTot, dReg + dAnon);

      cleanDaily[dayKey] = {
        ...dayVal,
        sessions: {
          ...dSess,
          total: dTot,
          registered: dReg,
          anonymous: dAnon,
          totalDurationSec: Math.max(0, dSess.totalDurationSec || 0)
        }
      };
    }
    clone.daily = cleanDaily;
  }

  return clone;
}

/**
 * Subscribes to real-time analytics updates for the Admin Dashboard
 */
export function subscribeToAnalytics(callback) {
  try {
    const sumRef = SUMMARY_DOC_REF();
    return onSnapshot(sumRef, (snap) => {
      if (snap.exists()) {
        const rawData = snap.data();
        const data = sanitizeAnalyticsData(rawData);
        getDoc(ADMIN_DOC_REF()).then((adminSnap) => {
          if (adminSnap.exists() && adminSnap.data()?.analytics?.recentUsers) {
            data.recentUsers = adminSnap.data().analytics.recentUsers;
          }
          if (callback) callback(data);
        }).catch(() => {
          if (callback) callback(data);
        });
      } else {
        // Fallback to admin doc
        getDoc(ADMIN_DOC_REF()).then((adminSnap) => {
          if (adminSnap.exists() && adminSnap.data()?.analytics) {
            if (callback) callback(sanitizeAnalyticsData(adminSnap.data().analytics));
          } else {
            if (callback) callback({});
          }
        }).catch(() => {
          if (callback) callback({});
        });
      }
    }, (err) => {
      console.warn('[Analytics] Error in summary snapshot listener, trying admin doc:', err);
      getDoc(ADMIN_DOC_REF()).then((adminSnap) => {
        if (adminSnap.exists() && adminSnap.data()?.analytics) {
          if (callback) callback(sanitizeAnalyticsData(adminSnap.data().analytics));
        } else {
          if (callback) callback({});
        }
      }).catch(() => {
        if (callback) callback({});
      });
    });
  } catch (err) {
    console.warn('[Analytics] Failed to setup snapshot listener:', err);
    getAnalyticsSummary().then(data => { if (callback) callback(data || {}); });
    return () => {};
  }
}

/**
 * Fetches aggregated analytics summary for the Admin Dashboard
 */
export async function getAnalyticsSummary() {
  try {
    // 1. Check analytics/summary doc
    try {
      const sumSnap = await getDoc(SUMMARY_DOC_REF());
      if (sumSnap.exists()) {
        const rawData = sumSnap.data();
        const data = sanitizeAnalyticsData(rawData);

        // If corrupted data was detected in summary doc, auto-repair it in Firestore
        if (rawData.sessions?.anonymous < 0) {
          setDoc(SUMMARY_DOC_REF(), data, { merge: true }).catch(() => {});
        }

        // Also fetch recent users from admin doc if available
        try {
          const adminSnap = await getDoc(ADMIN_DOC_REF());
          if (adminSnap.exists() && adminSnap.data()?.analytics?.recentUsers) {
            data.recentUsers = adminSnap.data().analytics.recentUsers;
          }
        } catch (_) {}
        return data;
      }
    } catch (_) {}

    // 2. Check players/{adminUid}.analytics
    const adminSnap = await getDoc(ADMIN_DOC_REF());
    if (adminSnap.exists() && adminSnap.data()?.analytics) {
      return sanitizeAnalyticsData(adminSnap.data().analytics);
    }

    return {};
  } catch (err) {
    console.error('[Analytics] Error fetching summary:', err);
    return {};
  }
}

/**
 * Resets all analytics data in Firestore (Admin only action)
 */
export async function resetAnalyticsData() {
  const emptySummary = {
    sessions: {
      total: 0,
      anonymous: 0,
      registered: 0,
      totalDurationSec: 0
    },
    features: {
      ai_query: 0,
      calculator_run: 0,
      mission_view: 0,
      pdf_export: 0,
      league_view: 0,
      calendar_view: 0
    },
    devices: {
      mobile: 0,
      desktop: 0,
      tablet: 0
    },
    os: {
      Windows: 0,
      Android: 0,
      iOS: 0,
      macOS: 0,
      Linux: 0,
      Other: 0
    },
    languages: {
      es: 0,
      en: 0
    },
    recentUsers: [],
    daily: {},
    resetAt: new Date().toISOString()
  };

  try {
    await setDoc(SUMMARY_DOC_REF(), emptySummary);
  } catch (_) {}

  try {
    await setDoc(ADMIN_DOC_REF(), { analytics: emptySummary }, { merge: true });
  } catch (_) {}

  return emptySummary;
}
