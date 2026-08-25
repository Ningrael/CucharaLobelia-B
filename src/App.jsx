// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import Navbar from './components/Navbar';
import Modal from './components/Modal';

// Firebase & Auth
import { auth, db } from './utils/firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  sendEmailVerification,
  updateEmail,
  updatePassword,
  sendPasswordResetEmail,
  deleteUser,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import UserManagement from './components/UserManagement';
import AppConfig from './components/AppConfig';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import { initSessionTracking, updateSessionUser, trackFeature, getAnalyticsConsent, setAnalyticsConsent } from './utils/analyticsTracker';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  addDoc,
  orderBy
} from 'firebase/firestore';

// Factions
import {
  LIGHT_FACTIONS,
  LIGHT_FACTIONS_LEGEND,
  DARK_FACTIONS,
  DARK_FACTIONS_LEGEND
} from './utils/factions';

// Importar Vistas
import Home from './views/Home';
import Calculator from './views/Calculator';
import Missions from './views/Missions';
import Calendar from './views/Calendar';
import League from './views/League';
import ArmyBuilder from './views/ArmyBuilder';
import Mods from './views/Mods';
import Duels from './views/Duels';
import logoImg from './assets/logo-horizontal.svg';

// Importar Traducciones
import translations from './i18n/translations.json';
import { subscribeToAppConfig } from './utils/geminiRulesAi';

const ADMIN_USERNAMES = ['matias', 'admin'];

export default function App() {
  // 1. Estado de Navegación ('home', 'missions', 'calculator', 'calendar', 'league')
  const [currentView, setView] = useState('home');

  // 2. Estado de Idioma (se detecta del navegador o localStorage, por defecto 'es')
  const [lang, setLang] = useState(() => {
    try {
      const stored = localStorage.getItem('lobelia_lang');
      if (stored === 'es' || stored === 'en') return stored;
    } catch (_) {}
    
    const navLang = navigator.language || navigator.userLanguage || '';
    return navLang.startsWith('en') ? 'en' : 'es';
  });

  // Guardar idioma preferido al cambiar
  useEffect(() => {
    try {
      localStorage.setItem('lobelia_lang', lang);
    } catch (_) {}
  }, [lang]);

  // Estado del Modal de Selección de Idioma Inicial (solo para españoles)
  const [isLangPromptOpen, setIsLangPromptOpen] = useState(() => {
    try {
      const stored = localStorage.getItem('lobelia_lang');
      if (!stored) {
        const navLang = navigator.language || navigator.userLanguage || '';
        if (!navLang.startsWith('en')) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  });

  // Estado para League Deep-Linking / QR
  const [initialLeagueId, setInitialLeagueId] = useState(null);

  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
      const hashParams = new URLSearchParams(hashQuery);
      const leagueParam = searchParams.get('league') || hashParams.get('league');
      if (leagueParam) {
        setInitialLeagueId(leagueParam);
        setView('league');
      }
    } catch (_) {}
  }, []);

  // Estado del Prompt de Instalación PWA (Móvil / Escritorio)
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBanner(false);
    }
    setDeferredPrompt(null);
  };

  // Estados del Bug Report
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
  const [bugReportText, setBugReportText] = useState('');
  const [bugReportScreenshot, setBugReportScreenshot] = useState(null);
  const [bugReportEmail, setBugReportEmail] = useState('');
  const [isSubmittingBug, setIsSubmittingBug] = useState(false);

  const BUG_RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutos

  const handleSubmitBugReport = async (e) => {
    e.preventDefault();
    if (!bugReportText.trim()) {
      showAlert(lang === 'es' ? 'Por favor, describe el problema.' : 'Please describe the issue.');
      return;
    }

    // Rate limit check
    try {
      const lastReport = localStorage.getItem('lobelia_last_bug_report');
      if (lastReport) {
        const elapsed = Date.now() - parseInt(lastReport);
        if (elapsed < BUG_RATE_LIMIT_MS) {
          const remaining = Math.ceil((BUG_RATE_LIMIT_MS - elapsed) / 60000);
          showAlert(
            lang === 'es'
              ? `Debes esperar ${remaining} minuto(s) antes de enviar otro reporte.`
              : `Please wait ${remaining} minute(s) before submitting another report.`
          );
          return;
        }
      }
    } catch (_) {}

    setIsSubmittingBug(true);
    try {
      // Gather tech info
      const techInfo = {
        userAgent: navigator.userAgent,
        platform: navigator.platform || 'unknown',
        language: navigator.language,
        screenSize: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        currentView: currentView,
        appVersion: '3.0.1',
        timestamp: new Date().toISOString(),
        url: window.location.href
      };

      // Convert screenshot to base64 data URL if provided
      let screenshotData = null;
      if (bugReportScreenshot) {
        screenshotData = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(bugReportScreenshot);
        });
      }

      const reportData = {
        description: bugReportText.trim(),
        screenshot: screenshotData,
        contactEmail: bugReportEmail.trim() || null,
        reporterUid: user?.uid || null,
        reporterName: profile?.name || profile?.username || (bugReportEmail.trim() || 'Anónimo'),
        techInfo: techInfo,
        status: 'new',
        createdAt: new Date()
      };

      // Save to Firestore bug_reports collection
      await addDoc(collection(db, 'bug_reports'), reportData);

      // Si el usuario está registrado, enviar un Mensaje Privado (MP) interno al admin
      if (user) {
        const adminUid = 'xXhjkWRjh0hVBjcYr2qAAFRvGL82';
        const senderUid = user.uid;
        const recipientUid = adminUid;
        const chatId = senderUid < recipientUid ? `${senderUid}_${recipientUid}` : `${recipientUid}_${senderUid}`;
        const chatDocRef = doc(db, 'chats', chatId);

        try {
          const chatDoc = await getDoc(chatDocRef);
          const senderNick = profile?.name || user.email?.split('@')[0] || 'Jugador';
          const senderUsername = profile?.username || user.email?.split('@')[0] || 'jugador';

          if (!chatDoc.exists()) {
            await setDoc(chatDocRef, {
              participants: [senderUid, recipientUid],
              lastMessage: `🐛 [REPORTE DE BUG]: ${bugReportText.trim()}`,
              lastUpdated: new Date(),
              unread: {
                [senderUid]: false,
                [recipientUid]: true
              },
              nicks: {
                [senderUid]: senderNick,
                [recipientUid]: 'Matias'
              },
              usernames: {
                [senderUid]: senderUsername,
                [recipientUid]: 'matias'
              }
            });
          } else {
            await updateDoc(chatDocRef, {
              lastMessage: `🐛 [REPORTE DE BUG]: ${bugReportText.trim()}`,
              lastUpdated: new Date(),
              [`unread.${recipientUid}`]: true
            });
          }

          const messagesRef = collection(db, 'chats', chatId, 'messages');
          await addDoc(messagesRef, {
            senderId: senderUid,
            text: `🐛 [REPORTE DE BUG]\n"${bugReportText.trim()}"\n\n📌 Vista: ${techInfo.currentView}\n🖥️ Navegador / Disp: ${techInfo.platform}\n📱 Pantalla: ${techInfo.screenSize}\n⚙️ App: v${techInfo.appVersion}`,
            timestamp: new Date()
          });
        } catch (pmErr) {
          console.warn('Could not send in-app PM for bug report:', pmErr.message);
        }
      }
      // Save rate limit timestamp
      try { localStorage.setItem('lobelia_last_bug_report', Date.now().toString()); } catch (_) {}

      // Reset form
      setBugReportText('');
      setBugReportScreenshot(null);
      setBugReportEmail('');
      setIsBugReportOpen(false);

      showAlert(
        lang === 'es'
          ? '¡Gracias! Tu reporte de bug ha sido enviado correctamente. Lo revisaremos lo antes posible.'
          : 'Thank you! Your bug report has been submitted successfully. We will review it as soon as possible.'
      );
    } catch (err) {
      console.error('Error submitting bug report:', err);
      showAlert(
        lang === 'es'
          ? `Error al enviar el reporte: ${err.message}`
          : `Error submitting report: ${err.message}`
      );
    }
    setIsSubmittingBug(false);
  };

  // Función para Compartir la App con la API nativa de Android/iOS/Windows
  const handleShareApp = async () => {
    const shareUrl = window.location.origin.includes('localhost')
      ? 'https://ningrael.github.io/CucharaLobelia/'
      : (window.location.origin + window.location.pathname);

    const shareText = lang === 'es'
      ? `🥄 *La Cuchara de Lobelia* ⚔️\n_La app definitiva para tus partidas de MESBG_\n\n🎲 Misiones & Emparejamientos\n🧙‍♂️ Lobelia: Tu referí con IA\n🏆 Ligas, Torneos y Estadísticas\n\nEntra aquí:`
      : `🥄 *La Cuchara de Lobelia* ⚔️\n_The ultimate MESBG companion app_\n\n🎲 Missions & Pairings\n🧙‍♂️ Lobelia: AI Rules Referee\n🏆 Leagues, Tournaments & Stats\n\nJoin here:`;

    const shareData = {
      title: 'La Cuchara de Lobelia | MESBG App',
      text: shareText,
      url: shareUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
      }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        showAlert(
          lang === 'es'
            ? '¡Mensaje y enlace de La Cuchara de Lobelia copiados al portapapeles! 📋'
            : 'La Cuchara de Lobelia message and link copied to clipboard! 📋'
        );
      } catch (_) {
        prompt(lang === 'es' ? 'Copia el enlace de la app:' : 'Copy app link:', shareUrl);
      }
    } else {
      prompt(lang === 'es' ? 'Copia el enlace de la app:' : 'Copy app link:', shareUrl);
    }
  };

  // 3. Estado del Modal "Acerca de" y "Aviso Legal & Privacidad"
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isLegalOpen, setIsLegalOpen] = useState(false);
  const [analyticsConsent, setAnalyticsConsentState] = useState(getAnalyticsConsent());

  // 4. Estados de Autenticación Global & Configuración
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [globalConfig, setGlobalConfig] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToAppConfig((cfg) => {
      if (cfg) setGlobalConfig(cfg);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Inicializar tracking de sesión SOLO si el usuario ha otorgado consentimiento explícito (RGPD)
  useEffect(() => {
    if (analyticsConsent === 'granted') {
      initSessionTracking(user, profile, lang);
    }
  }, [analyticsConsent, user, profile, lang]);

  // Actualizar sesión cuando el usuario se loguea o cambia su perfil
  useEffect(() => {
    if (analyticsConsent === 'granted') {
      updateSessionUser(user, profile);
    }
  }, [user, profile, analyticsConsent]);

  // Telemetría de vistas (solo si consent === 'granted')
  useEffect(() => {
    if (currentView && analyticsConsent === 'granted') {
      trackFeature(`view_${currentView}`);
    }
  }, [currentView, analyticsConsent]);

  // Estados del Modal de Perfil/Login
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register' | 'forgot_password' | 'google_complete'
  const [googleUser, setGoogleUser] = useState(null); // Temporary Google user during registration completion
  
  // Inputs del formulario de Auth
  const [usernameInput, setUsernameInput] = useState('');
  const [nickInput, setNickInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  // Estados del Formulario de Recuperación
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [isSendingForgotPassword, setIsSendingForgotPassword] = useState(false);

  // Estados de Gestión de Cuenta (Editar Perfil / Cambiar Contraseña)
  const [profileTab, setProfileTab] = useState('view'); // 'view' | 'edit_profile' | 'change_password'
  const [editNickInput, setEditNickInput] = useState('');
  const [editEmailInput, setEditEmailInput] = useState('');
  const [editPhoneInput, setEditPhoneInput] = useState('');
  const [editLocationInput, setEditLocationInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState('');
  const [isUpdatingAccount, setIsUpdatingAccount] = useState(false);
  
  // Preferencia de notificaciones de correo para PMs
  const [editEmailNotifications, setEditEmailNotifications] = useState(true);

  // Estados de Mensajería Privada (PM)
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);
  const [chats, setChats] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeChat, setActiveChat] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessageText, setNewMessageText] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Estados para Administrador: Reportes de Bugs recibidos
  const [bugReports, setBugReports] = useState([]);
  const [unreadBugReportsCount, setUnreadBugReportsCount] = useState(0);
  const [chatActiveTab, setChatActiveTab] = useState('chats'); // 'chats' | 'bugs'
  const [selectedBugScreenshot, setSelectedBugScreenshot] = useState(null);
  const pmMessagesEndRef = useRef(null);

  // Auto-scroll del chat privado al recibir o enviar mensajes
  useEffect(() => {
    if (activeChat && pmMessagesEndRef.current) {
      pmMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, activeChat]);

  // Sincronizar inputs de edición con el perfil activo
  useEffect(() => {
    if (profile) {
      setEditNickInput(profile.name || '');
      setEditEmailInput(profile.email || '');
      setEditPhoneInput(profile.phone || '');
      setEditLocationInput(profile.location || '');
      setEditEmailNotifications(profile.emailNotifications !== false);
    }
  }, [profile]);

  // Resetear estados al abrir/cerrar el modal
  useEffect(() => {
    if (!isAuthModalOpen) {
      setProfileTab('view');
      setNewPasswordInput('');
      setConfirmNewPasswordInput('');
    }
  }, [isAuthModalOpen]);

  // Estados y método para Alertas con modal premium
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertModalMessage, setAlertModalMessage] = useState('');

  const showAlert = (message) => {
    setAlertModalMessage(message);
    setIsAlertModalOpen(true);
  };

  const alert = (message) => {
    showAlert(message);
  };

  // Estados y método para Confirmaciones con modal premium
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmModalMessage, setConfirmModalMessage] = useState('');
  const [confirmModalOnConfirm, setConfirmModalOnConfirm] = useState(null);

  const showConfirm = (message, onConfirmCallback) => {
    setConfirmModalMessage(message);
    setConfirmModalOnConfirm(() => onConfirmCallback);
    setIsConfirmModalOpen(true);
  };

  // Escucha del estado de autenticación
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        setUser(currentUser);
        if (currentUser) {
          const docRef = doc(db, 'players', currentUser.uid);
          let docSnap = null;
          try {
            docSnap = await getDoc(docRef);
          } catch (getErr) {
            console.warn("Could not fetch player profile doc:", getErr.message);
          }

          if (docSnap && docSnap.exists()) {
            const profileData = docSnap.data();
            
            // Verify ban/block status
            const isBlocked = profileData.status === 'blocked' || profileData.status === 'deleted';
            const isSuspended = profileData.status === 'suspended' && profileData.banUntil && new Date(profileData.banUntil) > new Date();
            
            if (isBlocked || isSuspended) {
              const reason = profileData.banReason || (lang === 'es' ? 'No especificado' : 'Not specified');
              let banMessage = '';
              if (isBlocked) {
                banMessage = lang === 'es'
                  ? `Tu cuenta ha sido bloqueada permanentemente. Motivo: ${reason}`
                  : `Your account has been permanently blocked. Reason: ${reason}`;
              } else {
                banMessage = lang === 'es'
                  ? `Tu cuenta ha sido suspendida hasta el ${profileData.banUntil}. Motivo: ${reason}`
                  : `Your account has been suspended until ${profileData.banUntil}. Reason: ${reason}`;
              }
              
              setUser(null);
              setProfile(null);
              setIsAdmin(false);
              await signOut(auth);
              showAlert(banMessage);
              return;
            }

            setProfile(profileData);
            const isUserSuperAdmin = profileData.username?.toLowerCase() === 'matias' || (currentUser.email && currentUser.email.toLowerCase() === 'sosamatias@gmail.com') || profileData.isSuperAdmin === true;
            const isUserAdmin = ADMIN_USERNAMES.includes(profileData.username?.toLowerCase()) || (currentUser.email && currentUser.email.toLowerCase() === 'sosamatias@gmail.com') || profileData.isAdmin === true || isUserSuperAdmin;
            setIsAdmin(isUserAdmin);

            // Auto-fix invalid profile fields for Firestore schema compliance
            if (
              profileData.vpScored === null || profileData.vpScored === undefined || profileData.vpScored < 0 ||
              profileData.vpConceded === null || profileData.vpConceded === undefined || profileData.vpConceded < 0 ||
              profileData.leadersKilled === null || profileData.leadersKilled === undefined || profileData.leadersKilled < 0 ||
              profileData.leadersLost === null || profileData.leadersLost === undefined || profileData.leadersLost < 0 ||
              profileData.points === undefined || profileData.points === null || profileData.points < 0 ||
              profileData.matchesPlayed === undefined || profileData.matchesPlayed === null || profileData.matchesPlayed < 0 ||
              profileData.wins === undefined || profileData.wins === null || profileData.wins < 0 ||
              profileData.draws === undefined || profileData.draws === null || profileData.draws < 0 ||
              profileData.losses === undefined || profileData.losses === null || profileData.losses < 0 ||
              profileData.isAdmin === undefined || profileData.isAdmin === null ||
              profileData.isSuperAdmin === undefined || profileData.isSuperAdmin === null ||
              (profileData.username?.toLowerCase() === 'matias' && (profileData.isAdmin !== true || profileData.isSuperAdmin !== true))
            ) {
              console.log("Auto-fixing invalid profile fields for Firestore schema compliance...");
              const fixedFields = {};
              if (profileData.points === undefined || profileData.points === null || profileData.points < 0) fixedFields.points = 0;
              if (profileData.matchesPlayed === undefined || profileData.matchesPlayed === null || profileData.matchesPlayed < 0) fixedFields.matchesPlayed = 0;
              if (profileData.wins === undefined || profileData.wins === null || profileData.wins < 0) fixedFields.wins = 0;
              if (profileData.draws === undefined || profileData.draws === null || profileData.draws < 0) fixedFields.draws = 0;
              if (profileData.losses === undefined || profileData.losses === null || profileData.losses < 0) fixedFields.losses = 0;
              if (profileData.vpScored === null || profileData.vpScored === undefined || profileData.vpScored < 0) fixedFields.vpScored = 0;
              if (profileData.vpConceded === null || profileData.vpConceded === undefined || profileData.vpConceded < 0) fixedFields.vpConceded = 0;
              if (profileData.leadersKilled === null || profileData.leadersKilled === undefined || profileData.leadersKilled < 0) fixedFields.leadersKilled = 0;
              if (profileData.leadersLost === null || profileData.leadersLost === undefined || profileData.leadersLost < 0) fixedFields.leadersLost = 0;
              if (profileData.isAdmin === undefined || profileData.isAdmin === null) fixedFields.isAdmin = isUserAdmin;
              if (profileData.isSuperAdmin === undefined || profileData.isSuperAdmin === null) fixedFields.isSuperAdmin = isUserSuperAdmin;
              
              // Explicitly force Matias's fields
              if (profileData.username?.toLowerCase() === 'matias') {
                fixedFields.isAdmin = true;
                fixedFields.isSuperAdmin = true;
              }

              try {
                await updateDoc(docRef, fixedFields);
                console.log("Profile fields auto-fixed successfully!");
                const freshSnap = await getDoc(docRef);
                if (freshSnap && freshSnap.exists()) {
                  setProfile(freshSnap.data());
                }
              } catch (err) {
                console.warn("Failed to auto-fix profile fields:", err.message);
              }
            }
          } else {
            // New user without a profile doc in Firestore yet
            const isGoogleProvider = currentUser.providerData?.some(p => p.providerId === 'google.com');
            const baseName = currentUser.displayName || currentUser.email?.split('@')[0] || 'Jugador';
            const cleanUsername = (currentUser.email?.split('@')[0] || baseName).replace(/[^a-zA-Z0-9_]/g, '_');
            const isMatias = cleanUsername.toLowerCase() === 'matias';

            const defaultProfile = {
              username: cleanUsername,
              name: currentUser.displayName || baseName,
              email: currentUser.email,
              phone: '',
              faction: 'Desconocida',
              alignment: 'luz',
              status: 'pending',
              isAdmin: isMatias || ADMIN_USERNAMES.includes(cleanUsername.toLowerCase()),
              isSuperAdmin: isMatias,
              points: 0,
              matchesPlayed: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              vpScored: 0,
              vpConceded: 0,
              leadersKilled: 0,
              leadersLost: 0,
              createdAt: new Date().toISOString()
            };

            try {
              await setDoc(docRef, defaultProfile);
              setProfile(defaultProfile);
              setIsAdmin(defaultProfile.isAdmin);
            } catch (setErr) {
              console.warn("Could not create initial player profile:", setErr.message);
              setProfile(defaultProfile);
              setIsAdmin(defaultProfile.isAdmin);
            }

            if (isGoogleProvider) {
              setGoogleUser(currentUser);
              setAuthMode('google_complete');
              setIsAuthModalOpen(true);
            }
          }
        } else {
          setProfile(null);
          setIsAdmin(false);
        }
      } catch (globalAuthErr) {
        console.error("Error in onAuthStateChanged:", globalAuthErr);
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Escuchar chats en tiempo real y calcular unreadCount
  useEffect(() => {
    if (!user) {
      setChats([]);
      setUnreadCount(0);
      return;
    }

    const chatsRef = collection(db, "chats");
    const q = query(chatsRef, where("participants", "array-contains", user.uid));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = [];
      let unreadSum = 0;
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const chatItem = { id: docSnap.id, ...data };
        chatList.push(chatItem);
        if (data.unread && data.unread[user.uid] === true) {
          unreadSum++;
        }
      });
      chatList.sort((a, b) => {
        const tA = a.lastUpdated?.toMillis ? a.lastUpdated.toMillis() : (a.lastUpdated || 0);
        const tB = b.lastUpdated?.toMillis ? b.lastUpdated.toMillis() : (b.lastUpdated || 0);
        return tB - tA;
      });
      setChats(chatList);
      setUnreadCount(unreadSum);
    });

    return () => unsubscribe();
  }, [user]);

  // Escuchar reportes de bugs en tiempo real para Administradores
  useEffect(() => {
    if (!user || !isAdmin) {
      setBugReports([]);
      setUnreadBugReportsCount(0);
      return;
    }

    const bugsRef = collection(db, "bug_reports");
    const q = query(bugsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reports = [];
      let unreadBugs = 0;
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        reports.push({ id: docSnap.id, ...data });
        if (data.status === 'new') {
          unreadBugs++;
        }
      });
      setBugReports(reports);
      setUnreadBugReportsCount(unreadBugs);
    }, (err) => {
      console.warn("Could not listen to bug_reports:", err.message);
    });

    return () => unsubscribe();
  }, [user, isAdmin]);

  // Escuchar mensajes del chat activo y marcar como leído
  useEffect(() => {
    if (!activeChat || !user) {
      setChatMessages([]);
      return;
    }

    const messagesRef = collection(db, "chats", activeChat.id, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgList = [];
      snapshot.forEach(docSnap => {
        msgList.push({ id: docSnap.id, ...docSnap.data() });
      });
      setChatMessages(msgList);

      if (activeChat.unread && activeChat.unread[user.uid] === true) {
        const docRef = doc(db, "chats", activeChat.id);
        updateDoc(docRef, {
          [`unread.${user.uid}`]: false
        }).catch(err => console.warn("Failed to mark chat as read:", err.message));
      }
    });

    return () => unsubscribe();
  }, [activeChat, user]);

  // Iniciar o reanudar conversación
  const handleStartChat = async (recipientUid, recipientNick, recipientUsername) => {
    if (!user || !profile) return;
    if (user.uid === recipientUid) {
      alert(lang === 'es' ? "No puedes chatear contigo mismo." : "You cannot chat with yourself.");
      return;
    }

    const chatId = user.uid < recipientUid ? `${user.uid}_${recipientUid}` : `${recipientUid}_${user.uid}`;
    const chatDocRef = doc(db, "chats", chatId);

    try {
      const chatDoc = await getDoc(chatDocRef);
      let chatData = null;

      if (!chatDoc.exists()) {
        chatData = {
          participants: [user.uid, recipientUid],
          lastMessage: '',
          lastUpdated: new Date(),
          unread: {
            [user.uid]: false,
            [recipientUid]: false
          },
          nicks: {
            [user.uid]: profile.name || user.email.split('@')[0],
            [recipientUid]: recipientNick
          },
          usernames: {
            [user.uid]: profile.username || user.email.split('@')[0],
            [recipientUid]: recipientUsername
          }
        };
        await setDoc(chatDocRef, chatData);
        chatData.id = chatId;
      } else {
        chatData = { id: chatId, ...chatDoc.data() };
      }

      setActiveChat(chatData);
      setIsChatModalOpen(true);
    } catch (err) {
      console.error("Error starting chat:", err);
      alert(lang === 'es' ? "Error al iniciar chat: " + err.message : "Error starting chat: " + err.message);
    }
  };

  // Enviar mensaje e integrar correo en /mail
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!user || !activeChat || !newMessageText.trim()) return;

    const messageText = newMessageText.trim();
    setNewMessageText('');
    setIsSendingMessage(true);

    try {
      const recipientUid = activeChat.participants.find(uid => uid !== user.uid) || user.uid;

      const messagesRef = collection(db, "chats", activeChat.id, "messages");
      await addDoc(messagesRef, {
        senderId: user.uid,
        text: messageText,
        timestamp: new Date()
      });

      const chatDocRef = doc(db, "chats", activeChat.id);
      await updateDoc(chatDocRef, {
        lastMessage: messageText,
        lastUpdated: new Date(),
        [`unread.${recipientUid}`]: true
      });

      const recipientDocRef = doc(db, "players", recipientUid);
      const recipientDoc = await getDoc(recipientDocRef);
      if (recipientDoc.exists()) {
         const recipientData = recipientDoc.data();
         if (recipientData.emailNotifications !== false && recipientData.email) {
           const senderNick = profile.name || user.email.split('@')[0];
           const senderUsername = profile.username || user.email.split('@')[0];
           const recipientNick = recipientData.name || recipientData.email.split('@')[0];

           await addDoc(collection(db, "mail"), {
             to: recipientData.email,
             recipientUid: recipientUid,
             message: {
               subject: lang === 'es' ? `Nuevo mensaje de ${senderNick} en La Cuchara de Lobelia` : `New message from ${senderNick} on La Cuchara de Lobelia`,
               text: lang === 'es' 
                 ? `Hola ${recipientNick},\n\nHas recibido un nuevo mensaje privado de ${senderNick} (@${senderUsername}) en La Cuchara de Lobelia MESBG Companion.\n\nMensaje:\n"${messageText}"\n\nPuedes responder ingresando a la web: ${window.location.origin}\n\nUn saludo,\nLa Cuchara de Lobelia`
                 : `Hello ${recipientNick},\n\nYou have received a new private message from ${senderNick} (@${senderUsername}) on La Cuchara de Lobelia MESBG Companion.\n\nMessage:\n"${messageText}"\n\nYou can reply by entering the web: ${window.location.origin}\n\nBest regards,\nLa Cuchara de Lobelia`,
               html: `<div style="font-family: sans-serif; padding: 20px; background-color: #112114; color: #fff; border-radius: 8px; border: 1px solid #cba135;">
                        <h2 style="color: #cba135; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-top: 0;">La Cuchara de Lobelia MESBG</h2>
                        <p>${lang === 'es' ? `Hola <strong>${recipientNick}</strong>,` : `Hello <strong>${recipientNick}</strong>,`}</p>
                        <p>${lang === 'es' ? `Has recibido un nuevo mensaje privado de <strong>${senderNick}</strong> (@${senderUsername}):` : `You have received a new private message from <strong>${senderNick}</strong> (@${senderUsername}):`}</p>
                        <blockquote style="background: rgba(0,0,0,0.3); padding: 12px; border-left: 4px solid #cba135; color: #ddd; margin: 15px 0; border-radius: 4px; font-style: italic;">
                          "${messageText}"
                        </blockquote>
                        <p><a href="${window.location.origin}" style="display: inline-block; background: #cba135; color: #000; font-weight: bold; text-decoration: none; padding: 10px 18px; border-radius: 4px; margin-top: 10px;">${lang === 'es' ? '👉 Responder en la Web' : '👉 Reply on Web'}</a></p>
                        <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0;" />
                        <p style="font-size: 0.8rem; color: #888; margin-bottom: 0;">${lang === 'es' ? 'Este es un correo automático. Puedes desactivar estas notificaciones desde los ajustes de tu cuenta en la web.' : 'This is an automatic email. You can disable these notifications from your account settings on the web.'}</p>
                      </div>`
             }
           });
         }
      }
    } catch (err) {
      console.warn("Failed to send message/email:", err.message);
    }
    setIsSendingMessage(false);
  };

  // Helper para abrir chat privado con el usuario que reportó el bug
  const handleOpenChatWithReporter = async (reporterUid, reporterName) => {
    if (!user || !reporterUid || reporterUid === user.uid) return;
    const senderUid = user.uid;
    const recipientUid = reporterUid;
    const chatId = senderUid < recipientUid ? `${senderUid}_${recipientUid}` : `${recipientUid}_${senderUid}`;
    const chatDocRef = doc(db, 'chats', chatId);

    try {
      const chatDoc = await getDoc(chatDocRef);
      if (!chatDoc.exists()) {
        await setDoc(chatDocRef, {
          participants: [senderUid, recipientUid],
          lastMessage: lang === 'es' ? 'Hola, te escribo en relación a tu reporte de bug.' : 'Hello, I am contacting you regarding your bug report.',
          lastUpdated: new Date(),
          unread: {
            [senderUid]: false,
            [recipientUid]: true
          },
          nicks: {
            [senderUid]: profile?.name || 'Matias (Admin)',
            [recipientUid]: reporterName || 'Jugador'
          },
          usernames: {
            [senderUid]: profile?.username || 'matias',
            [recipientUid]: reporterName?.toLowerCase() || 'jugador'
          }
        });
      }
      setActiveChat({
        id: chatId,
        participants: [senderUid, recipientUid],
        nicks: { [senderUid]: profile?.name || 'Matias (Admin)', [recipientUid]: reporterName || 'Jugador' },
        usernames: { [senderUid]: profile?.username || 'matias', [recipientUid]: reporterName?.toLowerCase() || 'jugador' }
      });
      setChatActiveTab('chats');
    } catch (err) {
      console.error("Error opening chat with reporter:", err);
      showAlert(lang === 'es' ? 'Error' : 'Error', (lang === 'es' ? 'No se pudo abrir el chat: ' : 'Could not open chat: ') + err.message);
    }
  };

  // Helper para cambiar el estado de un reporte de bug
  const handleUpdateBugStatus = async (reportId, newStatus) => {
    try {
      const bugRef = doc(db, 'bug_reports', reportId);
      await updateDoc(bugRef, { status: newStatus });
    } catch (err) {
      console.error("Error updating bug report status:", err);
    }
  };

  // Helper para eliminar un reporte de bug
  const handleDeleteBugReport = (reportId) => {
    showConfirm(
      lang === 'es' ? 'Eliminar Reporte de Bug' : 'Delete Bug Report',
      lang === 'es' ? '¿Estás seguro de que deseas eliminar este reporte de bug de la base de datos?' : 'Are you sure you want to delete this bug report?',
      async () => {
        try {
          await deleteDoc(doc(db, 'bug_reports', reportId));
        } catch (err) {
          console.error("Error deleting bug report:", err);
          showAlert(lang === 'es' ? 'Error' : 'Error', err.message);
        }
      }
    );
  };

  const handleRefreshVerification = async () => {
    if (!auth.currentUser) return;
    try {
      await auth.currentUser.reload();
      const updatedUser = auth.currentUser;
      setUser({ ...updatedUser });
      if (updatedUser.emailVerified) {
        alert(lang === 'es' ? "¡Correo verificado con éxito!" : "Email successfully verified!");
      } else {
        alert(
          lang === 'es'
            ? "El correo aún no ha sido verificado. Revisa tu bandeja de entrada."
            : "Email has not been verified yet. Please check your inbox."
        );
      }
    } catch (err) {
      console.error(err);
      alert(lang === 'es' ? "Error al actualizar: " + err.message : "Error refreshing: " + err.message);
    }
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser) return;
    try {
      await sendEmailVerification(auth.currentUser);
      alert(
        lang === 'es'
          ? "Correo de verificación reenviado. Revisa tu bandeja de entrada."
          : "Verification email resent. Please check your inbox."
      );
    } catch (err) {
      console.error(err);
      alert(lang === 'es' ? "Error al reenviar: " + err.message : "Error resending: " + err.message);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!user || !profile) return;
    
    const newNick = editNickInput.trim();
    const newEmail = editEmailInput.trim();
    const newPhone = editPhoneInput.trim();
    const newLocation = editLocationInput.trim();
    
    if (!newNick || !newEmail || !newLocation) {
      alert(lang === 'es' ? "Completa todos los campos obligatorios." : "Please fill out all required fields.");
      return;
    }
    
    setIsUpdatingAccount(true);
    try {
      const docRef = doc(db, "players", user.uid);
      const emailChanged = newEmail.toLowerCase() !== profile.email?.toLowerCase();
      
      // Si el correo cambió, actualizamos en Firebase Auth
      if (emailChanged) {
        try {
          await updateEmail(auth.currentUser, newEmail);
          await sendEmailVerification(auth.currentUser);
          // Forzar refresh de la sesión local
          setUser({ ...auth.currentUser });
        } catch (authErr) {
          console.error("Failed to update email in Auth:", authErr);
          if (authErr.code === 'auth/requires-recent-login') {
            alert(
              lang === 'es'
                ? "Por motivos de seguridad, para cambiar tu correo electrónico debes cerrar sesión y volver a iniciarla."
                : "For security reasons, you must log out and log back in to change your email address."
            );
            setIsUpdatingAccount(false);
            return;
          }
          if (authErr.code === 'auth/email-already-in-use') {
            alert(
              lang === 'es'
                ? "El correo electrónico ya se encuentra en uso por otra cuenta."
                : "The email address is already in use by another account."
            );
            setIsUpdatingAccount(false);
            return;
          }
          throw authErr;
        }
      }
      
      const updatedFields = {
        name: newNick,
        email: newEmail,
        phone: newPhone,
        location: newLocation,
        emailNotifications: editEmailNotifications
      };
      
      await updateDoc(docRef, updatedFields);
      
      // Actualizar perfil local
      setProfile(prev => ({
        ...prev,
        ...updatedFields
      }));
      
      alert(
        lang === 'es'
          ? emailChanged
            ? "Perfil actualizado con éxito. Se envió un correo de verificación a la nueva dirección."
            : "Perfil actualizado con éxito."
          : emailChanged
            ? "Profile updated successfully. A verification email has been sent to the new address."
            : "Profile updated successfully."
      );
      setProfileTab('view');
    } catch (err) {
      console.error(err);
      alert(lang === 'es' ? `Error al actualizar perfil: ${err.message}` : `Error updating profile: ${err.message}`);
    }
    setIsUpdatingAccount(false);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!user) return;
    
    if (!newPasswordInput) {
      alert(lang === 'es' ? "Introduce la nueva contraseña." : "Please enter the new password.");
      return;
    }
    if (newPasswordInput !== confirmNewPasswordInput) {
      alert(lang === 'es' ? "Las contraseñas no coinciden." : "Passwords do not match.");
      return;
    }
    
    setIsUpdatingAccount(true);
    try {
      await updatePassword(auth.currentUser, newPasswordInput);
      alert(lang === 'es' ? "Contraseña cambiada con éxito." : "Password changed successfully.");
      setNewPasswordInput('');
      setConfirmNewPasswordInput('');
      setProfileTab('view');
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/requires-recent-login') {
        alert(
          lang === 'es'
            ? "Por motivos de seguridad, para cambiar tu contraseña debes cerrar sesión y volver a iniciarla."
            : "For security reasons, you must log out and log back in to change your password."
        );
      } else {
        alert(lang === 'es' ? `Error al cambiar contraseña: ${err.message}` : `Error changing password: ${err.message}`);
      }
    }
    setIsUpdatingAccount(false);
  };

  // Handlers de Auth
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!usernameInput || !passwordInput) {
      alert(lang === 'es' ? "Introduce tus credenciales." : "Please enter your credentials.");
      return;
    }
    setIsSubmittingAuth(true);
    const input = usernameInput.trim().toLowerCase();
    let email = '';
    
    try {
      if (input.includes('@')) {
        email = input;
      } else {
        // Consultar Firestore para ver si existe el usuario y su email
        const qUser = query(collection(db, "players"), where("username", "==", input));
        const qSnap = await getDocs(qUser);
        if (!qSnap.empty) {
          const pData = qSnap.docs[0].data();
          email = pData.email || `${input}@cucharalobelia.com`;
        } else {
          // Fallback para cuentas de prueba existentes
          email = `${input}@cucharalobelia.com`;
        }
      }
      
      await signInWithEmailAndPassword(auth, email, passwordInput);
      setUsernameInput('');
      setPasswordInput('');
      setIsAuthModalOpen(false);
    } catch (err) {
      console.error(err);
      alert(lang === 'es' ? "Nombre de usuario o contraseña incorrectos." : "Incorrect username or password.");
    }
    setIsSubmittingAuth(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!forgotPasswordEmail.trim()) {
      alert(lang === 'es' ? "Por favor ingresa tu correo electrónico." : "Please enter your email address.");
      return;
    }
    setIsSendingForgotPassword(true);
    try {
      await sendPasswordResetEmail(auth, forgotPasswordEmail.trim());
      alert(
        lang === 'es'
          ? "Se ha enviado un enlace para restablecer tu contraseña a tu correo electrónico."
          : "A password reset link has been sent to your email address."
      );
      setForgotPasswordEmail('');
      setAuthMode('login');
    } catch (err) {
      console.error(err);
      alert(
        lang === 'es'
          ? `Error al enviar el correo: ${err.message}`
          : `Error sending email: ${err.message}`
      );
    }
    setIsSendingForgotPassword(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    const sanitizedUsername = usernameInput.trim().toLowerCase();
    const sanitizedNick = nickInput.trim();
    const realEmail = emailInput.trim();
    
    if (!sanitizedUsername || !sanitizedNick || !passwordInput || !realEmail || !locationInput) {
      alert(lang === 'es' ? "Completa todo el formulario." : "Please fill out the entire form.");
      return;
    }
    if (passwordInput !== confirmPasswordInput) {
      alert(lang === 'es' ? "Las contraseñas no coinciden." : "Passwords do not match.");
      return;
    }

    setIsSubmittingAuth(true);
    try {
      const qUser = query(collection(db, "players"), where("username", "==", sanitizedUsername));
      const qSnap = await getDocs(qUser);
      if (!qSnap.empty) {
        alert(lang === 'es' ? "El usuario ya existe." : "Username already exists.");
        setIsSubmittingAuth(false);
        return;
      }

      // Crear usuario en Firebase Auth con email real
      const cred = await createUserWithEmailAndPassword(auth, realEmail, passwordInput);

      // Enviar correo de verificación
      try {
        await sendEmailVerification(cred.user);
      } catch (verifErr) {
        console.error("Failed to send email verification:", verifErr);
      }

      const isMatias = sanitizedUsername === 'matias';
      const newProfile = {
        username: sanitizedUsername,
        name: sanitizedNick,
        email: realEmail,
        phone: phoneInput.trim(),
        location: locationInput.trim(),
        status: 'approved',
        isAdmin: isMatias || ADMIN_USERNAMES.includes(sanitizedUsername),
        isSuperAdmin: isMatias,
        points: 0,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        vpScored: 0,
        vpConceded: 0,
        leadersKilled: 0,
        leadersLost: 0,
        emailNotifications: true,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, "players", cred.user.uid), newProfile);
      setProfile(newProfile);
      setIsAdmin(newProfile.isAdmin);

      setUsernameInput('');
      setNickInput('');
      setPasswordInput('');
      setConfirmPasswordInput('');
      setEmailInput('');
      setPhoneInput('');
      setLocationInput('');
      setIsAuthModalOpen(false);
      alert(
        lang === 'es'
          ? "Registro exitoso. Se ha enviado un correo de verificación a tu email. ⚠️ Revisa tu carpeta de SPAM si no lo ves en tu bandeja de entrada (remitente: noreply@mesbg-liga.firebaseapp.com). Verifica tu cuenta para unirte a las ligas."
          : "Registration successful. A verification email has been sent. ⚠️ Check your SPAM folder if you don't see it in your inbox (sender: noreply@mesbg-liga.firebaseapp.com). Please verify your account to join leagues."
      );
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use' || err.message?.includes('email-already-in-use')) {
        alert(
          lang === 'es'
            ? "El correo electrónico ya se encuentra en uso por otra cuenta."
            : "The email address is already in use by another account."
        );
      } else {
        alert(lang === 'es' ? `Error al registrar: ${err.message}` : `Registration error: ${err.message}`);
      }
    }
    setIsSubmittingAuth(false);
  };

  // Google Sign-In: si ya tiene perfil → login directo, si no → mostrar mini-formulario
  const handleGoogleSignIn = async () => {
    setIsSubmittingAuth(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const gUser = result.user;

      // Check if profile already exists in Firestore
      const docRef = doc(db, 'players', gUser.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        // Profile exists → login complete
        setIsAuthModalOpen(false);
      } else {
        // No profile → show completion form
        setGoogleUser(gUser);
        setEmailInput(gUser.email || '');
        setNickInput(gUser.displayName || '');
        setAuthMode('google_complete');
      }
    } catch (err) {
      console.error("Google sign-in error:", err);
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        alert(lang === 'es' ? `Error al iniciar con Google: ${err.message}` : `Google sign-in error: ${err.message}`);
      }
    }
    setIsSubmittingAuth(false);
  };

  // Completar registro de usuario que entró con Google (solo pide datos faltantes)
  const handleGoogleComplete = async (e) => {
    e.preventDefault();
    const sanitizedUsername = usernameInput.trim().toLowerCase();
    const sanitizedNick = nickInput.trim();

    if (!sanitizedUsername || !sanitizedNick || !locationInput.trim()) {
      alert(lang === 'es' ? "Completa todos los campos obligatorios." : "Please fill out all required fields.");
      return;
    }

    setIsSubmittingAuth(true);
    try {
      // Check username uniqueness
      const qUser = query(collection(db, "players"), where("username", "==", sanitizedUsername));
      const qSnap = await getDocs(qUser);
      if (!qSnap.empty) {
        alert(lang === 'es' ? "El usuario ya existe." : "Username already exists.");
        setIsSubmittingAuth(false);
        return;
      }

      const currentUser = googleUser || auth.currentUser;
      if (!currentUser) {
        alert(lang === 'es' ? "Error: sesión expirada. Intenta de nuevo." : "Error: session expired. Try again.");
        setIsSubmittingAuth(false);
        return;
      }

      const isMatias = sanitizedUsername === 'matias';
      const newProfile = {
        username: sanitizedUsername,
        name: sanitizedNick,
        email: currentUser.email || emailInput.trim(),
        phone: phoneInput.trim(),
        location: locationInput.trim(),
        status: 'approved',
        isAdmin: isMatias || ADMIN_USERNAMES.includes(sanitizedUsername),
        isSuperAdmin: isMatias,
        points: 0,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        vpScored: 0,
        vpConceded: 0,
        leadersKilled: 0,
        leadersLost: 0,
        emailNotifications: true,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, "players", currentUser.uid), newProfile);
      setProfile(newProfile);
      setIsAdmin(newProfile.isAdmin);

      setUsernameInput('');
      setNickInput('');
      setEmailInput('');
      setPhoneInput('');
      setLocationInput('');
      setGoogleUser(null);
      setIsAuthModalOpen(false);
      alert(
        lang === 'es'
          ? "¡Registro exitoso! Tu cuenta de Google ha sido vinculada."
          : "Registration successful! Your Google account has been linked."
      );
    } catch (err) {
      console.error(err);
      alert(lang === 'es' ? `Error al completar registro: ${err.message}` : `Registration error: ${err.message}`);
    }
    setIsSubmittingAuth(false);
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsAuthModalOpen(false);
  };

  const handleDeleteOwnAccount = async () => {
    const confirmMsg = lang === 'es'
      ? "¿Estás completamente seguro de que deseas eliminar tu cuenta? Esta acción es definitiva, borrará tu perfil y estadísticas de jugador y no se puede deshacer."
      : "Are you completely sure you want to delete your account? This action is permanent, will delete your player profile and statistics, and cannot be undone.";
      
    showConfirm(confirmMsg, async () => {
      if (!auth.currentUser) return;
      setIsUpdatingAccount(true);
      const uid = auth.currentUser.uid;
      
      try {
        // 1. Delete Firebase Auth user FIRST (requires recent login)
        // If this fails, nothing gets deleted (safe rollback)
        await deleteUser(auth.currentUser);
        
        // 2. Delete player document in Firestore (Auth user is already gone)
        const docRef = doc(db, 'players', uid);
        try {
          await deleteDoc(docRef);
        } catch (firestoreErr) {
          console.warn("Auth deleted but Firestore doc cleanup failed:", firestoreErr.message);
          // Auth user is already gone, so the email is freed up
          // The orphan Firestore doc will be ignored since no Auth user matches
        }
        
        // 3. Clear local states
        setUser(null);
        setProfile(null);
        setIsAdmin(false);
        setIsAuthModalOpen(false);
        
        showAlert(
          lang === 'es'
            ? "Tu cuenta ha sido eliminada correctamente. ¡Lamentamos verte partir!"
            : "Your account has been successfully deleted. We are sorry to see you go!"
        );
      } catch (err) {
        console.error("Error deleting account:", err);
        if (err.code === 'auth/requires-recent-login') {
          showAlert(
            lang === 'es'
              ? "Por motivos de seguridad, para eliminar tu cuenta debes cerrar sesión y volver a iniciarla recientemente."
              : "For security reasons, you must log out and log back in recently to delete your account."
          );
        } else {
          showAlert(
            lang === 'es'
              ? `Error al eliminar la cuenta: ${err.message}`
              : `Error deleting account: ${err.message}`
          );
        }
      } finally {
        setIsUpdatingAccount(false);
      }
    });
  };


  // Obtener diccionario activo
  const t = translations[lang] || translations['es'];

  // Renderizar la vista activa (pasando los datos de sesión globales a la vista de Liga)
  const renderActiveView = () => {
    switch (currentView) {
      case 'home':
        return (
          <Home 
            setView={setView} 
            onOpenAbout={() => setIsAboutOpen(true)}
            onOpenLegal={() => setIsLegalOpen(true)}
            onOpenBugReport={() => setIsBugReportOpen(true)}
            onShareApp={handleShareApp}
            lang={lang} 
            translations={translations}
            user={user}
            profile={profile}
            onOpenAuthModal={() => {
              setAuthMode('login');
              setIsAuthModalOpen(true);
            }}
          />
        );
      case 'calculator':
        return <Calculator lang={lang} translations={translations} />;
      case 'missions':
        return <Missions lang={lang} translations={translations} setLang={setLang} setView={setView} />;
      case 'calendar':
        return <Calendar lang={lang} translations={translations} />;
      case 'league':
        return (
          <League 
            lang={lang} 
            translations={translations} 
            user={user}
            profile={profile}
            isAdmin={isAdmin}
            authLoading={authLoading}
            initialLeagueId={initialLeagueId}
            onOpenAuthModal={() => {
              setAuthMode('login');
              setIsAuthModalOpen(true);
            }}
            onStartChat={handleStartChat}
          />
        );
      case 'army':
        return (
          <ArmyBuilder
            lang={lang}
            user={user}
            profile={profile}
            setView={setView}
          />
        );
      case 'duels':
        return (
          <Duels
            lang={lang}
            user={user}
            profile={profile}
            setView={setView}
          />
        );
      case 'mods':
        return (
          <Mods
            lang={lang}
            user={user}
            profile={profile}
          />
        );
      default:
        return (
          <Home 
            setView={setView} 
            onOpenAbout={() => setIsAboutOpen(true)}
            onOpenLegal={() => setIsLegalOpen(true)}
            onOpenBugReport={() => setIsBugReportOpen(true)}
            onShareApp={handleShareApp}
            lang={lang} 
            translations={translations}
            user={user}
            profile={profile}
            onOpenAuthModal={() => {
              setAuthMode('login');
              setIsAuthModalOpen(true);
            }}
          />
        );
    }
  };

  return (
    <div className="app-container">
      {/* Encabezado Fijo superior */}
      <header className="app-header">
        <div 
          className="logo-container" 
          onClick={() => setView('home')} 
          style={{ cursor: 'pointer' }}
        >
          <img 
            src={logoImg} 
            alt="La Cuchara de Lobelia" 
          />
        </div>

        <div className="youtube-header-center">
          <a 
            href="https://www.youtube.com/@CucharadeLobelia" 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" style={{ fill: '#ff0000', display: 'inline-block', verticalAlign: 'middle' }}>
              <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.108C19.524 3.545 12 3.545 12 3.545s-7.525 0-9.387.51A3.003 3.003 0 0 0 .502 6.163C0 8.07 0 12 0 12s0 3.93.502 5.837a3.003 3.003 0 0 0 2.11 2.108c1.862.51 9.387.51 9.387.51s7.525 0 9.387-.51a3.003 3.003 0 0 0 2.11-2.108C24 15.93 24 12 24 12s0-3.93-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
            <span style={{ verticalAlign: 'middle', marginLeft: '6px' }}>YouTube</span>
          </a>
        </div>
        
        <div className="header-controls">
          {/* Botón de Mensajería Privada (PM) */}
          {user && (() => {
            const totalUnread = unreadCount + (isAdmin ? unreadBugReportsCount : 0);
            return (
              <button 
                className={`lang-btn ${isChatModalOpen ? 'active' : ''}`}
                onClick={() => {
                  setActiveChat(null);
                  setIsChatModalOpen(true);
                }}
                aria-label={lang === 'es' ? "Mensajes Privados" : "Private Messages"}
                style={{ fontSize: '1.1rem', background: 'rgba(255, 255, 255, 0.05)', position: 'relative' }}
              >
                ✉️
                {totalUnread > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    background: 'var(--danger-color)',
                    color: '#fff',
                    fontSize: '0.62rem',
                    fontWeight: 'bold',
                    borderRadius: '50%',
                    width: '16px',
                    height: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #000'
                  }}>
                    {totalUnread}
                  </span>
                )}
              </button>
            );
          })()}

          {/* Botón de Perfil / Iniciar Sesión Global */}
          {authLoading ? (
            <div style={{ width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>...</div>
          ) : (
            <button 
              className={`lang-btn ${isAuthModalOpen ? 'active' : ''}`}
              onClick={() => setIsAuthModalOpen(true)}
              aria-label={lang === 'es' ? "Perfil y cuenta de jugador" : "User profile and account"}
              style={{ fontSize: '1.1rem', background: 'rgba(255, 255, 255, 0.05)' }}
            >
              {user ? (profile?.alignment === 'luz' ? '☀️' : '👁️') : '👤'}
            </button>
          )}

          {/* Botón Compartir App (Icono oficial de nodos/círculos de compartir) */}
          <button 
            className="lang-btn"
            onClick={handleShareApp}
            aria-label={lang === 'es' ? 'Compartir aplicación' : 'Share application'}
            title={lang === 'es' ? 'Compartir app' : 'Share app'}
            style={{ background: 'rgba(203, 161, 53, 0.12)', borderColor: 'rgba(203, 161, 53, 0.4)', color: 'var(--gold-primary)' }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ display: 'block' }}>
              <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
            </svg>
          </button>

          {/* Selector de Idioma Unificado (Toggle ES / EN) */}
          <button 
            className="lang-btn active"
            onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            aria-label={lang === 'es' ? 'Cambiar a Inglés' : 'Switch to Spanish'}
            title={lang === 'es' ? 'Idioma: Español (Clic para Inglés)' : 'Language: English (Click for Spanish)'}
          >
            <img 
              src={lang === 'es' ? 'https://flagcdn.com/w20/es.png' : 'https://flagcdn.com/w20/gb.png'} 
              alt={lang === 'es' ? 'Español' : 'English'} 
            />
          </button>
        </div>
      </header>

      {/* Banner de Anuncio Global */}
      {globalConfig?.announcementEnabled && (globalConfig.announcementTextEs || globalConfig.announcementTextEn) && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(203, 161, 53, 0.2), rgba(168, 98, 33, 0.3), rgba(203, 161, 53, 0.2))',
          borderBottom: '1px solid var(--gold-primary)',
          padding: '8px 16px',
          textAlign: 'center',
          fontSize: '0.84rem',
          fontWeight: 'bold',
          color: '#f3e8ce',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          letterSpacing: '0.3px'
        }}>
          <span style={{ fontSize: '1rem' }}>📢</span>
          <span>{lang === 'es' ? (globalConfig.announcementTextEs || globalConfig.announcementTextEn) : (globalConfig.announcementTextEn || globalConfig.announcementTextEs)}</span>
        </div>
      )}

      {/* Renderizado de la vista principal del enrutador */}
      {user && !user.emailVerified && (
        <div className="glass-card" style={{
          background: 'rgba(247, 169, 59, 0.1)',
          border: '1px solid var(--warning-color)',
          borderRadius: '8px',
          padding: '14px',
          marginBottom: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          alignItems: 'center',
          textAlign: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warning-color)', fontWeight: 'bold', fontSize: '0.92rem' }}>
            <span>⚠️</span>
            <span>{lang === 'es' ? "Correo electrónico no verificado" : "Email address not verified"}</span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
            {lang === 'es'
              ? "Debes verificar tu correo electrónico para poder inscribirte a ligas o crear tus propias ligas. Revisa tu bandeja de entrada."
              : "You must verify your email address to join or create leagues. Please check your inbox."}
          </p>
          <div style={{ display: 'flex', gap: '8px', width: '100%', justifyContent: 'center' }}>
            <button 
              className="btn btn-small"
              onClick={handleRefreshVerification}
              style={{
                background: 'var(--gold-primary)',
                color: '#000',
                border: 'none',
                minHeight: '28px',
                fontSize: '0.75rem',
                flex: '1',
                maxWidth: '180px',
                cursor: 'pointer'
              }}
            >
              🔄 {lang === 'es' ? "Ya lo verifiqué" : "I verified it"}
            </button>
            <button 
              className="btn btn-small"
              onClick={handleResendVerification}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#fff',
                border: 'var(--border-glass)',
                minHeight: '28px',
                fontSize: '0.75rem',
                flex: '1',
                maxWidth: '180px',
                cursor: 'pointer'
              }}
            >
              ✉️ {lang === 'es' ? "Reenviar correo" : "Resend email"}
            </button>
          </div>
        </div>
      )}

      <main role="main" aria-label="Contenido Principal">
        {renderActiveView()}
      </main>

      {/* ── FOOTER PERMANENTE CON DESCARGO FAN PROJECT (USO NOMINATIVO) ── */}
      <footer style={{
        marginTop: 'auto',
        padding: '24px 16px 32px 16px',
        textAlign: 'center',
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => setIsLegalOpen(true)}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
          >
            ⚖️ {lang === 'es' ? 'Aviso Legal, Privacidad & RGPD' : 'Legal Notice & Privacy'}
          </button>
          <span>•</span>
          <button
            type="button"
            onClick={() => setIsAboutOpen(true)}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
          >
            🥄 {t.about_title}
          </button>
        </div>
        <p style={{ margin: 0, maxWidth: '720px', lineHeight: '1.45', opacity: 0.8 }}>
          {lang === 'es'
            ? 'La Cuchara de Lobelia es un motor neutral y herramienta comunitaria independiente y no oficial. No está vinculada, aprobada, patrocinada ni asociada con Games Workshop Limited ni Middle-earth Enterprises. Todas las marcas registradas pertenecen a sus respectivos titulares y se citan exclusivamente con fines descriptivos e identificativos.'
            : 'La Cuchara de Lobelia is an independent unofficial community tool. It is not affiliated with, endorsed, sponsored, or specifically approved by Games Workshop Limited or Middle-earth Enterprises. All trademarks belong to their respective owners.'}
        </p>
      </footer>

      {/* ── BANNER DE CONSENTIMIENTO DE ANALÍTICA (RGPD & LSSI-CE) ── */}
      {analyticsConsent === null && (
        <div style={{
          position: 'fixed',
          bottom: '16px',
          left: '12px',
          right: '12px',
          maxWidth: '560px',
          margin: '0 auto',
          background: 'rgba(18, 22, 19, 0.96)',
          border: '1px solid var(--gold-primary)',
          borderRadius: '12px',
          padding: '14px 16px',
          zIndex: 99999,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>🛡️</span>
            <strong style={{ color: 'var(--gold-primary)', fontSize: '0.88rem' }}>
              {lang === 'es' ? 'Privacidad y Almacenamiento Técnico' : 'Privacy & Technical Storage'}
            </strong>
          </div>
          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
            {lang === 'es'
              ? 'Utilizamos almacenamiento técnico estrictamente necesario para el funcionamiento de la app. Opcionalmente, ¿nos permites recopilar estadísticas anónimas de uso para mejorar la herramienta conforme al RGPD?'
              : 'We use strictly necessary technical storage for app functionality. Optionally, do you allow us to collect anonymous usage stats under GDPR to improve the tool?'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setIsLegalOpen(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '0.74rem',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: '4px 8px',
                marginRight: 'auto'
              }}
            >
              {lang === 'es' ? 'Más información' : 'Learn more'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAnalyticsConsent('denied');
                setAnalyticsConsentState('denied');
              }}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'var(--text-secondary)',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '0.76rem',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              {lang === 'es' ? 'Solo Esenciales' : 'Essential Only'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAnalyticsConsent('granted');
                setAnalyticsConsentState('granted');
              }}
              style={{
                background: 'var(--gold-primary)',
                border: 'none',
                color: '#111',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '0.76rem',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              {lang === 'es' ? 'Aceptar Analítica' : 'Accept Analytics'}
            </button>
          </div>
        </div>
      )}

      {/* Modal Acerca De */}
      <Modal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        title={t.about_title}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'center' }}>
          <span style={{ fontSize: '3rem' }}>🥄</span>
          <div style={{ fontSize: '0.8rem', color: 'var(--gold-primary)', fontWeight: 'bold', letterSpacing: '0.08em' }}>
            LA CUCHARA DE LOBELIA • v3.0.1
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: '1.6' }}>
            {t.about_body}
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => { setIsAboutOpen(false); setIsLegalOpen(true); }}
            style={{ marginTop: '8px', fontSize: '0.78rem', alignSelf: 'center' }}
          >
            ⚖️ {lang === 'es' ? 'Aviso Legal, Privacidad & Cookies' : 'Legal Notice, Privacy & Cookies'}
          </button>
        </div>
      </Modal>

      {/* Modal Aviso Legal, Privacidad, Cookies & IA (Cumplimiento UE 2024/1689 + RGPD + LSSI) */}
      <Modal
        isOpen={isLegalOpen}
        onClose={() => setIsLegalOpen(false)}
        title={lang === 'es' ? "Aviso Legal, Privacidad & Cookies" : "Legal Notice, Privacy & Cookies"}
        size="large"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: '1.55', textAlign: 'left' }}>
          
          {/* Sección 1: Inteligencia Artificial (AI Act) */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(203, 161, 53, 0.3)', borderRadius: '10px', padding: '12px' }}>
            <h4 style={{ margin: '0 0 6px 0', color: 'var(--gold-primary)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem', fontFamily: 'var(--font-title)' }}>
              <span>🤖</span>
              <span>{lang === 'es' ? 'Transparencia en Inteligencia Artificial (Reglamento UE 2024/1689)' : 'AI Transparency (EU AI Act)'}</span>
            </h4>
            <p style={{ margin: '0 0 6px 0' }}>
              {lang === 'es'
                ? 'El asistente de reglas "Lobelia: Tu referí de confianza" es una herramienta consultiva automatizada basada en modelos de lenguaje artificial (Google Gemini API). Opera analizando los datos proporcionados por el mod de reglas activo instalado por el usuario en su navegador.'
                : 'The rules assistant "Lobelia: Your Trusted Referee" is an automated advisory tool powered by artificial intelligence models (Google Gemini API). It parses user-installed rules mods in the browser.'}
            </p>
            <p style={{ margin: '0 0 6px 0' }}>
              {lang === 'es'
                ? '• Notas de Voz (Audio): El audio grabado por el usuario se transmite de forma cifrada y efímera a la API únicamente para su transcripción y resolución técnica de la duda. No se almacena permanentemente en servidores ni se usa para entrenamiento.'
                : '• Voice Notes (Audio): Audio recorded by the user is transmitted in an encrypted and ephemeral manner to the API solely for transcription and rule resolution. It is not permanently stored nor used for training.'}
            </p>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {lang === 'es'
                ? '⚖️ En torneos o partidas competitivas, las respuestas de la IA son meramente orientativas. La decisión final vinculante siempre corresponde al árbitro u organizador humano del evento.'
                : '⚖️ In official tournaments or competitive games, AI responses are purely advisory. The human tournament referee holds final authority.'}
            </p>
          </div>

          {/* Sección 2: Protección de Datos (RGPD) */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px' }}>
            <h4 style={{ margin: '0 0 6px 0', color: 'var(--gold-primary)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem', fontFamily: 'var(--font-title)' }}>
              <span>🛡️</span>
              <span>{lang === 'es' ? 'Protección de Datos (RGPD & LOPDGDD 3/2018)' : 'Data Protection (GDPR)'}</span>
            </h4>
            <p style={{ margin: '0 0 4px 0' }}>
              {lang === 'es'
                ? '• Responsable: Proyecto lúdico y comunitario independiente "La Cuchara de Lobelia".'
                : '• Controller: Independent fan community project "La Cuchara de Lobelia".'}
            </p>
            <p style={{ margin: '0 0 4px 0' }}>
              {lang === 'es'
                ? '• Datos tratados: Nombre de usuario/apodo, correo electrónico (Firebase Auth), bando de juego preferido y estadísticas voluntarias de partidas de liga.'
                : '• Processed data: Nickname, email (Firebase Auth), preferred gaming alignment, and voluntary league match stats.'}
            </p>
            <p style={{ margin: '0 0 4px 0' }}>
              {lang === 'es'
                ? '• Encargados del tratamiento: Google Firebase (almacenamiento de base de datos Firestore y autenticación) y GitHub Pages (alojamiento web).'
                : '• Processors: Google Firebase (Firestore database & auth) and GitHub Pages (hosting).'}
            </p>
            <p style={{ margin: 0 }}>
              {lang === 'es'
                ? '• Derechos del usuario: Tienes derecho de acceso, rectificación, portabilidad y supresión de tu cuenta en cualquier momento desde tu Perfil de Jugador.'
                : '• User rights: You may edit your data or request deletion of your account at any time from your Player Profile.'}
            </p>
          </div>

          {/* Sección 3: Cookies y Almacenamiento Técnico */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px' }}>
            <h4 style={{ margin: '0 0 6px 0', color: 'var(--gold-primary)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem', fontFamily: 'var(--font-title)' }}>
              <span>🍪</span>
              <span>{lang === 'es' ? 'Cookies y Almacenamiento Local (LSSI-CE)' : 'Cookies & Local Storage (LSSI-CE)'}</span>
            </h4>
            <p style={{ margin: '0 0 6px 0' }}>
              {lang === 'es'
                ? 'Esta aplicación no utiliza cookies publicitarias ni de terceros con fines comerciales. Se utiliza almacenamiento técnico esencial (localStorage e IndexedDB) para mantener tu sesión, recordar tu idioma y guardar tus mods instalados localmente en tu navegador.'
                : 'This application does not use commercial advertising cookies. Strictly necessary technical storage (localStorage and IndexedDB) is used for sessions, preferences, and offline mod storage.'}
            </p>
            <ul style={{ margin: '0 0 4px 0', paddingLeft: '20px', fontSize: '0.78rem' }}>
              <li><strong>firebase:authUser</strong>: {lang === 'es' ? 'Mantiene abierta tu sesión autenticada.' : 'Keeps your authenticated session open.'}</li>
              <li><strong>lobelia_lang</strong>: {lang === 'es' ? 'Recuerda tu idioma de preferencia.' : 'Remembers your language preference.'}</li>
              <li><strong>lobelia_analytics_consent</strong>: {lang === 'es' ? 'Almacena tu preferencia de consentimiento RGPD.' : 'Stores your GDPR consent preference.'}</li>
            </ul>
          </div>

          {/* Sección 4: Propiedad Intelectual */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px' }}>
            <h4 style={{ margin: '0 0 6px 0', color: 'var(--gold-primary)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem', fontFamily: 'var(--font-title)' }}>
              <span>⚔️</span>
              <span>{lang === 'es' ? 'Propiedad Intelectual & Descargo Fan Project' : 'Intellectual Property & Fan Project Disclaimer'}</span>
            </h4>
            <p style={{ margin: 0, fontSize: '0.76rem' }}>
              {lang === 'es'
                ? 'La Cuchara de Lobelia es una aplicación web comunitaria independiente y no oficial. No está vinculada, aprobada, patrocinada ni asociada con Games Workshop Limited ni Middle-earth Enterprises. Todas las marcas registradas pertenecen a sus respectivos titulares y se citan exclusivamente con fines descriptivos e identificativos bajo los límites del uso nominativo.'
                : 'La Cuchara de Lobelia is an independent unofficial community tool. It is not affiliated with, endorsed, sponsored, or specifically approved by Games Workshop Limited or Middle-earth Enterprises. All trademarks belong to their respective owners.'}
            </p>
          </div>

        </div>
      </Modal>

      {/* Modal de Autenticación / Perfil Global */}
      <Modal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        title={user ? (lang === 'es' ? "Perfil de Jugador" : "Player Profile") : (lang === 'es' ? "Acceso de Jugador" : "Player Access")}
      >
        {user ? (
          /* VISTA: PERFIL LOGUEADO */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Header con foto y nombre */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
              <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: 'var(--gold-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', color: '#000' }}>
                👤
              </div>
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>{profile?.name || user.email.split('@')[0]}</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>@{profile?.username}</span>
              </div>
            </div>

            {/* Menú de pestañas de navegación */}
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px', gap: '8px' }}>
              <button 
                type="button"
                onClick={() => setProfileTab('view')}
                style={{
                  background: profileTab === 'view' ? 'var(--gold-primary)' : 'transparent',
                  color: profileTab === 'view' ? '#000' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {lang === 'es' ? 'Mis Datos' : 'My Info'}
              </button>
              <button 
                type="button"
                onClick={() => setProfileTab('edit_profile')}
                style={{
                  background: profileTab === 'edit_profile' ? 'var(--gold-primary)' : 'transparent',
                  color: profileTab === 'edit_profile' ? '#000' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {lang === 'es' ? 'Editar Perfil' : 'Edit Profile'}
              </button>
              <button 
                type="button"
                onClick={() => setProfileTab('change_password')}
                style={{
                  background: profileTab === 'change_password' ? 'var(--gold-primary)' : 'transparent',
                  color: profileTab === 'change_password' ? '#000' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {lang === 'es' ? 'Contraseña' : 'Password'}
              </button>
              {isAdmin && (
                <>
                  <button 
                    type="button"
                    onClick={() => setProfileTab('admin_analytics')}
                    style={{
                      background: profileTab === 'admin_analytics' ? 'var(--gold-primary)' : 'transparent',
                      color: profileTab === 'admin_analytics' ? '#000' : 'var(--text-secondary)',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '0.78rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    📊 {lang === 'es' ? 'Analíticas' : 'Analytics'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setProfileTab('admin_users')}
                    style={{
                      background: profileTab === 'admin_users' ? 'var(--gold-primary)' : 'transparent',
                      color: profileTab === 'admin_users' ? '#000' : 'var(--text-secondary)',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '0.78rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    👥 {lang === 'es' ? 'Usuarios' : 'Users'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setProfileTab('admin_config')}
                    style={{
                      background: profileTab === 'admin_config' ? 'var(--gold-primary)' : 'transparent',
                      color: profileTab === 'admin_config' ? '#000' : 'var(--text-secondary)',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '0.78rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    ⚙️ AppConfig
                  </button>
                </>
              )}
            </div>

            {/* Contenido Condicional */}
            {profileTab === 'view' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px', border: 'var(--border-glass)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div><strong>{lang === 'es' ? 'Nick / Nombre Público:' : 'Nick / Display Name:'}</strong> {profile?.name}</div>
                  <div><strong>{lang === 'es' ? 'Nombre de Usuario:' : 'Username:'}</strong> @{profile?.username}</div>
                  <div><strong>{lang === 'es' ? 'Email:' : 'Email:'}</strong> {profile?.email}</div>
                  <div><strong>{lang === 'es' ? 'País - Ciudad:' : 'Country - City:'}</strong> {profile?.location || (lang === 'es' ? 'No especificado' : 'Not specified')}</div>
                  <div><strong>{lang === 'es' ? 'Teléfono:' : 'Phone:'}</strong> {profile?.phone || (lang === 'es' ? 'No proporcionado' : 'Not provided')}</div>
                  <div><strong>{lang === 'es' ? 'Notificaciones por Correo:' : 'Email Notifications:'}</strong> {profile?.emailNotifications !== false ? (lang === 'es' ? 'Activadas 🔔' : 'Enabled 🔔') : (lang === 'es' ? 'Desactivadas 🔕' : 'Disabled 🔕')}</div>
                  <div>
                    <strong>{lang === 'es' ? 'Verificación de Correo:' : 'Email Verification:'}</strong>{' '}
                    <span style={{ color: user?.emailVerified ? 'var(--success-color)' : 'var(--warning-color)' }}>
                      {user?.emailVerified 
                        ? (lang === 'es' ? 'Verificado ✔' : 'Verified ✔') 
                        : (lang === 'es' ? 'Pendiente ⏳' : 'Pending ⏳')}
                    </span>
                    {!user?.emailVerified && (
                      <button 
                        type="button"
                        onClick={handleResendVerification}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--gold-primary)',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          fontSize: '0.75rem',
                          marginLeft: '8px'
                        }}
                      >
                        ({lang === 'es' ? 'Reenviar' : 'Resend'})
                      </button>
                    )}
                  </div>
                </div>

                <button 
                  type="button" 
                  className="btn btn-small" 
                  onClick={handleLogout} 
                  style={{ width: '100%', marginTop: '8px', background: 'rgba(255, 255, 255, 0.05)', color: '#fff', border: 'var(--border-glass)' }}
                >
                  {lang === 'es' ? 'Cerrar Sesión' : 'Logout'}
                </button>

                {/* Separador y opción de eliminación de cuenta (RGPD) */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '16px', paddingTop: '12px', textAlign: 'center' }}>
                  <button 
                    type="button" 
                    onClick={handleDeleteOwnAccount}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ff6b6b',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      textDecoration: 'underline',
                      padding: '4px 8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    ⚠️ {lang === 'es' ? 'Eliminar mi cuenta' : 'Delete my account'}
                  </button>
                </div>
              </div>
            )}

            {profileTab === 'edit_profile' && (
              <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nick / Nombre Público:' : 'Nick / Display Name:'}</label>
                  <input 
                    type="text" value={editNickInput} onChange={(e) => setEditNickInput(e.target.value)} required
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Email:' : 'Email:'}</label>
                  <input 
                    type="email" value={editEmailInput} onChange={(e) => setEditEmailInput(e.target.value)} required
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }}
                  />
                  {editEmailInput.toLowerCase() !== profile?.email?.toLowerCase() && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--warning-color)', marginTop: '2px' }}>
                      ⚠️ {lang === 'es' ? 'El cambio de email requerirá volver a verificar tu cuenta.' : 'Changing your email will require re-verifying your account.'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Teléfono (WhatsApp):' : 'Phone (WhatsApp):'}</label>
                  <input 
                    type="tel" value={editPhoneInput} onChange={(e) => setEditPhoneInput(e.target.value)}
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'País - Ciudad:' : 'Country - City:'}</label>
                  <input 
                    type="text" value={editLocationInput} onChange={(e) => setEditLocationInput(e.target.value)} required
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button type="submit" className="btn btn-primary" disabled={isUpdatingAccount} style={{ flex: 1 }}>
                    {isUpdatingAccount ? (lang === 'es' ? 'Guardando...' : 'Saving...') : (lang === 'es' ? 'Guardar Cambios' : 'Save Changes')}
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => setProfileTab('view')} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: '#fff', border: 'var(--border-glass)' }}>
                    {lang === 'es' ? 'Cancelar' : 'Cancel'}
                  </button>
                </div>
              </form>
            )}

            {profileTab === 'change_password' && (
              <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '4px' }}>
                  {lang === 'es' ? 'Actualiza la contraseña de tu cuenta.' : 'Update your account password.'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nueva Contraseña:' : 'New Password:'}</label>
                  <input 
                    type="password" value={newPasswordInput} onChange={(e) => setNewPasswordInput(e.target.value)} placeholder="******" required minLength="6"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Repetir Contraseña:' : 'Confirm Password:'}</label>
                  <input 
                    type="password" value={confirmNewPasswordInput} onChange={(e) => setConfirmNewPasswordInput(e.target.value)} placeholder="******" required minLength="6"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button type="submit" className="btn btn-primary" disabled={isUpdatingAccount} style={{ flex: 1 }}>
                    {isUpdatingAccount ? (lang === 'es' ? 'Actualizando...' : 'Updating...') : (lang === 'es' ? 'Cambiar Contraseña' : 'Change Password')}
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => setProfileTab('view')} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: '#fff', border: 'var(--border-glass)' }}>
                    {lang === 'es' ? 'Cancelar' : 'Cancel'}
                  </button>
                </div>
              </form>
            )}

            {profileTab === 'admin_analytics' && isAdmin && (
              <AnalyticsDashboard
                lang={lang}
                showAlert={showAlert}
                showConfirm={showConfirm}
              />
            )}

            {profileTab === 'admin_users' && isAdmin && (
              <UserManagement 
                lang={lang} 
                currentUserId={user.uid}
                currentUsername={profile?.username}
                showAlert={showAlert}
                showConfirm={showConfirm}
              />
            )}

            {profileTab === 'admin_config' && isAdmin && (
              <AppConfig
                lang={lang}
                showAlert={showAlert}
                showConfirm={showConfirm}
                currentUser={user}
                profile={profile}
              />
            )}
          </div>
        ) : (
          /* VISTA: LOGOUT - FORMULARIOS LOGIN/REGISTRO */
          <div>
            {authMode === 'login' ? (
              /* FORMULARIO LOGIN */
              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '8px' }}>
                  {lang === 'es' ? 'Ingresa tus credenciales para unirte a ligas o cargar tus resultados.' : 'Enter your credentials to join leagues or report match scores.'}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nombre de Usuario:' : 'Username:'}</label>
                  <input 
                    type="text" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} placeholder={lang === 'es' ? "Ej. frodo88" : "e.g. frodo88"}
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '12px', outline: 'none', fontSize: '0.9rem' }}
                    required
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Contraseña:' : 'Password:'}</label>
                  <input 
                    type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="******"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '12px', outline: 'none', fontSize: '0.9rem' }}
                    required
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-10px' }}>
                  <button type="button" onClick={() => setAuthMode('forgot_password')} style={{ background: 'transparent', border: 'none', color: 'var(--gold-primary)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.78rem' }}>
                    {lang === 'es' ? '¿Olvidaste tu contraseña?' : 'Forgot your password?'}
                  </button>
                </div>

                <button type="submit" className="btn btn-primary" disabled={isSubmittingAuth} style={{ marginTop: '6px' }}>
                  {isSubmittingAuth ? (lang === 'es' ? 'Entrando...' : 'Logging in...') : (lang === 'es' ? 'Iniciar Sesión' : 'Login')}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '4px 0' }}>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{lang === 'es' ? 'o' : 'or'}</span>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                </div>

                <button type="button" onClick={handleGoogleSignIn} disabled={isSubmittingAuth} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  background: '#fff', color: '#333', border: 'none', borderRadius: 'var(--radius-sm)',
                  padding: '12px', fontSize: '0.88rem', fontWeight: '600', cursor: 'pointer',
                  transition: 'opacity 0.2s', opacity: isSubmittingAuth ? 0.5 : 1
                }}>
                  <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                  {lang === 'es' ? 'Entrar con Google' : 'Sign in with Google'}
                </button>
                
                <button type="button" onClick={() => setAuthMode('register')} style={{ background: 'transparent', border: 'none', color: 'var(--gold-primary)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.82rem', alignSelf: 'center', marginTop: '4px' }}>
                  {lang === 'es' ? '¿No tienes cuenta? Regístrate aquí' : "Don't have an account? Register here"}
                </button>
              </form>
            ) : authMode === 'forgot_password' ? (
              /* FORMULARIO RECUPERAR CONTRASEÑA */
              <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '8px' }}>
                  {lang === 'es' ? 'Ingresa tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña.' : 'Enter your email address and we will send you a password reset link.'}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Correo Electrónico:' : 'Email Address:'}</label>
                  <input 
                    type="email" value={forgotPasswordEmail} onChange={(e) => setForgotPasswordEmail(e.target.value)} placeholder="frodo@shire.com"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '12px', outline: 'none', fontSize: '0.9rem' }}
                    required
                  />
                </div>

                <button type="submit" className="btn btn-primary" disabled={isSendingForgotPassword} style={{ marginTop: '6px' }}>
                  {isSendingForgotPassword ? (lang === 'es' ? 'Enviando...' : 'Sending...') : (lang === 'es' ? 'Enviar Enlace' : 'Send Link')}
                </button>
                
                <button type="button" onClick={() => setAuthMode('login')} style={{ background: 'transparent', border: 'none', color: 'var(--gold-primary)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.82rem', alignSelf: 'center', marginTop: '4px' }}>
                  {lang === 'es' ? 'Volver al Inicio de Sesión' : 'Back to Login'}
                </button>
              </form>
            ) : authMode === 'register' ? (
              /* FORMULARIO REGISTRO */
              <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '4px' }}>
                  {lang === 'es' ? 'Crea tu cuenta de jugador para ligas y torneos.' : 'Create your player account for leagues and tournaments.'}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nombre de Usuario (Login):' : 'Username (Login):'}</label>
                  <input type="text" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} placeholder="frodo88"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }} required
                  />
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {lang === 'es' ? '🔒 Privado: Nombre para iniciar sesión.' : '🔒 Private: Name used to sign in.'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nick / Nombre Público:' : 'Nick / Display Name:'}</label>
                  <input type="text" value={nickInput} onChange={(e) => setNickInput(e.target.value)} placeholder="Frodo"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }} required
                  />
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {lang === 'es' ? '🌍 Público: El nombre que verán los demás en las ligas.' : '🌍 Public: The name others will see in leagues.'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Email:' : 'Email:'}</label>
                  <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="frodo@shire.com"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }} required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Contraseña:' : 'Password:'}</label>
                    <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="******"
                      style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }} required
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Repetir Contraseña:' : 'Confirm Password:'}</label>
                    <input type="password" value={confirmPasswordInput} onChange={(e) => setConfirmPasswordInput(e.target.value)} placeholder="******"
                      style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }} required
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {lang === 'es' ? 'País - Ciudad:' : 'Country - City:'}
                  </label>
                  <input type="text" value={locationInput} onChange={(e) => setLocationInput(e.target.value)} placeholder={lang === 'es' ? "España - Madrid" : "Spain - Madrid"}
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }} required
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Teléfono (WhatsApp):' : 'Phone (WhatsApp):'}</label>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({lang === 'es' ? 'Opcional' : 'Optional'})</span>
                  </div>
                  <input type="tel" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder={lang === 'es' ? "Ej. +34 666 555 444" : "e.g. +34 666 555 444"}
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: '1.2' }}>
                    {lang === 'es' 
                      ? '💡 Opcional: Proporcionar tu WhatsApp ayuda a los organizadores a coordinar emparejamientos.' 
                      : '💡 Optional: Providing your WhatsApp helps organizers coordinate matches.'}
                  </span>
                </div>

                {/* Consentimiento RGPD / GDPR Checkbox */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '4px 0' }}>
                  <input 
                    type="checkbox" 
                    id="gdpr_consent" 
                    required 
                    style={{ marginTop: '3px', cursor: 'pointer' }}
                  />
                  <label htmlFor="gdpr_consent" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.35', cursor: 'pointer' }}>
                    {lang === 'es' 
                      ? 'Acepto el tratamiento de mis datos personales para la gestión lúdica conforme al RGPD y el uso de almacenamiento técnico (cookies/localStorage) esencial. ' 
                      : 'I consent to the processing of my personal data under GDPR and essential technical storage (cookies/localStorage). '}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsLegalOpen(true); }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--gold-primary)', textDecoration: 'underline', padding: 0, fontSize: '0.72rem', cursor: 'pointer' }}
                    >
                      {lang === 'es' ? 'Ver Aviso Legal, Privacidad y Cookies' : 'View Legal & Privacy Policy'}
                    </button>
                  </label>
                </div>

                {/* Descargo de Responsabilidad No Comercial de Games Workshop */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '4px',
                  padding: '8px',
                  fontSize: '0.68rem',
                  color: 'var(--text-muted)',
                  lineHeight: '1.3',
                  textAlign: 'justify'
                }}>
                  {lang === 'es'
                    ? '📢 Proyecto de Fans No Oficial: Esta aplicación es una herramienta gratuita creada por fans y no tiene fines comerciales. No está afiliada, autorizada ni respaldada por Games Workshop Limited, Middle-earth Enterprises ni los herederos de J.R.R. Tolkien. Todos los nombres, facciones y marcas registradas son propiedad de sus respectivos dueños.'
                    : '📢 Unofficial Fan Project: This application is a free tool created by fans and has no commercial purposes. It is not affiliated with, authorized, or endorsed by Games Workshop Limited, Middle-earth Enterprises, or the Tolkien Estate. All names, factions, and trademarks are the property of their respective owners.'}
                </div>

                <button type="submit" className="btn btn-primary" disabled={isSubmittingAuth} style={{ marginTop: '8px' }}>
                  {isSubmittingAuth ? (lang === 'es' ? 'Registrando...' : 'Registering...') : (lang === 'es' ? 'Crear Cuenta' : 'Create Account')}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '4px 0' }}>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{lang === 'es' ? 'o' : 'or'}</span>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                </div>

                <button type="button" onClick={handleGoogleSignIn} disabled={isSubmittingAuth} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  background: '#fff', color: '#333', border: 'none', borderRadius: 'var(--radius-sm)',
                  padding: '12px', fontSize: '0.88rem', fontWeight: '600', cursor: 'pointer',
                  transition: 'opacity 0.2s', opacity: isSubmittingAuth ? 0.5 : 1
                }}>
                  <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                  {lang === 'es' ? 'Registrarse con Google' : 'Sign up with Google'}
                </button>
                
                <button type="button" onClick={() => setAuthMode('login')} style={{ background: 'transparent', border: 'none', color: 'var(--gold-primary)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.82rem', alignSelf: 'center', marginTop: '4px' }}>
                  {lang === 'es' ? '¿Ya tienes cuenta? Inicia sesión' : 'Already have an account? Login'}
                </button>
              </form>
            ) : authMode === 'google_complete' ? (
              /* FORMULARIO COMPLETAR REGISTRO GOOGLE */
              <form onSubmit={handleGoogleComplete} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: 'rgba(66,133,244,0.08)', border: '1px solid rgba(66,133,244,0.2)', borderRadius: '8px' }}>
                  <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.8rem', color: '#fff' }}>{googleUser?.displayName || ''}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{googleUser?.email || ''}</span>
                  </div>
                </div>

                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '4px' }}>
                  {lang === 'es' ? '¡Casi listo! Completa estos datos para crear tu perfil de jugador.' : 'Almost there! Complete these details to create your player profile.'}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nombre de Usuario (Login):' : 'Username (Login):'}</label>
                  <input type="text" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} placeholder="frodo88"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }} required
                  />
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {lang === 'es' ? '🔒 Privado: Nombre único para tu perfil.' : '🔒 Private: Unique name for your profile.'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nick / Nombre Público:' : 'Nick / Display Name:'}</label>
                  <input type="text" value={nickInput} onChange={(e) => setNickInput(e.target.value)} placeholder="Frodo"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }} required
                  />
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {lang === 'es' ? '🌍 Público: El nombre que verán los demás.' : '🌍 Public: The name others will see.'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'País - Ciudad:' : 'Country - City:'}</label>
                  <input type="text" value={locationInput} onChange={(e) => setLocationInput(e.target.value)} placeholder={lang === 'es' ? "España - Madrid" : "Spain - Madrid"}
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }} required
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Teléfono (WhatsApp):' : 'Phone (WhatsApp):'}</label>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({lang === 'es' ? 'Opcional' : 'Optional'})</span>
                  </div>
                  <input type="tel" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder={lang === 'es' ? "Ej. +34 666 555 444" : "e.g. +34 666 555 444"}
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '10px', outline: 'none', fontSize: '0.85rem' }}
                  />
                </div>

                {/* GDPR */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '4px 0' }}>
                  <input type="checkbox" id="gdpr_consent_google" required style={{ marginTop: '3px', cursor: 'pointer' }} />
                  <label htmlFor="gdpr_consent_google" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.3', cursor: 'pointer' }}>
                    {lang === 'es' 
                      ? 'Acepto el tratamiento de mis datos personales (nombre, correo y teléfono opcional) para la gestión del torneo conforme al RGPD.' 
                      : 'I consent to the processing of my personal data (name, email, and optional phone) for tournament management under GDPR.'}
                  </label>
                </div>

                <button type="submit" className="btn btn-primary" disabled={isSubmittingAuth} style={{ marginTop: '4px' }}>
                  {isSubmittingAuth ? (lang === 'es' ? 'Creando perfil...' : 'Creating profile...') : (lang === 'es' ? 'Completar Registro' : 'Complete Registration')}
                </button>
                
                <button type="button" onClick={() => { setAuthMode('login'); setGoogleUser(null); signOut(auth); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.78rem', alignSelf: 'center' }}>
                  {lang === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
              </form>
            ) : null}
          </div>
        )}
      </Modal>

      {/* Modal de Mensajería Privada (PM) */}
      <Modal
        isOpen={isChatModalOpen}
        onClose={() => {
          setIsChatModalOpen(false);
          setActiveChat(null);
          setChatActiveTab('chats');
        }}
        title={activeChat 
          ? (lang === 'es' ? `Chat con ${activeChat.nicks?.[activeChat.participants.find(uid => uid !== user?.uid) || user?.uid] || 'Admin'}` : `Chat with ${activeChat.nicks?.[activeChat.participants.find(uid => uid !== user?.uid) || user?.uid] || 'Admin'}`) 
          : (lang === 'es' ? "Mensajes Privados" : "Private Messages")}
      >
        {!activeChat ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '300px', maxHeight: '65vh' }}>
            
            {/* Pestañas de Admin: Chats vs Reportes de Bugs */}
            {isAdmin && (
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '4px' }}>
                <button
                  type="button"
                  onClick={() => setChatActiveTab('chats')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: chatActiveTab === 'chats' ? 'rgba(203, 161, 53, 0.15)' : 'transparent',
                    border: 'none',
                    borderBottom: chatActiveTab === 'chats' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                    color: chatActiveTab === 'chats' ? 'var(--gold-primary)' : 'var(--text-secondary)',
                    fontWeight: 'bold',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  💬 {lang === 'es' ? 'Mensajes' : 'Chats'} ({chats.length})
                </button>
                <button
                  type="button"
                  onClick={() => setChatActiveTab('bugs')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: chatActiveTab === 'bugs' ? 'rgba(203, 161, 53, 0.15)' : 'transparent',
                    border: 'none',
                    borderBottom: chatActiveTab === 'bugs' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                    color: chatActiveTab === 'bugs' ? 'var(--gold-primary)' : 'var(--text-secondary)',
                    fontWeight: 'bold',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  🐛 {lang === 'es' ? 'Reportes de Bugs' : 'Bug Reports'} ({bugReports.length})
                  {unreadBugReportsCount > 0 && (
                    <span style={{
                      background: 'var(--danger-color)',
                      color: '#fff',
                      fontSize: '0.65rem',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      fontWeight: 'bold'
                    }}>
                      {unreadBugReportsCount}
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* VISTA 1: LISTA DE CHATS PRIVADOS */}
            {(!isAdmin || chatActiveTab === 'chats') && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {chats.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '8px' }}>✉️</span>
                    {lang === 'es' ? 'No tienes conversaciones activas.' : 'No active conversations.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {chats.map(chat => {
                      const recipientId = chat.participants.find(uid => uid !== user?.uid) || user?.uid;
                      const recipientNick = chat.nicks?.[recipientId] || recipientId || 'Admin';
                      const recipientUser = chat.usernames?.[recipientId] || '';
                      const hasUnread = chat.unread?.[user?.uid] === true;
                      const lastMsgTime = chat.lastUpdated?.toMillis 
                        ? new Date(chat.lastUpdated.toMillis()).toLocaleDateString() + ' ' + new Date(chat.lastUpdated.toMillis()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '';

                      return (
                        <div
                          key={chat.id}
                          onClick={() => setActiveChat(chat)}
                          className="league-row-hover"
                          style={{
                            background: hasUnread ? 'rgba(203, 161, 53, 0.06)' : 'rgba(255, 255, 255, 0.02)',
                            border: hasUnread ? '1px solid rgba(203, 161, 53, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                            borderRadius: '8px',
                            padding: '12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '10px',
                            transition: 'all 0.2s'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: hasUnread ? 'bold' : '600', color: hasUnread ? 'var(--gold-primary)' : '#fff', fontSize: '0.9rem' }}>
                                {recipientNick}
                              </span>
                              {recipientUser && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>@{recipientUser}</span>
                              )}
                              {hasUnread && (
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold-primary)', display: 'inline-block' }} />
                              )}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: hasUnread ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: chat.lastMessage ? 'normal' : 'italic' }}>
                              {chat.lastMessage || (lang === 'es' ? 'Sin mensajes aún.' : 'No messages yet.')}
                            </div>
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {lastMsgTime}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* VISTA 2: LISTA DE REPORTES DE BUGS (SOLO ADMINS) */}
            {isAdmin && chatActiveTab === 'bugs' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {bugReports.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '8px' }}>🐛</span>
                    {lang === 'es' ? 'No hay reportes de bugs registrados.' : 'No bug reports registered.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {bugReports.map(b => {
                      const isNew = b.status === 'new';
                      const isResolved = b.status === 'resolved';
                      const dateStr = b.createdAt?.toMillis 
                        ? new Date(b.createdAt.toMillis()).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) 
                        : (b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : (b.createdAt ? new Date(b.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Reciente'));

                      return (
                        <div
                          key={b.id}
                          style={{
                            background: isNew ? 'rgba(235, 87, 87, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                            border: isNew ? '1px solid rgba(235, 87, 87, 0.35)' : '1px solid rgba(255, 255, 255, 0.06)',
                            borderRadius: '8px',
                            padding: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px'
                          }}
                        >
                          {/* Header del reporte */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '6px' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 'bold', color: '#fff', fontSize: '0.88rem' }}>
                                  👤 {b.reporterName || (b.contactEmail || 'Usuario anónimo')}
                                </span>
                                {b.contactEmail && (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--gold-primary)' }}>
                                    ✉️ {b.contactEmail}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                🕒 {dateStr}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{
                                fontSize: '0.7rem',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontWeight: 'bold',
                                background: isNew ? 'rgba(235, 87, 87, 0.2)' : (isResolved ? 'rgba(46, 204, 113, 0.2)' : 'rgba(241, 196, 15, 0.2)'),
                                color: isNew ? '#ff6b6b' : (isResolved ? '#2ecc71' : '#f1c40f'),
                                border: `1px solid ${isNew ? 'rgba(235, 87, 87, 0.4)' : (isResolved ? 'rgba(46, 204, 113, 0.4)' : 'rgba(241, 196, 15, 0.4)')}`
                              }}>
                                {isNew ? '🔴 Nuevo' : (isResolved ? '✅ Resuelto' : '🟡 Revisado')}
                              </span>
                            </div>
                          </div>

                          {/* Descripción del Bug */}
                          <div style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: 'var(--border-glass)',
                            borderRadius: '6px',
                            padding: '8px 10px',
                            fontSize: '0.82rem',
                            color: 'var(--text-primary)',
                            lineHeight: '1.4',
                            whiteSpace: 'pre-wrap'
                          }}>
                            {b.description}
                          </div>

                          {/* Captura de pantalla si existe */}
                          {b.screenshot && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div
                                onClick={() => setSelectedBugScreenshot(b.screenshot)}
                                style={{
                                  cursor: 'zoom-in',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  background: 'rgba(255,255,255,0.05)',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  border: 'var(--border-glass)',
                                  fontSize: '0.75rem',
                                  color: 'var(--gold-primary)'
                                }}
                              >
                                📷 {lang === 'es' ? 'Ver captura adjunta' : 'View screenshot'}
                                <img 
                                  src={b.screenshot} 
                                  alt="Thumb" 
                                  style={{ width: '28px', height: '28px', objectFit: 'cover', borderRadius: '4px' }} 
                                />
                              </div>
                            </div>
                          )}

                          {/* Info técnica */}
                          {b.techInfo && (
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '8px', background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: '4px' }}>
                              <span>📌 Vista: <strong>{b.techInfo.currentView || '-'}</strong></span>
                              <span>🖥️ SO: <strong>{b.techInfo.platform || '-'}</strong></span>
                              <span>📱 Pantalla: <strong>{b.techInfo.screenSize || '-'}</strong></span>
                              <span>⚙️ v<strong>{b.techInfo.appVersion || '3.0'}</strong></span>
                            </div>
                          )}

                          {/* Botones de acción */}
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px', alignItems: 'center' }}>
                            {b.reporterUid && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                onClick={() => handleOpenChatWithReporter(b.reporterUid, b.reporterName)}
                                style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                              >
                                💬 {lang === 'es' ? 'Abrir Chat' : 'Open Chat'}
                              </button>
                            )}
                            {b.contactEmail && (
                              <a
                                href={`mailto:${b.contactEmail}?subject=${encodeURIComponent('Respuesta a tu reporte de bug - La Cuchara de Lobelia')}`}
                                className="btn btn-secondary btn-small"
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontSize: '0.72rem', padding: '3px 8px', textDecoration: 'none' }}
                              >
                                📧 {lang === 'es' ? 'Enviar Email' : 'Send Email'}
                              </a>
                            )}
                            {isNew && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                onClick={() => handleUpdateBugStatus(b.id, 'reviewed')}
                                style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                              >
                                👁️ {lang === 'es' ? 'Marcar Revisado' : 'Mark Reviewed'}
                              </button>
                            )}
                            {!isResolved ? (
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                onClick={() => handleUpdateBugStatus(b.id, 'resolved')}
                                style={{ fontSize: '0.72rem', padding: '3px 8px', color: '#2ecc71', borderColor: 'rgba(46, 204, 113, 0.3)' }}
                              >
                                ✅ {lang === 'es' ? 'Marcar Resuelto' : 'Mark Resolved'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                onClick={() => handleUpdateBugStatus(b.id, 'new')}
                                style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                              >
                                🔄 {lang === 'es' ? 'Reabrir' : 'Reopen'}
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-danger btn-small"
                              onClick={() => handleDeleteBugReport(b.id)}
                              style={{ fontSize: '0.72rem', padding: '3px 8px', marginLeft: 'auto' }}
                              title={lang === 'es' ? 'Eliminar reporte' : 'Delete report'}
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '65vh' }}>
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => setActiveChat(null)}
                style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', border: 'var(--border-glass)', padding: '4px 10px', minHeight: '30px' }}
              >
                ◀ {lang === 'es' ? 'Volver' : 'Back'}
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
              {chatMessages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                  {lang === 'es' ? 'Comienzo de la conversación. Envía un mensaje.' : 'Start of the conversation. Send a message.'}
                </div>
              ) : (
                chatMessages.map(msg => {
                  const isMe = msg.senderId === user?.uid;
                  const msgTime = msg.timestamp?.toMillis 
                    ? new Date(msg.timestamp.toMillis()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '';

                  return (
                    <div
                      key={msg.id}
                      style={{
                        alignSelf: isMe ? 'flex-end' : 'flex-start',
                        maxWidth: '80%',
                        background: isMe ? 'rgba(46, 117, 89, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                        border: isMe ? '1px solid rgba(46, 117, 89, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                        color: isMe ? '#fff' : 'var(--text-primary)',
                        padding: '10px 14px',
                        borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        wordBreak: 'break-word'
                      }}
                    >
                      <div style={{ fontSize: '0.88rem', lineHeight: '1.4' }}>{msg.text}</div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', alignSelf: 'flex-end' }}>{msgTime}</div>
                    </div>
                  );
                })
              )}
              <div ref={pmMessagesEndRef} style={{ height: '1px', width: '100%' }} />
            </div>

            <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
              <input
                type="text"
                value={newMessageText}
                onChange={(e) => setNewMessageText(e.target.value)}
                placeholder={lang === 'es' ? "Escribe un mensaje..." : "Type a message..."}
                style={{
                  flex: 1,
                  background: '#111',
                  border: 'var(--border-glass)',
                  borderRadius: '4px',
                  color: '#fff',
                  padding: '10px',
                  outline: 'none',
                  fontSize: '0.85rem'
                }}
                maxLength="500"
                required
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSendingMessage || !newMessageText.trim()}
                style={{ padding: '0 20px', minHeight: '38px', fontWeight: 'bold' }}
              >
                {lang === 'es' ? 'Enviar' : 'Send'}
              </button>
            </form>
          </div>
        )}
      </Modal>

      {/* Modal de Alerta Premium */}
      <Modal
        isOpen={isAlertModalOpen}
        onClose={() => setIsAlertModalOpen(false)}
        title={lang === 'es' ? 'Mensaje de la Cuchara' : 'Lobelia Message'}
        zIndex={10000}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', textAlign: 'center', padding: '10px 0' }}>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-primary)', lineHeight: '1.4' }}>
            {alertModalMessage}
          </p>
          <button 
            className="btn btn-primary" 
            onClick={() => setIsAlertModalOpen(false)}
            style={{ minWidth: '100px', marginTop: '8px' }}
          >
            {lang === 'es' ? 'Aceptar' : 'OK'}
          </button>
        </div>
      </Modal>

      {/* Modal de Confirmación Premium */}
      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        title={lang === 'es' ? 'Confirmación' : 'Confirmation'}
        zIndex={10000}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', textAlign: 'center', padding: '10px 0' }}>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-primary)', lineHeight: '1.4' }}>
            {confirmModalMessage}
          </p>
          <div style={{ display: 'flex', gap: '10px', width: '100%', justifyContent: 'center' }}>
            <button 
              className="btn btn-primary" 
              onClick={async () => {
                setIsConfirmModalOpen(false);
                if (confirmModalOnConfirm) {
                  await confirmModalOnConfirm();
                }
              }}
              style={{ minWidth: '100px' }}
            >
              {lang === 'es' ? 'Confirmar' : 'Confirm'}
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={() => setIsConfirmModalOpen(false)}
              style={{ minWidth: '100px', background: 'rgba(255,255,255,0.05)', color: '#fff', border: 'var(--border-glass)' }}
            >
              {lang === 'es' ? 'Cancelar' : 'Cancel'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Lightbox para ver capturas de pantalla a tamaño completo */}
      {selectedBugScreenshot && (
        <div 
          onClick={() => setSelectedBugScreenshot(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.92)',
            backdropFilter: 'blur(8px)',
            zIndex: 20000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            cursor: 'zoom-out'
          }}
        >
          <img 
            src={selectedBugScreenshot} 
            alt="Screenshot Preview" 
            style={{
              maxWidth: '95vw',
              maxHeight: '92vh',
              borderRadius: '8px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.9)',
              border: '1px solid var(--gold-primary)'
            }}
          />
        </div>
      )}

      {/* Modal de Selección de Idioma Inicial (solo para españoles) */}
      <Modal
        isOpen={isLangPromptOpen}
        onClose={() => setIsLangPromptOpen(false)}
        title="Idioma / Language"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', textAlign: 'center', padding: '10px 0' }}>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-primary)', lineHeight: '1.4' }}>
            Hemos detectado tu idioma en Español. ¿Deseas mantener la aplicación en Español o prefieres verla en Inglés?<br/><br/>
            We detected your language is Spanish. Would you like to keep the app in Spanish or change it to English?
          </p>
          <div style={{ display: 'flex', gap: '10px', width: '100%', justifyContent: 'center' }}>
            <button 
              className="btn btn-primary" 
              onClick={() => {
                setLang('es');
                try { localStorage.setItem('lobelia_lang', 'es'); } catch (_) {}
                setIsLangPromptOpen(false);
              }}
              style={{ minWidth: '120px', fontWeight: 'bold' }}
            >
              Español
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={() => {
                setLang('en');
                try { localStorage.setItem('lobelia_lang', 'en'); } catch (_) {}
                setIsLangPromptOpen(false);
              }}
              style={{ minWidth: '120px', background: 'rgba(255,255,255,0.05)', color: '#fff', border: 'var(--border-glass)', fontWeight: 'bold' }}
            >
              English
            </button>
          </div>
        </div>
      </Modal>
      {/* Modal de Reporte de Bug */}
      <Modal
        isOpen={isBugReportOpen}
        onClose={() => {
          setIsBugReportOpen(false);
          setBugReportText('');
          setBugReportScreenshot(null);
          setBugReportEmail('');
        }}
        title={lang === 'es' ? '🐛 Reportar un Bug' : '🐛 Report a Bug'}
      >
        <form onSubmit={handleSubmitBugReport} style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.4', margin: 0 }}>
            {lang === 'es'
              ? '¿Encontraste un problema? Descríbelo aquí y lo revisaremos lo antes posible.'
              : 'Found an issue? Describe it here and we will review it as soon as possible.'}
          </p>

          {/* Descripción del bug */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
              {lang === 'es' ? 'Descripción del problema *' : 'Problem description *'}
            </label>
            <textarea
              value={bugReportText}
              onChange={(e) => setBugReportText(e.target.value)}
              placeholder={lang === 'es' ? 'Describe qué ha pasado, qué esperabas que ocurriera y los pasos para reproducirlo...' : 'Describe what happened, what you expected, and the steps to reproduce it...'}
              rows={4}
              maxLength={2000}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: 'var(--border-glass)',
                background: 'rgba(255,255,255,0.04)',
                color: '#fff',
                fontSize: '0.88rem',
                fontFamily: 'inherit',
                resize: 'vertical',
                minHeight: '80px'
              }}
            />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right' }}>
              {bugReportText.length}/2000
            </span>
          </div>

          {/* Captura de pantalla */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
              {lang === 'es' ? '📎 Captura de pantalla (opcional)' : '📎 Screenshot (optional)'}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: 'var(--border-glass)',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
              >
                📷 {lang === 'es' ? 'Elegir imagen' : 'Choose image'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setBugReportScreenshot(e.target.files?.[0] || null)}
                  style={{ display: 'none' }}
                />
              </label>
              {bugReportScreenshot && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--accent-color)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ✅ {bugReportScreenshot.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBugReportScreenshot(null)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--danger-color)', cursor: 'pointer', fontSize: '0.9rem', padding: '2px' }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Email de contacto (solo para anónimos) */}
          {!user && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                {lang === 'es' ? '📧 Email de contacto (opcional)' : '📧 Contact email (optional)'}
              </label>
              <input
                type="email"
                value={bugReportEmail}
                onChange={(e) => setBugReportEmail(e.target.value)}
                placeholder={lang === 'es' ? 'Para que podamos responderte...' : 'So we can get back to you...'}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: 'var(--border-glass)',
                  background: 'rgba(255,255,255,0.04)',
                  color: '#fff',
                  fontSize: '0.88rem'
                }}
              />
            </div>
          )}

          {/* Info técnica auto */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: 'var(--border-glass)',
            borderRadius: '8px',
            padding: '8px 10px',
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
            lineHeight: '1.5'
          }}>
            <span style={{ fontWeight: 'bold' }}>{lang === 'es' ? 'ℹ️ Se adjuntará automáticamente:' : 'ℹ️ Will be automatically attached:'}</span><br/>
            {lang === 'es' ? 'Navegador, dispositivo, pantalla, vista actual, versión de la app' : 'Browser, device, screen, current view, app version'}
          </div>

          {/* Botones */}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setIsBugReportOpen(false);
                setBugReportText('');
                setBugReportScreenshot(null);
                setBugReportEmail('');
              }}
              style={{ minWidth: '90px', background: 'rgba(255,255,255,0.05)', color: '#fff', border: 'var(--border-glass)' }}
            >
              {lang === 'es' ? 'Cancelar' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmittingBug || !bugReportText.trim()}
              style={{ minWidth: '90px' }}
            >
              {isSubmittingBug
                ? (lang === 'es' ? 'Enviando...' : 'Sending...')
                : (lang === 'es' ? '🐛 Enviar' : '🐛 Send')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Banner flotante de instalación PWA (estilo Senda) */}
      {showInstallBanner && deferredPrompt && (
        <div style={{
          position: 'fixed',
          bottom: '75px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '92%',
          maxWidth: '420px',
          background: 'rgba(17, 33, 20, 0.96)',
          backdropFilter: 'blur(12px)',
          border: '1.5px solid #cba135',
          borderRadius: '14px',
          padding: '12px 16px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <img src={logoImg} alt="App Icon" style={{ width: '42px', height: '42px', borderRadius: '10px', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 'bold', color: '#fff', fontFamily: 'var(--font-title)' }}>
              {lang === 'es' ? '¿Instalar La Cuchara de Lobelia?' : 'Install La Cuchara de Lobelia?'}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#bbb', marginTop: '2px' }}>
              {lang === 'es' ? 'Añade la app a tu inicio para entrar directo sin navegador.' : 'Add app to home screen for direct access.'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
            <button 
              className="btn btn-primary" 
              onClick={handleInstallPWA}
              style={{ fontSize: '0.75rem', padding: '6px 12px', borderRadius: '8px' }}
            >
              {lang === 'es' ? 'Instalar' : 'Install'}
            </button>
            <button 
              onClick={() => setShowInstallBanner(false)}
              style={{ background: 'transparent', border: 'none', color: '#999', fontSize: '0.7rem', cursor: 'pointer' }}
            >
              {lang === 'es' ? 'Ahora no' : 'Not now'}
            </button>
          </div>
        </div>
      )}

      {/* Barra de Navegación inferior fija */}
      <Navbar 
        currentView={currentView} 
        setView={setView} 
        lang={lang} 
        translations={translations} 
      />
    </div>
  );
}
