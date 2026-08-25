// src/views/Mods.jsx
// ─────────────────────────────────────────────────────────────────────────────
// ModStore & Workshop de La Cuchara de Lobelia (Zero-GW IP Neutral Engine).
// Taller Comunitario Descentralizado, Reseñas por Versión (Google Maps Style),
// Instalación 1-Clic en IndexedDB, Gestión por Capas y Sistema de Reportes Dual.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  installMod,
  uninstallMod,
  getInstalledMods,
  getActiveLayers,
  setActiveLayer,
  validateModSchema,
  downloadAndCacheMissionPdfs,
  MOD_LAYERS
} from '../utils/modManager';
import {
  fetchCommunityMods,
  publishCommunityMod,
  updateCommunityMod,
  deleteCommunityMod,
  fetchModReviews,
  saveModReview,
  deleteModReview,
  reportBugToCreator,
  reportModToAdmin,
  incrementModInstalls
} from '../utils/communityMods';
import {
  CREATOR_GUIDE_MD,
  TEMPLATE_MOD_1_MISSIONS,
  TEMPLATE_MOD_2_RULES_AI
} from '../data/creatorGuide';
import Modal from '../components/Modal';

export default function Mods({ user, profile, lang = 'es' }) {
  // Pestañas principales
  const [activeTab, setActiveTab] = useState('workshop'); // 'workshop' | 'installed' | 'layers' | 'docs'
  
  // Estado local de mods instalados en IndexedDB
  const [installedMods, setInstalledMods] = useState([]);
  const [activeLayers, setActiveLayersState] = useState(getActiveLayers());
  const [loading, setLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState(null); // { type: 'success'|'error'|'info', message }
  
  // Importador manual de URL
  const [urlInput, setUrlInput] = useState('');
  const [urlDownloading, setUrlDownloading] = useState(false);

  // ── ESTADO DEL TALLER COMUNITARIO (WORKSHOP) ───────────────────────────────
  const [communityMods, setCommunityMods] = useState([]);
  const [loadingCommunity, setLoadingCommunity] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all'); // 'all' | 'missions' | 'rules_ai' | 'army_builder' | 'duels' | 'offline'
  const [sortBy, setSortBy] = useState('rating'); // 'rating' | 'recent' | 'reviews' | 'name'

  // ── ESTADO DE MODAL DE RESEÑAS (ESTILO GOOGLE MAPS) ────────────────────────
  const [isReviewsModalOpen, setIsReviewsModalOpen] = useState(false);
  const [selectedModForReviews, setSelectedModForReviews] = useState(null);
  const [modReviews, setModReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [reviewVersionFilter, setReviewVersionFilter] = useState('latest'); // 'latest' | 'all'
  const [userRating, setUserRating] = useState(5);
  const [userComment, setUserComment] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // ── ESTADO DE MODAL PUBLICAR / EDITAR MOD ──────────────────────────────────
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [editingModId, setEditingModId] = useState(null);
  const [publishForm, setPublishForm] = useState({
    name: '',
    author: '',
    jsonUrl: '',
    version: '1.0.0',
    description: '',
    capabilities: ['missions'],
    hasOfflinePdf: false,
    communityLink: ''
  });
  const [isValidatingUrl, setIsValidatingUrl] = useState(false);
  const [urlValidationResult, setUrlValidationResult] = useState(null);
  const [isSubmittingPublish, setIsSubmittingPublish] = useState(false);

  // ── ESTADO DE MODAL DE REPORTE DUAL (CREADOR VS ADMIN) ─────────────────────
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [selectedModForReport, setSelectedModForReport] = useState(null);
  const [reportType, setReportType] = useState('creator'); // 'creator' | 'admin'
  const [reportReason, setReportReason] = useState('broken_link');
  const [reportDetails, setReportDetails] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // Modal de Manual de Creador
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);

  // Validador en vivo en pestaña Docs
  const [validatorInput, setValidatorInput] = useState('');
  const [validationReport, setValidationReport] = useState(null);

  // Modal de Prompt Offline / Online
  const [offlinePromptModal, setOfflinePromptModal] = useState({
    isOpen: false,
    modJson: null,
    sourceUrl: '',
    modName: '',
    totalPdfs: 0,
    communityModId: null
  });

  // Modal de Progreso de Descarga Offline
  const [downloadProgress, setDownloadProgress] = useState({
    isDownloading: false,
    current: 0,
    total: 0,
    currentFile: ''
  });

  // Diálogo genérico
  const [dialog, setDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'alert',
    confirmText: 'Aceptar',
    cancelText: 'Cancelar',
    onConfirm: null
  });

  const closeDialog = () => setDialog(d => ({ ...d, isOpen: false }));
  const showConfirm = (title, message, onConfirmCallback) => {
    setDialog({
      isOpen: true,
      title,
      message,
      type: 'confirm',
      confirmText: lang === 'es' ? 'Confirmar' : 'Confirm',
      cancelText: lang === 'es' ? 'Cancelar' : 'Cancel',
      onConfirm: () => {
        closeDialog();
        if (onConfirmCallback) onConfirmCallback();
      }
    });
  };

  // ── CARGAR DATOS LOCALES Y COMUNITARIOS ─────────────────────────────────────
  const reloadData = useCallback(async () => {
    setLoading(true);
    const uid = user?.uid || null;
    const installed = await getInstalledMods(uid);
    const layers = getActiveLayers(uid);

    setInstalledMods(installed);
    setActiveLayersState(layers);
    setLoading(false);
  }, [user]);

  const reloadCommunity = useCallback(async () => {
    setLoadingCommunity(true);
    const mods = await fetchCommunityMods();
    setCommunityMods(mods);
    setLoadingCommunity(false);
  }, []);

  useEffect(() => {
    reloadData();
    reloadCommunity();
  }, [reloadData, reloadCommunity]);

  // ── DESCARGA DE RECURSOS / PLANTILLAS ──────────────────────────────────────
  const downloadTextFile = (filename, content, mimeType = 'application/json') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadGuide = () => downloadTextFile('MANUAL_CREACION_MODS_LOBELIA.md', CREATOR_GUIDE_MD, 'text/markdown');
  const handleDownloadTemplateMissions = () => downloadTextFile('plantilla_mod_1_misiones.json', JSON.stringify(TEMPLATE_MOD_1_MISSIONS, null, 2), 'application/json');
  const handleDownloadTemplateRulesAi = () => downloadTextFile('plantilla_mod_2_arbitro_ia.json', JSON.stringify(TEMPLATE_MOD_2_RULES_AI, null, 2), 'application/json');

  // ── HELPER DE DESCARGA JSON DESDE URL PÚBLICA ──────────────────────────────
  const fetchModJsonFromUrl = async (downloadUrl) => {
    let json = null;
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
        `https://cdn.jsdelivr.net/gh/${owner}/${repo}@main/${filename}`
      );
    }
    for (const url of urlsToTry) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          json = await res.json();
          if (json && (json.modId || json.modName)) break;
        }
      } catch (_) {}
    }
    return json;
  };

  // ── INSTALACIÓN DE MODS (1-CLIC & MANUAL) ──────────────────────────────────
  const initiateInstall = (modJson, sourceUrl = '', communityModId = null) => {
    if (modJson.missionPdfs && (modJson.missionPdfs.missions1v1 || modJson.missionPdfs.missions2v2)) {
      const m1 = Object.keys(modJson.missionPdfs.missions1v1 || {}).length;
      const m2 = Object.keys(modJson.missionPdfs.missions2v2 || {}).length;
      setOfflinePromptModal({
        isOpen: true,
        modJson,
        sourceUrl,
        modName: modJson.modName || 'Mod de Misiones',
        totalPdfs: (m1 + m2) * 2,
        communityModId
      });
    } else {
      handleExecuteInstall(modJson, false, sourceUrl, communityModId);
    }
  };

  const handleExecuteInstall = async (modJson, isOffline = false, sourceUrl = '', communityModId = null) => {
    setOfflinePromptModal(prev => ({ ...prev, isOpen: false }));
    setActionStatus({
      type: 'info',
      message: lang === 'es' ? 'Instalando mod en almacenamiento local...' : 'Installing mod in local storage...'
    });

    const result = await installMod(user?.uid || null, modJson, sourceUrl);
    if (!result.success) {
      setActionStatus({ type: 'error', message: result.error });
      return;
    }

    if (isOffline && modJson.missionPdfs) {
      setDownloadProgress({ isDownloading: true, current: 0, total: 0, currentFile: 'Iniciando descarga de PDFs...' });
      await downloadAndCacheMissionPdfs(modJson, (curr, tot, file) => {
        setDownloadProgress({ isDownloading: true, current: curr, total: tot, currentFile: file });
      });
      setDownloadProgress({ isDownloading: false, current: 0, total: 0, currentFile: '' });
    }

    if (communityModId) {
      incrementModInstalls(communityModId);
    }

    setActionStatus({
      type: 'success',
      message: lang === 'es'
        ? `✅ "${result.mod.modName}" instalado correctamente ${isOffline ? '(100% Offline con PDFs en IndexedDB)' : '(Modo Online)'}.`
        : `✅ "${result.mod.modName}" installed successfully ${isOffline ? '(100% Offline with PDFs in IndexedDB)' : '(Online Mode)'}.`
    });
    await reloadData();
  };

  const handleInstallCommunityMod = async (cMod) => {
    setActionStatus({
      type: 'info',
      message: lang === 'es' ? `Descargando paquete de "${cMod.name}"...` : `Downloading "${cMod.name}" package...`
    });

    try {
      const modJson = await fetchModJsonFromUrl(cMod.jsonUrl);
      if (!modJson) {
        setActionStatus({
          type: 'error',
          message: lang === 'es' ? 'No se pudo descargar el mod desde la URL del autor.' : 'Could not download mod from creator URL.'
        });
        return;
      }
      initiateInstall(modJson, cMod.jsonUrl, cMod.id);
    } catch (err) {
      setActionStatus({ type: 'error', message: err.message });
    }
  };

  const handleInstallFromUrl = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setUrlDownloading(true);
    try {
      const modJson = await fetchModJsonFromUrl(trimmed);
      setUrlDownloading(false);
      if (!modJson) {
        setActionStatus({
          type: 'error',
          message: lang === 'es' ? 'No se pudo descargar un mod válido desde la URL.' : 'Could not download a valid mod from the URL.'
        });
        return;
      }
      setUrlInput('');
      initiateInstall(modJson, trimmed);
    } catch (err) {
      setUrlDownloading(false);
      setActionStatus({ type: 'error', message: err.message });
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        initiateInstall(json, file.name);
      } catch (err) {
        setActionStatus({
          type: 'error',
          message: lang === 'es' ? 'El archivo seleccionado no es un JSON válido.' : 'Invalid JSON file selected.'
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleUninstall = (modId) => {
    showConfirm(
      lang === 'es' ? '¿Desinstalar Mod?' : 'Uninstall Mod?',
      lang === 'es' ? '¿Deseas eliminar este mod de tu dispositivo local?' : 'Remove this mod from your local device?',
      async () => {
        const res = await uninstallMod(user?.uid || null, modId);
        if (res.success) {
          setActionStatus({
            type: 'info',
            message: lang === 'es' ? 'Mod desinstalado.' : 'Mod uninstalled.'
          });
          await reloadData();
        }
      }
    );
  };

  const handleLayerChange = (layer, modId) => {
    const targetModId = modId === 'none' ? null : modId;
    setActiveLayer(user?.uid || null, layer, targetModId);
    setActiveLayersState(getActiveLayers(user?.uid || null));
    setActionStatus({
      type: 'success',
      message: lang === 'es' ? 'Capa actualizada.' : 'Layer updated.'
    });
  };

  // ── RESEÑAS Y PUNTUACIÓN (GOOGLE MAPS STYLE) ───────────────────────────────
  const handleOpenReviewsModal = async (cMod) => {
    setSelectedModForReviews(cMod);
    setIsReviewsModalOpen(true);
    setLoadingReviews(true);
    setReviewVersionFilter('latest');
    
    // Cargar reseñas de Firestore
    const revs = await fetchModReviews(cMod.id);
    setModReviews(revs);
    
    // Si el usuario actual ya votó, precargar su valoración
    const existing = revs.find(r => r.userUid === user?.uid);
    if (existing) {
      setUserRating(existing.rating || 5);
      setUserComment(existing.comment || '');
    } else {
      setUserRating(5);
      setUserComment('');
    }
    setLoadingReviews(false);
  };

  const handleSaveUserReview = async () => {
    if (!user || !user.uid) {
      setActionStatus({ type: 'error', message: lang === 'es' ? 'Inicia sesión para valorar este mod.' : 'Please log in to review.' });
      return;
    }
    if (!selectedModForReviews) return;

    setIsSubmittingReview(true);
    const res = await saveModReview(
      selectedModForReviews.id,
      user,
      userRating,
      userComment,
      selectedModForReviews.version
    );
    setIsSubmittingReview(false);

    if (res.success) {
      setActionStatus({ type: 'success', message: lang === 'es' ? '⭐ ¡Reseña guardada!' : '⭐ Review saved!' });
      // Recargar reseñas y lista comunitaria
      const revs = await fetchModReviews(selectedModForReviews.id);
      setModReviews(revs);
      reloadCommunity();
    } else {
      setActionStatus({ type: 'error', message: res.error });
    }
  };

  const handleDeleteUserReview = async () => {
    if (!user || !user.uid || !selectedModForReviews) return;
    setIsSubmittingReview(true);
    const res = await deleteModReview(selectedModForReviews.id, user.uid, selectedModForReviews.version);
    setIsSubmittingReview(false);
    if (res.success) {
      setUserComment('');
      setUserRating(5);
      const revs = await fetchModReviews(selectedModForReviews.id);
      setModReviews(revs);
      reloadCommunity();
    }
  };

  // ── PUBLICACIÓN Y EDICIÓN DE MODS ──────────────────────────────────────────
  const handleOpenPublishModal = (cMod = null) => {
    if (cMod) {
      setEditingModId(cMod.id);
      setPublishForm({
        name: cMod.name || '',
        author: cMod.author || '',
        jsonUrl: cMod.jsonUrl || '',
        version: cMod.version || '1.0.0',
        description: cMod.description || '',
        capabilities: Array.isArray(cMod.capabilities) ? cMod.capabilities : ['missions'],
        hasOfflinePdf: Boolean(cMod.hasOfflinePdf),
        communityLink: cMod.communityLink || ''
      });
    } else {
      setEditingModId(null);
      setPublishForm({
        name: '',
        author: user?.displayName || user?.email?.split('@')[0] || '',
        jsonUrl: '',
        version: '1.0.0',
        description: '',
        capabilities: ['missions'],
        hasOfflinePdf: false,
        communityLink: ''
      });
    }
    setUrlValidationResult(null);
    setIsPublishModalOpen(true);
  };

  const handleValidatePublishUrl = async () => {
    const url = publishForm.jsonUrl.trim();
    if (!url) {
      setUrlValidationResult({ valid: false, message: 'Introduce una URL para validar.' });
      return;
    }
    setIsValidatingUrl(true);
    setUrlValidationResult(null);

    try {
      const json = await fetchModJsonFromUrl(url);
      setIsValidatingUrl(false);
      if (!json) {
        setUrlValidationResult({
          valid: false,
          message: 'No se pudo descargar el archivo JSON desde la URL especificada.'
        });
        return;
      }

      const schemaRes = validateModSchema(json);
      if (!schemaRes.valid) {
        setUrlValidationResult({
          valid: false,
          message: `El JSON no cumple con el esquema oficial: ${schemaRes.errors.slice(0, 2).join(', ')}`
        });
        return;
      }

      // Auto-completar campos detectados
      setPublishForm(prev => ({
        ...prev,
        name: prev.name || json.modName || '',
        author: prev.author || json.modAuthor || '',
        version: json.modVersion || prev.version,
        description: prev.description || json.description || '',
        capabilities: json.capabilities || prev.capabilities,
        hasOfflinePdf: Boolean(json.missionPdfs && Object.keys(json.missionPdfs).length > 0)
      }));

      setUrlValidationResult({
        valid: true,
        message: `✅ Archivo JSON válido ("${json.modName}" v${json.modVersion || '1.0'}). Campos auto-completados.`
      });
    } catch (err) {
      setIsValidatingUrl(false);
      setUrlValidationResult({ valid: false, message: `Error: ${err.message}` });
    }
  };

  const handleSavePublishForm = async (e) => {
    e.preventDefault();
    if (!user || !user.uid) {
      setActionStatus({ type: 'error', message: 'Debes iniciar sesión para publicar.' });
      return;
    }

    setIsSubmittingPublish(true);
    let res;
    if (editingModId) {
      const isAdmin = profile?.role === 'admin' || profile?.isGlobalAdmin;
      res = await updateCommunityMod(editingModId, user, publishForm, isAdmin);
    } else {
      res = await publishCommunityMod(user, publishForm);
    }
    setIsSubmittingPublish(false);

    if (res.success) {
      setIsPublishModalOpen(false);
      setActionStatus({
        type: 'success',
        message: editingModId ? '✅ Mod actualizado en la comunidad.' : '🎉 ¡Mod publicado en el Taller Comunitario!'
      });
      reloadCommunity();
    } else {
      setActionStatus({ type: 'error', message: res.error });
    }
  };

  const handleDeleteCommunityMod = (cMod) => {
    const isAdmin = profile?.role === 'admin' || profile?.isGlobalAdmin;
    showConfirm(
      lang === 'es' ? '¿Eliminar Mod del Taller?' : 'Delete Mod from Workshop?',
      lang === 'es' ? `¿Estás seguro de que deseas retirar "${cMod.name}" del catálogo público?` : `Remove "${cMod.name}" from public workshop?`,
      async () => {
        const res = await deleteCommunityMod(cMod.id, user, isAdmin);
        if (res.success) {
          setActionStatus({ type: 'info', message: 'Mod retirado del taller comunitario.' });
          reloadCommunity();
        } else {
          setActionStatus({ type: 'error', message: res.error });
        }
      }
    );
  };

  // ── REPORTES DUALES (CREADOR VS ADMIN) ─────────────────────────────────────
  const handleOpenReportModal = (cMod) => {
    setSelectedModForReport(cMod);
    setReportType('creator');
    setReportReason('broken_link');
    setReportDetails('');
    setIsReportModalOpen(true);
  };

  const handleSubmitReport = async () => {
    if (!user || !user.uid || !selectedModForReport) {
      setActionStatus({ type: 'error', message: 'Debes iniciar sesión para reportar.' });
      return;
    }

    setIsSubmittingReport(true);
    let res;
    if (reportType === 'creator') {
      res = await reportBugToCreator(
        selectedModForReport.authorUid,
        selectedModForReport,
        user,
        reportDetails
      );
    } else {
      res = await reportModToAdmin(
        selectedModForReport.id,
        selectedModForReport,
        user,
        reportReason,
        reportDetails
      );
    }
    setIsSubmittingReport(false);

    if (res.success) {
      setIsReportModalOpen(false);
      setActionStatus({
        type: 'success',
        message: reportType === 'creator'
          ? '📨 ¡Reporte de fallo enviado por Mensaje Privado al creador!'
          : '🛡️ Reporte enviado a los administradores. ¡Gracias por ayudar a moderar!'
      });
    } else {
      setActionStatus({ type: 'error', message: res.error });
    }
  };

  // ── FILTRADO Y ORDENACIÓN DEL WORKSHOP ─────────────────────────────────────
  const filteredCommunityMods = useMemo(() => {
    return communityMods.filter(mod => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q ||
        (mod.name && mod.name.toLowerCase().includes(q)) ||
        (mod.author && mod.author.toLowerCase().includes(q)) ||
        (mod.description && mod.description.toLowerCase().includes(q));

      const matchesCategory =
        selectedCategory === 'all' ||
        (selectedCategory === 'offline' && mod.hasOfflinePdf) ||
        (mod.capabilities && mod.capabilities.includes(selectedCategory));

      return matchesSearch && matchesCategory;
    }).sort((a, b) => {
      if (sortBy === 'rating') {
        return (b.ratingAvg || 0) - (a.ratingAvg || 0) || (b.ratingCount || 0) - (a.ratingCount || 0);
      }
      if (sortBy === 'recent') {
        const tA = a.createdAt?.seconds || 0;
        const tB = b.createdAt?.seconds || 0;
        return tB - tA;
      }
      if (sortBy === 'reviews') {
        return (b.ratingCount || 0) - (a.ratingCount || 0);
      }
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '');
      }
      return 0;
    });
  }, [communityMods, searchQuery, selectedCategory, sortBy]);

  // ── RESEÑAS FILTRADAS POR VERSIÓN ──────────────────────────────────────────
  const filteredReviews = useMemo(() => {
    if (!selectedModForReviews) return [];
    if (reviewVersionFilter === 'latest') {
      return modReviews.filter(r => r.version === selectedModForReviews.version);
    }
    return modReviews;
  }, [modReviews, reviewVersionFilter, selectedModForReviews]);

  return (
    <div style={{ padding: '16px', maxWidth: '880px', margin: '0 auto', paddingBottom: '90px' }}>
      
      {/* ── CABECERA ── */}
      <div style={{ textAlign: 'center', marginBottom: '22px' }}>
        <h2 style={{ fontFamily: 'var(--font-title)', color: 'var(--gold-primary)', margin: '0 0 6px 0', fontSize: '1.6rem', letterSpacing: '0.04em' }}>
          🧩 {lang === 'es' ? 'TALLER COMUNITARIO & GESTOR DE MODS' : 'COMMUNITY WORKSHOP & MOD MANAGER'}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', maxWidth: '640px', margin: '0 auto', lineHeight: '1.5' }}>
          {lang === 'es'
            ? 'Motor neutral y descentralizado. Los mods son creados y compartidos por la comunidad mediante URLs públicas, almacenándose de forma 100% privada en tu navegador (IndexedDB).'
            : 'Decentralized neutral engine. Community-created mods shared via public URLs, stored 100% privately in your local browser storage (IndexedDB).'}
        </p>
      </div>

      {/* ── NOTIFICACIONES DE ACCIÓN ── */}
      {actionStatus && (
        <div
          style={{
            background: actionStatus.type === 'success' ? 'rgba(46, 204, 113, 0.15)' : actionStatus.type === 'error' ? 'rgba(231, 76, 60, 0.15)' : 'rgba(52, 152, 219, 0.15)',
            border: `1px solid ${actionStatus.type === 'success' ? '#2ecc71' : actionStatus.type === 'error' ? '#e74c3c' : '#3498db'}`,
            color: '#fff',
            borderRadius: '8px',
            padding: '10px 14px',
            fontSize: '0.82rem',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span>{actionStatus.message}</span>
          <button
            onClick={() => setActionStatus(null)}
            style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── PESTAÑAS DE NAVEGACIÓN (RESPONSIVE GRID SIN SCROLLBAR) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '8px',
        marginBottom: '20px',
        width: '100%'
      }}>
        {[
          { id: 'workshop', icon: '🌐', label: lang === 'es' ? 'Taller Comunitario' : 'Community Workshop' },
          { id: 'installed', icon: '📁', label: lang === 'es' ? 'Mis Mods' : 'Installed Mods' },
          { id: 'layers', icon: '🎛️', label: lang === 'es' ? 'Gestión por Capas' : 'Layer Manager' },
          { id: 'docs', icon: '📖', label: lang === 'es' ? 'Guía & Validador' : 'Docs & Validator' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: activeTab === tab.id ? 'var(--gold-primary)' : 'rgba(255,255,255,0.04)',
              color: activeTab === tab.id ? '#111' : 'var(--text-secondary)',
              border: activeTab === tab.id ? '1px solid var(--gold-primary)' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              padding: '10px 8px',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.15s',
              textAlign: 'center'
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* PESTAÑA 1: TALLER COMUNITARIO (EXPLORAR, BUSCAR, RESEÑAS, 1-CLIC)          */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'workshop' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Barra de Acciones Superior: Buscador + Botón Publicar */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ flex: '1 1 260px', position: 'relative' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === 'es' ? "🔍 Buscar mod, autor (ej: @Amoncat), palabra clave..." : "🔍 Search mod, author, keyword..."}
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.5)',
                  border: 'var(--border-glass)',
                  borderRadius: '8px',
                  padding: '9px 12px',
                  color: '#fff',
                  fontSize: '0.82rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}
                >
                  ✕
                </button>
              )}
            </div>

            <button
              onClick={() => handleOpenPublishModal()}
              style={{
                background: 'linear-gradient(135deg, rgba(203, 161, 53, 0.25) 0%, rgba(203, 161, 53, 0.1) 100%)',
                border: '1px solid var(--gold-primary)',
                color: 'var(--gold-primary)',
                borderRadius: '8px',
                padding: '9px 14px',
                fontSize: '0.82rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              <span>📤</span> {lang === 'es' ? 'Publicar Mi Mod (URL)' : 'Publish My Mod (URL)'}
            </button>
          </div>

          {/* Filtros por Capa + Ordenación */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            {/* Categorías */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
              {[
                { id: 'all', label: lang === 'es' ? 'Todos' : 'All' },
                { id: 'missions', label: '🎲 Misiones' },
                { id: 'rules_ai', label: '🤖 Árbitro IA' },
                { id: 'army_builder', label: '⚔️ Listas & Perfiles' },
                { id: 'duels', label: '🤺 Duelos' },
                { id: 'offline', label: '📦 Con Offline (PDFs)' }
              ].map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  style={{
                    background: selectedCategory === cat.id ? 'rgba(203, 161, 53, 0.2)' : 'rgba(255,255,255,0.03)',
                    border: selectedCategory === cat.id ? '1px solid var(--gold-primary)' : '1px solid rgba(255,255,255,0.08)',
                    color: selectedCategory === cat.id ? 'var(--gold-primary)' : 'var(--text-secondary)',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Ordenación */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>{lang === 'es' ? 'Ordenar:' : 'Sort:'}</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  background: 'rgba(0,0,0,0.5)',
                  border: 'var(--border-glass)',
                  color: '#fff',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '0.74rem'
                }}
              >
                <option value="rating">{lang === 'es' ? '⭐ Mejor valorados' : '⭐ Top Rated'}</option>
                <option value="recent">{lang === 'es' ? '🆕 Más recientes' : '🆕 Most Recent'}</option>
                <option value="reviews">{lang === 'es' ? '💬 Más comentados' : '💬 Most Reviews'}</option>
                <option value="name">{lang === 'es' ? '🔤 Nombre (A-Z)' : '🔤 Name (A-Z)'}</option>
              </select>
            </div>
          </div>

          {/* Grid de Mods Comunitarios */}
          {loadingCommunity ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>⏳</div>
              {lang === 'es' ? 'Cargando catálogo comunitario...' : 'Loading community workshop...'}
            </div>
          ) : filteredCommunityMods.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: 'var(--border-glass)' }}>
              <div style={{ fontSize: '2.2rem', marginBottom: '8px' }}>🔍</div>
              <h4 style={{ color: 'var(--gold-primary)', margin: '0 0 6px 0' }}>
                {searchQuery || selectedCategory !== 'all'
                  ? (lang === 'es' ? 'No se encontraron mods con esos filtros' : 'No mods found matching criteria')
                  : (lang === 'es' ? '¡El taller comunitario está esperando el primer mod!' : 'The workshop is waiting for its first mod!')}
              </h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 16px 0' }}>
                {lang === 'es'
                  ? 'Sé el primero en compartir tu paquete de misiones o suplemento con toda la comunidad.'
                  : 'Be the first to share your mission pack or supplement with the community.'}
              </p>
              <button
                onClick={() => handleOpenPublishModal()}
                style={{
                  background: 'var(--gold-primary)',
                  color: '#111',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                  cursor: 'pointer'
                }}
              >
                📤 {lang === 'es' ? 'Publicar Nuevo Mod' : 'Publish New Mod'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '14px' }}>
              {filteredCommunityMods.map(cMod => {
                const installedLocal = installedMods.find(m => m.modId === cMod.name || m.modName === cMod.name);
                const isInstalled = Boolean(installedLocal);
                const isOwner = user && cMod.authorUid === user.uid;
                const isAdmin = profile?.role === 'admin' || profile?.isGlobalAdmin;

                return (
                  <div
                    key={cMod.id}
                    style={{
                      background: 'rgba(0,0,0,0.4)',
                      border: isInstalled ? '1px solid rgba(46, 204, 113, 0.4)' : 'var(--border-glass)',
                      borderRadius: '12px',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '12px',
                      position: 'relative'
                    }}
                  >
                    <div>
                      {/* Cabecera de la tarjeta: Badges + Versión */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {cMod.capabilities?.includes('missions') && (
                            <span style={{ fontSize: '0.65rem', background: 'rgba(52, 152, 219, 0.2)', border: '1px solid #3498db', color: '#3498db', padding: '2px 6px', borderRadius: '4px' }}>
                              🎲 Misiones
                            </span>
                          )}
                          {cMod.capabilities?.includes('rules_ai') && (
                            <span style={{ fontSize: '0.65rem', background: 'rgba(155, 89, 182, 0.2)', border: '1px solid #9b59b6', color: '#9b59b6', padding: '2px 6px', borderRadius: '4px' }}>
                              🤖 Árbitro IA
                            </span>
                          )}
                          {cMod.capabilities?.includes('army_builder') && (
                            <span style={{ fontSize: '0.65rem', background: 'rgba(230, 126, 34, 0.2)', border: '1px solid #e67e22', color: '#e67e22', padding: '2px 6px', borderRadius: '4px' }}>
                              ⚔️ Listas
                            </span>
                          )}
                          {cMod.hasOfflinePdf && (
                            <span style={{ fontSize: '0.65rem', background: 'rgba(46, 204, 113, 0.2)', border: '1px solid #2ecc71', color: '#2ecc71', padding: '2px 6px', borderRadius: '4px' }}>
                              📦 Offline
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          v{cMod.version || '1.0.0'}
                        </span>
                      </div>

                      {/* Título y Autor */}
                      <h4 style={{ margin: '0 0 2px 0', color: 'var(--gold-primary)', fontSize: '1rem', lineHeight: '1.3' }}>
                        {cMod.name}
                      </h4>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        {lang === 'es' ? 'Por' : 'By'} <strong>@{cMod.author || 'Creador'}</strong>
                      </div>

                      {/* Descripción */}
                      {cMod.description && (
                        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {cMod.description}
                        </p>
                      )}
                    </div>

                    {/* Footer de Tarjeta: Reseñas + Botones de Acción */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
                      {/* Botón de Puntuación Estilo Google Maps */}
                      <button
                        type="button"
                        onClick={() => handleOpenReviewsModal(cMod)}
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(203, 161, 53, 0.25)',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          color: '#fff',
                          fontSize: '0.75rem'
                        }}
                        title={lang === 'es' ? 'Ver reseñas y puntuaciones' : 'View reviews and ratings'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ color: '#f1c40f' }}>★</span>
                          <strong>{cMod.ratingAvg > 0 ? cMod.ratingAvg : 'Sin votos'}</strong>
                          <span style={{ color: 'var(--text-muted)' }}>({cMod.ratingCount || 0} {lang === 'es' ? 'reseñas' : 'reviews'})</span>
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--gold-primary)' }}>
                          {lang === 'es' ? 'Ver opiniones ➔' : 'Reviews ➔'}
                        </span>
                      </button>

                      {/* Botón Instalar / Actualizar */}
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => handleInstallCommunityMod(cMod)}
                          style={{
                            flex: 1,
                            background: isInstalled ? 'rgba(46, 204, 113, 0.15)' : 'var(--gold-primary)',
                            border: isInstalled ? '1px solid #2ecc71' : 'none',
                            color: isInstalled ? '#2ecc71' : '#111',
                            borderRadius: '6px',
                            padding: '8px',
                            fontWeight: 'bold',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px'
                          }}
                        >
                          {isInstalled ? (
                            <><span>✔️</span> {lang === 'es' ? 'Reinstalar' : 'Reinstall'}</>
                          ) : (
                            <><span>⬇️</span> {lang === 'es' ? 'Instalar (1-Clic)' : 'Install (1-Click)'}</>
                          )}
                        </button>

                        {/* Botón Reportar */}
                        <button
                          type="button"
                          onClick={() => handleOpenReportModal(cMod)}
                          style={{
                            background: 'rgba(255,255,255,0.04)',
                            border: 'var(--border-glass)',
                            color: 'var(--text-muted)',
                            borderRadius: '6px',
                            padding: '8px 10px',
                            fontSize: '0.75rem',
                            cursor: 'pointer'
                          }}
                          title={lang === 'es' ? 'Reportar fallo al creador o enlace caído a administradores' : 'Report bug or broken link'}
                        >
                          🚨
                        </button>

                        {/* Opciones de Autor / Admin */}
                        {(isOwner || isAdmin) && (
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => handleOpenPublishModal(cMod)}
                              style={{ background: 'rgba(255,255,255,0.04)', border: 'var(--border-glass)', color: 'var(--gold-primary)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.75rem', cursor: 'pointer' }}
                              title="Editar publicación"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCommunityMod(cMod)}
                              style={{ background: 'rgba(231, 76, 60, 0.15)', border: '1px solid #e74c3c', color: '#e74c3c', borderRadius: '6px', padding: '8px 10px', fontSize: '0.75rem', cursor: 'pointer' }}
                              title="Eliminar publicación"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* PESTAÑA 2: MIS MODS INSTALADOS (ALMACENAMIENTO PRIVADO LOCAL)             */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'installed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Panel de Importación */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(203, 161, 53, 0.08) 0%, rgba(0,0,0,0.4) 100%)',
              border: '1px solid rgba(203, 161, 53, 0.3)',
              borderRadius: '12px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--gold-primary)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📥</span> {lang === 'es' ? 'Importar Manualmente (Archivo o URL)' : 'Manual Import (File or URL)'}
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  {lang === 'es'
                    ? 'Carga un archivo .json desde tu dispositivo o introduce una URL pública externa.'
                    : 'Load a .json file from your device or enter a public external URL.'}
                </p>
              </div>

              <label
                style={{
                  background: 'var(--gold-primary)',
                  color: '#111',
                  borderRadius: '8px',
                  padding: '9px 16px',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>📂</span> {lang === 'es' ? 'Cargar Archivo JSON' : 'Upload JSON File'}
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            {/* Input URL */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://raw.githubusercontent.com/.../mod.json"
                style={{
                  flex: 1,
                  background: 'rgba(0,0,0,0.5)',
                  border: 'var(--border-glass)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  color: '#fff',
                  fontSize: '0.8rem',
                  outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={handleInstallFromUrl}
                disabled={urlDownloading || !urlInput.trim()}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: 'var(--border-glass)',
                  color: '#fff',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                  cursor: urlDownloading ? 'wait' : 'pointer'
                }}
              >
                {urlDownloading ? (lang === 'es' ? 'Descargando...' : 'Downloading...') : (lang === 'es' ? 'Descargar e Instalar' : 'Fetch & Install')}
              </button>
            </div>
          </div>

          {/* Lista de Mods Instalados */}
          <div>
            <h3 style={{ color: 'var(--gold-primary)', fontSize: '1.05rem', margin: '0 0 12px 0' }}>
              {lang === 'es' ? 'Mods Guardados en IndexedDB Local' : 'Mods Saved in Local IndexedDB'} ({installedMods.length})
            </h3>

            {installedMods.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: 'var(--border-glass)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 12px 0' }}>
                  {lang === 'es' ? 'No tienes ningún mod instalado en este navegador.' : 'No mods installed in this browser.'}
                </p>
                <button
                  onClick={() => setActiveTab('workshop')}
                  style={{ background: 'var(--gold-primary)', color: '#111', border: 'none', borderRadius: '6px', padding: '8px 14px', fontWeight: 'bold', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  🌐 {lang === 'es' ? 'Ir al Taller Comunitario' : 'Go to Community Workshop'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {installedMods.map(mod => (
                  <div
                    key={mod.modId}
                    style={{
                      background: 'rgba(0,0,0,0.3)',
                      border: 'var(--border-glass)',
                      borderRadius: '10px',
                      padding: '14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h4 style={{ margin: 0, color: '#fff', fontSize: '0.95rem' }}>{mod.modName}</h4>
                        <span style={{ fontSize: '0.7rem', color: 'var(--gold-primary)', background: 'rgba(203, 161, 53, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                          v{mod.modVersion || '1.0'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {lang === 'es' ? 'Autor:' : 'Author:'} @{mod.modAuthor || 'Desconocido'} · {lang === 'es' ? 'Sistema:' : 'System:'} {mod.gameSystem || 'MESBG'}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleUninstall(mod.modId)}
                      style={{
                        background: 'rgba(231, 76, 60, 0.15)',
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      🗑️ {lang === 'es' ? 'Desinstalar' : 'Uninstall'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* PESTAÑA 3: CONFIGURACIÓN POR CAPAS                                        */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'layers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            {lang === 'es'
              ? 'Puedes combinar módulos de distintos mods (por ejemplo: las misiones de un mod y el árbitro IA de otro).'
              : 'You can combine layers from different mods.'}
          </p>

          {[
            { id: MOD_LAYERS.MISSIONS, label: '🎲 Capa de Misiones y Escenarios', desc: 'Controla qué misiones aparecen en el selector aleatorio y torneos.' },
            { id: MOD_LAYERS.RULES_AI, label: '🤖 Capa de Árbitro de Reglas con IA', desc: 'Base de conocimiento y suplementos para el asistente consultivo.' },
            { id: MOD_LAYERS.ARMY_BUILDER, label: '⚔️ Capa de Constructor de Listas & Perfiles', desc: 'Facciones, héroes, guerreros y costes en puntos.' },
            { id: MOD_LAYERS.DUELS, label: '🤺 Capa de Duelos & Calculadora de Combate', desc: 'Perfiles de atributos para simulaciones de combate.' }
          ].map(layer => (
            <div
              key={layer.id}
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: 'var(--border-glass)',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div style={{ maxWidth: '480px' }}>
                <h4 style={{ margin: '0 0 4px 0', color: 'var(--gold-primary)', fontSize: '0.92rem' }}>{layer.label}</h4>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{layer.desc}</p>
              </div>

              <select
                value={activeLayers[layer.id] || 'none'}
                onChange={(e) => handleLayerChange(layer.id, e.target.value)}
                style={{
                  background: 'rgba(0,0,0,0.6)',
                  border: '1px solid rgba(203, 161, 53, 0.4)',
                  color: '#fff',
                  padding: '7px 12px',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  minWidth: '180px'
                }}
              >
                <option value="none">{lang === 'es' ? '⚪ Ninguno (Desactivado)' : '⚪ None (Disabled)'}</option>
                {installedMods.map(m => (
                  <option key={m.modId} value={m.modId}>
                    📦 {m.modName} (v{m.modVersion || '1.0'})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* PESTAÑA 4: GUÍA PARA CREADORES & VALIDADOR                                 */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'docs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Plantillas y Manual */}
          <div style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: '12px', padding: '18px' }}>
            <h3 style={{ color: 'var(--gold-primary)', margin: '0 0 10px 0', fontSize: '1rem' }}>
              📚 {lang === 'es' ? 'Recursos Oficiales para Desarrolladores de Mods' : 'Official Resources for Mod Creators'}
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: '1.4' }}>
              {lang === 'es'
                ? 'Descarga las plantillas en formato JSON para crear tus propios paquetes de misiones, perfiles o suplementos de reglas para el Árbitro IA.'
                : 'Download JSON templates to create mission packs, profiles or rule supplements.'}
            </p>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => setIsGuideModalOpen(true)} style={{ background: 'var(--gold-primary)', color: '#111', border: 'none', borderRadius: '6px', padding: '8px 14px', fontWeight: 'bold', fontSize: '0.78rem', cursor: 'pointer' }}>
                📖 {lang === 'es' ? 'Leer Manual en Pantalla' : 'Read Creator Manual'}
              </button>
              <button onClick={handleDownloadTemplateMissions} style={{ background: 'rgba(255,255,255,0.06)', border: 'var(--border-glass)', color: '#fff', borderRadius: '6px', padding: '8px 14px', fontSize: '0.78rem', cursor: 'pointer' }}>
                📥 {lang === 'es' ? 'Plantilla Misiones (.JSON)' : 'Missions Template (.JSON)'}
              </button>
              <button onClick={handleDownloadTemplateRulesAi} style={{ background: 'rgba(255,255,255,0.06)', border: 'var(--border-glass)', color: '#fff', borderRadius: '6px', padding: '8px 14px', fontSize: '0.78rem', cursor: 'pointer' }}>
                📥 {lang === 'es' ? 'Plantilla Árbitro IA (.JSON)' : 'AI Rules Template (.JSON)'}
              </button>
            </div>
          </div>

          {/* Validador de Esquema en Vivo */}
          <div style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: '12px', padding: '18px' }}>
            <h3 style={{ color: 'var(--gold-primary)', margin: '0 0 8px 0', fontSize: '1rem' }}>
              🧪 {lang === 'es' ? 'Validador de Esquema en Vivo' : 'Live Schema Validator'}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 12px 0' }}>
              {lang === 'es'
                ? 'Pega el código JSON de tu mod para verificar al instante que cumple con el estándar de compatibilidad.'
                : 'Paste your mod JSON code to verify compatibility standard.'}
            </p>

            <textarea
              value={validatorInput}
              onChange={(e) => setValidatorInput(e.target.value)}
              placeholder='{ "modId": "mi_mod", "modName": "Mi Super Mod", "schemaVersion": "1.0", ... }'
              rows={7}
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.6)',
                border: 'var(--border-glass)',
                borderRadius: '8px',
                padding: '10px',
                color: '#fff',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                boxSizing: 'border-box'
              }}
            />

            <div style={{ marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(validatorInput);
                    const res = validateModSchema(parsed);
                    setValidationReport(res);
                  } catch (e) {
                    setValidationReport({ valid: false, errors: [`Error de sintaxis JSON: ${e.message}`] });
                  }
                }}
                style={{ background: 'rgba(255,255,255,0.08)', border: 'var(--border-glass)', color: '#fff', borderRadius: '6px', padding: '8px 16px', fontWeight: 'bold', fontSize: '0.78rem', cursor: 'pointer' }}
              >
                🔍 {lang === 'es' ? 'Comprobar Esquema' : 'Validate Schema'}
              </button>
            </div>

            {validationReport && (
              <div style={{ marginTop: '14px', padding: '12px', borderRadius: '8px', background: validationReport.valid ? 'rgba(46, 204, 113, 0.15)' : 'rgba(231, 76, 60, 0.15)', border: `1px solid ${validationReport.valid ? '#2ecc71' : '#e74c3c'}` }}>
                {validationReport.valid ? (
                  <div style={{ color: '#2ecc71', fontSize: '0.8rem' }}>
                    <strong>✅ ¡Esquema 100% válido y compatible con La Cuchara de Lobelia!</strong>
                  </div>
                ) : (
                  <div style={{ color: '#ff7675', fontSize: '0.8rem' }}>
                    <strong>❌ Errores encontrados:</strong>
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: '18px' }}>
                      {validationReport.errors.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: RESEÑAS & PUNTUACIÓN (GOOGLE MAPS STYLE)                         */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {isReviewsModalOpen && selectedModForReviews && (
        <Modal
          isOpen={true}
          size="medium"
          onClose={() => setIsReviewsModalOpen(false)}
          title={`⭐ ${selectedModForReviews.name}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Cabecera de Puntuación Media */}
            <div style={{ background: 'rgba(203, 161, 53, 0.08)', border: '1px solid rgba(203, 161, 53, 0.3)', borderRadius: '10px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--gold-primary)', fontFamily: 'var(--font-title)' }}>
                    {selectedModForReviews.ratingAvg > 0 ? selectedModForReviews.ratingAvg : '–'}
                  </span>
                  <span style={{ fontSize: '1rem', color: '#f1c40f' }}>★★★★★</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    ({selectedModForReviews.ratingCount || 0} {lang === 'es' ? 'valoraciones globales' : 'total ratings'})
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {lang === 'es' ? 'Versión actual:' : 'Current version:'} <strong>v{selectedModForReviews.version}</strong>
                  {selectedModForReviews.ratingCountLatest > 0 && (
                    <span> · ⭐ {selectedModForReviews.ratingAvgLatest} ({selectedModForReviews.ratingCountLatest} {lang === 'es' ? 'en esta versión' : 'on this version'})</span>
                  )}
                </div>
              </div>

              {/* Selector de Filtro de Versión */}
              <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: '6px', padding: '2px', border: 'var(--border-glass)' }}>
                <button
                  type="button"
                  onClick={() => setReviewVersionFilter('latest')}
                  style={{
                    background: reviewVersionFilter === 'latest' ? 'var(--gold-primary)' : 'transparent',
                    color: reviewVersionFilter === 'latest' ? '#111' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 10px',
                    fontSize: '0.72rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  ⭐ {lang === 'es' ? `Versión v${selectedModForReviews.version}` : `v${selectedModForReviews.version} only`}
                </button>
                <button
                  type="button"
                  onClick={() => setReviewVersionFilter('all')}
                  style={{
                    background: reviewVersionFilter === 'all' ? 'var(--gold-primary)' : 'transparent',
                    color: reviewVersionFilter === 'all' ? '#111' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 10px',
                    fontSize: '0.72rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  🌐 {lang === 'es' ? 'Histórico completo' : 'All versions'}
                </button>
              </div>
            </div>

            {/* Formulario para dejar/editar reseña */}
            {user ? (
              <div style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: '10px', padding: '14px' }}>
                <h5 style={{ margin: '0 0 8px 0', color: 'var(--gold-primary)', fontSize: '0.85rem' }}>
                  ✍️ {lang === 'es' ? 'Tu valoración de este mod' : 'Your review'} (v{selectedModForReviews.version})
                </h5>

                {/* Selector interactivo de estrellas */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setUserRating(star)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: '1.4rem',
                        cursor: 'pointer',
                        color: star <= userRating ? '#f1c40f' : 'rgba(255,255,255,0.2)',
                        padding: 0
                      }}
                    >
                      ★
                    </button>
                  ))}
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: '6px' }}>
                    {userRating} / 5
                  </span>
                </div>

                <textarea
                  value={userComment}
                  onChange={(e) => setUserComment(e.target.value)}
                  placeholder={lang === 'es' ? 'Escribe tu opinión, sugerencia o feedback para el autor...' : 'Write your feedback for the author...'}
                  rows={2}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.5)',
                    border: 'var(--border-glass)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    color: '#fff',
                    fontSize: '0.78rem',
                    boxSizing: 'border-box'
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                  {modReviews.some(r => r.userUid === user?.uid) && (
                    <button
                      type="button"
                      onClick={handleDeleteUserReview}
                      disabled={isSubmittingReview}
                      style={{ background: 'transparent', border: 'none', color: '#e74c3c', fontSize: '0.75rem', cursor: 'pointer' }}
                    >
                      🗑️ {lang === 'es' ? 'Eliminar mi reseña' : 'Delete my review'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveUserReview}
                    disabled={isSubmittingReview}
                    style={{
                      background: 'var(--gold-primary)',
                      border: 'none',
                      color: '#111',
                      borderRadius: '6px',
                      padding: '6px 14px',
                      fontWeight: 'bold',
                      fontSize: '0.78rem',
                      cursor: 'pointer'
                    }}
                  >
                    {isSubmittingReview ? (lang === 'es' ? 'Guardando...' : 'Saving...') : (lang === 'es' ? 'Publicar Valoración' : 'Submit Review')}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                🔒 {lang === 'es' ? 'Inicia sesión para dejar tu valoración y comentario.' : 'Log in to leave a review.'}
              </div>
            )}

            {/* Listado de Reseñas de Jugadores */}
            <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {loadingReviews ? (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  ⏳ {lang === 'es' ? 'Cargando opiniones...' : 'Loading reviews...'}
                </div>
              ) : filteredReviews.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {reviewVersionFilter === 'latest'
                    ? (lang === 'es' ? `Aún no hay reseñas en la versión v${selectedModForReviews.version}. ¡Sé el primero!` : `No reviews for v${selectedModForReviews.version} yet.`)
                    : (lang === 'es' ? 'Aún no hay reseñas registradas.' : 'No reviews recorded yet.')}
                </div>
              ) : (
                filteredReviews.map((rev) => (
                  <div
                    key={rev.id || rev.userUid}
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '8px',
                      padding: '10px 12px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <strong style={{ fontSize: '0.82rem', color: 'var(--gold-primary)' }}>
                          {rev.userName || 'Jugador'}
                        </strong>
                        <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: '3px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          v{rev.version || '1.0'}
                        </span>
                      </div>
                      <span style={{ color: '#f1c40f', fontSize: '0.8rem' }}>
                        {'★'.repeat(rev.rating)}{'☆'.repeat(5 - rev.rating)}
                      </span>
                    </div>

                    {rev.comment && (
                      <p style={{ margin: 0, fontSize: '0.78rem', color: '#ddd', lineHeight: '1.4' }}>
                        {rev.comment}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

          </div>
        </Modal>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: PUBLICAR / EDITAR MOD COMUNITARIO (URL EXTERNA)                  */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {isPublishModalOpen && (
        <Modal
          isOpen={true}
          size="medium"
          onClose={() => setIsPublishModalOpen(false)}
          title={editingModId ? (lang === 'es' ? '✏️ Editar Publicación de Mod' : '✏️ Edit Mod Listing') : (lang === 'es' ? '📤 Publicar Mod en el Taller' : '📤 Publish Mod to Workshop')}
        >
          <form onSubmit={handleSavePublishForm} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
              {lang === 'es'
                ? 'Introduce la URL pública directa a tu archivo .json (por ejemplo de GitHub Raw, Gist, Pastebin o CDN). Nosotros no guardamos tu archivo, solo compartimos el enlace con la comunidad.'
                : 'Enter direct public URL to your .json file. We only share the link with the community.'}
            </p>

            {/* URL del JSON + Botón de Prueba */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>
                {lang === 'es' ? '1. URL Pública del Archivo JSON *' : '1. Public JSON URL *'}
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  required
                  type="url"
                  value={publishForm.jsonUrl}
                  onChange={(e) => setPublishForm(f => ({ ...f, jsonUrl: e.target.value }))}
                  placeholder="https://raw.githubusercontent.com/.../mod.json"
                  style={{
                    flex: 1,
                    background: 'rgba(0,0,0,0.5)',
                    border: 'var(--border-glass)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    color: '#fff',
                    fontSize: '0.8rem'
                  }}
                />
                <button
                  type="button"
                  onClick={handleValidatePublishUrl}
                  disabled={isValidatingUrl}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: 'var(--border-glass)',
                    color: 'var(--gold-primary)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    cursor: isValidatingUrl ? 'wait' : 'pointer'
                  }}
                >
                  {isValidatingUrl ? '⏳' : '🔍 Probar'}
                </button>
              </div>

              {urlValidationResult && (
                <div style={{ fontSize: '0.72rem', color: urlValidationResult.valid ? '#2ecc71' : '#ff7675', marginTop: '2px' }}>
                  {urlValidationResult.message}
                </div>
              )}
            </div>

            {/* Nombre y Versión */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>
                  {lang === 'es' ? '2. Nombre del Mod *' : '2. Mod Name *'}
                </label>
                <input
                  required
                  type="text"
                  value={publishForm.name}
                  onChange={(e) => setPublishForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Pack Misiones Amoncât 2026"
                  style={{ background: 'rgba(0,0,0,0.5)', border: 'var(--border-glass)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.8rem' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>
                  {lang === 'es' ? 'Versión *' : 'Version *'}
                </label>
                <input
                  required
                  type="text"
                  value={publishForm.version}
                  onChange={(e) => setPublishForm(f => ({ ...f, version: e.target.value }))}
                  placeholder="1.0.0"
                  style={{ background: 'rgba(0,0,0,0.5)', border: 'var(--border-glass)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.8rem', fontFamily: 'monospace' }}
                />
              </div>
            </div>

            {/* Autor / Comunidad */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>
                {lang === 'es' ? '3. Nombre del Creador / Comunidad *' : '3. Creator / Community Name *'}
              </label>
              <input
                required
                type="text"
                value={publishForm.author}
                onChange={(e) => setPublishForm(f => ({ ...f, author: e.target.value }))}
                placeholder="Ej: Tessen MESBG Team / @TuNick"
                style={{ background: 'rgba(0,0,0,0.5)', border: 'var(--border-glass)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.8rem' }}
              />
            </div>

            {/* Selector de Módulos / Capas que incluye */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>
                {lang === 'es' ? '4. ¿Qué incluye este mod?' : '4. Capabilities Included:'}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  { id: 'missions', label: '🎲 Misiones y Mapas' },
                  { id: 'rules_ai', label: '🤖 Árbitro IA' },
                  { id: 'army_builder', label: '⚔️ Listas & Perfiles' },
                  { id: 'duels', label: '🤺 Duelos & Combate' }
                ].map(cap => {
                  const checked = publishForm.capabilities.includes(cap.id);
                  return (
                    <label key={cap.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#ddd', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: '6px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setPublishForm(f => ({ ...f, capabilities: [...f.capabilities, cap.id] }));
                          } else {
                            setPublishForm(f => ({ ...f, capabilities: f.capabilities.filter(c => c !== cap.id) }));
                          }
                        }}
                      />
                      {cap.label}
                    </label>
                  );
                })}
              </div>

              {/* Sub-opción para Misiones: Offline */}
              {publishForm.capabilities.includes('missions') && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--gold-primary)', cursor: 'pointer', marginTop: '2px' }}>
                  <input
                    type="checkbox"
                    checked={publishForm.hasOfflinePdf}
                    onChange={(e) => setPublishForm(f => ({ ...f, hasOfflinePdf: e.target.checked }))}
                  />
                  <span>📦 {lang === 'es' ? 'Incluye PDFs descargables para soporte 100% Offline' : 'Includes downloadable PDFs for 100% Offline support'}</span>
                </label>
              )}
            </div>

            {/* Descripción */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>
                {lang === 'es' ? '5. Descripción del Mod' : '5. Mod Description'}
              </label>
              <textarea
                value={publishForm.description}
                onChange={(e) => setPublishForm(f => ({ ...f, description: e.target.value }))}
                placeholder={lang === 'es' ? 'Explica qué reglas, misiones o perfiles incluye...' : 'Explain what is included...'}
                rows={3}
                style={{ background: 'rgba(0,0,0,0.5)', border: 'var(--border-glass)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.8rem' }}
              />
            </div>

            {/* Enlace Comunitario / Discord */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {lang === 'es' ? 'Enlace a tu Discord / Grupo de WhatsApp / Web (Opcional):' : 'Discord / WhatsApp / Web Link (Optional):'}
              </label>
              <input
                type="url"
                value={publishForm.communityLink}
                onChange={(e) => setPublishForm(f => ({ ...f, communityLink: e.target.value }))}
                placeholder="https://discord.gg/... o https://chat.whatsapp.com/..."
                style={{ background: 'rgba(0,0,0,0.5)', border: 'var(--border-glass)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.8rem' }}
              />
            </div>

            {/* Botones de Envío */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => setIsPublishModalOpen(false)}
                style={{ background: 'rgba(255,255,255,0.06)', border: 'var(--border-glass)', color: '#fff', padding: '8px 14px', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer' }}
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSubmittingPublish}
                style={{
                  background: 'var(--gold-primary)',
                  border: 'none',
                  color: '#111',
                  padding: '8px 18px',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                  cursor: 'pointer'
                }}
              >
                {isSubmittingPublish
                  ? (lang === 'es' ? 'Guardando...' : 'Saving...')
                  : editingModId
                    ? (lang === 'es' ? 'Guardar Cambios' : 'Save Changes')
                    : (lang === 'es' ? 'Publicar en el Taller' : 'Publish to Workshop')}
              </button>
            </div>

          </form>
        </Modal>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: REPORTE DUAL (CREADOR VS ADMIN)                                  */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {isReportModalOpen && selectedModForReport && (
        <Modal
          isOpen={true}
          size="small"
          onClose={() => setIsReportModalOpen(false)}
          title={`🚨 Reportar: ${selectedModForReport.name}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            {/* Selector de Destinatario: Creador vs Admin */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setReportType('creator')}
                style={{
                  background: reportType === 'creator' ? 'rgba(203, 161, 53, 0.2)' : 'rgba(255,255,255,0.04)',
                  border: reportType === 'creator' ? '1px solid var(--gold-primary)' : '1px solid rgba(255,255,255,0.1)',
                  color: reportType === 'creator' ? 'var(--gold-primary)' : 'var(--text-secondary)',
                  borderRadius: '8px',
                  padding: '10px',
                  textAlign: 'center',
                  fontSize: '0.78rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '1.2rem', marginBottom: '2px' }}>🐛</div>
                {lang === 'es' ? 'Avisar al Creador (Bug / Fallo)' : 'Report Bug to Creator'}
              </button>

              <button
                type="button"
                onClick={() => setReportType('admin')}
                style={{
                  background: reportType === 'admin' ? 'rgba(231, 76, 60, 0.2)' : 'rgba(255,255,255,0.04)',
                  border: reportType === 'admin' ? '1px solid #e74c3c' : '1px solid rgba(255,255,255,0.1)',
                  color: reportType === 'admin' ? '#e74c3c' : 'var(--text-secondary)',
                  borderRadius: '8px',
                  padding: '10px',
                  textAlign: 'center',
                  fontSize: '0.78rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '1.2rem', marginBottom: '2px' }}>🛡️</div>
                {lang === 'es' ? 'Reportar a Admins (Abuso / Enlace Caído)' : 'Report to Admins'}
              </button>
            </div>

            {reportType === 'creator' ? (
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                💡 {lang === 'es' ? `Se enviará un Mensaje Privado (MP) directo al autor (@${selectedModForReport.author}) en su bandeja de entrada.` : `A direct PM will be sent to the author (@${selectedModForReport.author}).`}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.78rem', color: '#e74c3c', fontWeight: 'bold' }}>
                  {lang === 'es' ? 'Motivo del reporte:' : 'Reason:'}
                </label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  style={{ background: 'rgba(0,0,0,0.5)', border: 'var(--border-glass)', color: '#fff', padding: '8px', borderRadius: '6px', fontSize: '0.78rem' }}
                >
                  <option value="broken_link">{lang === 'es' ? 'Enlace caído / 404' : 'Broken link / 404'}</option>
                  <option value="inappropriate">{lang === 'es' ? 'Contenido inapropiado / Spam' : 'Inappropriate content / Spam'}</option>
                  <option value="malicious">{lang === 'es' ? 'Mod malicioso / Falso' : 'Malicious mod'}</option>
                  <option value="other">{lang === 'es' ? 'Otro motivo' : 'Other'}</option>
                </select>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>
                {lang === 'es' ? 'Detalle del reporte *:' : 'Details *:'}
              </label>
              <textarea
                required
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder={reportType === 'creator' ? (lang === 'es' ? 'Describe el fallo o errata encontrada...' : 'Describe the bug...') : (lang === 'es' ? 'Explica el motivo para los administradores...' : 'Explain the issue...')}
                rows={3}
                style={{ background: 'rgba(0,0,0,0.5)', border: 'var(--border-glass)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.8rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setIsReportModalOpen(false)}
                style={{ background: 'rgba(255,255,255,0.06)', border: 'var(--border-glass)', color: '#fff', padding: '8px 14px', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer' }}
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleSubmitReport}
                disabled={isSubmittingReport || !reportDetails.trim()}
                style={{
                  background: reportType === 'creator' ? 'var(--gold-primary)' : '#e74c3c',
                  border: 'none',
                  color: reportType === 'creator' ? '#111' : '#fff',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                  cursor: 'pointer'
                }}
              >
                {isSubmittingReport ? (lang === 'es' ? 'Enviando...' : 'Sending...') : (lang === 'es' ? 'Enviar Reporte' : 'Submit Report')}
              </button>
            </div>

          </div>
        </Modal>
      )}

      {/* ── MODAL: MANUAL OFICIAL DE CREADORES ── */}
      {isGuideModalOpen && (
        <Modal
          isOpen={true}
          size="large"
          onClose={() => setIsGuideModalOpen(false)}
          title={lang === 'es' ? "Manual Oficial para Creadores de Mods" : "Official Mod Creator Guide"}
        >
          <div style={{ maxHeight: '70vh', overflowY: 'auto', padding: '10px 4px', fontSize: '0.86rem', lineHeight: '1.6', color: '#ddd' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '14px' }}>
              <button
                onClick={handleDownloadGuide}
                style={{
                  background: 'var(--gold-primary)',
                  color: '#111',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '7px 16px',
                  fontWeight: 'bold',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                📥 {lang === 'es' ? 'Descargar Manual (.MD)' : 'Download Guide (.MD)'}
              </button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px', border: 'var(--border-glass)', margin: 0 }}>
              {CREATOR_GUIDE_MD}
            </pre>
          </div>
        </Modal>
      )}

      {/* ── MODAL DE DIÁLOGO / CONFIRMACIÓN IN-APP ── */}
      {dialog.isOpen && (
        <Modal
          isOpen={true}
          onClose={closeDialog}
          title={dialog.title}
          zIndex={9999}
        >
          <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: '1.5', margin: 0 }}>
              {dialog.message}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              {dialog.cancelText && (
                <button
                  type="button"
                  onClick={closeDialog}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: 'var(--text-secondary)',
                    borderRadius: '6px',
                    padding: '7px 16px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  {dialog.cancelText}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (dialog.onConfirm) {
                    dialog.onConfirm();
                  } else {
                    closeDialog();
                  }
                }}
                style={{
                  background: 'var(--gold-primary)',
                  border: 'none',
                  color: '#111',
                  borderRadius: '6px',
                  padding: '7px 18px',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL DE ELECCIÓN ONLINE VS OFFLINE ── */}
      {offlinePromptModal.isOpen && (
        <Modal
          isOpen={true}
          onClose={() => setOfflinePromptModal(prev => ({ ...prev, isOpen: false }))}
          title={lang === 'es' ? 'Opciones de Instalación del Mod' : 'Mod Installation Options'}
          zIndex={9999}
        >
          <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '2.5rem' }}>📦</span>
              <h4 style={{ color: 'var(--gold-primary)', margin: '8px 0 4px 0', fontSize: '1.1rem' }}>
                {offlinePromptModal.modName}
              </h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0, lineHeight: '1.4' }}>
                {lang === 'es'
                  ? 'Este mod contiene mapas y escenarios de misiones. Elige cómo prefieres que gestione los archivos PDF:'
                  : 'This mod contains scenario maps and mission PDFs. Choose how you want to handle PDF files:'}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              {/* Opción 1: Online */}
              <button
                type="button"
                onClick={() => handleExecuteInstall(offlinePromptModal.modJson, false, offlinePromptModal.sourceUrl, offlinePromptModal.communityModId)}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                <span style={{ fontSize: '1.8rem' }}>📡</span>
                <div>
                  <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '0.9rem' }}>
                    {lang === 'es' ? 'Solo Modo Online (0 MB de espacio)' : 'Online Mode Only (0 MB storage)'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {lang === 'es'
                      ? 'Instalación instantánea. Los PDFs se cargarán por streaming cuando los consultes.'
                      : 'Instant installation. PDFs will be streamed on-demand when clicked.'}
                  </div>
                </div>
              </button>

              {/* Opción 2: Offline Completo */}
              <button
                type="button"
                onClick={() => handleExecuteInstall(offlinePromptModal.modJson, true, offlinePromptModal.sourceUrl, offlinePromptModal.communityModId)}
                style={{
                  background: 'linear-gradient(135deg, rgba(203, 161, 53, 0.15) 0%, rgba(20, 20, 20, 0.8) 100%)',
                  border: '1px solid var(--gold-primary)',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  boxShadow: '0 4px 14px rgba(203, 161, 53, 0.2)'
                }}
              >
                <span style={{ fontSize: '1.8rem' }}>📦</span>
                <div>
                  <div style={{ fontWeight: 'bold', color: 'var(--gold-primary)', fontSize: '0.9rem' }}>
                    {lang === 'es' ? 'Descarga Completa Offline (Recomendado para torneos)' : 'Full Offline Download (Recommended for tournaments)'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)', marginTop: '2px' }}>
                    {lang === 'es'
                      ? `Descarga todos los PDFs al almacenamiento del navegador para consultarlos sin cobertura ni Wi-Fi.`
                      : `Downloads all PDFs into browser storage for 100% offline access anywhere.`}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL DE PROGRESO DE DESCARGA OFFLINE ── */}
      {downloadProgress.isDownloading && (
        <Modal
          isOpen={true}
          onClose={() => {}}
          title={lang === 'es' ? 'Descargando PDFs para Modo Offline' : 'Downloading PDFs for Offline Mode'}
          zIndex={10000}
        >
          <div style={{ padding: '16px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem' }}>⏳</div>
            <div>
              <h4 style={{ color: 'var(--gold-primary)', margin: '0 0 6px 0', fontSize: '1rem' }}>
                {downloadProgress.total > 0
                  ? (lang === 'es' 
                      ? `Guardando PDF ${downloadProgress.current} de ${downloadProgress.total}`
                      : `Saving PDF ${downloadProgress.current} of ${downloadProgress.total}`)
                  : (lang === 'es' ? 'Iniciando descarga...' : 'Starting download...')}
              </h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', margin: 0, wordBreak: 'break-all' }}>
                {downloadProgress.currentFile}
              </p>
            </div>

            <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div 
                style={{ 
                  height: '100%', 
                  background: 'var(--gold-primary)', 
                  width: `${downloadProgress.total > 0 ? (downloadProgress.current / downloadProgress.total) * 100 : 10}%`,
                  transition: 'width 0.2s ease' 
                }} 
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Aviso Legal de Motor Neutral */}
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: '1.5', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: 'var(--border-glass)', marginTop: '20px' }}>
        <strong>{lang === 'es' ? 'Aviso sobre Mods y Contenidos:' : 'Notice on Mods & Content:'}</strong> {lang === 'es'
          ? 'Los paquetes de mods son creados, compartidos por URLs públicas y procesados localmente en el navegador por los propios usuarios. La aplicación actúa como un motor de lectura abierto y no aloja ni distribuye contenidos propietarios sin autorización.'
          : 'Mod packages are created, shared via public URLs, and processed locally in the browser by users. The application operates as an open reader engine and does not host or distribute proprietary content without authorization.'}
      </div>

    </div>
  );
}
