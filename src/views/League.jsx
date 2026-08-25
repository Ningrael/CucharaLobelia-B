// src/views/League.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import QRCode from 'qrcode';
import logoHorizontalImg from '../assets/logo-horizontal.png';
import marcaSimboloImg from '../assets/marca-simbolo.png';
import { db } from '../utils/firebase';
import {
  LIGHT_FACTIONS,
  LIGHT_FACTIONS_LEGEND,
  DARK_FACTIONS,
  DARK_FACTIONS_LEGEND
} from '../utils/factions';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp,
  deleteField
} from 'firebase/firestore';
import Modal from '../components/Modal';
import PdfCanvasViewer from '../components/PdfCanvasViewer';
import { getEloTier, DEFAULT_ELO, calculateMatchElo } from '../utils/eloRating';
import { getMissionPdfUrl } from '../utils/modManager';

// --- CONFIGURACIÓN Y CONSTANTES ---

const ADMIN_USERNAMES = ['admin', 'lobelia', 'cuchara', 'matías', 'matias', 'sosa', 'sosamatias'];

// Convert Firestore map to 2D Array to support rounds structures (since Firestore rejects nested arrays)
const roundsMapToArray = (rounds) => {
  if (!rounds) return [];
  if (Array.isArray(rounds)) return rounds;
  const arr = [];
  const keys = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  keys.forEach(k => {
    arr[k] = rounds[k];
  });
  return arr;
};

// Convert 2D Array to Firestore map to avoid nested arrays
const roundsArrayToMap = (rounds) => {
  if (!rounds) return {};
  if (!Array.isArray(rounds)) return rounds;
  const map = {};
  rounds.forEach((roundMatches, rIdx) => {
    map[rIdx] = roundMatches;
  });
  return map;
};

const getTimestampMs = (ts) => {
  if (!ts) return 0;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') return new Date(ts).getTime();
  return 0;
};


const POOLS_1VS1 = [
  { name: { es: "1. Control de Zonas", en: "1. Zone Control" }, items: ['Domination', 'Capture & Control', 'Breakthrough', 'Stake a Claim'] },
  { name: { es: "2. Matar y Destruir", en: "2. Kill & Destroy" }, items: ['To the Death!', 'Lords of Battle', 'Assassination', 'Contest of Champions'] },
  { name: { es: "3. Objetivos Variables", en: "3. Variable Objectives" }, items: ['Hold Ground', 'Heirloom of Ages Past', 'Sites of Power', 'Command the Battlefield'] },
  { name: { es: "4. Escenarios de Suministros", en: "4. Supply Scenarios" }, items: ['Destroy the Supplies', 'Retrieval', 'Seize the Prizes', 'Treasure Hoard'] },
  { name: { es: "5. Movimiento y Flancos", en: "5. Maneuver & Flank" }, items: ['Reconnoitre', 'Storm the Camp', 'Divide & Conquer', 'Escort the Wounded'] },
  { name: { es: "6. Condiciones Especiales", en: "6. Special Conditions" }, items: ['Fog of War', 'Clash by Moonlight', 'Lead from the Front', 'Convergence'] }
];

// --- PLAYOFF BRACKET UTILITIES ---

// Recursión para avanzar ganadores en las llaves
const advanceWinner = (bracketData, rIdx, mIdx, winnerUid) => {
  const updated = { ...bracketData };
  const nextRIdx = rIdx + 1;
  if (nextRIdx < updated.rounds.length) {
    const nextMIdx = Math.floor(mIdx / 2);
    const nextMatch = updated.rounds[nextRIdx][nextMIdx];
    if (mIdx % 2 === 0) {
      nextMatch.player1 = winnerUid;
    } else {
      nextMatch.player2 = winnerUid;
    }
    
    // Si el nuevo rival es BYE, avanzar de forma recursiva e inmediata
    if (nextMatch.player2 === 'BYE') {
      nextMatch.verified = true;
      nextMatch.reportedVpP1 = 1;
      nextMatch.reportedVpP2 = 0;
      nextMatch.winner = nextMatch.player1;
      return advanceWinner(updated, nextRIdx, nextMIdx, nextMatch.player1);
    } else if (nextMatch.player1 === 'BYE') {
      nextMatch.verified = true;
      nextMatch.reportedVpP1 = 0;
      nextMatch.reportedVpP2 = 1;
      nextMatch.winner = nextMatch.player2;
      return advanceWinner(updated, nextRIdx, nextMIdx, nextMatch.player2);
    }
  }
  return updated;
};

// Generar emparejamientos de Ronda 1 de Playoffs (Formato de torneo tradicional o Luz vs Oscuridad)
const generateBracketRound1 = (selectedPlayers, prioritizeAlignment = false) => {
  const size = Math.max(2, Math.pow(2, Math.ceil(Math.log2(selectedPlayers.length))));
  const numMatches = size / 2;
  const matches = [];

  if (prioritizeAlignment) {
    const lights = selectedPlayers.filter(p => p.alignment === 'luz');
    const darks = selectedPlayers.filter(p => p.alignment === 'oscuridad');
    const neutrals = selectedPlayers.filter(p => p.alignment !== 'luz' && p.alignment !== 'oscuridad');

    const pairedLight = [];
    const pairedDark = [];
    
    // Emparejar Luz vs Oscuridad por orden de siembra (Top seed Luz vs Lowest seed Oscu)
    const matchCount = Math.min(lights.length, darks.length);
    for (let i = 0; i < matchCount; i++) {
      pairedLight.push(lights[i]);
      pairedDark.push(darks[darks.length - 1 - i]);
    }

    // Jugadores sobrantes (excedente del mismo bando o neutrales)
    const leftovers = [
      ...lights.slice(matchCount),
      ...darks.slice(0, darks.length - matchCount),
      ...neutrals
    ];

    const allP1 = [...pairedLight];
    const allP2 = [...pairedDark];

    while (leftovers.length > 0) {
      const p1 = leftovers.shift();
      const p2 = leftovers.length > 0 ? leftovers.pop() : { uid: 'BYE', name: 'DESCANSO (BYE)', alignment: 'none', faction: 'Ninguna' };
      allP1.push(p1);
      allP2.push(p2);
    }

    while (allP1.length < numMatches) {
      allP1.push({ uid: 'BYE', name: 'DESCANSO (BYE)', alignment: 'none', faction: 'Ninguna' });
      allP2.push({ uid: 'BYE', name: 'DESCANSO (BYE)', alignment: 'none', faction: 'Ninguna' });
    }

    for (let mIdx = 0; mIdx < numMatches; mIdx++) {
      const p1 = allP1[mIdx];
      const p2 = allP2[mIdx];
      const isBye = p1.uid === 'BYE' || p2.uid === 'BYE';
      let winner = "";
      if (isBye) {
        winner = p1.uid === 'BYE' ? p2.uid : p1.uid;
      }
      matches.push({
        player1: p1.uid,
        player2: p2.uid,
        verified: isBye,
        reportedBy: isBye ? "system" : "",
        reportedVpP1: isBye ? (p1.uid !== 'BYE' ? 1 : 0) : 0,
        reportedVpP2: isBye ? (p2.uid !== 'BYE' ? 1 : 0) : 0,
        reportedKilledLeaderP1: false,
        reportedKilledLeaderP2: false,
        winner: winner
      });
    }
  } else {
    // Formato tradicional por Siembra / Guerra Civil (1º vs Último, 2º vs Penúltimo, etc.)
    const padded = [...selectedPlayers];
    while (padded.length < size) {
      padded.push({ uid: 'BYE', name: 'DESCANSO (BYE)', alignment: 'none', faction: 'Ninguna' });
    }

    let seedOrder = [1, 2];
    while (seedOrder.length < size) {
      const nextOrder = [];
      const currentSize = seedOrder.length * 2;
      for (let i = 0; i < seedOrder.length; i++) {
        nextOrder.push(seedOrder[i]);
        nextOrder.push(currentSize + 1 - seedOrder[i]);
      }
      seedOrder = nextOrder;
    }

    for (let mIdx = 0; mIdx < numMatches; mIdx++) {
      const p1Seed = seedOrder[2 * mIdx];
      const p2Seed = seedOrder[2 * mIdx + 1];
      const p1 = padded[p1Seed - 1];
      const p2 = padded[p2Seed - 1];

      const isBye = p1.uid === 'BYE' || p2.uid === 'BYE';
      let winner = "";
      if (isBye) {
        winner = p1.uid === 'BYE' ? p2.uid : p1.uid;
      }

      matches.push({
        player1: p1.uid,
        player2: p2.uid,
        verified: isBye,
        reportedBy: isBye ? "system" : "",
        reportedVpP1: isBye ? (p1.uid !== 'BYE' ? 1 : 0) : 0,
        reportedVpP2: isBye ? (p2.uid !== 'BYE' ? 1 : 0) : 0,
        reportedKilledLeaderP1: false,
        reportedKilledLeaderP2: false,
        winner: winner
      });
    }
  }

  return { matches, size };
};

// Construir la estructura completa de rondas para llaves
const buildFullBracketStructure = (r1Matches, size) => {
  const rounds = [r1Matches];
  let currentSize = size / 2;
  
  while (currentSize > 1) {
    currentSize = currentSize / 2;
    const roundMatches = [];
    for (let i = 0; i < currentSize; i++) {
      roundMatches.push({
        player1: "",
        player2: "",
        verified: false,
        reportedBy: "",
        reportedVpP1: 0,
        reportedVpP2: 0,
        reportedKilledLeaderP1: false,
        reportedKilledLeaderP2: false,
        winner: ""
      });
    }
    rounds.push(roundMatches);
  }
  
  let bracketData = { size, rounds };
  // Propagar avances automáticos de BYE
  r1Matches.forEach((m, mIdx) => {
    if (m.verified && m.winner && m.winner !== 'BYE') {
      bracketData = advanceWinner(bracketData, 0, mIdx, m.winner);
    }
  });
  
  return bracketData;
};

// --- FIXTURE REGULAR ENGINE ---

// --- FIXTURE REGULAR ENGINE ---

const generateFixture = (plist, totalRounds, prioritizeAlignment) => {
  const playersList = plist.map(p => ({ ...p }));
  
  if (prioritizeAlignment) {
    let lights = playersList.filter(p => p.alignment === 'luz');
    let darks = playersList.filter(p => p.alignment === 'oscuridad');
    const neutrals = playersList.filter(p => p.alignment !== 'luz' && p.alignment !== 'oscuridad');

    // Distribuir neutrales equitativamente si los hubiera
    neutrals.forEach((n) => {
      if (lights.length <= darks.length) {
        lights.push(n);
      } else {
        darks.push(n);
      }
    });

    // Si el total es impar, añadir BYE al bando mayoritario para balancear
    if ((lights.length + darks.length) % 2 !== 0) {
      if (lights.length > darks.length) {
        darks.push({ uid: 'BYE', name: 'DESCANSO (BYE)', alignment: 'oscuridad', faction: 'Ninguna' });
      } else {
        lights.push({ uid: 'BYE', name: 'DESCANSO (BYE)', alignment: 'luz', faction: 'Ninguna' });
      }
    }

    // Mezcla aleatoria inicial para variedad de emparejamientos
    lights.sort(() => Math.random() - 0.5);
    darks.sort(() => Math.random() - 0.5);

    const minSide = Math.min(lights.length, darks.length);
    const rounds = [];

    for (let r = 0; r < totalRounds; r++) {
      const roundMatches = [];
      const usedL = new Set();
      const usedD = new Set();

      // 1. Cruces directos Luz vs Oscuridad con rotación circular por ronda
      for (let i = 0; i < minSide; i++) {
        const lPlayer = lights[i];
        const dIndex = (i + r) % darks.length;
        const dPlayer = darks[dIndex];
        
        roundMatches.push({
          player1: lPlayer.uid,
          player2: dPlayer.uid
        });
        usedL.add(lPlayer.uid);
        usedD.add(dPlayer.uid);
      }

      // 2. Jugadores sobrantes en el bando mayoritario juegan espejos rotativos
      const excessL = lights.filter(p => !usedL.has(p.uid));
      const excessD = darks.filter(p => !usedD.has(p.uid));

      if (excessL.length > 1) {
        for (let i = 0; i < excessL.length; i += 2) {
          if (i + 1 < excessL.length) {
            roundMatches.push({
              player1: excessL[(i + r) % excessL.length].uid,
              player2: excessL[(i + 1 + r) % excessL.length].uid
            });
          }
        }
      }

      if (excessD.length > 1) {
        for (let i = 0; i < excessD.length; i += 2) {
          if (i + 1 < excessD.length) {
            roundMatches.push({
              player1: excessD[(i + r) % excessD.length].uid,
              player2: excessD[(i + 1 + r) % excessD.length].uid
            });
          }
        }
      }

      rounds.push(roundMatches);
    }

    return rounds;
  } else {
    // GUERRA CIVIL (Round-Robin Método Polígono / Tablas de Berger con rotación y ciclos)
    let pool = [...playersList];
    if (pool.length % 2 !== 0) {
      pool.push({ uid: 'BYE', name: 'DESCANSO (BYE)', alignment: 'none', faction: 'Ninguna' });
    }

    pool.sort(() => Math.random() - 0.5);
    const n = pool.length;
    const roundsInCycle = n - 1;
    const half = n / 2;
    const baseRounds = [];

    let rotating = [...pool];
    for (let r = 0; r < roundsInCycle; r++) {
      const roundMatches = [];
      for (let i = 0; i < half; i++) {
        const p1 = rotating[i];
        const p2 = rotating[n - 1 - i];
        roundMatches.push({
          player1: p1.uid,
          player2: p2.uid
        });
      }
      baseRounds.push(roundMatches);

      // Rotar todos los elementos excepto el primero (método clásico Berger)
      const fixed = rotating[0];
      const rest = rotating.slice(1);
      rest.unshift(rest.pop());
      rotating = [fixed, ...rest];
    }

    const finalRounds = [];
    for (let r = 0; r < totalRounds; r++) {
      finalRounds.push(baseRounds[r % roundsInCycle]);
    }
    return finalRounds;
  }
};

// --- COMPONENTE PRINCIPAL ---

export default function League({ lang, translations, user, profile, isAdmin: isGlobalAdmin, authLoading, onOpenAuthModal, onStartChat, initialLeagueId }) {
  const t = translations[lang];

  // Navegación
  const [activeSubTab, setActiveSubTab] = useState('details'); // 'details', 'ranking', 'fixture', 'profile', 'admin'

  // Estados de búsqueda y filtrado de ligas
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all' | 'my'


  // Estados de Base de Datos
  const [players, setPlayers] = useState([]);
  const [playersMap, setPlayersMap] = useState({});
  const [matches, setMatches] = useState([]);
  const [leagueState, setLeagueState] = useState('registration');
  const [configData, setConfigData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);

  // Estados de Playoff (Llaves)
  const [winnersBracket, setWinnersBracket] = useState({ status: 'not_created', rounds: [] });
  const [losersBracket, setLosersBracket] = useState({ status: 'not_created', rounds: [] });
  const [activeFixtureView, setActiveFixtureView] = useState('regular'); // 'regular' | 'winners' | 'losers'

  // Estados para Generación en Admin (Rondas e Inscriptos)
  const [totalRoundsInput, setTotalRoundsInput] = useState(5);
  const [draftFixture, setDraftFixture] = useState(null);
  const [draftMissions, setDraftMissions] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Estados para Generación de Playoffs (Llaves)
  const [selectedPlayoffType, setSelectedPlayoffType] = useState('winners'); // 'winners' | 'losers'
  const [selectedPlayoffPlayers, setSelectedPlayoffPlayers] = useState([]);
  const [draftBracket, setDraftBracket] = useState(null);

  // Filtros de Fixture Regular
  const [selectedRoundFilter, setSelectedRoundFilter] = useState('all');

  // Modal Reporte
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [selectedMatchToReport, setSelectedMatchToReport] = useState(null); // { match, isBracket: bool, bracketId: string, roundIdx, matchIdx }
  const [myVpReport, setMyVpReport] = useState(0);
  const [rivalVpReport, setRivalVpReport] = useState(0);
  const [myLeaderKilledReport, setMyLeaderKilledReport] = useState(false);
  const [myLeaderLostReport, setMyLeaderLostReport] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // Modal Admin Override Match
  const [isAdminEditModalOpen, setIsAdminEditModalOpen] = useState(false);
  const [selectedMatchToEditAdmin, setSelectedMatchToEditAdmin] = useState(null); // { match, isBracket, bracketId, roundIdx, matchIdx }
  const [adminVpP1, setAdminVpP1] = useState(0);
  const [adminVpP2, setAdminVpP2] = useState(0);
  const [adminKilledP1, setAdminKilledP1] = useState(false);
  const [adminKilledP2, setAdminKilledP2] = useState(false);
  const [adminVerified, setAdminVerified] = useState(true);
  const [isAdminSaving, setIsAdminSaving] = useState(false);

  // Modal Admin Editar Ficha Jugador
  const [isPlayerEditModalOpen, setIsPlayerEditModalOpen] = useState(false);
  const [selectedPlayerToEdit, setSelectedPlayerToEdit] = useState(null);
  const [editPlayerName, setEditPlayerName] = useState('');
  const [editPlayerPhone, setEditPlayerPhone] = useState('');
  const [editPlayerFaction, setEditPlayerFaction] = useState('');
  const [editPlayerAlignment, setEditPlayerAlignment] = useState('luz');
  const [editPlayerIsAdmin, setEditPlayerIsAdmin] = useState(false);
  const [editPlayerParticipates, setEditPlayerParticipates] = useState(true);
  const [isPlayerSaving, setIsPlayerSaving] = useState(false);

  // Modal Admin Añadir Jugador Manualmente
  const [isAddPlayerModalOpen, setIsAddPlayerModalOpen] = useState(false);
  const [addPlayerSearch, setAddPlayerSearch] = useState('');
  const [selectedUserToAdd, setSelectedUserToAdd] = useState(null);
  const [addUserAlignment, setAddUserAlignment] = useState('luz');
  const [addUserFaction, setAddUserFaction] = useState('');
  const [allAvailableUsers, setAllAvailableUsers] = useState([]);
  const [isLoadingAllUsers, setIsLoadingAllUsers] = useState(false);
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);

  // Modal para Visor de PDF (Misiones)
  const [selectedMissionPdf, setSelectedMissionPdf] = useState(null);
  const [activePdfUrl, setActivePdfUrl] = useState(null);
  const [pdfLang, setPdfLang] = useState(() => {
    try {
      const stored = localStorage.getItem('lobelia_pdf_lang');
      if (stored === 'es' || stored === 'en') return stored;
    } catch (_) {}
    return lang;
  });

  useEffect(() => {
    try {
      const stored = localStorage.getItem('lobelia_pdf_lang');
      if (!stored) {
        setPdfLang(lang);
      }
    } catch (_) {}
  }, [lang]);

  // Estados de Multiligas
  const [selectedLeagueId, setSelectedLeagueId] = useState(null);
  const [leaguesList, setLeaguesList] = useState({});
  const [isCreateLeagueModalOpen, setIsCreateLeagueModalOpen] = useState(false);
  const [newLeagueName, setNewLeagueName] = useState('');
  const [newLeagueDeadline, setNewLeagueDeadline] = useState('');
  const [newLeagueLocation, setNewLeagueLocation] = useState('');
  const [newLeagueDescription, setNewLeagueDescription] = useState('');
  const [newLeagueRulesLink, setNewLeagueRulesLink] = useState('');
  const [isJoinLeagueModalOpen, setIsJoinLeagueModalOpen] = useState(false);
  const [joinAlignment, setJoinAlignment] = useState('luz');
  const [joinFaction, setJoinFaction] = useState('');
  const [joinPhone, setJoinPhone] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isPrioritizeModalOpen, setIsPrioritizeModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmModalMessage, setConfirmModalMessage] = useState('');
  const [confirmModalOnConfirm, setConfirmModalOnConfirm] = useState(null);

  const [pendingRegisterLeagueId, setPendingRegisterLeagueId] = useState(null);
  const [pendingCreateLeague, setPendingCreateLeague] = useState(false);

  // Modal de Compartir Liga (QR y Cartel Oficial de WhatsApp)
  const [isShareLeagueModalOpen, setIsShareLeagueModalOpen] = useState(false);
  const [shareLeagueData, setShareLeagueData] = useState(null);
  const [copiedLinkToast, setCopiedLinkToast] = useState(false);
  const [copiedImageToast, setCopiedImageToast] = useState(false);
  const [copiedTextToast, setCopiedTextToast] = useState(false);
  const qrCanvasRef = useRef(null);

  const getShareUrl = (leagueId) => {
    if (!leagueId) return '';
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `https://ningrael.github.io/CucharaLobelia-B/?league=${leagueId}`;
    }
    return `${window.location.origin}${window.location.pathname}?league=${leagueId}`;
  };

  const handleOpenShareModal = (leagueId, leagueObj) => {
    if (!leagueId || !leagueObj) return;
    setShareLeagueData({
      id: leagueId,
      name: leagueObj.name || 'Liga de MESBG',
      location: leagueObj.location || '',
      deadline: leagueObj.registrationDeadline || leagueObj.deadline || '',
      description: leagueObj.description || '',
      rulesLink: leagueObj.rulesLink || ''
    });
    setIsShareLeagueModalOpen(true);
  };

  // Generador del Cartel Oficial en Canvas
  useEffect(() => {
    if (!isShareLeagueModalOpen || !shareLeagueData || !qrCanvasRef.current) return;

    let isMounted = true;
    const canvas = qrCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = 800;
    const height = 860;
    canvas.width = width;
    canvas.height = height;

    const renderPoster = async () => {
      // 1. Fondo "Noche de Taberna"
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#06110a');
      bgGrad.addColorStop(0.3, '#0e2316');
      bgGrad.addColorStop(0.7, '#102418');
      bgGrad.addColorStop(1, '#050c07');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Doble marco dorado con esquinas en diamante
      ctx.save();
      ctx.strokeStyle = 'rgba(203, 161, 53, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(20, 20, width - 40, height - 40);

      ctx.strokeStyle = 'rgba(203, 161, 53, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(28, 28, width - 56, height - 56);

      const corners = [
        [20, 20], [width - 20, 20], [20, height - 20], [width - 20, height - 20]
      ];
      ctx.fillStyle = '#CBA135';
      corners.forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 7);
        ctx.lineTo(cx + 7, cy);
        ctx.lineTo(cx, cy + 7);
        ctx.lineTo(cx - 7, cy);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();

      // 3. Logotipo de la App protagonista en la cabecera
      try {
        const logo = new Image();
        logo.src = logoHorizontalImg;
        await new Promise((res) => {
          if (logo.complete) res();
          logo.onload = res;
          logo.onerror = res;
        });
        if (logo.width > 0 && isMounted) {
          const logoW = 340;
          const logoH = (logo.height / logo.width) * logoW;
          ctx.drawImage(logo, (width - logoW) / 2, 42, logoW, logoH);
        }
      } catch (_) {
        ctx.fillStyle = '#F3E8CE';
        ctx.font = 'bold 32px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('LA CUCHARA DE LOBELIA', width / 2, 95);
      }

      // Separador central
      const sepY = 158;
      const sepGrad = ctx.createLinearGradient(120, sepY, width - 120, sepY);
      sepGrad.addColorStop(0, 'rgba(203, 161, 53, 0)');
      sepGrad.addColorStop(0.5, 'rgba(203, 161, 53, 0.8)');
      sepGrad.addColorStop(1, 'rgba(203, 161, 53, 0)');
      ctx.strokeStyle = sepGrad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(120, sepY);
      ctx.lineTo(width - 120, sepY);
      ctx.stroke();

      ctx.fillStyle = '#CBA135';
      ctx.beginPath();
      ctx.moveTo(width / 2, sepY - 5);
      ctx.lineTo(width / 2 + 5, sepY);
      ctx.lineTo(width / 2, sepY + 5);
      ctx.lineTo(width / 2 - 5, sepY);
      ctx.closePath();
      ctx.fill();

      // 4. Caja de Datos de la Liga
      const cardX = 45;
      const cardY = 176;
      const cardW = width - 90;
      const cardH = 198;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(203, 161, 53, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Título de la Liga
      ctx.fillStyle = '#F3E8CE';
      ctx.font = 'bold 30px Georgia, serif';
      ctx.textAlign = 'center';
      const leagueTitle = (shareLeagueData.name || 'LIGA DE MESBG').toUpperCase();
      ctx.fillText(leagueTitle, width / 2, cardY + 44);

      // Línea divisoria bajo el título
      ctx.strokeStyle = 'rgba(203, 161, 53, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width / 2 - 130, cardY + 60);
      ctx.lineTo(width / 2 + 130, cardY + 60);
      ctx.stroke();

      // Info rows
      ctx.font = '600 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      
      // Ubicación
      ctx.fillStyle = '#CBA135';
      const locText = shareLeagueData.location ? `📍 Lugar: ${shareLeagueData.location}` : '📍 Modalidad: Presencial / Online';
      ctx.fillText(locText, width / 2, cardY + 95);

      // Fecha
      ctx.fillStyle = '#9CBFA0';
      const dateText = shareLeagueData.deadline ? `📅 Cierre de Inscripción: ${shareLeagueData.deadline}` : '📅 Inscripción Abierta';
      ctx.fillText(dateText, width / 2, cardY + 128);

      // Descripción
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'italic 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const desc = shareLeagueData.description || 'Prepara tu lista y compite en el ranking oficial.';
      const cleanDesc = desc.length > 70 ? desc.slice(0, 67) + '...' : desc;
      ctx.fillText(`«${cleanDesc}»`, width / 2, cardY + 166);

      // 5. Marco del Código QR
      const qrBoxSize = 350;
      const qrBoxX = (width - qrBoxSize) / 2;
      const qrBoxY = 398;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 18);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = '#CBA135';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Renderizar QR en canvas temporal
      const shareUrl = getShareUrl(shareLeagueData.id);
      const tempCanvas = document.createElement('canvas');
      await QRCode.toCanvas(tempCanvas, shareUrl, {
        width: 310,
        margin: 1,
        color: {
          dark: '#07130C',
          light: '#FFFFFF'
        }
      });
      if (isMounted) {
        ctx.drawImage(tempCanvas, qrBoxX + 20, qrBoxY + 20, 310, 310);
      }

      // 6. Call to Action directo y limpio
      ctx.fillStyle = '#F3E8CE';
      ctx.font = 'bold 22px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('📷 ESCANEA EL CÓDIGO QR PARA ENTRAR', width / 2, 798);
    };

    renderPoster();

    return () => {
      isMounted = false;
    };
  }, [isShareLeagueModalOpen, shareLeagueData]);

  const handleDownloadPoster = () => {
    if (!qrCanvasRef.current || !shareLeagueData) return;
    const pngUrl = qrCanvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = `Cartel_Liga_${shareLeagueData.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopyCardImage = async () => {
    if (!qrCanvasRef.current) return;
    try {
      const blob = await new Promise(res => qrCanvasRef.current.toBlob(res, 'image/png'));
      if (navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        setCopiedImageToast(true);
        setTimeout(() => setCopiedImageToast(false), 2500);
      } else {
        handleDownloadPoster();
      }
    } catch (err) {
      console.warn('Clipboard write error:', err);
      handleDownloadPoster();
    }
  };

  const handleShareWhatsApp = async () => {
    if (!shareLeagueData || !qrCanvasRef.current) return;
    const shareUrl = getShareUrl(shareLeagueData.id);
    const text = `🏆 *${shareLeagueData.name}*\n` +
      `⚔️ *La Cuchara de Lobelia — MESBG*\n\n` +
      (shareLeagueData.location ? `📍 *Lugar:* ${shareLeagueData.location}\n` : '') +
      (shareLeagueData.deadline ? `📅 *Inscripción:* Cierre ${shareLeagueData.deadline}\n` : '📅 *Inscripción:* Abierta\n') +
      (shareLeagueData.description ? `\n📝 ${shareLeagueData.description}\n` : '') +
      (shareLeagueData.rulesLink ? `📜 *Reglamento:* ${shareLeagueData.rulesLink}\n` : '') +
      `\n👉 *Inscripción directa:*\n${shareUrl}`;

    // Si el navegador soporta compartir archivos nativamente (Móvil Android / iOS):
    try {
      const blob = await new Promise(res => qrCanvasRef.current.toBlob(res, 'image/png'));
      const file = new File([blob], `Cartel_Liga_${shareLeagueData.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: shareLeagueData.name,
          text: text,
          files: [file]
        });
        return;
      }
    } catch (_) {}

    // En Escritorio / WhatsApp Web: copiar texto formateado al portapapeles y abrir WhatsApp
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLinkToast(true);
      setTimeout(() => setCopiedLinkToast(false), 3000);
    } catch (_) {}

    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleCopyShareText = async () => {
    if (!shareLeagueData) return;
    const shareUrl = getShareUrl(shareLeagueData.id);
    const text = `🏆 *${shareLeagueData.name}*\n` +
      `⚔️ *La Cuchara de Lobelia — MESBG*\n\n` +
      (shareLeagueData.location ? `📍 *Lugar:* ${shareLeagueData.location}\n` : '') +
      (shareLeagueData.deadline ? `📅 *Inscripción:* Cierre ${shareLeagueData.deadline}\n` : '📅 *Inscripción:* Abierta\n') +
      (shareLeagueData.description ? `\n📝 ${shareLeagueData.description}\n` : '') +
      (shareLeagueData.rulesLink ? `📜 *Reglamento:* ${shareLeagueData.rulesLink}\n` : '') +
      `\n👉 *Inscripción directa:*\n${shareUrl}`;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedTextToast(true);
      setTimeout(() => setCopiedTextToast(false), 2500);
    } catch (_) {}
  };

  const handleCopyShareLink = () => {
    if (!shareLeagueData) return;
    const shareUrl = getShareUrl(shareLeagueData.id);
    navigator.clipboard.writeText(shareUrl);
    setCopiedLinkToast(true);
    setTimeout(() => setCopiedLinkToast(false), 2500);
  };

  // Modal Perfil de Jugador y Enviar Mensaje
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState(null);
  const [isPlayerProfileModalOpen, setIsPlayerProfileModalOpen] = useState(false);

  const handleOpenPlayerProfile = (uid) => {
    if (!uid || uid === 'BYE' || uid === 'DESCANSO') return;
    const playerObj = playersMap[uid] || players.find(p => p.uid === uid);
    if (playerObj) {
      setSelectedPlayerProfile(playerObj);
      setIsPlayerProfileModalOpen(true);
    }
  };

  const showConfirm = (message, callback) => {
    setConfirmModalMessage(message);
    setConfirmModalOnConfirm(() => callback);
    setIsConfirmModalOpen(true);
  };

  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertModalMessage, setAlertModalMessage] = useState('');

  const showAlert = (message) => {
    setAlertModalMessage(message);
    setIsAlertModalOpen(true);
  };

  const alert = (message) => {
    showAlert(message);
  };


  const [leagueConfigError, setLeagueConfigError] = useState(null);

  const joinFactionsList = joinAlignment === 'luz' 
    ? { normal: LIGHT_FACTIONS, legend: LIGHT_FACTIONS_LEGEND } 
    : { normal: DARK_FACTIONS, legend: DARK_FACTIONS_LEGEND };

  const addPlayerFactionsList = addUserAlignment === 'luz' 
    ? { normal: LIGHT_FACTIONS, legend: LIGHT_FACTIONS_LEGEND } 
    : { normal: DARK_FACTIONS, legend: DARK_FACTIONS_LEGEND };

  // --- EFECTOS Y ESCUCHAS ---


  const loadLeagueData = async () => {
    setLoadingData(true);
    let activeLeaguesList = {};
    let cachedPlayersSnap = null;
    let reportedMatches = [];
    
    // 1. Configuración de la Liga / Listado de Ligas (desde /players)
    try {
      setLeagueConfigError(null);
      cachedPlayersSnap = await getDocs(collection(db, "players"));
      activeLeaguesList = {};
      cachedPlayersSnap.forEach(d => {
        const pData = d.data();
        if (pData.createdLeagues) {
          Object.assign(activeLeaguesList, pData.createdLeagues);
        }
      });

      // Background auto-heal check for all player profiles if the current user is an admin
      const isCurrentAdmin = profile && (ADMIN_USERNAMES.includes(profile.username?.toLowerCase()) || profile.isAdmin === true);
      if (isCurrentAdmin) {
        cachedPlayersSnap.forEach(async (d) => {
          const pData = d.data();
          const pFixed = {};
          if (pData.points === undefined || pData.points === null || pData.points < 0) pFixed.points = 0;
          if (pData.matchesPlayed === undefined || pData.matchesPlayed === null || pData.matchesPlayed < 0) pFixed.matchesPlayed = 0;
          if (pData.wins === undefined || pData.wins === null || pData.wins < 0) pFixed.wins = 0;
          if (pData.draws === undefined || pData.draws === null || pData.draws < 0) pFixed.draws = 0;
          if (pData.losses === undefined || pData.losses === null || pData.losses < 0) pFixed.losses = 0;
          if (pData.vpScored === undefined || pData.vpScored === null || pData.vpScored < 0) pFixed.vpScored = 0;
          if (pData.vpConceded === undefined || pData.vpConceded === null || pData.vpConceded < 0) pFixed.vpConceded = 0;
          if (pData.leadersKilled === undefined || pData.leadersKilled === null || pData.leadersKilled < 0) pFixed.leadersKilled = 0;
          if (pData.leadersLost === undefined || pData.leadersLost === null || pData.leadersLost < 0) pFixed.leadersLost = 0;
          if (pData.isAdmin === undefined || pData.isAdmin === null) pFixed.isAdmin = false;

          if (Object.keys(pFixed).length > 0) {
            console.log(`Auto-healing invalid profile fields for player ${d.id}...`);
            try {
              await updateDoc(doc(db, "players", d.id), pFixed);
            } catch (err) {
              console.warn(`Failed to auto-heal player ${d.id}:`, err.message);
            }
          }
        });
      }

      // Auto-heal / Auto-recover Liga del Tessen if it is missing from createdLeagues
      if (!activeLeaguesList['liga_1780992431832']) {
        const hasTessenPlayers = Array.from(cachedPlayersSnap.docs).some(d => d.data()?.leagues?.['liga_1780992431832']);
        if (hasTessenPlayers) {
          console.log("Auto-recovering Liga del Tessen from enrolled players...");
          const recoveredLeague = {
            name: 'Liga del Tessen',
            status: 'active',
            registrationDeadline: '',
            location: 'Tessen',
            description: 'Liga oficial de la comunidad Tessen de MESBG.',
            rulesLink: '',
            creatorUid: 'xXhjkWRjh0hVBjcYr2qAAFRvGL82',
            creatorName: 'Matias Alejandro Sosa',
            totalRounds: 5,
            missions: ['Fog of War', 'Domination', 'Hold Ground', 'Destroy the Supplies', 'To the Death!'],
            playerStatuses: {
              'FocJZZfHDIhnLiFV4RvtEcZOUZR2': 'approved',
              'JFvFUa9QttTtem8QIwcDHcJ8Pz42': 'approved',
              'ZUxeH7Z4opTJnJavFAzSdt9onHL2': 'approved',
              'faPYn4R5eqPceO1KZ5vBLGHijZx2': 'approved',
              'hgz5ODiI7UaMZ7493o3ukryBSRh2': 'approved',
              'mMvhWt7WYBfU6oo2So8ncl28GBs1': 'approved',
              'xXhjkWRjh0hVBjcYr2qAAFRvGL82': 'approved'
            },
            rounds: {
              '0': [
                { player1: 'xXhjkWRjh0hVBjcYr2qAAFRvGL82', player2: 'ZUxeH7Z4opTJnJavFAzSdt9onHL2' },
                { player1: 'FocJZZfHDIhnLiFV4RvtEcZOUZR2', player2: 'faPYn4R5eqPceO1KZ5vBLGHijZx2' },
                { player1: 'hgz5ODiI7UaMZ7493o3ukryBSRh2', player2: 'JFvFUa9QttTtem8QIwcDHcJ8Pz42' },
                { player1: 'mMvhWt7WYBfU6oo2So8ncl28GBs1', player2: 'BYE' }
              ],
              '1': [
                { player1: 'xXhjkWRjh0hVBjcYr2qAAFRvGL82', player2: 'faPYn4R5eqPceO1KZ5vBLGHijZx2' },
                { player1: 'ZUxeH7Z4opTJnJavFAzSdt9onHL2', player2: 'hgz5ODiI7UaMZ7493o3ukryBSRh2' },
                { player1: 'FocJZZfHDIhnLiFV4RvtEcZOUZR2', player2: 'mMvhWt7WYBfU6oo2So8ncl28GBs1' },
                { player1: 'JFvFUa9QttTtem8QIwcDHcJ8Pz42', player2: 'BYE' }
              ],
              '2': [
                { player1: 'xXhjkWRjh0hVBjcYr2qAAFRvGL82', player2: 'JFvFUa9QttTtem8QIwcDHcJ8Pz42' },
                { player1: 'ZUxeH7Z4opTJnJavFAzSdt9onHL2', player2: 'mMvhWt7WYBfU6oo2So8ncl28GBs1' },
                { player1: 'hgz5ODiI7UaMZ7493o3ukryBSRh2', player2: 'FocJZZfHDIhnLiFV4RvtEcZOUZR2' },
                { player1: 'faPYn4R5eqPceO1KZ5vBLGHijZx2', player2: 'BYE' }
              ],
              '3': [
                { player1: 'FocJZZfHDIhnLiFV4RvtEcZOUZR2', player2: 'mMvhWt7WYBfU6oo2So8ncl28GBs1' },
                { player1: 'xXhjkWRjh0hVBjcYr2qAAFRvGL82', player2: 'hgz5ODiI7UaMZ7493o3ukryBSRh2' },
                { player1: 'ZUxeH7Z4opTJnJavFAzSdt9onHL2', player2: 'JFvFUa9QttTtem8QIwcDHcJ8Pz42' },
                { player1: 'faPYn4R5eqPceO1KZ5vBLGHijZx2', player2: 'BYE' }
              ],
              '4': [
                { player1: 'FocJZZfHDIhnLiFV4RvtEcZOUZR2', player2: 'xXhjkWRjh0hVBjcYr2qAAFRvGL82' },
                { player1: 'ZUxeH7Z4opTJnJavFAzSdt9onHL2', player2: 'faPYn4R5eqPceO1KZ5vBLGHijZx2' },
                { player1: 'hgz5ODiI7UaMZ7493o3ukryBSRh2', player2: 'mMvhWt7WYBfU6oo2So8ncl28GBs1' },
                { player1: 'JFvFUa9QttTtem8QIwcDHcJ8Pz42', player2: 'BYE' }
              ]
            }
          };

          activeLeaguesList['liga_1780992431832'] = recoveredLeague;

          // If the logged in user is admin/creator, persist back to Firestore
          if (user && (user.uid === 'xXhjkWRjh0hVBjcYr2qAAFRvGL82' || isCurrentAdmin)) {
            setDoc(doc(db, "players", "xXhjkWRjh0hVBjcYr2qAAFRvGL82"), {
              createdLeagues: {
                'liga_1780992431832': recoveredLeague
              }
            }, { merge: true }).catch(err => console.warn("Could not persist recovered league to creator doc:", err));
          }
        }
      }

      setLeaguesList(activeLeaguesList);
    } catch (e) {
      console.warn("Failed to load league config from players:", e.message);
      setLeagueConfigError(e.message);
      setLeaguesList({});
    }

    if (selectedLeagueId && activeLeaguesList[selectedLeagueId]) {
      const leagueConfig = JSON.parse(JSON.stringify(activeLeaguesList[selectedLeagueId]));
      if (leagueConfig.rounds) {
        leagueConfig.rounds = roundsMapToArray(leagueConfig.rounds);
      }
      if (leagueConfig.winnersBracket && leagueConfig.winnersBracket.rounds) {
        leagueConfig.winnersBracket.rounds = roundsMapToArray(leagueConfig.winnersBracket.rounds);
      }
      if (leagueConfig.losersBracket && leagueConfig.losersBracket.rounds) {
        leagueConfig.losersBracket.rounds = roundsMapToArray(leagueConfig.losersBracket.rounds);
      }
      setConfigData(leagueConfig);
      setLeagueState(leagueConfig.status || 'registration');

      // 2. Jugadores inscritos en esta liga
      const allVerifications = {};
      const allReports = {};
      try {
        const playersSnap = cachedPlayersSnap || await getDocs(collection(db, "players"));
        
        const playerStatuses = leagueConfig.playerStatuses || {};
        const playerOverrides = leagueConfig.playerOverrides || {};

        const plist = [];
        const pmap = {};
        playersSnap.forEach(d => {
          const data = d.data();
          
          // Collect match reports from every player profile
          if (data.matchReports) {
            Object.keys(data.matchReports).forEach(mId => {
              const currentReport = data.matchReports[mId];
              if (!allReports[mId] || getTimestampMs(currentReport.timestamp) > getTimestampMs(allReports[mId].timestamp)) {
                allReports[mId] = currentReport;
              }
            });
          }

          // Collect match verifications from every player profile
          if (data.matchVerifications) {
            Object.keys(data.matchVerifications).forEach(mId => {
              const currentVerif = data.matchVerifications[mId];
              if (!allVerifications[mId] || getTimestampMs(currentVerif.timestamp) > getTimestampMs(allVerifications[mId].timestamp)) {
                allVerifications[mId] = currentVerif;
              }
            });
          }

          let leagueData = data.leagues && data.leagues[selectedLeagueId];
          
          // Auto-heal enrollment if player is creator or listed in playerStatuses or matches
          if (!leagueData && (d.id === 'xXhjkWRjh0hVBjcYr2qAAFRvGL82' || d.id === leagueConfig.creatorUid || playerStatuses[d.id] === 'approved')) {
            leagueData = {
              status: 'approved',
              alignment: data.alignment || 'luz',
              faction: data.faction || 'Minas Tirith',
              participates: true
            };
            if (user && (user.uid === d.id || isCurrentAdmin)) {
              updateDoc(doc(db, "players", d.id), {
                [`leagues.${selectedLeagueId}`]: leagueData
              }).catch(() => {});
            }
          }

          if (leagueData) {
            // Resolve creator status & overrides
            const creatorStatus = playerStatuses[d.id];
            const overrides = playerOverrides[d.id] || {};
            
            // If player was removed/rejected but re-applied (their own status is 'pending'),
            // show them as pending so admin can re-approve
            let resolvedStatus;
            if ((creatorStatus === 'removed' || creatorStatus === 'rejected') && leagueData.status === 'pending') {
              resolvedStatus = 'pending'; // Re-applied, override creator's removal
            } else {
              resolvedStatus = creatorStatus || leagueData.status || 'pending';
            }
            
            // If still removed or rejected after resolution, exclude from league
            if (resolvedStatus === 'removed' || resolvedStatus === 'rejected') return;

            const p = {
              uid: d.id,
              name: data.name || data.username || 'Matias',
              username: data.username || '',
              email: data.email || '',
              phone: data.phone || '',
              location: data.location || '',
              isAdmin: data.isAdmin || false,
              ...leagueData,
              status: resolvedStatus,
              ...overrides
            };
            plist.push(p);
            pmap[d.id] = p;
          } else {
            // Populate pmap fallback with global profile so no player shows as raw UID
            pmap[d.id] = {
              uid: d.id,
              name: data.name || data.username || d.id,
              username: data.username || '',
              email: data.email || '',
              phone: data.phone || '',
              location: data.location || '',
              faction: data.faction || 'Minas Tirith',
              alignment: data.alignment || 'luz',
              status: 'approved'
            };
          }
        });
        setPlayers(plist);
        setPlayersMap(pmap);
      } catch (e) {
        console.error("Failed to load players list:", e.message);
      }

      // 3. Partidas de esta liga (Optimizado)
      try {
        const matchesQuery = query(collection(db, "matches"), where("leagueId", "==", selectedLeagueId));
        const matchesSnap = await getDocs(matchesQuery);
        reportedMatches = [];
        matchesSnap.forEach(d => {
          const m = d.data();
          reportedMatches.push({ id: d.id, ...m });
        });

        // Merge player profile matchReports with time-based precedence
        Object.keys(allReports).forEach(matchId => {
          const rep = allReports[matchId];
          const idx = reportedMatches.findIndex(rm => rm.id === matchId);
          if (idx !== -1) {
            // If the profile report is newer than the database report, overwrite it
            if (getTimestampMs(rep.timestamp) > getTimestampMs(reportedMatches[idx].timestamp)) {
              reportedMatches[idx] = {
                ...reportedMatches[idx],
                ...rep,
                id: matchId
              };
            }
          } else {
            // Otherwise, add it as a reported match
            reportedMatches.push({
              id: matchId,
              leagueId: selectedLeagueId,
              ...rep
            });
          }
        });

        // Merge player profile matchVerifications with time-based precedence
        reportedMatches.forEach(m => {
          const verif = allVerifications[m.id];
          if (verif) {
            const mTime = getTimestampMs(m.timestamp);
            const vTime = getTimestampMs(verif.timestamp);
            if (vTime >= mTime) {
              if (verif.verified !== undefined) m.verified = verif.verified;
              if (verif.winner !== undefined) m.winner = verif.winner;
              if (verif.rejected) {
                m.reportedBy = "";
                m.reportedVpP1 = 0;
                m.reportedVpP2 = 0;
                m.reportedKilledLeaderP1 = false;
                m.reportedKilledLeaderP2 = false;
                m.verified = false;
              }
            }
          }
        });

        // Merge admin overrides to bypass /matches create restrictions
        if (leagueConfig && leagueConfig.overrides) {
          Object.keys(leagueConfig.overrides).forEach(matchId => {
            const overrideMatch = {
              id: matchId,
              ...leagueConfig.overrides[matchId]
            };
            const idx = reportedMatches.findIndex(rm => rm.id === matchId);
            if (idx !== -1) {
              reportedMatches[idx] = overrideMatch;
            } else {
              reportedMatches.push(overrideMatch);
            }
          });
        }

        const mlist = [];
        if (leagueConfig.rounds) {
          leagueConfig.rounds.forEach((roundMatches, rIdx) => {
            const roundNum = rIdx + 1;
            const roundMission = leagueConfig.missions[rIdx] || '';
            roundMatches.forEach(fm => {
              // Buscar si hay partida cargada para este emparejamiento
              const rep = reportedMatches.find(rm => 
                rm.round === roundNum &&
                ((rm.player1 === fm.player1 && rm.player2 === fm.player2) ||
                 (rm.player1 === fm.player2 && rm.player2 === fm.player1))
              );

              if (rep) {
                if (!rep.mission) {
                  rep.mission = roundMission;
                }
                mlist.push(rep);
              } else {
                const isBye = fm.player2 === 'BYE';
                mlist.push({
                  id: `virtual_${roundNum}_${fm.player1}_${fm.player2}`,
                  leagueId: selectedLeagueId,
                  player1: fm.player1,
                  player2: fm.player2,
                  round: roundNum,
                  mission: roundMission,
                  verified: isBye, // verificado automáticamente si es BYE
                  reportedBy: isBye ? 'system' : '',
                  reportedVpP1: 0,
                  reportedVpP2: 0,
                  reportedKilledLeaderP1: false,
                  reportedKilledLeaderP2: false,
                  isVirtual: true
                });
              }
            });
          });
        } else {
          reportedMatches.forEach(m => {
            if (!m.mission && leagueConfig.missions && leagueConfig.missions[m.round - 1]) {
              m.mission = leagueConfig.missions[m.round - 1];
            }
            mlist.push(m);
          });
        }

        mlist.sort((a, b) => a.round - b.round);
        setMatches(mlist);
      } catch (e) {
        console.error("Failed to load matches:", e.message);
      }

      // Helper to dynamically merge reported matches from /matches into bracket rounds
      const mergeReportedMatchesIntoBracket = (bracket, bracketId) => {
        if (!bracket || !bracket.rounds) return bracket;
        let updatedBracket = JSON.parse(JSON.stringify(bracket));
        const numRounds = updatedBracket.rounds.length;
        for (let rIdx = 0; rIdx < numRounds; rIdx++) {
          const roundMatches = updatedBracket.rounds[rIdx];
          roundMatches.forEach((m, mIdx) => {
            const matchDocId = `playoff_${selectedLeagueId}_${bracketId}_${rIdx}_${mIdx}`;
            let rep = reportedMatches.find(rm => rm.id === matchDocId);
            if (!rep) {
              rep = reportedMatches.find(rm => 
                rm.round === (rIdx + 1) &&
                rm.bracketId === bracketId &&
                ((rm.player1 === m.player1 && rm.player2 === m.player2) ||
                 (rm.player1 === m.player2 && rm.player2 === m.player1))
              );
            }
            if (rep) {
              m.id = rep.id;
              m.reportedBy = rep.reportedBy || "";
              m.verified = rep.verified || false;
              m.reportedVpP1 = rep.reportedVpP1 || 0;
              m.reportedVpP2 = rep.reportedVpP2 || 0;
              m.reportedKilledLeaderP1 = rep.reportedKilledLeaderP1 || false;
              m.reportedKilledLeaderP2 = rep.reportedKilledLeaderP2 || false;
              m.winner = rep.winner || "";
              
              if (m.verified && m.winner) {
                updatedBracket = advanceWinner(updatedBracket, rIdx, mIdx, m.winner);
              }
            } else {
              m.id = matchDocId; // Set virtual match ID
            }
          });
        }
        return updatedBracket;
      };

      // 4. Llaves de Playoffs - Ganadores
      let wBracket = { status: 'not_created', rounds: [] };
      if (leagueConfig.winnersBracket) {
        wBracket = mergeReportedMatchesIntoBracket(leagueConfig.winnersBracket, 'winners');
      }
      setWinnersBracket(wBracket);

      // 5. Llaves de Playoffs - Perdedores
      let lBracket = { status: 'not_created', rounds: [] };
      if (leagueConfig.losersBracket) {
        lBracket = mergeReportedMatchesIntoBracket(leagueConfig.losersBracket, 'losers');
      }
      setLosersBracket(lBracket);
    } else {
      setConfigData(null);
      setLeagueState('registration');
      setPlayers([]);
      setPlayersMap({});
      setMatches([]);
      setWinnersBracket({ status: 'not_created', rounds: [] });
      setLosersBracket({ status: 'not_created', rounds: [] });
    }

    setLoadingData(false);
  };

  useEffect(() => {
    loadLeagueData();
  }, [user, selectedLeagueId]);

  useEffect(() => {
    if (initialLeagueId && leaguesList[initialLeagueId]) {
      setSelectedLeagueId(initialLeagueId);
      const isEnrolled = !!(profile?.leagues?.[initialLeagueId]);
      const leagueData = leaguesList[initialLeagueId];
      const isRegistrationOpen = leagueData?.status === 'registration';
      if (!isEnrolled && isRegistrationOpen) {
        setJoinAlignment('luz');
        setJoinFaction('');
        setIsJoinLeagueModalOpen(true);
      }
    }
  }, [initialLeagueId, leaguesList, profile]);

  // Computar isAdmin según permisos globales o si el usuario es el creador de la liga seleccionada
  const isAdmin = useMemo(() => {
    if (!user || !profile) return false;
    if (isGlobalAdmin) return true;
    if (selectedLeagueId && leaguesList[selectedLeagueId]) {
      return leaguesList[selectedLeagueId].creatorUid === user.uid;
    }
    return false;
  }, [user, profile, isGlobalAdmin, selectedLeagueId, leaguesList]);


  // Manejador de Creación de Liga
  const handleCreateLeague = async (e) => {
    e.preventDefault();
    if (user && !user.emailVerified) {
      alert(lang === 'es' ? "Debes verificar tu correo electrónico para poder crear una liga." : "You must verify your email to create a league.");
      return;
    }
    if (!newLeagueName.trim() || !newLeagueDeadline || !newLeagueLocation.trim()) {
      alert(lang === 'es' ? "Completa todos los campos obligatorios." : "Please fill out all required fields.");
      return;
    }
    setLoadingData(true);
    try {
      const leagueId = `liga_${Date.now()}`;
      
      const newLeague = {
        name: newLeagueName.trim(),
        status: 'registration',
        registrationDeadline: newLeagueDeadline,
        location: newLeagueLocation.trim(),
        description: newLeagueDescription.trim(),
        rulesLink: newLeagueRulesLink.trim(),
        creatorUid: user.uid,
        creatorName: profile?.name || user.email.split('@')[0],
        totalRounds: 0,
        missions: []
      };

      await setDoc(doc(db, "players", user.uid), {
        createdLeagues: {
          [leagueId]: newLeague
        }
      }, { merge: true });

      alert("Liga creada con éxito.");
      setIsCreateLeagueModalOpen(false);
      setNewLeagueName('');
      setNewLeagueDeadline('');
      setNewLeagueLocation('');
      setNewLeagueDescription('');
      setNewLeagueRulesLink('');
      loadLeagueData();
    } catch (err) {
      console.error(err);
      alert("Error al crear la liga: " + err.message);
    }
    setLoadingData(false);
  };

  // Manejador de Inscripción a Liga
  const handleJoinLeagueSubmit = async (e) => {
    e.preventDefault();
    if (user && !user.emailVerified) {
      alert(lang === 'es' ? "Debes verificar tu correo electrónico para poder inscribirte a una liga." : "You must verify your email to register for a league.");
      return;
    }
    if (!joinFaction) {
      alert("Elige una facción.");
      return;
    }
    setIsJoining(true);
    try {
      await updateDoc(doc(db, "players", user.uid), {
        [`leagues.${selectedLeagueId}`]: {
          status: 'pending',
          alignment: joinAlignment,
          faction: joinFaction,
          participates: true
        }
      });
      alert("Inscripción solicitada. Espera la aprobación del administrador.");
      setIsJoinLeagueModalOpen(false);
      loadLeagueData();
    } catch (err) {
      console.error(err);
      alert("Error al inscribirse: " + err.message);
    }
    setIsJoining(false);
  };

  // --- CLASIFICACIÓN REACTIVA EN CALIENTE ---
  const standings = useMemo(() => {
    const statsMap = {};
    const approvedPlayers = players.filter(p => p.status === 'approved' && p.participates !== false);

    approvedPlayers.forEach(p => {
      statsMap[p.uid] = {
        uid: p.uid,
        name: p.name,
        username: p.username,
        faction: p.faction,
        alignment: p.alignment,
        elo: Number(p.elo) || DEFAULT_ELO,
        points: 0,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        vpScored: 0,
        vpConceded: 0,
        leadersKilled: 0,
        leadersLost: 0
      };
    });

    matches.forEach(m => {
      if (!m.verified) return;
      const p1 = m.player1;
      const p2 = m.player2;

      const p1Stats = statsMap[p1];
      const p2Stats = statsMap[p2];

      const vp1 = parseInt(m.reportedVpP1) || 0;
      const vp2 = parseInt(m.reportedVpP2) || 0;
      const killed1 = m.reportedKilledLeaderP1 === true || m.reportedKilledLeaderP1 === 'true';
      const killed2 = m.reportedKilledLeaderP2 === true || m.reportedKilledLeaderP2 === 'true';

      if (p1Stats) {
        p1Stats.matchesPlayed += 1;
        p1Stats.vpScored += vp1;
        p1Stats.vpConceded += vp2;
        p1Stats.leadersKilled += killed1 ? 1 : 0;
        p1Stats.leadersLost += killed2 ? 1 : 0;

        if (p2 === 'BYE') {
          p1Stats.points += 3;
          p1Stats.wins += 1;
        } else {
          if (vp1 > vp2) {
            p1Stats.points += 3;
            p1Stats.wins += 1;
          } else if (vp1 < vp2) {
            p1Stats.points += 0;
            p1Stats.losses += 1;
          } else {
            p1Stats.points += 1;
            p1Stats.draws += 1;
          }
        }
      }

      if (p2Stats && p2 !== 'BYE') {
        p2Stats.matchesPlayed += 1;
        p2Stats.vpScored += vp2;
        p2Stats.vpConceded += vp1;
        p2Stats.leadersKilled += killed2 ? 1 : 0;
        p2Stats.leadersLost += killed1 ? 1 : 0;

        if (vp2 > vp1) {
          p2Stats.points += 3;
          p2Stats.wins += 1;
        } else if (vp2 < vp1) {
          p2Stats.points += 0;
          p2Stats.losses += 1;
        } else {
          p2Stats.points += 1;
          p2Stats.draws += 1;
        }
      }

      // Cálculo de ELO para enfrentamientos directos entre jugadores reales
      if (p1Stats && p2Stats && p2 !== 'BYE') {
        const resultP1 = vp1 > vp2 ? 'win' : vp1 < vp2 ? 'loss' : 'draw';
        const { newRatingA, newRatingB } = calculateMatchElo(p1Stats.elo, p2Stats.elo, resultP1, vp1, vp2);
        p1Stats.elo = newRatingA;
        p2Stats.elo = newRatingB;
      }
    });

    const standingsList = Object.values(statsMap);
    standingsList.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const diffA = a.vpScored - a.vpConceded;
      const diffB = b.vpScored - b.vpConceded;
      if (diffB !== diffA) return diffB - diffA;
      const leadDiffA = a.leadersKilled - a.leadersLost;
      const leadDiffB = b.leadersKilled - b.leadersLost;
      if (leadDiffB !== leadDiffA) return leadDiffB - leadDiffA;
      return a.name.localeCompare(b.name);
    });

    return standingsList;
  }, [players, matches]);



  // --- CONTROLES DE ADMINISTRADOR ---

  const handleApprovePlayer = async (uid) => {
    try {
      const isGlobalAdmin = ADMIN_USERNAMES.includes(profile.username?.toLowerCase()) || profile.isAdmin === true;
      if (isGlobalAdmin) {
        await updateDoc(doc(db, "players", uid), {
          [`leagues.${selectedLeagueId}.status`]: 'approved'
        });
      } else {
        await updateDoc(doc(db, "players", configData.creatorUid), {
          [`createdLeagues.${selectedLeagueId}.playerStatuses.${uid}`]: 'approved'
        });
      }
      alert("Aprobado.");
      loadLeagueData();
    } catch (e) {
      console.error(e);
      alert("Error al aprobar: " + e.message);
    }
  };

  const handleRejectPlayer = async (uid) => {
    showConfirm("¿Rechazar inscripción?", async () => {
      try {
        const isGlobalAdmin = ADMIN_USERNAMES.includes(profile.username?.toLowerCase()) || profile.isAdmin === true;
        if (isGlobalAdmin) {
          await updateDoc(doc(db, "players", uid), {
            [`leagues.${selectedLeagueId}`]: deleteField()
          });
        } else {
          await updateDoc(doc(db, "players", configData.creatorUid), {
            [`createdLeagues.${selectedLeagueId}.playerStatuses.${uid}`]: 'rejected'
          });
        }
        alert("Inscripción borrada.");
        loadLeagueData();
      } catch (e) {
        console.error(e);
        alert("Error al rechazar: " + e.message);
      }
    });
  };

  const handleDeletePlayer = async (uid, name) => {
    showConfirm(`¿Seguro que quieres quitar a ${name} de esta liga?`, async () => {
      try {
        const isGlobalAdmin = ADMIN_USERNAMES.includes(profile.username?.toLowerCase()) || profile.isAdmin === true;
        if (isGlobalAdmin) {
          await updateDoc(doc(db, "players", uid), {
            [`leagues.${selectedLeagueId}`]: deleteField()
          });
        } else {
          await updateDoc(doc(db, "players", configData.creatorUid), {
            [`createdLeagues.${selectedLeagueId}.playerStatuses.${uid}`]: 'removed'
          });
        }
        alert("Jugador quitado.");
        loadLeagueData();
      } catch (e) {
        console.error(e);
        alert("Error al quitar jugador: " + e.message);
      }
    });
  };

  const handleSavePlayerEdit = async () => {
    if (!selectedPlayerToEdit) return;
    setIsPlayerSaving(true);
    try {
      const isGlobalAdmin = ADMIN_USERNAMES.includes(profile.username?.toLowerCase()) || profile.isAdmin === true;
      if (isGlobalAdmin) {
        await updateDoc(doc(db, "players", selectedPlayerToEdit.uid), {
          name: editPlayerName.trim(),
          phone: editPlayerPhone.trim(),
          isAdmin: editPlayerIsAdmin,
          [`leagues.${selectedLeagueId}.alignment`]: editPlayerAlignment,
          [`leagues.${selectedLeagueId}.faction`]: editPlayerFaction,
          [`leagues.${selectedLeagueId}.participates`]: editPlayerParticipates
        });
      } else {
        await updateDoc(doc(db, "players", configData.creatorUid), {
          [`createdLeagues.${selectedLeagueId}.playerOverrides.${selectedPlayerToEdit.uid}`]: {
            alignment: editPlayerAlignment,
            faction: editPlayerFaction,
            participates: editPlayerParticipates
          }
        });
      }
      alert("Ficha actualizada.");
      setIsPlayerEditModalOpen(false);
      loadLeagueData();
    } catch (e) {
      console.error(e);
      alert("Error al guardar cambios: " + e.message);
    }
    setIsPlayerSaving(false);
  };

  // Abrir Modal de Añadir Jugador Manualmente (Admin)
  const handleOpenAddPlayerModal = async () => {
    setIsAddPlayerModalOpen(true);
    setAddPlayerSearch('');
    setSelectedUserToAdd(null);
    setAddUserAlignment('luz');
    setAddUserFaction('');
    setIsLoadingAllUsers(true);

    try {
      const snap = await getDocs(collection(db, "players"));
      const users = [];
      const currentApprovedUids = new Set(players.filter(p => p.status === 'approved').map(p => p.uid));

      snap.forEach(d => {
        const data = d.data();
        if (!currentApprovedUids.has(d.id)) {
          users.push({
            uid: d.id,
            name: data.name || data.username || d.id,
            username: data.username || '',
            email: data.email || '',
            phone: data.phone || '',
            faction: data.faction || '',
            alignment: data.alignment || 'luz'
          });
        }
      });
      users.sort((a, b) => a.name.localeCompare(b.name));
      setAllAvailableUsers(users);
    } catch (e) {
      console.error("Error fetching all users:", e);
      alert(lang === 'es' ? "Error al cargar la lista de usuarios: " + e.message : "Error loading users list: " + e.message);
    }
    setIsLoadingAllUsers(false);
  };

  // Confirmar añadir jugador
  const handleConfirmAddPlayer = async (e) => {
    e.preventDefault();
    if (!selectedUserToAdd) {
      alert(lang === 'es' ? "Selecciona un usuario de la lista." : "Select a user from the list.");
      return;
    }
    if (!addUserFaction) {
      alert(lang === 'es' ? "Elige una facción para el jugador." : "Choose a faction for the player.");
      return;
    }

    setIsAddingPlayer(true);
    try {
      const playerUid = selectedUserToAdd.uid;
      const leagueData = {
        status: 'approved',
        alignment: addUserAlignment,
        faction: addUserFaction,
        participates: true
      };

      // 1. Guardar en el documento del jugador
      await updateDoc(doc(db, "players", playerUid), {
        [`leagues.${selectedLeagueId}`]: leagueData
      });

      // 2. Guardar en el documento del creador de la liga para redundancia / status
      if (configData?.creatorUid) {
        await updateDoc(doc(db, "players", configData.creatorUid), {
          [`createdLeagues.${selectedLeagueId}.playerStatuses.${playerUid}`]: 'approved',
          [`createdLeagues.${selectedLeagueId}.playerOverrides.${playerUid}`]: {
            alignment: addUserAlignment,
            faction: addUserFaction,
            participates: true
          }
        });
      }

      alert(lang === 'es' ? `¡${selectedUserToAdd.name} ha sido añadido y aprobado en la liga con éxito!` : `Player ${selectedUserToAdd.name} successfully added and approved in the league!`);
      setIsAddPlayerModalOpen(false);
      setSelectedUserToAdd(null);
      loadLeagueData();
    } catch (err) {
      console.error("Error adding player manually:", err);
      alert((lang === 'es' ? "Error al añadir jugador: " : "Error adding player: ") + err.message);
    }
    setIsAddingPlayer(false);
  };

  // Generador de Ronda Regular
  const handlePreparePairingsLightVsDark = () => {
    const approved = players.filter(p => p.status === 'approved' && p.participates !== false);
    if (approved.length < 2) {
      alert(lang === 'es' ? "Se necesitan mínimo 2 jugadores aprobados." : "At least 2 approved players are required.");
      return;
    }
    showConfirm(
      lang === 'es' 
        ? "Está a punto de generar rondas respetando enfrentamientos Luz vs Oscuridad. ¿Está seguro?" 
        : "You are about to generate rounds respecting Light vs Darkness match-ups. Are you sure?",
      () => runPairingGeneration(true)
    );
  };

  const handlePreparePairingsCivilWar = () => {
    const approved = players.filter(p => p.status === 'approved' && p.participates !== false);
    if (approved.length < 2) {
      alert(lang === 'es' ? "Se necesitan mínimo 2 jugadores aprobados." : "At least 2 approved players are required.");
      return;
    }
    showConfirm(
      lang === 'es' 
        ? "Está a punto de generar rondas sin tener en cuenta bandos Luz/Oscuridad. ¿Está seguro?" 
        : "You are about to generate rounds without considering Light/Darkness sides (Civil War). Are you sure?",
      () => runPairingGeneration(false)
    );
  };

  const runPairingGeneration = (prioritize) => {
    setIsPrioritizeModalOpen(false);
    const approved = players.filter(p => p.status === 'approved' && p.participates !== false);
    setIsGenerating(true);
    const generated = generateFixture(approved, totalRoundsInput, prioritize);
    setDraftFixture(generated);

    const poolIndexes = [0, 1, 2, 3, 4, 5];
    for (let i = poolIndexes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [poolIndexes[i], poolIndexes[j]] = [poolIndexes[j], poolIndexes[i]];
    }
    const tempMissions = [];
    for (let r = 0; r < totalRoundsInput; r++) {
      const pool = POOLS_1VS1[poolIndexes[r % 6]];
      tempMissions.push(pool.items[Math.floor(Math.random() * pool.items.length)]);
    }
    setDraftMissions(tempMissions);
    setIsGenerating(false);
  };


  const handleSwapOpponent = (roundIndex, matchIndex, playerKey, newPlayerUid) => {
    const currentMatch = draftFixture[roundIndex][matchIndex];
    const otherKey = playerKey === 'player1' ? 'player2' : 'player1';
    if (currentMatch[otherKey] === newPlayerUid) return;

    setDraftFixture(prev => {
      const updated = JSON.parse(JSON.stringify(prev));
      const match = updated[roundIndex][matchIndex];
      const oldPlayerUid = match[playerKey];

      let otherMatchIndex = -1;
      let otherPlayerKey = '';
      for (let i = 0; i < updated[roundIndex].length; i++) {
        if (updated[roundIndex][i].player1 === newPlayerUid) {
          otherMatchIndex = i;
          otherPlayerKey = 'player1';
          break;
        }
        if (updated[roundIndex][i].player2 === newPlayerUid) {
          otherMatchIndex = i;
          otherPlayerKey = 'player2';
          break;
        }
      }

      if (otherMatchIndex !== -1) {
        match[playerKey] = newPlayerUid;
        updated[roundIndex][otherMatchIndex][otherPlayerKey] = oldPlayerUid;
      }
      return updated;
    });
  };

  const handleDraftMissionChange = (roundIndex, newMission) => {
    setDraftMissions(prev => {
      const updated = [...prev];
      updated[roundIndex] = newMission;
      return updated;
    });
  };

  const handleLaunchLeague = () => {
    if (!draftFixture) return;
    showConfirm("¿Lanzar fixture de ronda regular? Se borrarán partidas anteriores de esta liga.", async () => {
      setLoadingData(true);
      try {
        // Borrar partidas anteriores de esta liga
        try {
          const matchesSnap = await getDocs(collection(db, "matches"));
          const deletes = [];
          matchesSnap.forEach(d => {
            if (d.data().leagueId === selectedLeagueId) {
              deletes.push(deleteDoc(doc(db, "matches", d.id)));
            }
          });
          await Promise.all(deletes);
        } catch (e) {
          console.warn("Could not delete physical matches:", e.message);
        }

        // Armar el fixture (rounds)
        const rounds = [];
        draftFixture.forEach((roundMatches, rIdx) => {
          const roundMission = draftMissions[rIdx];
          const rMatches = [];
          roundMatches.forEach(m => {
            rMatches.push({
              player1: m.player1,
              player2: m.player2,
              mission: roundMission,
              round: rIdx + 1
            });
          });
          rounds.push(rMatches);
        });

        // Guardar la liga con el fixture y borrar brackets anteriores en el perfil del creador
        const cleanedConfig = { ...configData };
        if (cleanedConfig.rounds) delete cleanedConfig.rounds;
        if (cleanedConfig.winnersBracket) delete cleanedConfig.winnersBracket;
        if (cleanedConfig.losersBracket) delete cleanedConfig.losersBracket;

        await setDoc(doc(db, "players", configData.creatorUid), {
          createdLeagues: {
            [selectedLeagueId]: {
              ...cleanedConfig,
              status: 'active',
              totalRounds: totalRoundsInput,
              missions: draftMissions,
              rounds: roundsArrayToMap(rounds),
              winnersBracket: deleteField(),
              losersBracket: deleteField()
            }
          }
        }, { merge: true });

        alert("Liga comenzada.");
        setDraftFixture(null);
        setDraftMissions([]);
        loadLeagueData();
        setActiveFixtureView('regular');
        setActiveSubTab('fixture');
      } catch (e) {
        console.error(e);
        alert(`Error al lanzar la liga: ${e.message}`);
      }
      setLoadingData(false);
    });
  };

  const handleResetLeague = () => {
    showConfirm("🚨 ¿Seguro que quieres resetear esta liga? Se borrarán todos los emparejamientos, llaves y resultados correspondientes.", async () => {
      setLoadingData(true);
      try {
        try {
          const matchesSnap = await getDocs(collection(db, "matches"));
          const deletes = [];
          matchesSnap.forEach(d => {
            if (d.data().leagueId === selectedLeagueId) {
              deletes.push(deleteDoc(doc(db, "matches", d.id)));
            }
          });
          await Promise.all(deletes);
        } catch (e) {
          console.warn("Could not delete physical match documents due to security rules:", e.message);
        }

        const { rounds, winnersBracket, losersBracket, ...restConfig } = configData;
        await setDoc(doc(db, "players", configData.creatorUid), {
          createdLeagues: {
            [selectedLeagueId]: {
              ...restConfig,
              status: 'registration',
              totalRounds: 0,
              missions: [],
              rounds: deleteField(),
              winnersBracket: deleteField(),
              losersBracket: deleteField()
            }
          }
        }, { merge: true });

        alert("Liga reseteada.");
        loadLeagueData();
      } catch (e) {
        console.error(e);
        alert(`Error al resetear la liga: ${e.message}`);
      }
      setLoadingData(false);
    });
  };

  // --- ADMINISTRACIÓN DE PLAYOFFS (LLAVES) ---

  // Inicializar Borrador de Bracket
  // Inicializar Borrador de Bracket
  const handlePrepareBracketDraftLightVsDark = () => {
    if (selectedPlayoffPlayers.length < 2) {
      alert(lang === 'es' ? "Selecciona al menos 2 jugadores aprobados para la llave." : "Select at least 2 approved players for the bracket.");
      return;
    }
    showConfirm(
      lang === 'es'
        ? "Está a punto de generar el borrador de la llave respetando enfrentamientos Luz vs Oscuridad. ¿Está seguro?"
        : "You are about to generate the bracket draft respecting Light vs Darkness match-ups. Are you sure?",
      () => {
        const selectedProfiles = standings.filter(p => selectedPlayoffPlayers.includes(p.uid));
        const r1 = generateBracketRound1(selectedProfiles, true);
        const structure = buildFullBracketStructure(r1.matches, r1.size);
        setDraftBracket(structure);
      }
    );
  };

  const handlePrepareBracketDraftCivilWar = () => {
    if (selectedPlayoffPlayers.length < 2) {
      alert(lang === 'es' ? "Selecciona al menos 2 jugadores aprobados para la llave." : "Select at least 2 approved players for the bracket.");
      return;
    }
    showConfirm(
      lang === 'es'
        ? "Está a punto de generar el borrador de la llave sin tener en cuenta bandos Luz/Oscuridad. ¿Está seguro?"
        : "You are about to generate the bracket draft without considering Light/Darkness sides (Civil War). Are you sure?",
      () => {
        const selectedProfiles = standings.filter(p => selectedPlayoffPlayers.includes(p.uid));
        const r1 = generateBracketRound1(selectedProfiles, false);
        const structure = buildFullBracketStructure(r1.matches, r1.size);
        setDraftBracket(structure);
      }
    );
  };

  // Swap en borrador de bracket
  const handleSwapBracketSlot = (matchIdx, slotKey, newPlayerUid) => {
    const currentMatch = draftBracket.rounds[0][matchIdx];
    const otherKey = slotKey === 'player1' ? 'player2' : 'player1';
    if (currentMatch[otherKey] === newPlayerUid) return;

    setDraftBracket(prev => {
      const updated = JSON.parse(JSON.stringify(prev));
      const match = updated.rounds[0][matchIdx];
      const oldPlayerUid = match[slotKey];

      let otherMatchIdx = -1;
      let otherKey = '';
      for (let i = 0; i < updated.rounds[0].length; i++) {
        if (updated.rounds[0][i].player1 === newPlayerUid) {
          otherMatchIdx = i;
          otherKey = 'player1';
          break;
        }
        if (updated.rounds[0][i].player2 === newPlayerUid) {
          otherMatchIdx = i;
          otherKey = 'player2';
          break;
        }
      }

      if (otherMatchIdx !== -1) {
        match[slotKey] = newPlayerUid;
        updated.rounds[0][otherMatchIdx][otherKey] = oldPlayerUid;

        // Reset de rondas posteriores
        for (let r = 1; r < updated.rounds.length; r++) {
          for (let m = 0; m < updated.rounds[r].length; m++) {
            updated.rounds[r][m] = {
              player1: "", player2: "", verified: false, reportedBy: "",
              reportedVpP1: 0, reportedVpP2: 0, reportedKilledLeaderP1: false,
              reportedKilledLeaderP2: false, winner: ""
            };
          }
        }

        // Re-evaluar BYEs en Ronda 1
        updated.rounds[0].forEach(m => {
          if (m.player2 === 'BYE') {
            m.verified = true; m.reportedBy = 'system'; m.reportedVpP1 = 1; m.reportedVpP2 = 0; m.winner = m.player1;
          } else if (m.player1 === 'BYE') {
            m.verified = true; m.reportedBy = 'system'; m.reportedVpP1 = 0; m.reportedVpP2 = 1; m.winner = m.player2;
          } else {
            m.verified = false; m.reportedBy = ''; m.reportedVpP1 = 0; m.reportedVpP2 = 0; m.winner = '';
          }
        });

        // Re-propagar avances
        let propagated = updated;
        updated.rounds[0].forEach((m, idx) => {
          if (m.verified && m.winner && m.winner !== 'BYE') {
            propagated = advanceWinner(propagated, 0, idx, m.winner);
          }
        });

        return propagated;
      }
      return prev;
    });
  };

  // Lanzar la Llave Oficialmente
  const handleLaunchBracket = async () => {
    if (!draftBracket) return;
    showConfirm(`¿Publicar y oficializar la Llave de ${selectedPlayoffType === 'winners' ? 'Ganadores' : 'Perdedores'}?`, async () => {
      setLoadingData(true);
      try {
        const bracketField = selectedPlayoffType === 'winners' ? 'winnersBracket' : 'losersBracket';
        await setDoc(doc(db, "players", configData.creatorUid), {
          createdLeagues: {
            [selectedLeagueId]: {
              [bracketField]: {
                status: 'active',
                size: draftBracket.size,
                rounds: roundsArrayToMap(draftBracket.rounds)
              }
            }
          }
        }, { merge: true });
        alert(`Llave de ${selectedPlayoffType === 'winners' ? 'Ganadores' : 'Perdedores'} lanzada.`);
        setDraftBracket(null);
        setSelectedPlayoffPlayers([]);
        loadLeagueData();
        setActiveFixtureView(selectedPlayoffType);
        setActiveSubTab('fixture');
      } catch (e) {
        console.error(e);
        alert("Error al lanzar llave.");
      }
      setLoadingData(false);
    });
  };

  // Reset/Wipe de una Llave
  const handleResetBracket = async (bracketId) => {
    showConfirm(`🚨 ¿Seguro que quieres borrar por completo la llave de ${bracketId === 'winners' ? 'Ganadores' : 'Perdedores'}?`, async () => {
      setLoadingData(true);
      try {
        const bracketField = bracketId === 'winners' ? 'winnersBracket' : 'losersBracket';
        await setDoc(doc(db, "players", configData.creatorUid), {
          createdLeagues: {
            [selectedLeagueId]: {
              [bracketField]: deleteField()
            }
          }
        }, { merge: true });
        alert("Llave eliminada.");
        loadLeagueData();
      } catch (e) {
        console.error(e);
      }
      setLoadingData(false);
    });
  };

  // --- CARGA, REPORTES Y VALIDACIÓN DE JUGADORES ---

  const openReportModal = (match, isBracket = false, bracketId = '', roundIdx = 0, matchIdx = 0) => {
    setSelectedMatchToReport({ match, isBracket, bracketId, roundIdx, matchIdx });
    setMyVpReport(0);
    setRivalVpReport(0);
    setMyLeaderKilledReport(false);
    setMyLeaderLostReport(false);
    setIsReportModalOpen(true);
  };

  // Guardar reporte
  const handleSaveReport = async (e) => {
    e.preventDefault();
    if (!selectedMatchToReport) return;

    if (myVpReport < 0 || myVpReport > 20 || rivalVpReport < 0 || rivalVpReport > 20) {
      alert("PV de 0 a 20.");
      return;
    }

    setIsSubmittingReport(true);
    try {
      const { match, isBracket, bracketId, roundIdx, matchIdx } = selectedMatchToReport;
      const isP1 = user.uid === match.player1;

      // Normalizar datos en base a Player 1
      const p1Vp = isP1 ? myVpReport : rivalVpReport;
      const p2Vp = isP1 ? rivalVpReport : myVpReport;
      const p1Killed = isP1 ? myLeaderKilledReport : myLeaderLostReport;
      const p2Killed = isP1 ? myLeaderLostReport : myLeaderKilledReport;

      if (!isBracket) {
        // Partida de Rondas
        const mRef = doc(db, "matches", match.id);
        if (match.isVirtual) {
          const reporterUid = user.uid;
          const opponentUid = user.uid === match.player1 ? match.player2 : match.player1;
          
          let res = 'draw';
          if (myVpReport > rivalVpReport) res = 'win';
          else if (rivalVpReport > myVpReport) res = 'loss';
          
          const matchData = {
            player1: reporterUid,
            player2: opponentUid,
            leagueId: selectedLeagueId,
            round: match.round,
            mission: match.mission || "",
            date: new Date().toISOString().split('T')[0],
            result: res,
            vpScored: myVpReport,
            vpConceded: rivalVpReport,
            killedLeader: myLeaderKilledReport,
            lostLeader: myLeaderLostReport,
            verified: false,
            timestamp: serverTimestamp(),
            reportedBy: user.uid,
            reportedVpP1: p1Vp,
            reportedVpP2: p2Vp,
            reportedKilledLeaderP1: p1Killed,
            reportedKilledLeaderP2: p2Killed
          };
          try {
            await setDoc(mRef, matchData);
          } catch (err) {
            console.warn("Direct match creation failed, falling back to profile write:", err.message);
            await setDoc(doc(db, "players", user.uid), {
              matchReports: {
                [match.id]: {
                  reportedBy: user.uid,
                  reportedVpP1: p1Vp,
                  reportedVpP2: p2Vp,
                  reportedKilledLeaderP1: p1Killed,
                  reportedKilledLeaderP2: p2Killed,
                  timestamp: serverTimestamp()
                }
              }
            }, { merge: true });
          }
        } else {
          try {
            await updateDoc(mRef, {
              reportedBy: user.uid,
              verified: false,
              reportedVpP1: p1Vp,
              reportedVpP2: p2Vp,
              reportedKilledLeaderP1: p1Killed,
              reportedKilledLeaderP2: p2Killed,
              timestamp: serverTimestamp()
            });
          } catch (err) {
            console.warn("Direct match update failed, falling back to profile write:", err.message);
            await setDoc(doc(db, "players", user.uid), {
              matchReports: {
                [match.id]: {
                  reportedBy: user.uid,
                  reportedVpP1: p1Vp,
                  reportedVpP2: p2Vp,
                  reportedKilledLeaderP1: p1Killed,
                  reportedKilledLeaderP2: p2Killed,
                  timestamp: serverTimestamp()
                }
              }
            }, { merge: true });
          }
        }
      } else {
        // Partida de Llaves
        const matchDocId = `playoff_${selectedLeagueId}_${bracketId}_${roundIdx}_${matchIdx}`;
        const mRef = doc(db, "matches", matchDocId);
        const reporterUid = user.uid;
        const opponentUid = user.uid === match.player1 ? match.player2 : match.player1;
        
        let res = 'draw';
        if (myVpReport > rivalVpReport) res = 'win';
        else if (rivalVpReport > myVpReport) res = 'loss';

        const matchData = {
          player1: reporterUid,
          player2: opponentUid,
          leagueId: selectedLeagueId,
          bracketId: bracketId,
          round: roundIdx + 1,
          mission: match.mission || "",
          date: new Date().toISOString().split('T')[0],
          result: res,
          vpScored: myVpReport,
          vpConceded: rivalVpReport,
          killedLeader: myLeaderKilledReport,
          lostLeader: myLeaderLostReport,
          verified: false,
          timestamp: serverTimestamp(),
          reportedBy: user.uid,
          reportedVpP1: p1Vp,
          reportedVpP2: p2Vp,
          reportedKilledLeaderP1: p1Killed,
          reportedKilledLeaderP2: p2Killed
        };
        try {
          await setDoc(mRef, matchData);
        } catch (err) {
          console.warn("Direct playoff match write failed, falling back to profile write:", err.message);
          await setDoc(doc(db, "players", user.uid), {
            matchReports: {
              [matchDocId]: {
                reportedBy: user.uid,
                reportedVpP1: p1Vp,
                reportedVpP2: p2Vp,
                reportedKilledLeaderP1: p1Killed,
                reportedKilledLeaderP2: p2Killed,
                timestamp: serverTimestamp()
              }
            }
          }, { merge: true });
        }
      }

      alert("Resultado cargado. Pendiente de verificación por rival.");
      setIsReportModalOpen(false);
      setSelectedMatchToReport(null);
      loadLeagueData();
    } catch (err) {
      console.error(err);
      alert(`Error al guardar: ${err.message}`);
    }
    setIsSubmittingReport(false);
  };

  // Eliminar mi propio reporte (solo si aún no fue verificado)
  const handleDeleteOwnReport = async (match, isBracket = false, bracketId = '', roundIdx = 0, matchIdx = 0) => {
    showConfirm(
      lang === 'es' 
        ? "¿Eliminar tu reporte? El resultado volverá al estado sin reportar." 
        : "Delete your report? The result will go back to unreported status.",
      async () => {
        setLoadingData(true);
        try {
          if (!isBracket) {
            const matchId = match.id;
            if (profile?.isAdmin) {
              try {
                const mRef = doc(db, "matches", matchId);
                await updateDoc(mRef, {
                  reportedBy: "", reportedVpP1: 0, reportedVpP2: 0,
                  reportedKilledLeaderP1: false, reportedKilledLeaderP2: false, verified: false
                });
              } catch (err) {
                console.warn("Direct update failed on own report delete:", err.message);
                await setDoc(doc(db, "players", user.uid), {
                  matchReports: {
                    [matchId]: {
                      reportedBy: "",
                      reportedVpP1: 0, reportedVpP2: 0,
                      reportedKilledLeaderP1: false, reportedKilledLeaderP2: false,
                      timestamp: serverTimestamp()
                    }
                  }
                }, { merge: true });
              }
            } else {
              await setDoc(doc(db, "players", user.uid), {
                matchReports: {
                  [matchId]: {
                    reportedBy: "",
                    reportedVpP1: 0, reportedVpP2: 0,
                    reportedKilledLeaderP1: false, reportedKilledLeaderP2: false,
                    timestamp: serverTimestamp()
                  }
                }
              }, { merge: true });
            }
          } else {
            const matchDocId = match.id || `playoff_${selectedLeagueId}_${bracketId}_${roundIdx}_${matchIdx}`;
            if (profile?.isAdmin) {
              try {
                await deleteDoc(doc(db, "matches", matchDocId));
              } catch (e) {
                console.warn("Could not delete playoff match document:", e.message);
              }
            }
            await setDoc(doc(db, "players", user.uid), {
              matchReports: {
                [matchDocId]: {
                  reportedBy: "",
                  reportedVpP1: 0, reportedVpP2: 0,
                  reportedKilledLeaderP1: false, reportedKilledLeaderP2: false,
                  timestamp: serverTimestamp()
                }
              }
            }, { merge: true });
          }
          alert(lang === 'es' ? "Reporte eliminado." : "Report deleted.");
          loadLeagueData();
        } catch (e) {
          console.error(e);
          alert(`Error: ${e.message}`);
        }
        setLoadingData(false);
      }
    );
  };

  // Validar reporte
  const handleValidateReport = async (match, isBracket = false, bracketId = '', roundIdx = 0, matchIdx = 0) => {
    showConfirm("¿Validar este resultado?", async () => {
      setLoadingData(true);
      try {
        if (!isBracket) {
          const matchId = match.id;
          if (profile?.isAdmin) {
            try {
              const mRef = doc(db, "matches", matchId);
              await updateDoc(mRef, { verified: true });
              alert("Validada con éxito por admin.");
            } catch (err) {
              console.warn("Direct update failed, falling back to profile write:", err.message);
              await setDoc(doc(db, "players", user.uid), {
                matchVerifications: {
                  [matchId]: {
                    verified: true,
                    timestamp: serverTimestamp()
                  }
                }
              }, { merge: true });
              alert("Validada con éxito.");
            }
          } else {
            await setDoc(doc(db, "players", user.uid), {
              matchVerifications: {
                [matchId]: {
                  verified: true,
                  timestamp: serverTimestamp()
                }
              }
            }, { merge: true });
            alert("Validada con éxito.");
          }
        } else {
          const matchDocId = match.id || `playoff_${selectedLeagueId}_${bracketId}_${roundIdx}_${matchIdx}`;
          
          const vp1 = match.reportedVpP1;
          const vp2 = match.reportedVpP2;
          let winnerUid = "";
          if (vp1 > vp2) winnerUid = match.player1;
          else if (vp2 > vp1) winnerUid = match.player2;
          else {
            const killed1 = match.reportedKilledLeaderP1;
            const killed2 = match.reportedKilledLeaderP2;
            winnerUid = (killed1 && !killed2) ? match.player1 : match.player2;
          }

          if (profile?.isAdmin) {
            try {
              const mRef = doc(db, "matches", matchDocId);
              await setDoc(mRef, { verified: true, winner: winnerUid }, { merge: true });
            } catch (err) {
              console.warn("Playoff direct update failed:", err.message);
            }
          }

          // Write verification to own profile
          await setDoc(doc(db, "players", user.uid), {
            matchVerifications: {
              [matchDocId]: {
                verified: true,
                winner: winnerUid,
                timestamp: serverTimestamp()
              }
            }
          }, { merge: true });

          // If current user is the creator, update the bracket in creator profile directly as well
          if (configData && configData.creatorUid === user.uid) {
            let bracketData = bracketId === 'winners' ? JSON.parse(JSON.stringify(winnersBracket)) : JSON.parse(JSON.stringify(losersBracket));
            const m = bracketData.rounds[roundIdx][matchIdx];
            m.verified = true;
            m.winner = winnerUid;
            bracketData = advanceWinner(bracketData, roundIdx, matchIdx, winnerUid);
            
            const bracketField = bracketId === 'winners' ? 'winnersBracket' : 'losersBracket';
            const bracketToSave = {
              ...bracketData,
              rounds: roundsArrayToMap(bracketData.rounds)
            };
            await setDoc(doc(db, "players", configData.creatorUid), {
              createdLeagues: {
                [selectedLeagueId]: {
                  [bracketField]: bracketToSave
                }
              }
            }, { merge: true });
          }

          alert("Validada con éxito.");
        }
        loadLeagueData();
      } catch (e) {
        console.error(e);
        alert(`Error al validar: ${e.message}`);
      }
      setLoadingData(false);
    });
  };

  // Modificar/Rechazar reporte
  const handleModifyReport = async (match, isBracket = false, bracketId = '', roundIdx = 0, matchIdx = 0) => {
    showConfirm("¿Rechazar este resultado? Volverá al estado sin reportar.", async () => {
      setLoadingData(true);
      try {
        if (!isBracket) {
          const matchId = match.id;
          if (profile?.isAdmin) {
            try {
              const mRef = doc(db, "matches", matchId);
              await updateDoc(mRef, {
                reportedBy: "", reportedVpP1: 0, reportedVpP2: 0,
                reportedKilledLeaderP1: false, reportedKilledLeaderP2: false, verified: false
              });
              alert("Reporte rechazado por admin.");
            } catch (err) {
              console.warn("Direct update failed on rejection:", err.message);
              await setDoc(doc(db, "players", user.uid), {
                matchVerifications: {
                  [matchId]: {
                    rejected: true,
                    timestamp: serverTimestamp()
                  }
                }
              }, { merge: true });
              alert("Reporte rechazado.");
            }
          } else {
            await setDoc(doc(db, "players", user.uid), {
              matchVerifications: {
                [matchId]: {
                  rejected: true,
                  timestamp: serverTimestamp()
                }
              }
            }, { merge: true });
            alert("Reporte rechazado.");
          }
        } else {
          const matchDocId = match.id || `playoff_${selectedLeagueId}_${bracketId}_${roundIdx}_${matchIdx}`;
          if (profile?.isAdmin) {
            try {
              await deleteDoc(doc(db, "matches", matchDocId));
            } catch (e) {
              console.warn("Could not delete playoff match document:", e.message);
            }
          }
          
          await setDoc(doc(db, "players", user.uid), {
            matchVerifications: {
              [matchDocId]: {
                rejected: true,
                timestamp: serverTimestamp()
              }
            }
          }, { merge: true });

          // If current user is the creator, also reset the bracket cell in creator profile
          if (configData && configData.creatorUid === user.uid) {
            let bracketData = bracketId === 'winners' ? JSON.parse(JSON.stringify(winnersBracket)) : JSON.parse(JSON.stringify(losersBracket));
            const m = bracketData.rounds[roundIdx][matchIdx];
            m.reportedBy = "";
            m.verified = false;
            m.reportedVpP1 = 0;
            m.reportedVpP2 = 0;
            m.reportedKilledLeaderP1 = false;
            m.reportedKilledLeaderP2 = false;
            m.winner = "";
            
            const bracketField = bracketId === 'winners' ? 'winnersBracket' : 'losersBracket';
            const bracketToSave = {
              ...bracketData,
              rounds: roundsArrayToMap(bracketData.rounds)
            };
            await setDoc(doc(db, "players", configData.creatorUid), {
              createdLeagues: {
                [selectedLeagueId]: {
                  [bracketField]: bracketToSave
                }
              }
            }, { merge: true });
          }

          alert("Reporte borrado.");
        }
        loadLeagueData();
      } catch (e) {
        console.error(e);
      }
      setLoadingData(false);
    });
  };

  // --- ADMINISTRADOR OVERRIDE MANUAL DE RESULTADO ---

  const openAdminEditModal = (match, isBracket = false, bracketId = '', roundIdx = 0, matchIdx = 0) => {
    setSelectedMatchToEditAdmin({ match, isBracket, bracketId, roundIdx, matchIdx });
    setAdminVpP1(match.reportedVpP1 || 0);
    setAdminVpP2(match.reportedVpP2 || 0);
    setAdminKilledP1(match.reportedKilledLeaderP1 || false);
    setAdminKilledP2(match.reportedKilledLeaderP2 || false);
    setAdminVerified(match.verified || false);
    setIsAdminEditModalOpen(true);
  };

  const handleAdminSaveOverride = async (e) => {
    e.preventDefault();
    if (!selectedMatchToEditAdmin) return;
    setIsAdminSaving(true);
    try {
      const { match, isBracket, bracketId, roundIdx, matchIdx } = selectedMatchToEditAdmin;
      const vp1 = parseInt(adminVpP1) || 0;
      const vp2 = parseInt(adminVpP2) || 0;
      const matchDocId = match.id;

      const overrideData = {
        player1: match.player1,
        player2: match.player2,
        leagueId: selectedLeagueId,
        bracketId: bracketId || null,
        round: isBracket ? (roundIdx + 1) : match.round,
        date: new Date().toISOString().split('T')[0],
        result: vp1 > vp2 ? 'win' : (vp2 > vp1 ? 'loss' : 'draw'),
        vpScored: vp1,
        vpConceded: vp2,
        killedLeader: adminKilledP1,
        lostLeader: adminKilledP2,
        verified: adminVerified,
        reportedBy: adminVerified ? user.uid : "",
        reportedVpP1: vp1,
        reportedVpP2: vp2,
        reportedKilledLeaderP1: adminKilledP1,
        reportedKilledLeaderP2: adminKilledP2
      };

      // Try to update /matches if the document exists (already reported by player)
      if (match.id && !match.id.startsWith('virtual_') && !match.id.startsWith('playoff_')) {
        try {
          const mRef = doc(db, "matches", match.id);
          await updateDoc(mRef, {
            result: vp1 > vp2 ? 'win' : (vp2 > vp1 ? 'loss' : 'draw'),
            vpScored: vp1,
            vpConceded: vp2,
            killedLeader: adminKilledP1,
            lostLeader: adminKilledP2,
            reportedVpP1: vp1,
            reportedVpP2: vp2,
            reportedKilledLeaderP1: adminKilledP1,
            reportedKilledLeaderP2: adminKilledP2,
            verified: adminVerified,
            reportedBy: adminVerified ? (match.reportedBy || user.uid) : ""
          });
        } catch (err) {
          console.warn("Could not update matches collection doc:", err.message);
        }
      }

      if (!isBracket) {
        // Guardar override en el perfil del creador
        await setDoc(doc(db, "players", configData.creatorUid), {
          createdLeagues: {
            [selectedLeagueId]: {
              overrides: {
                [matchDocId]: overrideData
              }
            }
          }
        }, { merge: true });

        alert("Resultado forzado por administración.");
      } else {
        let bracketUpdatePayload = {};
        if (adminVerified) {
          let winnerUid = "";
          if (vp1 > vp2) winnerUid = match.player1;
          else if (vp2 > vp1) winnerUid = match.player2;
          else winnerUid = adminKilledP1 ? match.player1 : match.player2;

          let bracketData = bracketId === 'winners' ? JSON.parse(JSON.stringify(winnersBracket)) : JSON.parse(JSON.stringify(losersBracket));
          const m = bracketData.rounds[roundIdx][matchIdx];
          m.verified = true;
          m.winner = winnerUid;
          bracketData = advanceWinner(bracketData, roundIdx, matchIdx, winnerUid);
          
          const bracketField = bracketId === 'winners' ? 'winnersBracket' : 'losersBracket';
          bracketUpdatePayload = {
            [bracketField]: {
              ...bracketData,
              rounds: roundsArrayToMap(bracketData.rounds)
            }
          };
        }

        // Guardar tanto el override como la llave en el perfil del creador en una sola escritura
        await setDoc(doc(db, "players", configData.creatorUid), {
          createdLeagues: {
            [selectedLeagueId]: {
              ...bracketUpdatePayload,
              overrides: {
                [matchDocId]: overrideData
              }
            }
          }
        }, { merge: true });

        alert("Partida de llave forzada por administración.");
      }
      setIsAdminEditModalOpen(false);
      loadLeagueData();
    } catch (err) {
      console.error(err);
      alert(`Error al guardar: ${err.message}`);
    }
    setIsAdminSaving(false);
  };

  // --- VISORES ---

  const openPdf = (missionName) => {
    setSelectedMissionPdf(missionName);
  };

  useEffect(() => {
    if (!selectedMissionPdf) {
      setActivePdfUrl(null);
      return;
    }
    const url = getMissionPdfUrl(selectedMissionPdf, pdfLang, '1vs1', user?.uid);
    setActivePdfUrl(url);
  }, [selectedMissionPdf, pdfLang, user]);

  // Helper para obtener nombres legibles de rondas eliminatorias
  const getRoundLabel = (rIdx, totalRounds) => {
    const isEs = lang === 'es';
    if (rIdx === totalRounds - 1) return isEs ? "Gran Final" : "Grand Final";
    if (rIdx === totalRounds - 2) return isEs ? "Semifinales" : "Semifinals";
    if (rIdx === totalRounds - 3) return isEs ? "Cuartos de Final" : "Quarterfinals";
    if (rIdx === totalRounds - 4) return isEs ? "Octavos de Final" : "Round of 16";
    return isEs ? `Ronda ${rIdx + 1}` : `Round ${rIdx + 1}`;
  };

  const executeLeagueDeletion = async (leagueId, creatorUid) => {
    if (!leagueId) return;
    
    setLoadingData(true);
    try {
      // 1. Delete league config from the creator's profile document in /players
      // Si no tenemos creatorUid (liga vieja), buscar en todos los jugadores quién la tiene
      let resolvedCreatorUid = creatorUid;
      if (!resolvedCreatorUid) {
        const allPlayersSnap = await getDocs(collection(db, "players"));
        allPlayersSnap.forEach(d => {
          const pData = d.data();
          if (pData.createdLeagues && pData.createdLeagues[leagueId]) {
            resolvedCreatorUid = d.id;
          }
        });
      }
      if (resolvedCreatorUid) {
        await updateDoc(doc(db, "players", resolvedCreatorUid), {
          [`createdLeagues.${leagueId}`]: deleteField()
        });
      }
      
      // 2. Delete matches in the /matches collection that have leagueId === leagueId (Optimizado)
      const matchesSnap = await getDocs(query(collection(db, "matches"), where("leagueId", "==", leagueId)));
      const deletePromises = [];
      matchesSnap.forEach(d => {
        deletePromises.push(deleteDoc(doc(db, "matches", d.id)));
      });
      
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
      }
      
      // 3. Remove this league from the enrolled list of all players (profile.leagues[leagueId]) (Optimizado)
      const playersSnap = await getDocs(query(
        collection(db, "players"), 
        where(`leagues.${leagueId}.status`, "in", ["approved", "pending", "removed", "rejected"])
      ));
      const playerUpdatePromises = [];
      playersSnap.forEach(d => {
        playerUpdatePromises.push(
          updateDoc(doc(db, "players", d.id), {
            [`leagues.${leagueId}`]: deleteField()
          })
        );
      });
      
      if (playerUpdatePromises.length > 0) {
        await Promise.all(playerUpdatePromises);
      }

      // Exit back to directory if we deleted the selected league
      if (selectedLeagueId === leagueId) {
        setSelectedLeagueId(null);
      }
      
      // Reload the directory data
      await loadLeagueData();
      
      alert(lang === 'es' ? "Liga eliminada correctamente." : "League deleted successfully.");
    } catch (err) {
      console.error("Error deleting league:", err);
      alert(lang === 'es' ? `Error al eliminar la liga: ${err.message}` : `Error deleting league: ${err.message}`);
    }
    setLoadingData(false);
  };

  const handleDeleteLeagueClick = (leagueId, league) => {
    setConfirmModalMessage(
      lang === 'es'
        ? `¿Estás seguro de que deseas eliminar permanentemente la liga "${league.name}"? Esta acción es irreversible y eliminará todas las partidas, resultados y clasificaciones asociadas.`
        : `Are you sure you want to permanently delete the league "${league.name}"? This action is irreversible and will delete all associated matches, results, and standings.`
    );
    setConfirmModalOnConfirm(() => async () => {
      await executeLeagueDeletion(leagueId, league.creatorUid);
    });
    setIsConfirmModalOpen(true);
  };

  if (!selectedLeagueId) {
    const filteredLeagues = Object.entries(leaguesList).filter(([id, league]) => {
      const matchesSearch = league.name?.toLowerCase().includes(searchTerm.toLowerCase());
      let matchesType = true;
      if (filterType === 'my') {
        matchesType = profile?.leagues && profile.leagues[id];
      }
      return matchesSearch && matchesType;
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
        <div className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
          <span style={{ fontSize: '3.5rem', filter: 'drop-shadow(0 0 8px var(--gold-glow))' }} role="img" aria-label="Cuchara">🥄</span>
          <h2 style={{ color: 'var(--gold-primary)', marginTop: '10px', fontSize: '1.8rem', fontFamily: 'Outfit, sans-serif' }}>{lang === 'es' ? 'Directorio de Ligas' : 'Leagues Directory'}</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {lang === 'es' 
              ? 'Explora las ligas de La Cuchara de Lobelia, regístrate y participa en los torneos.' 
              : 'Explore La Cuchara de Lobelia leagues, register and participate in tournaments.'}
          </p>
        </div>

        <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Cabecera del directorio de ligas con controles */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 300px' }}>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--gold-primary)', margin: 0, whiteSpace: 'nowrap' }}>
                {lang === 'es' ? 'Ligas Disponibles' : 'Available Leagues'}
              </h3>
              
              {/* Buscador */}
              <div style={{ position: 'relative', width: '100%', maxWidth: '280px' }}>
                <input 
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={lang === 'es' ? "Buscar liga..." : "Search league..."}
                  style={{ 
                    width: '100%',
                    background: 'rgba(0, 0, 0, 0.25)', 
                    border: 'var(--border-glass)', 
                    color: '#fff', 
                    padding: '8px 12px', 
                    borderRadius: '6px', 
                    fontSize: '0.85rem',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                />
              </div>
            </div>

            {/* Filtros y botón de crear */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '2px', border: 'var(--border-glass)' }}>
                <button
                  onClick={() => setFilterType('all')}
                  style={{
                    background: filterType === 'all' ? 'var(--gold-primary)' : 'transparent',
                    color: filterType === 'all' ? '#000' : 'var(--text-secondary)',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    fontWeight: '650',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {lang === 'es' ? 'Todas' : 'All'}
                </button>
                <button
                  onClick={() => setFilterType('my')}
                  style={{
                    background: filterType === 'my' ? 'var(--gold-primary)' : 'transparent',
                    color: filterType === 'my' ? '#000' : 'var(--text-secondary)',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    fontWeight: '650',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {lang === 'es' ? 'Mis Ligas' : 'My Leagues'}
                </button>
              </div>

              <button 
                className="btn btn-primary btn-small" 
                onClick={() => {
                  if (!user) {
                    setPendingCreateLeague(true);
                    onOpenAuthModal();
                    return;
                  }
                  setIsCreateLeagueModalOpen(true);
                }} 
                style={{ minHeight: '34px' }}
              >
                ➕ {lang === 'es' ? 'Crear Liga' : 'Create League'}
              </button>
            </div>
          </div>

          {/* Listado de Ligas (Tabla compacta y scrollable) */}
          {leagueConfigError && (
            <div style={{ background: 'rgba(226, 76, 76, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', padding: '10px', borderRadius: '6px', fontSize: '0.8rem' }}>
              ⚠️ Error al leer Firestore: {leagueConfigError}
            </div>
          )}

          {loadingData ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Cargando ligas...' : 'Loading leagues...'}</div>
          ) : filteredLeagues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {lang === 'es' ? 'No se encontraron ligas.' : 'No leagues found.'}
            </div>
          ) : (
            <div style={{ maxHeight: '450px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
              {filteredLeagues.map(([id, league]) => {
                const deadlineDate = new Date(league.registrationDeadline);
                const isClosedByDeadline = deadlineDate < new Date() && league.status === 'registration';
                const displayStatus = league.status === 'registration' 
                  ? (isClosedByDeadline 
                      ? (lang === 'es' ? 'Cerrada' : 'Closed') 
                      : (lang === 'es' ? 'Inscripción Abierta' : 'Registration Open')) 
                  : league.status === 'active' 
                    ? (lang === 'es' ? 'En Juego' : 'In Game') 
                    : (lang === 'es' ? 'Terminada' : 'Finished');
                
                const isEnrolled = !!(profile?.leagues && profile.leagues[id] && profile.leagues[id].participates !== false);
                const userStatus = isEnrolled ? profile.leagues[id].status : null;

                return (
                  <div key={id} className="league-card league-row-hover">
                    {/* Info de la Liga */}
                    <div className="league-card-info">
                      <div className="league-card-title-row">
                        <strong style={{ fontSize: '1.05rem', color: '#fff' }}>{league.name}</strong>
                        <span 
                          style={{ 
                            fontSize: '0.68rem', 
                            padding: '2px 6px', 
                            borderRadius: '4px',
                            background: league.status === 'registration' && !isClosedByDeadline
                              ? 'rgba(46, 117, 89, 0.2)' 
                              : league.status === 'active' 
                                ? 'rgba(203, 161, 53, 0.2)' 
                                : 'rgba(255, 255, 255, 0.05)',
                            color: league.status === 'registration' && !isClosedByDeadline
                              ? 'var(--success-color)' 
                              : league.status === 'active' 
                                ? 'var(--gold-primary)' 
                                : 'var(--text-muted)',
                            border: league.status === 'registration' && !isClosedByDeadline
                              ? '1px solid rgba(46, 117, 89, 0.4)'
                              : league.status === 'active'
                                ? '1px solid rgba(203, 161, 53, 0.4)'
                                : '1px solid rgba(255, 255, 255, 0.1)'
                          }}
                        >
                          {displayStatus}
                        </span>
                      </div>
                      <div className="league-card-meta">
                        <span>
                          {lang === 'es' ? 'Organizador' : 'Organizer'}: <span style={{ color: 'var(--text-secondary)' }}>{league.creatorName || 'Admin'}</span>
                        </span>
                        <span className="league-card-meta-separator">•</span>
                        <span>
                          📅 {lang === 'es' ? 'Límite:' : 'Deadline:'} <span style={{ color: '#fff', fontWeight: '500' }}>
                            {league.registrationDeadline 
                              ? (isNaN(new Date(league.registrationDeadline + 'T00:00:00').getTime()) 
                                  ? (lang === 'es' ? 'Sin fecha límite' : 'No deadline') 
                                  : new Date(league.registrationDeadline + 'T00:00:00').toLocaleDateString())
                              : (lang === 'es' ? 'Sin fecha límite' : 'No deadline')}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Acciones */}
                    <div className="league-card-actions">
                      {(() => {
                        const isRegistrationOpen = league.status === 'registration' && !isClosedByDeadline && (!league.totalRounds || league.totalRounds === 0);

                        if (isEnrolled) {
                          const isApproved = userStatus === 'approved';
                          return (
                            <span style={{ 
                              padding: '6px 12px',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              color: isApproved ? 'var(--success-color)' : 'var(--warning-color)',
                              background: isApproved ? 'rgba(46, 117, 89, 0.15)' : 'rgba(203, 161, 53, 0.15)',
                              borderRadius: '4px',
                              border: isApproved ? '1px solid rgba(46, 117, 89, 0.4)' : '1px solid rgba(203, 161, 53, 0.4)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}>
                              {isApproved 
                                ? (lang === 'es' ? '✔ Inscripto' : '✔ Registered') 
                                : (lang === 'es' ? '⏳ Pendiente' : '⏳ Pending')}
                            </span>
                          );
                        } else {
                          if (isRegistrationOpen) {
                            return (
                              <button 
                                className="btn btn-small"
                                onClick={() => {
                                  if (!user) {
                                    setPendingRegisterLeagueId(id);
                                    onOpenAuthModal();
                                    return;
                                  }
                                  setSelectedLeagueId(id);
                                  setJoinAlignment('luz');
                                  setJoinFaction('');
                                  setIsJoinLeagueModalOpen(true);
                                }}
                                style={{ border: 'var(--border-gold)', color: 'var(--gold-primary)', minHeight: '34px', background: 'transparent', padding: '0 12px' }}
                              >
                                ✍️ {lang === 'es' ? 'Inscribirse' : 'Register'}
                              </button>
                            );
                          } else {
                            return (
                              <span style={{ 
                                padding: '6px 12px',
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                color: 'var(--danger-color)',
                                background: 'rgba(226, 76, 76, 0.15)',
                                borderRadius: '4px',
                                border: '1px solid rgba(226, 76, 76, 0.4)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}>
                                🚫 {lang === 'es' ? 'Cerrada' : 'Closed'}
                              </span>
                            );
                          }
                        }
                      })()}

                      <button 
                        className="btn btn-small" 
                        onClick={() => handleOpenShareModal(id, league)}
                        style={{ 
                          minHeight: '34px', 
                          padding: '0 10px', 
                          background: 'rgba(203, 161, 53, 0.12)', 
                          border: '1px solid rgba(203, 161, 53, 0.4)',
                          color: 'var(--gold-primary)',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        title={lang === 'es' ? 'Compartir liga con QR y WhatsApp' : 'Share league with QR and WhatsApp'}
                      >
                        <span>🔗</span>
                      </button>

                      <button 
                        className="btn btn-primary btn-small" 
                        onClick={() => {
                          setSelectedLeagueId(id);
                          setActiveSubTab('details');
                        }}
                        style={{ minHeight: '34px', padding: '0 16px' }}
                      >
                        🚪 {lang === 'es' ? 'Entrar' : 'Enter'}
                      </button>

                      {isGlobalAdmin && (
                        <button 
                          className="btn btn-small" 
                          onClick={() => handleDeleteLeagueClick(id, league)}
                          style={{ 
                            minHeight: '34px', 
                            padding: '0 10px', 
                            background: 'rgba(226, 76, 76, 0.15)', 
                            border: '1px solid rgba(226, 76, 76, 0.4)',
                            color: 'var(--danger-color)',
                            marginLeft: '6px',
                            cursor: 'pointer'
                          }}
                          title={lang === 'es' ? 'Eliminar Liga' : 'Delete League'}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modales en Directorio de Ligas */}
        <Modal 
          isOpen={isCreateLeagueModalOpen} 
          onClose={() => setIsCreateLeagueModalOpen(false)}
          title={lang === 'es' ? "Crear Nueva Liga" : "Create New League"}
        >
          <form onSubmit={handleCreateLeague} style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nombre de la Liga:' : 'League Name:'}</label>
              <input 
                type="text" 
                value={newLeagueName} 
                onChange={(e) => setNewLeagueName(e.target.value)} 
                placeholder={lang === 'es' ? "Ej. Liga de Otoño" : "e.g. Autumn League"}
                style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
                required 
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Fecha Límite de Inscripción:' : 'Registration Deadline:'}</label>
              <input 
                type="date" 
                value={newLeagueDeadline} 
                onChange={(e) => setNewLeagueDeadline(e.target.value)}
                style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
                required 
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Ubicación / Lugar de juego:' : 'Location / Venue:'}</label>
              <input 
                type="text" 
                value={newLeagueLocation} 
                onChange={(e) => setNewLeagueLocation(e.target.value)} 
                placeholder={lang === 'es' ? "Ej. Barcelona, Club Bilbo" : "e.g. Barcelona, Club Bilbo"}
                style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
                required 
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Descripción y Normas (opcional):' : 'Description and Rules (optional):'}</label>
              <textarea 
                value={newLeagueDescription} 
                onChange={(e) => setNewLeagueDescription(e.target.value)} 
                placeholder={lang === 'es' ? "Normas de la liga, formato, etc." : "League rules, format, etc."}
                rows={4}
                style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Link al Reglamento (opcional):' : 'Rules Link (optional):'}</label>
              <input 
                type="text" 
                value={newLeagueRulesLink} 
                onChange={(e) => setNewLeagueRulesLink(e.target.value)} 
                placeholder={lang === 'es' ? "Ej. enlace a Google Drive" : "e.g. Link to Google Drive"}
                style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ marginTop: '10px' }}>
              {lang === 'es' ? 'Crear Liga' : 'Create League'}
            </button>
          </form>
        </Modal>

        <Modal 
          isOpen={isJoinLeagueModalOpen} 
          onClose={() => setIsJoinLeagueModalOpen(false)}
          title={lang === 'es' ? "Inscripción a la Liga" : "Register to League"}
        >
          {selectedLeagueId && leaguesList[selectedLeagueId] && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(203, 161, 53, 0.12) 0%, rgba(0,0,0,0.5) 100%)',
              border: '1px solid rgba(203, 161, 53, 0.4)',
              borderRadius: '10px',
              padding: '14px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '1.3rem' }}>🏆</span>
                <h4 style={{ margin: 0, color: 'var(--gold-primary)', fontSize: '1.05rem', fontFamily: 'var(--font-title)' }}>
                  {leaguesList[selectedLeagueId].name}
                </h4>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                {leaguesList[selectedLeagueId].location && (
                  <span>📍 <strong>{leaguesList[selectedLeagueId].location}</strong></span>
                )}
                {leaguesList[selectedLeagueId].deadline && (
                  <span>📅 Cierre: <strong>{leaguesList[selectedLeagueId].deadline}</strong></span>
                )}
              </div>
              {leaguesList[selectedLeagueId].description && (
                <p style={{ margin: '0 0 6px 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  {leaguesList[selectedLeagueId].description}
                </p>
              )}
              {leaguesList[selectedLeagueId].rulesLink && (
                <a
                  href={leaguesList[selectedLeagueId].rulesLink.startsWith('http') ? leaguesList[selectedLeagueId].rulesLink : `https://${leaguesList[selectedLeagueId].rulesLink}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.75rem', color: 'var(--gold-primary)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  📜 {lang === 'es' ? 'Ver Bases / Reglamento Oficial' : 'View Rules / Guidelines'}
                </a>
              )}
            </div>
          )}

          <form onSubmit={handleJoinLeagueSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Bando:' : 'Side:'}</label>
                <select 
                  value={joinAlignment} 
                  onChange={(e) => { setJoinAlignment(e.target.value); setJoinFaction(''); }}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
                >
                  <option value="luz">{lang === 'es' ? '☀️ Luz' : '☀️ Light'}</option>
                  <option value="oscuridad">{lang === 'es' ? '👁️ Oscuridad' : '👁️ Darkness'}</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Facción:' : 'Faction:'}</label>
                <select 
                  value={joinFaction} 
                  onChange={(e) => setJoinFaction(e.target.value)}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
                  required
                >
                  <option value="">{lang === 'es' ? '-- Facción --' : '-- Faction --'}</option>
                  <optgroup label={joinAlignment === 'luz' ? (lang === 'es' ? "Listas de Luz" : "Light Lists") : (lang === 'es' ? "Listas de Oscuridad" : "Darkness Lists")}>
                    {joinFactionsList.normal.map(f => <option key={f} value={f}>{f}</option>)}
                  </optgroup>
                  <optgroup label={joinAlignment === 'luz' ? (lang === 'es' ? "Listas de Luz (Legend)" : "Light Lists (Legend)") : (lang === 'es' ? "Listas de Oscuridad (Legend)" : "Darkness Lists (Legend)")}>
                    {joinFactionsList.legend.map(f => <option key={f} value={f}>{f}</option>)}
                  </optgroup>
                </select>
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={isJoining} style={{ marginTop: '10px' }}>
              {isJoining ? (lang === 'es' ? 'Inscribiendo...' : 'Registering...') : (lang === 'es' ? 'Confirmar Inscripción' : 'Confirm Registration')}
            </button>
          </form>
        </Modal>

        {/* --- MODAL SHARE: CARTEL OFICIAL DE LIGA (QR & WHATSAPP) --- */}
        {isShareLeagueModalOpen && shareLeagueData && (
          <Modal
            isOpen={true}
            onClose={() => setIsShareLeagueModalOpen(false)}
            title={lang === 'es' ? `Cartel Oficial: ${shareLeagueData.name}` : `Official Poster: ${shareLeagueData.name}`}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', textAlign: 'center' }}>
              
              {/* Canvas del Cartel Oficial de Convocatoria */}
              <div style={{
                width: '100%',
                maxWidth: '340px',
                margin: '0 auto',
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 10px 35px rgba(0,0,0,0.8)',
                border: '1px solid rgba(203, 161, 53, 0.45)',
                background: '#07130C'
              }}>
                <canvas 
                  ref={qrCanvasRef} 
                  style={{ 
                    display: 'block', 
                    width: '100%', 
                    height: 'auto' 
                  }} 
                />
              </div>

              {/* Botones Principales de Compartición */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
                <button
                  type="button"
                  onClick={handleShareWhatsApp}
                  style={{
                    background: '#25D366',
                    border: 'none',
                    color: '#111',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 10px rgba(37, 211, 102, 0.3)'
                  }}
                >
                  <span>📲</span> {lang === 'es' ? 'Enviar a WhatsApp' : 'Share on WhatsApp'}
                </button>

                <button
                  type="button"
                  onClick={handleCopyCardImage}
                  style={{
                    background: copiedImageToast ? '#2ecc71' : 'rgba(203, 161, 53, 0.15)',
                    border: '1px solid var(--gold-primary)',
                    color: copiedImageToast ? '#fff' : 'var(--gold-primary)',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease'
                  }}
                  title={lang === 'es' ? 'Copia la imagen para pegarla con Ctrl+V' : 'Copy image to clipboard'}
                >
                  <span>🖼️</span> {copiedImageToast ? '✔ Imagen Copiada' : (lang === 'es' ? 'Copiar Imagen' : 'Copy Image')}
                </button>
              </div>

              {/* Fila secundaria: Copiar Texto Formateado y Descargar PNG */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
                <button
                  type="button"
                  onClick={handleCopyShareText}
                  style={{
                    background: copiedTextToast ? '#2ecc71' : 'rgba(255,255,255,0.06)',
                    border: 'var(--border-glass)',
                    color: copiedTextToast ? '#111' : '#fff',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <span>📝</span> {copiedTextToast ? '✔ Texto Copiado' : (lang === 'es' ? 'Copiar Texto' : 'Copy Text')}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPoster}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: 'var(--border-glass)',
                    color: '#fff',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <span>📥</span> {lang === 'es' ? 'Descargar PNG' : 'Download PNG'}
                </button>
              </div>

              {/* Guía visual para WhatsApp Web */}
              <div style={{ 
                background: 'rgba(37, 211, 102, 0.08)', 
                border: '1px solid rgba(37, 211, 102, 0.3)', 
                borderRadius: '8px', 
                padding: '10px 12px', 
                fontSize: '0.74rem', 
                color: '#e2e8f0', 
                lineHeight: '1.45', 
                textAlign: 'left',
                width: '100%',
                boxSizing: 'border-box'
              }}>
                <strong style={{ color: '#25D366', display: 'block', marginBottom: '3px' }}>
                  📌 ¿Cómo enviarlo en 1 solo mensaje en WhatsApp Web?
                </strong>
                1. Pulsa <strong>«Copiar Imagen»</strong> y haz <strong>Ctrl + V</strong> en el chat de WhatsApp Web.<br/>
                2. En la ventana de previsualización, pulsa en <em>"Añade un pie de foto..."</em> y pega el texto con el enlace antes de pulsar Enviar.
              </div>

            </div>
          </Modal>
        )}

        <Modal
          isOpen={isConfirmModalOpen}
          onClose={() => setIsConfirmModalOpen(false)}
          title={lang === 'es' ? 'Confirmación' : 'Confirmation'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '10px 0' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              {confirmModalMessage}
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button 
                className="btn btn-primary" 
                onClick={async () => {
                  setIsConfirmModalOpen(false);
                  if (confirmModalOnConfirm) {
                    await confirmModalOnConfirm();
                  }
                }}
                style={{ flex: 1, background: 'var(--success-color)', color: '#000', border: 'none' }}
              >
                {lang === 'es' ? 'Sí, estoy seguro' : "Yes, I'm sure"}
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => setIsConfirmModalOpen(false)}
                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: '#fff', border: 'var(--border-glass)' }}
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={isAlertModalOpen}
          onClose={() => setIsAlertModalOpen(false)}
          title={lang === 'es' ? 'Notificación' : 'Notification'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '10px 0' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              {alertModalMessage}
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button 
                className="btn btn-primary" 
                onClick={() => setIsAlertModalOpen(false)}
                style={{ flex: 1, background: 'var(--gold-primary)', color: '#000', border: 'none', minHeight: '40px', fontWeight: 'bold' }}
              >
                {lang === 'es' ? 'Aceptar' : 'OK'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      
      {/* HEADER DE LIGA SELECCIONADA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: 'var(--border-glass)', flexWrap: 'wrap', gap: '10px' }}>
        <button 
          className="btn btn-small" 
          onClick={() => {
            setSelectedLeagueId(null);
            setActiveSubTab('details');
          }}
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: 'var(--border-glass)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            minHeight: '34px'
          }}
        >
          ⬅️ {lang === 'es' ? 'Volver a las ligas' : 'Back to Leagues'}
        </button>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ fontSize: '1.2rem', color: 'var(--gold-primary)', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
            {configData?.name || (lang === 'es' ? 'Cargando liga...' : 'Loading league...')}
          </h2>
          {configData && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {lang === 'es' ? 'Estado' : 'Status'}: {configData.status === 'registration' ? (lang === 'es' ? 'Inscripciones abiertas' : 'Registration open') : configData.status === 'active' ? (lang === 'es' ? 'En juego' : 'In game') : (lang === 'es' ? 'Terminada' : 'Finished')}
            </span>
          )}
        </div>
      </div>

      {/* MENÚ DE SUBPESTAÑAS */}
      <div className="subtabs-container hide-scrollbar">
        <button 
          className="btn btn-small subtab-button"
          onClick={() => setActiveSubTab('details')}
          style={{
            background: activeSubTab === 'details' ? 'linear-gradient(135deg, #1d3321 0%, #112114 100%)' : 'transparent',
            border: activeSubTab === 'details' ? 'var(--border-gold)' : '1px solid transparent',
            color: activeSubTab === 'details' ? 'var(--gold-primary)' : 'var(--text-muted)',
            boxShadow: 'none'
          }}
        >
          ℹ️ {lang === 'es' ? 'Detalles' : 'Details'}
        </button>
        <button 
          className="btn btn-small subtab-button"
          onClick={() => setActiveSubTab('ranking')}
          style={{
            background: activeSubTab === 'ranking' ? 'linear-gradient(135deg, #1d3321 0%, #112114 100%)' : 'transparent',
            border: activeSubTab === 'ranking' ? 'var(--border-gold)' : '1px solid transparent',
            color: activeSubTab === 'ranking' ? 'var(--gold-primary)' : 'var(--text-muted)',
            boxShadow: 'none'
          }}
        >
          🏆 {lang === 'es' ? 'Ranking' : 'Rankings'}
        </button>
        <button 
          className="btn btn-small subtab-button"
          onClick={() => setActiveSubTab('fixture')}
          style={{
            background: activeSubTab === 'fixture' ? 'linear-gradient(135deg, #1d3321 0%, #112114 100%)' : 'transparent',
            border: activeSubTab === 'fixture' ? 'var(--border-gold)' : '1px solid transparent',
            color: activeSubTab === 'fixture' ? 'var(--gold-primary)' : 'var(--text-muted)',
            boxShadow: 'none'
          }}
        >
          ⚔️ {lang === 'es' ? 'Fixture' : 'Fixture'}
        </button>
        <button 
          className="btn btn-small subtab-button"
          onClick={() => setActiveSubTab('profile')}
          style={{
            background: activeSubTab === 'profile' ? 'linear-gradient(135deg, #1d3321 0%, #112114 100%)' : 'transparent',
            border: activeSubTab === 'profile' ? 'var(--border-gold)' : '1px solid transparent',
            color: activeSubTab === 'profile' ? 'var(--gold-primary)' : 'var(--text-muted)',
            boxShadow: 'none'
          }}
        >
          👤 {lang === 'es' ? 'Mi Perfil' : 'Profile'}
        </button>
        {isAdmin && (
          <button 
            className="btn btn-small subtab-button"
            onClick={() => setActiveSubTab('admin')}
            style={{
              background: activeSubTab === 'admin' ? 'linear-gradient(135deg, #4d1c1c 0%, #301010 100%)' : 'transparent',
              border: activeSubTab === 'admin' ? '1px solid var(--danger-color)' : '1px solid transparent',
              color: activeSubTab === 'admin' ? 'var(--danger-color)' : 'var(--text-muted)',
              boxShadow: 'none'
            }}
          >
            🛠️ Admin
          </button>
        )}
      </div>

      {/* --- SECCIÓN 0: DETALLES --- */}
      {activeSubTab === 'details' && (
        <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--gold-primary)', margin: 0 }}>
              {lang === 'es' ? 'Detalles de la Liga' : 'League Details'}
            </h3>
            <button
              className="btn btn-small"
              onClick={() => handleOpenShareModal(selectedLeagueId, configData)}
              style={{
                background: 'rgba(203, 161, 53, 0.15)',
                border: '1px solid var(--gold-primary)',
                color: 'var(--gold-primary)',
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              <span>📱</span> {lang === 'es' ? 'Compartir Liga (QR / WhatsApp)' : 'Share League (QR / WhatsApp)'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Ubicación */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                📍 {lang === 'es' ? 'Ubicación / Lugar de juego:' : 'Location / Venue:'}
              </span>
              <span style={{ fontSize: '0.95rem', color: '#fff' }}>
                {configData?.location || (lang === 'es' ? 'No especificada' : 'Not specified')}
              </span>
            </div>

            {/* Descripción / Normas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                📝 {lang === 'es' ? 'Descripción y Normas:' : 'Description and Rules:'}
              </span>
              <div style={{ 
                fontSize: '0.9rem', 
                color: '#ddd', 
                lineHeight: '1.5', 
                whiteSpace: 'pre-wrap', 
                background: 'rgba(0,0,0,0.2)', 
                padding: '12px', 
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.03)'
              }}>
                {configData?.description || (lang === 'es' ? 'El organizador no ha añadido ninguna descripción.' : 'The organizer has not added any description.')}
              </div>
            </div>

            {/* Link Reglamento */}
            {configData?.rulesLink && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                  🔗 {lang === 'es' ? 'Reglamento Oficial:' : 'Official Rules:'}
                </span>
                <a 
                  href={configData.rulesLink.startsWith('http') ? configData.rulesLink : `https://${configData.rulesLink}`}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{ 
                    alignSelf: 'flex-start', 
                    padding: '8px 16px', 
                    fontSize: '0.85rem', 
                    textDecoration: 'none', 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    gap: '6px' 
                  }}
                >
                  📖 {lang === 'es' ? 'Ver Reglamento Completo' : 'View Full Rules'}
                </a>
              </div>
            )}

            {/* Inscribirse desde Detalles si aplica */}
            {(() => {
              const deadlineDate = configData?.registrationDeadline ? new Date(configData.registrationDeadline + 'T00:00:00') : null;
              const isClosedByDeadline = deadlineDate && deadlineDate < new Date() && configData?.status === 'registration';
              const isRegistrationOpen = configData?.status === 'registration' && !isClosedByDeadline && (!configData?.totalRounds || configData.totalRounds === 0);
              const leagueEnrollment = profile?.leagues?.[selectedLeagueId];
              const participates = leagueEnrollment && leagueEnrollment.participates !== false;

              if (participates) {
                const isApproved = leagueEnrollment.status === 'approved';
                return (
                  <div style={{ 
                    marginTop: '10px', 
                    padding: '12px 16px', 
                    background: isApproved ? 'rgba(46, 117, 89, 0.1)' : 'rgba(203, 161, 53, 0.1)', 
                    border: isApproved ? '1px solid rgba(46, 117, 89, 0.3)' : '1px solid rgba(203, 161, 53, 0.3)', 
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: isApproved ? 'var(--success-color)' : 'var(--warning-color)',
                    fontSize: '0.9rem'
                  }}>
                    <span>{isApproved ? '✔' : '⏳'}</span>
                    <span>
                      {isApproved 
                        ? (lang === 'es' ? 'Ya estás inscrito en esta liga.' : 'You are registered in this league.')
                        : (lang === 'es' ? 'Tu inscripción está pendiente de aprobación por el organizador.' : 'Your registration is pending approval by the organizer.')}
                    </span>
                  </div>
                );
              }

              if (isRegistrationOpen) {
                return (
                  <div style={{ 
                    marginTop: '10px', 
                    padding: '16px', 
                    background: 'rgba(29, 51, 33, 0.2)', 
                    border: '1px dashed var(--gold-primary)', 
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--gold-primary)', fontWeight: '600' }}>
                      {lang === 'es' ? '¡Inscripciones abiertas para esta liga!' : 'Registration is open for this league!'}
                    </span>
                    <button
                      className="btn btn-primary btn-small"
                      onClick={() => {
                        if (!user) {
                          setPendingRegisterLeagueId(selectedLeagueId);
                          onOpenAuthModal();
                          return;
                        }
                        setJoinAlignment('luz');
                        setJoinFaction('');
                        setIsJoinLeagueModalOpen(true);
                      }}
                      style={{ padding: '8px 20px' }}
                    >
                      ✍️ {lang === 'es' ? 'Inscribirse a la Liga' : 'Register to League'}
                    </button>
                  </div>
                );
              } else {
                return (
                  <div style={{ 
                    marginTop: '10px', 
                    padding: '12px 16px', 
                    background: 'rgba(226, 76, 76, 0.1)', 
                    border: '1px solid rgba(226, 76, 76, 0.3)', 
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: 'var(--danger-color)',
                    fontSize: '0.9rem'
                  }}>
                    <span>🚫</span>
                    <span>
                      {lang === 'es' ? 'Las inscripciones para esta liga están cerradas.' : 'Registration for this league is closed.'}
                    </span>
                  </div>
                );
              }
            })()}
          </div>
        </div>
      )}

      {/* --- SECCIÓN 1: RANKING --- */}
      {activeSubTab === 'ranking' && (
        <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--gold-primary)' }}>
              {lang === 'es' ? 'Clasificación Regular' : 'Regular Standings'}
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {configData?.name || ''}
            </span>
          </div>

          <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left', minWidth: '460px' }}>
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '8px 6px', width: '32px' }}>#</th>
                  <th style={{ padding: '8px 6px' }}>Jugador</th>
                  <th style={{ padding: '8px 6px' }}>Facción</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', width: '40px' }}>Pts</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', width: '56px' }}>ELO</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', width: '60px' }}>P/V/E/D</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', width: '54px' }}>PV ±</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', width: '50px' }}>Líd ±</th>
                </tr>
              </thead>
              <tbody>
                {loadingData ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>Cargando datos...</td>
                  </tr>
                ) : standings.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No hay jugadores activos en el ranking regular.
                    </td>
                  </tr>
                ) : standings.map((p, idx) => {
                  const isCurrent = user?.uid === p.uid;
                  const alignmentIcon = p.alignment === 'luz' ? '☀️' : '👁️';
                  const alignmentColor = p.alignment === 'luz' ? 'var(--gold-primary)' : 'var(--danger-color)';
                  const diffVp = p.vpScored - p.vpConceded;
                  const diffLid = p.leadersKilled - p.leadersLost;
                  const eloVal = p.elo || DEFAULT_ELO;
                  const eloTier = getEloTier(eloVal, lang);

                  return (
                    <tr 
                      key={p.uid} 
                      style={{ 
                        borderBottom: '1px solid rgba(255,255,255,0.04)', 
                        color: isCurrent ? '#fff' : 'var(--text-primary)', 
                        fontWeight: isCurrent ? 'bold' : 'normal',
                        background: isCurrent ? 'rgba(203, 161, 53, 0.08)' : 'transparent'
                      }}
                    >
                      <td style={{ padding: '12px 6px', color: 'var(--gold-primary)', fontWeight: 'bold' }}>{idx + 1}</td>
                      <td style={{ padding: '12px 6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '0.85rem', color: alignmentColor }} title={p.alignment}>{alignmentIcon}</span>
                          <span 
                            onClick={() => handleOpenPlayerProfile(p.uid)}
                            style={{ 
                              cursor: 'pointer', 
                              color: 'var(--gold-primary)', 
                              transition: 'color 0.2s',
                              textDecoration: 'underline',
                              textDecorationColor: 'rgba(203,161,53,0.3)'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.color = '#fff'}
                            onMouseOut={(e) => e.currentTarget.style.color = 'var(--gold-primary)'}
                          >
                            {p.name}
                          </span>
                        </div>
                        <span 
                          onClick={() => handleOpenPlayerProfile(p.uid)}
                          style={{ cursor: 'pointer', fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block' }}
                          onMouseOver={(e) => e.currentTarget.style.color = 'var(--gold-primary)'}
                          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                        >
                          @{p.username}
                        </span>
                      </td>
                      <td style={{ padding: '12px 6px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{p.faction}</td>
                      <td style={{ padding: '12px 6px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--gold-primary)' }}>{p.points}</td>
                      <td style={{ padding: '12px 6px', textAlign: 'center', fontSize: '0.76rem' }}>
                        <span
                          style={{
                            background: eloTier.bg,
                            color: eloTier.color,
                            border: `1px solid ${eloTier.border}`,
                            borderRadius: '4px',
                            padding: '2px 5px',
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                          title={`${eloTier.name} (${eloVal} ELO)`}
                        >
                          <span>{eloTier.badge}</span>
                          <span>{eloVal}</span>
                        </span>
                      </td>
                      <td style={{ padding: '12px 6px', textAlign: 'center', color: 'var(--text-secondary)' }}>{p.matchesPlayed}/{p.wins}/{p.draws}/{p.losses}</td>
                      <td style={{ padding: '12px 6px', textAlign: 'center', fontSize: '0.78rem' }}>
                        <span style={{ color: diffVp > 0 ? 'var(--success-color)' : diffVp < 0 ? 'var(--danger-color)' : 'inherit' }}>
                          {diffVp > 0 ? `+${diffVp}` : diffVp}
                        </span>
                        <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{p.vpScored}-{p.vpConceded}</div>
                      </td>
                      <td style={{ padding: '12px 6px', textAlign: 'center', fontSize: '0.78rem' }}>
                        <span style={{ color: diffLid > 0 ? 'var(--success-color)' : diffLid < 0 ? 'var(--danger-color)' : 'inherit' }}>
                          {diffLid > 0 ? `+${diffLid}` : diffLid}
                        </span>
                        <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{p.leadersKilled}/{p.leadersLost}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- SECCIÓN 2: FIXTURE / LLAVES --- */}
      {activeSubTab === 'fixture' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Sub-Navegación del Fixture */}
          <div className="glass-card" style={{ padding: '12px', display: 'flex', gap: '8px' }}>
            <button 
              className="btn btn-small"
              onClick={() => setActiveFixtureView('regular')}
              style={{
                flex: 1, minHeight: '34px',
                background: activeFixtureView === 'regular' ? 'var(--gold-primary)' : 'transparent',
                color: activeFixtureView === 'regular' ? '#000' : 'var(--text-primary)',
                border: 'var(--border-glass)'
              }}
            >
              {lang === 'es' ? 'Rondas' : 'Rounds'}
            </button>
            <button 
              className="btn btn-small"
              onClick={() => setActiveFixtureView('winners')}
              style={{
                flex: 1, minHeight: '34px',
                background: activeFixtureView === 'winners' ? 'var(--gold-primary)' : 'transparent',
                color: activeFixtureView === 'winners' ? '#000' : 'var(--text-primary)',
                border: 'var(--border-glass)'
              }}
            >
              {lang === 'es' ? 'Playoffs Ganadores' : 'Winners Playoff'}
            </button>
            <button 
              className="btn btn-small"
              onClick={() => setActiveFixtureView('losers')}
              style={{
                flex: 1, minHeight: '34px',
                background: activeFixtureView === 'losers' ? 'var(--gold-primary)' : 'transparent',
                color: activeFixtureView === 'losers' ? '#000' : 'var(--text-primary)',
                border: 'var(--border-glass)'
              }}
            >
              {lang === 'es' ? 'Playoffs Perdedores' : 'Losers Playoff'}
            </button>
          </div>

          {/* VISTA 1: FIXTURE REGULAR */}
          {activeFixtureView === 'regular' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '1.1rem', color: 'var(--gold-primary)' }}>{lang === 'es' ? 'Partidas de Ronda Regular' : 'Regular Round Matches'}</h3>
                  <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>
                    {lang === 'es' ? 'Fase' : 'Phase'}: {leagueState === 'active' ? (lang === 'es' ? 'Activa ⚔️' : 'Active ⚔️') : (lang === 'es' ? 'Inscripciones ⏳' : 'Registration ⏳')}
                  </span>
                </div>

                {leagueState === 'active' && configData && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Filtrar ronda:' : 'Filter round:'}</span>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <button 
                        className="btn btn-small"
                        onClick={() => setSelectedRoundFilter('all')}
                        style={{ minHeight: '32px', background: selectedRoundFilter === 'all' ? 'var(--gold-primary)' : 'transparent', color: selectedRoundFilter === 'all' ? '#000' : '#fff', border: 'var(--border-glass)' }}
                      >
                        {lang === 'es' ? 'Todas' : 'All'}
                      </button>
                      {Array.from({ length: configData.totalRounds || 0 }).map((_, rIdx) => (
                        <button 
                          key={rIdx}
                          className="btn btn-small"
                          onClick={() => setSelectedRoundFilter(rIdx + 1)}
                          style={{ minHeight: '32px', background: selectedRoundFilter === rIdx + 1 ? 'var(--gold-primary)' : 'transparent', color: selectedRoundFilter === rIdx + 1 ? '#000' : '#fff', border: 'var(--border-glass)' }}
                        >
                          R{rIdx + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {leagueState !== 'active' ? (
                <div className="glass-card" style={{ padding: '30px', textAlign: 'center' }}>
                  <span style={{ fontSize: '2.5rem' }}>⏳</span>
                  <h4 style={{ color: 'var(--gold-primary)', marginTop: '10px' }}>{lang === 'es' ? 'Rondas no publicadas' : 'Rounds Not Published'}</h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'El administrador publicará el fixture en cuanto cierre las inscripciones.' : 'The administrator will publish the fixture as soon as registration closes.'}</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {matches
                    .filter(m => selectedRoundFilter === 'all' || m.round === selectedRoundFilter)
                    .map(m => {
                      const p1 = playersMap[m.player1] || { name: m.player1, faction: 'Desconocida', alignment: 'none' };
                      const p2 = m.player2 === 'BYE' 
                        ? { uid: 'BYE', name: (lang === 'es' ? 'DESCANSO (BYE)' : 'BYE (REST)'), faction: (lang === 'es' ? 'Ninguna' : 'None'), alignment: 'none' }
                        : (playersMap[m.player2] || { name: m.player2, faction: 'Desconocida', alignment: 'none' });
                      const isMyMatch = user && (user.uid === m.player1 || user.uid === m.player2);
                      const isBye = m.player2 === 'BYE';

                      return (
                        <div 
                          key={m.id}
                          className="glass-card"
                          style={{ padding: '14px', border: isMyMatch ? '1px solid var(--gold-primary)' : 'var(--border-glass)', position: 'relative' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px', marginBottom: '10px' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>{lang === 'es' ? 'Ronda' : 'Round'} {m.round}</span>
                            {m.mission ? (
                              <button onClick={() => openPdf(m.mission)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}>
                                📖 {lang === 'es' ? 'Misión' : 'Mission'}: {m.mission}
                              </button>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                📖 {lang === 'es' ? 'Misión: Sin asignar' : 'Mission: Unassigned'}
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '8px', margin: '12px 0' }}>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 'bold', fontSize: '0.88rem' }}>
                                {p1.alignment === 'luz' ? '☀️ ' : p1.alignment === 'oscuridad' ? '👁️ ' : ''}
                                {p1.uid && p1.uid !== 'BYE' ? (
                                  <span
                                    onClick={() => handleOpenPlayerProfile(p1.uid)}
                                    style={{ 
                                      cursor: 'pointer', 
                                      color: 'var(--gold-primary)', 
                                      textDecoration: 'underline',
                                      textDecorationColor: 'rgba(203,161,53,0.3)'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.color = '#fff'}
                                    onMouseOut={(e) => e.currentTarget.style.color = 'var(--gold-primary)'}
                                  >
                                    {p1.name}
                                  </span>
                                ) : (
                                  p1.name
                                )}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{p1.faction}</div>
                            </div>
                            <div style={{ textAlign: 'center', padding: '0 8px' }}>
                              {m.verified ? (
                                <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--gold-primary)', background: 'rgba(0,0,0,0.3)', padding: '4px 10px', borderRadius: '4px' }}>
                                  {m.reportedVpP1} - {m.reportedVpP2}
                                </div>
                              ) : isBye ? (
                                <span style={{ fontSize: '0.75rem', color: 'var(--success-color)', fontWeight: 'bold' }}>BYE</span>
                              ) : (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>vs</span>
                              )}
                            </div>
                            <div style={{ textAlign: 'left' }}>
                              <div style={{ fontWeight: 'bold', fontSize: '0.88rem' }}>
                                {p2.uid && p2.uid !== 'BYE' ? (
                                  <span
                                    onClick={() => handleOpenPlayerProfile(p2.uid)}
                                    style={{ 
                                      cursor: 'pointer', 
                                      color: 'var(--gold-primary)', 
                                      textDecoration: 'underline',
                                      textDecorationColor: 'rgba(203,161,53,0.3)'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.color = '#fff'}
                                    onMouseOut={(e) => e.currentTarget.style.color = 'var(--gold-primary)'}
                                  >
                                    {p2.name}
                                  </span>
                                ) : (
                                  p2.name
                                )}
                                {p2.alignment === 'luz' ? ' ☀️' : p2.alignment === 'oscuridad' ? ' 👁️' : ''}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{p2.faction}</div>
                            </div>
                          </div>

                          {m.verified && !isBye && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', background: 'rgba(0,0,0,0.15)', padding: '6px 12px', borderRadius: '4px' }}>
                              <div style={{ color: m.reportedKilledLeaderP2 ? 'var(--danger-color)' : 'var(--text-muted)' }}>
                                {m.reportedKilledLeaderP2 ? (lang === 'es' ? '💀 Líder muerto' : '💀 Leader dead') : (lang === 'es' ? '🛡️ Líder a salvo' : '🛡️ Leader safe')}
                              </div>
                              <div style={{ color: m.reportedKilledLeaderP1 ? 'var(--danger-color)' : 'var(--text-muted)' }}>
                                {m.reportedKilledLeaderP1 ? (lang === 'es' ? '💀 Líder muerto' : '💀 Leader dead') : (lang === 'es' ? '🛡️ Líder a salvo' : '🛡️ Leader safe')}
                              </div>
                            </div>
                          )}

                          {!m.verified && !isBye && (
                            <div style={{ marginTop: '10px' }}>
                              {m.reportedBy === "" && isMyMatch && (
                                <button className="btn btn-primary btn-small" onClick={() => openReportModal(m)} style={{ width: '100%', minHeight: '34px' }}>📝 Cargar Resultados</button>
                              )}
                              {m.reportedBy === user?.uid && (
                                <div style={{ border: '1px dashed var(--warning-color)', padding: '10px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                    ⏳ {lang === 'es' ? 'Pendiente de verificar por rival.' : 'Pending opponent verification.'} ({lang === 'es' ? 'Reportado' : 'Reported'}: {user.uid === m.player1 ? m.reportedVpP1 : m.reportedVpP2} - {user.uid === m.player1 ? m.reportedVpP2 : m.reportedVpP1})
                                  </div>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-primary btn-small" onClick={() => openReportModal(m)} style={{ flex: 1, minHeight: '32px', fontSize: '0.75rem' }}>
                                      ✏️ {lang === 'es' ? 'Editar' : 'Edit'}
                                    </button>
                                    <button className="btn btn-danger btn-small" onClick={() => handleDeleteOwnReport(m)} style={{ flex: 1, minHeight: '32px', fontSize: '0.75rem' }}>
                                      🗑️ {lang === 'es' ? 'Eliminar' : 'Delete'}
                                    </button>
                                  </div>
                                </div>
                              )}
                              {m.reportedBy !== "" && m.reportedBy !== user?.uid && isMyMatch && (
                                <div style={{ background: 'rgba(85,196,107,0.05)', border: '1px solid rgba(85,196,107,0.2)', padding: '10px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  <div style={{ fontSize: '0.78rem', color: '#fff', textAlign: 'center' }}>
                                    Rival propone: Tú {user.uid === m.player1 ? m.reportedVpP1 : m.reportedVpP2} - {user.uid === m.player1 ? m.reportedVpP2 : m.reportedVpP1} Rival
                                  </div>
                                  {(() => {
                                    const myKilledRival = user.uid === m.player1 ? m.reportedKilledLeaderP1 : m.reportedKilledLeaderP2;
                                    const myLeaderDied = user.uid === m.player1 ? m.reportedKilledLeaderP2 : m.reportedKilledLeaderP1;
                                    return (
                                      <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '6px' }}>
                                        <div>Mataste al líder enemigo: <span style={{ color: myKilledRival ? 'var(--success-color)' : 'var(--text-muted)' }}>{myKilledRival ? 'Sí ⚔️' : 'No 🛡️'}</span></div>
                                        <div>Tu líder murió en combate: <span style={{ color: myLeaderDied ? 'var(--danger-color)' : 'var(--text-muted)' }}>{myLeaderDied ? 'Sí 💀' : 'No 🛡️'}</span></div>
                                      </div>
                                    );
                                  })()}
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-primary btn-small" onClick={() => handleValidateReport(m)} style={{ flex: 1, background: 'var(--success-color)', border: 'none', color: '#000', minHeight: '32px' }}>✔ Validar</button>
                                    <button className="btn btn-danger btn-small" onClick={() => handleModifyReport(m)} style={{ flex: 1, minHeight: '32px' }}>✖ Modificar</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {isAdmin && (
                            <button onClick={() => openAdminEditModal(m)} style={{ position: 'absolute', bottom: '8px', right: '8px', background: 'rgba(226, 76, 76, 0.1)', border: '1px solid rgba(226, 76, 76, 0.3)', color: 'var(--danger-color)', fontSize: '0.65rem', padding: '3px 6px', borderRadius: '4px', cursor: 'pointer' }}>🛠️ Editar Admin</button>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* VISTAS 2 Y 3: LLAVES DE PLAYOFF (GANADORES / PERDEDORES) */}
          {(activeFixtureView === 'winners' || activeFixtureView === 'losers') && (() => {
            const bracket = activeFixtureView === 'winners' ? winnersBracket : losersBracket;
            
            if (bracket.status !== 'active' || !bracket.rounds || bracket.rounds.length === 0) {
              return (
                <div className="glass-card" style={{ padding: '30px', textAlign: 'center' }}>
                  <span style={{ fontSize: '2.5rem' }}>🏆</span>
                  <h4 style={{ color: 'var(--gold-primary)', marginTop: '10px' }}>{lang === 'es' ? 'Llave eliminatoria no iniciada' : 'Playoffs Bracket Not Started'}</h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Esta llave no está configurada o se encuentra en fase de inscripción.' : 'This bracket is not configured or is currently in the registration phase.'}</p>
                </div>
              );
            }

            return (
              <div className="glass-card" style={{ padding: '16px', overflow: 'hidden' }}>
                <h3 style={{ fontSize: '1rem', color: 'var(--gold-primary)', marginBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                  {lang === 'es' ? 'Cuadro de Playoffs' : 'Playoffs Bracket'} ({activeFixtureView === 'winners' ? (lang === 'es' ? 'Fase Ganadores' : 'Winners Phase') : (lang === 'es' ? 'Fase Perdedores' : 'Losers Phase')})
                </h3>

                {(() => {
                  const lastRound = bracket.rounds[bracket.rounds.length - 1];
                  const finalMatch = lastRound && lastRound[0];
                  const hasChampion = finalMatch && finalMatch.verified && finalMatch.winner;
                  if (!hasChampion) return null;

                  const champ = playersMap[finalMatch.winner] || { name: finalMatch.winner, alignment: 'none' };
                  const runnerUpUid = finalMatch.winner === finalMatch.player1 ? finalMatch.player2 : finalMatch.player1;
                  const runner = playersMap[runnerUpUid] || { name: runnerUpUid, alignment: 'none' };

                  return (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '16px',
                      margin: '10px 0 24px 0',
                      padding: '24px',
                      background: 'linear-gradient(135deg, rgba(203, 161, 53, 0.15) 0%, rgba(0, 0, 0, 0.4) 100%)',
                      border: '1px solid var(--gold-primary)',
                      borderRadius: '12px',
                      boxShadow: '0 0 15px rgba(203, 161, 53, 0.25)',
                      position: 'relative',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        position: 'absolute',
                        top: '-50%',
                        left: '-50%',
                        width: '200%',
                        height: '200%',
                        background: 'radial-gradient(circle, rgba(203, 161, 53, 0.05) 0%, transparent 60%)',
                        pointerEvents: 'none',
                        zIndex: 0
                      }} />

                      <h4 style={{ 
                        color: 'var(--gold-primary)', 
                        fontSize: '1.2rem', 
                        fontWeight: 'bold', 
                        textTransform: 'uppercase', 
                        letterSpacing: '1px', 
                        margin: 0,
                        zIndex: 1,
                        textShadow: '0 0 10px rgba(203, 161, 53, 0.5)'
                      }}>
                        {lang === 'es' ? '🏆 Podio de Honor 🏆' : '🏆 Podium of Honor 🏆'}
                      </h4>

                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'flex-end', 
                        justifyContent: 'center', 
                        gap: '20px', 
                        width: '100%', 
                        maxWidth: '450px',
                        marginTop: '10px',
                        zIndex: 1
                      }}>
                        {/* Silver - 2nd Place */}
                        <div style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          alignItems: 'center', 
                          flex: 1 
                        }}>
                          <div style={{ 
                            fontSize: '1.8rem', 
                            marginBottom: '4px',
                            filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.4))'
                          }}>🥈</div>
                          <span style={{ 
                            fontSize: '0.9rem', 
                            fontWeight: 'bold', 
                            color: '#e2e8f0', 
                            textAlign: 'center',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '150px'
                          }} title={runner.name}>
                            {runner.name}
                          </span>
                          <span style={{ 
                            fontSize: '0.7rem', 
                            color: 'var(--text-muted)',
                            marginBottom: '10px'
                          }}>
                            {runner.alignment === 'luz' ? (lang === 'es' ? '☀️ Luz' : '☀️ Light') : runner.alignment === 'oscuridad' ? (lang === 'es' ? '👁️ Oscuridad' : '👁️ Darkness') : ''}
                          </span>
                          <div style={{ 
                            width: '100%', 
                            height: '60px', 
                            background: 'linear-gradient(to top, #475569, #94a3b8)', 
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px 6px 0 0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                          }}>
                            <strong style={{ color: '#0f172a', fontSize: '1rem' }}>{lang === 'es' ? '2° puesto' : '2nd Place'}</strong>
                          </div>
                        </div>

                        {/* Gold - 1st Place */}
                        <div style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          alignItems: 'center', 
                          flex: 1.2
                        }}>
                          <div style={{ 
                            fontSize: '2.5rem', 
                            marginBottom: '4px',
                            filter: 'drop-shadow(0 0 8px rgba(253,224,71,0.6))'
                          }}>🥇</div>
                          <span style={{ 
                            fontSize: '1.05rem', 
                            fontWeight: 'bold', 
                            color: '#fef08a', 
                            textAlign: 'center',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '180px'
                          }} title={champ.name}>
                            {champ.name}
                          </span>
                          <span style={{ 
                            fontSize: '0.75rem', 
                            color: 'var(--gold-primary)',
                            marginBottom: '10px'
                          }}>
                            {champ.alignment === 'luz' ? (lang === 'es' ? '☀️ Luz' : '☀️ Light') : champ.alignment === 'oscuridad' ? (lang === 'es' ? '👁️ Oscuridad' : '👁️ Darkness') : ''}
                          </span>
                          <div style={{ 
                            width: '100%', 
                            height: '90px', 
                            background: 'linear-gradient(to top, #ca8a04, #fde047)', 
                            border: '1px solid #fef08a',
                            borderRadius: '8px 8px 0 0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 4px 12px rgba(234,179,8,0.3)'
                          }}>
                            <strong style={{ color: '#451a03', fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{lang === 'es' ? 'Campeón' : 'Champion'}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Árbol de Eliminatorias Responsivo Swipeable */}
                <div style={{ display: 'flex', gap: '24px', overflowX: 'auto', padding: '10px 0', WebkitOverflowScrolling: 'touch' }}>
                  {bracket.rounds.map((roundMatches, rIdx) => {
                    const roundLabel = getRoundLabel(rIdx, bracket.rounds.length);
                    return (
                      <div 
                        key={rIdx} 
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          justifyContent: 'space-around', 
                          gap: '24px', 
                          minWidth: '220px',
                          borderRight: rIdx < bracket.rounds.length - 1 ? '1px dashed rgba(255,255,255,0.05)' : 'none',
                          paddingRight: rIdx < bracket.rounds.length - 1 ? '12px' : '0'
                        }}
                      >
                        <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--gold-primary)', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
                          {roundLabel}
                        </div>

                        {roundMatches.map((match, mIdx) => {
                          const p1 = playersMap[match.player1] || { name: match.player1 || 'Esperando...', alignment: 'none', faction: '' };
                          const p2 = match.player2 === 'BYE'
                            ? { uid: 'BYE', name: (lang === 'es' ? 'DESCANSO (BYE)' : 'BYE (REST)'), alignment: 'none', faction: '' }
                            : (playersMap[match.player2] || { name: match.player2 || 'Esperando...', alignment: 'none', faction: '' });

                          const isMyMatch = user && (user.uid === match.player1 || user.uid === match.player2);
                          const isBye = match.player2 === 'BYE' || match.player1 === 'BYE';

                          // Colores de bando
                          const col1 = p1.alignment === 'luz' ? 'var(--gold-primary)' : p1.alignment === 'oscuridad' ? 'var(--danger-color)' : 'var(--text-muted)';
                          const col2 = p2.alignment === 'luz' ? 'var(--gold-primary)' : p2.alignment === 'oscuridad' ? 'var(--danger-color)' : 'var(--text-muted)';

                          return (
                            <div 
                              key={mIdx}
                              style={{
                                background: isMyMatch ? 'rgba(203, 161, 53, 0.1)' : 'rgba(0,0,0,0.35)',
                                border: isMyMatch ? '1px solid var(--gold-primary)' : 'var(--border-glass)',
                                borderRadius: 'var(--radius-sm)',
                                padding: '10px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                                position: 'relative',
                                boxShadow: isMyMatch ? '0 0 6px var(--gold-glow)' : 'none'
                              }}
                            >
                              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{lang === 'es' ? `Llave Match ${mIdx + 1}` : `Bracket Match ${mIdx + 1}`}</span>
                                {isBye && <span style={{ color: 'var(--success-color)' }}>{lang === 'es' ? 'Auto-avanzado' : 'Walkover'}</span>}
                              </div>
                              
                              {/* Jugador 1 */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                                <span style={{ fontWeight: match.winner === match.player1 && match.winner ? 'bold' : 'normal', color: match.winner === match.player1 && match.winner ? 'var(--gold-primary)' : '#fff', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                  {p1.alignment === 'luz' ? '☀️' : p1.alignment === 'oscuridad' ? '👁️' : ''}
                                  {p1.uid && p1.uid !== 'BYE' ? (
                                    <span 
                                      onClick={() => handleOpenPlayerProfile(p1.uid)}
                                      style={{ 
                                        overflow: 'hidden', 
                                        textOverflow: 'ellipsis', 
                                        whiteSpace: 'nowrap', 
                                        maxWidth: '120px',
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                        textDecorationColor: 'rgba(255,255,255,0.2)'
                                      }}
                                      onMouseOver={(e) => e.currentTarget.style.color = 'var(--gold-primary)'}
                                      onMouseOut={(e) => e.currentTarget.style.color = match.winner === match.player1 && match.winner ? 'var(--gold-primary)' : '#fff'}
                                    >
                                      {p1.name}
                                    </span>
                                  ) : (
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>{p1.name}</span>
                                  )}
                                </span>
                                <span style={{ fontWeight: 'bold', color: 'var(--gold-primary)' }}>
                                  {match.verified ? match.reportedVpP1 : (match.reportedBy && match.reportedBy === match.player1 ? '📝' : '')}
                                </span>
                              </div>

                              {/* Jugador 2 */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '4px' }}>
                                <span style={{ fontWeight: match.winner === match.player2 && match.winner ? 'bold' : 'normal', color: match.winner === match.player2 && match.winner ? 'var(--gold-primary)' : '#fff', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                  {p2.alignment === 'luz' ? '☀️' : p2.alignment === 'oscuridad' ? '👁️' : ''}
                                  {p2.uid && p2.uid !== 'BYE' ? (
                                    <span 
                                      onClick={() => handleOpenPlayerProfile(p2.uid)}
                                      style={{ 
                                        overflow: 'hidden', 
                                        textOverflow: 'ellipsis', 
                                        whiteSpace: 'nowrap', 
                                        maxWidth: '120px',
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                        textDecorationColor: 'rgba(255,255,255,0.2)'
                                      }}
                                      onMouseOver={(e) => e.currentTarget.style.color = 'var(--gold-primary)'}
                                      onMouseOut={(e) => e.currentTarget.style.color = match.winner === match.player2 && match.winner ? 'var(--gold-primary)' : '#fff'}
                                    >
                                      {p2.name}
                                    </span>
                                  ) : (
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>{p2.name}</span>
                                  )}
                                </span>
                                <span style={{ fontWeight: 'bold', color: 'var(--gold-primary)' }}>
                                  {match.verified ? match.reportedVpP2 : (match.reportedBy && match.reportedBy === match.player2 ? '📝' : '')}
                                </span>
                              </div>

                              {/* Acciones de Jugadores en playoffs */}
                              {!match.verified && !isBye && match.player1 && match.player2 && (
                                <div style={{ marginTop: '4px' }}>
                                  {match.reportedBy === "" && isMyMatch && (
                                    <button 
                                      className="btn btn-primary btn-small"
                                      onClick={() => openReportModal(match, true, activeFixtureView, rIdx, mIdx)}
                                      style={{ width: '100%', minHeight: '28px', padding: '2px', fontSize: '0.72rem' }}
                                    >
                                      {lang === 'es' ? 'Reportar Llave' : 'Report Match'}
                                    </button>
                                  )}
                                  
                                  {match.reportedBy === user?.uid && (
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', border: '1px dashed var(--warning-color)', padding: '4px', borderRadius: '4px', textAlign: 'center' }}>
                                      ⏳ {lang === 'es' ? 'Pendiente verificar' : 'Pending verification'}
                                    </div>
                                  )}

                                  {match.reportedBy !== "" && match.reportedBy !== user?.uid && isMyMatch && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                                      {(() => {
                                        const myKilledRival = user.uid === match.player1 ? match.reportedKilledLeaderP1 : match.reportedKilledLeaderP2;
                                        const myLeaderDied = user.uid === match.player1 ? match.reportedKilledLeaderP2 : match.reportedKilledLeaderP1;
                                        return (
                                          <div style={{ fontSize: '0.62rem', color: 'var(--warning-color)', textAlign: 'center', background: 'rgba(0,0,0,0.25)', padding: '4px', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <div>{lang === 'es' ? 'Rival propone' : 'Opponent proposes'}: {user.uid === match.player1 ? match.reportedVpP1 : match.reportedVpP2} - {user.uid === match.player1 ? match.reportedVpP2 : match.reportedVpP1}</div>
                                            {(myKilledRival || myLeaderDied) && (
                                              <div style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'center', gap: '4px' }}>
                                                {myKilledRival && (lang === 'es' ? '⚔️ Mataste L.' : '⚔️ Killed L.')}
                                                {myLeaderDied && (lang === 'es' ? '💀 Moriste' : '💀 Died')}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}
                                      <div style={{ display: 'flex', gap: '4px' }}>
                                        <button 
                                          className="btn btn-primary btn-small"
                                          onClick={() => handleValidateReport(match, true, activeFixtureView, rIdx, mIdx)}
                                          style={{ flex: 1, minHeight: '26px', padding: '0', fontSize: '0.7rem', background: 'var(--success-color)', border: 'none', color: '#000' }}
                                        >
                                          ✔ {lang === 'es' ? 'Val.' : 'Verify'}
                                        </button>
                                        <button 
                                          className="btn btn-danger btn-small"
                                          onClick={() => handleModifyReport(match, true, activeFixtureView, rIdx, mIdx)}
                                          style={{ flex: 1, minHeight: '26px', padding: '0', fontSize: '0.7rem' }}
                                        >
                                          ✖ {lang === 'es' ? 'Mod.' : 'Modify'}
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Admin override en playoffs */}
                              {isAdmin && match.player1 && match.player2 && (
                                <button 
                                  onClick={() => openAdminEditModal(match, true, activeFixtureView, rIdx, mIdx)}
                                  style={{
                                    background: 'transparent', border: 'none', color: 'var(--danger-color)',
                                    fontSize: '0.62rem', cursor: 'pointer', textAlign: 'center', marginTop: '4px',
                                    textDecoration: 'underline'
                                  }}
                                >
                                  🛠️ Force Admin
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* --- SECCIÓN 3: MI PERFIL / ACCESO --- */}
      {activeSubTab === 'profile' && (
        <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {authLoading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>Comprobando sesión del jugador...</div>
          ) : !user ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}>
              <span style={{ fontSize: '2.5rem' }}>👤</span>
              <h3 style={{ fontSize: '1.1rem', color: '#fff' }}>
                {lang === 'es' ? 'Acceso de Jugador' : 'Player Access'}
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '300px', lineHeight: '1.4' }}>
                {lang === 'es' 
                  ? 'Por favor, inicia sesión para ver tus datos e historial en esta liga.'
                  : 'Please log in to view your league data and history.'}
              </p>
              <button 
                className="btn btn-primary"
                onClick={onOpenAuthModal}
                style={{ marginTop: '6px' }}
              >
                {lang === 'es' ? 'Iniciar Sesión / Registrarse' : 'Login / Register'}
              </button>
            </div>
          ) : (() => {
            const leagueEnrollment = profile?.leagues?.[selectedLeagueId];
            if (!leagueEnrollment || !leagueEnrollment.participates) {
              const isClosedByDeadline = configData?.registrationDeadline && new Date(configData.registrationDeadline + 'T00:00:00') < new Date() && configData.status === 'registration';
              const isRegistrationOpen = configData?.status === 'registration' && !isClosedByDeadline && (!configData?.totalRounds || configData.totalRounds === 0);
              return (
                <div style={{ textAlign: 'center', padding: '30px 10px', display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}>
                  <span style={{ fontSize: '2.5rem' }}>✍️</span>
                  <h3 style={{ fontSize: '1.1rem', color: '#fff' }}>
                    {lang === 'es' ? 'No estás inscrito en esta liga' : 'Not registered in this league'}
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '300px', lineHeight: '1.4' }}>
                    {lang === 'es' 
                      ? 'Inscríbete para poder subir tus resultados y competir en la liga.'
                      : 'Register to report your match scores and compete in the league.'}
                  </p>
                  {isRegistrationOpen && (
                    <button 
                      className="btn btn-primary"
                      onClick={() => {
                        setJoinAlignment('luz');
                        setJoinFaction('');
                        setIsJoinLeagueModalOpen(true);
                      }}
                      style={{ marginTop: '10px' }}
                    >
                      {lang === 'es' ? 'Inscribirse Ahora' : 'Register Now'}
                    </button>
                  )}
                </div>
              );
            }

            if (leagueEnrollment.status === 'pending') {
              return (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(255, 169, 59, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', color: 'var(--warning-color)' }}>⏳</div>
                  <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>¡Inscripción Recibida!</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '300px', lineHeight: '1.4' }}>
                    Hola, <strong>{profile?.name || user.email.split('@')[0]}</strong>. Estás registrado bajo la <strong>{leagueEnrollment.alignment === 'luz' ? 'Luz ☀️' : 'Oscuridad 👁️'}</strong> con la facción <strong>{leagueEnrollment.faction}</strong>.
                  </p>
                  <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px dashed var(--warning-color)', padding: '12px', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--warning-color)' }}>
                    Tu inscripción está en estado: <strong>PENDIENTE DE APROBACIÓN POR ADMINISTRACIÓN</strong>.
                  </div>
                </div>
              );
            }

            // APROBADA EN ESTA LIGA
            const myStats = standings.find(s => s.uid === user.uid) || {
              points: 0, matchesPlayed: 0, wins: 0, draws: 0, losses: 0, vpScored: 0, vpConceded: 0, leadersKilled: 0, leadersLost: 0
            };
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '16px' }}>
                  <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: leagueEnrollment.alignment === 'luz' ? 'var(--gold-primary)' : 'var(--danger-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', color: '#000' }}>
                    {leagueEnrollment.alignment === 'luz' ? '☀️' : '👁️'}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>{profile?.name}</h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>@{profile?.username}</span>
                    {profile?.phone && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Tel: {profile.phone}</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                    <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px', border: 'var(--border-glass)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Puntos Liga</div>
                      <div style={{ fontSize: '1.4rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>{myStats.points}</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px', border: 'var(--border-glass)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Partidas Regular</div>
                      <div style={{ fontSize: '1.4rem', color: '#fff', fontWeight: 'bold' }}>{myStats.matchesPlayed}</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px', border: 'var(--border-glass)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Historial (V/E/D)</div>
                      <div style={{ fontSize: '1.2rem', color: '#fff', fontWeight: 'bold', marginTop: '2px' }}>{myStats.wins}/{myStats.draws}/{myStats.losses}</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px', border: 'var(--border-glass)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Facción</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 'bold', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leagueEnrollment.faction}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* --- SECCIÓN 4: ADMIN PANEL --- */}
      {isAdmin && activeSubTab === 'admin' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Inscripciones Pendientes */}
          <div className="glass-card" style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--warning-color)', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px', marginBottom: '12px' }}>
              Inscripciones Pendientes ({players.filter(p => p.status === 'pending').length})
            </h3>
            {players.filter(p => p.status === 'pending').length === 0 ? (
              <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>No hay solicitudes pendientes.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {players.filter(p => p.status === 'pending').map(p => (
                  <div key={p.uid} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div>
                      <strong>{p.name}</strong> <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}> (@{p.username})</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      • Bando: {p.alignment === 'luz' ? '☀️ Luz' : '👁️ Oscu'} | Facción: {p.faction} | Tel: {p.phone}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-primary btn-small" onClick={() => handleApprovePlayer(p.uid)} style={{ flex: 1, minHeight: '32px', background: 'var(--success-color)', color: '#000', border: 'none' }}>Aprobar</button>
                      <button className="btn btn-danger btn-small" onClick={() => handleRejectPlayer(p.uid)} style={{ flex: 1, minHeight: '32px' }}>Rechazar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Listado de Aprobados */}
          <div className="glass-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--gold-primary)', margin: 0 }}>
                Jugadores Aprobados ({players.filter(p => p.status === 'approved').length})
              </h3>
              <button 
                className="btn btn-primary btn-small" 
                onClick={handleOpenAddPlayerModal}
                style={{ fontSize: '0.75rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--gold-primary)', color: '#000', fontWeight: 'bold' }}
              >
                ➕ {lang === 'es' ? 'Añadir Jugador' : 'Add Player'}
              </button>
            </div>
            <div style={{ width: '100%', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ padding: '6px', textAlign: 'left' }}>Jugador</th>
                    <th style={{ padding: '6px', textAlign: 'left' }}>Bando/Facción</th>
                    <th style={{ padding: '6px', textAlign: 'center' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {players.filter(p => p.status === 'approved').map(p => (
                    <tr key={p.uid} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '8px 6px' }}>
                        <strong>{p.name}</strong>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>@{p.username}</div>
                      </td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>
                        {p.alignment === 'luz' ? '☀️ Luz' : '👁️ Oscu'}
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{p.faction}</div>
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button className="btn btn-small" style={{ minHeight: '28px', padding: '2px 8px', fontSize: '0.7rem' }}
                            onClick={() => {
                              setSelectedPlayerToEdit(p);
                              setEditPlayerName(p.name);
                              setEditPlayerPhone(p.phone || '');
                              setEditPlayerFaction(p.faction || '');
                              setEditPlayerAlignment(p.alignment || 'luz');
                              setEditPlayerIsAdmin(p.isAdmin || false);
                              setEditPlayerParticipates(p.participates !== false);
                              setIsPlayerEditModalOpen(true);
                            }}
                          >
                            Editar
                          </button>
                          <button className="btn btn-danger btn-small" style={{ minHeight: '28px', padding: '2px 8px', fontSize: '0.7rem' }}
                            onClick={() => handleDeletePlayer(p.uid, p.name)}
                          >
                            Quitar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Generador de Fixture Rondas Regular */}
          <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '1rem', color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
              Generar Fixture Regular (Rondas)
            </h3>
            {leagueState === 'registration' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <select value={totalRoundsInput} onChange={(e) => setTotalRoundsInput(parseInt(e.target.value))}
                  style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '12px', fontSize: '0.9rem' }}
                >
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} Rondas</option>)}
                </select>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={handlePreparePairingsLightVsDark} 
                    disabled={isGenerating}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.82rem', padding: '10px 8px' }}
                  >
                    ☀️ vs 👁️ {lang === 'es' ? 'Generar Rondas (Luz vs Oscuridad)' : 'Generate Rounds (Light vs Darkness)'}
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    onClick={handlePreparePairingsCivilWar} 
                    disabled={isGenerating}
                    style={{ 
                      background: 'rgba(239, 68, 68, 0.15)', 
                      border: '1px solid rgba(239, 68, 68, 0.4)', 
                      color: '#fca5a5', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '6px',
                      fontSize: '0.82rem',
                      padding: '10px 8px'
                    }}
                  >
                    ⚔️ {lang === 'es' ? 'Generar Rondas (Guerra Civil)' : 'Generate Rounds (Civil War)'}
                  </button>
                </div>
                
                {draftFixture && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '10px', padding: '10px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(203,161,53,0.2)', borderRadius: '8px' }}>
                    <h4 style={{ color: 'var(--gold-primary)', fontSize: '0.9rem', textAlign: 'center' }}>Borrador Regular</h4>
                    {draftFixture.map((roundMatches, rIdx) => {
                      const approved = players.filter(p => p.status === 'approved' && p.participates !== false);
                      return (
                        <div key={rIdx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <strong style={{ fontSize: '0.78rem', color: 'var(--gold-primary)' }}>Ronda {rIdx + 1}</strong>
                            <select value={draftMissions[rIdx]} onChange={(e) => handleDraftMissionChange(rIdx, e.target.value)}
                              style={{ background: '#111', color: '#fff', fontSize: '0.72rem', borderRadius: '4px' }}
                            >
                              {POOLS_1VS1.flatMap(p => p.items).map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {roundMatches.map((m, mIdx) => (
                              <div key={mIdx} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                                <select value={m.player1} onChange={(e) => handleSwapOpponent(rIdx, mIdx, 'player1', e.target.value)}
                                  style={{ background: '#111', color: '#fff', fontSize: '0.7rem' }}
                                >
                                  <option value="BYE">BYE</option>
                                  {approved.map(p => {
                                    const alignmentLabel = p.alignment ? (p.alignment.toLowerCase() === 'luz' ? 'Luz' : 'Oscuridad') : '';
                                    return (
                                      <option key={p.uid} value={p.uid}>
                                        {p.name}{alignmentLabel ? ` - ${alignmentLabel}` : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                                <span style={{ color: 'var(--text-muted)' }}>vs</span>
                                <select value={m.player2} onChange={(e) => handleSwapOpponent(rIdx, mIdx, 'player2', e.target.value)}
                                  style={{ background: '#111', color: '#fff', fontSize: '0.7rem' }}
                                >
                                  <option value="BYE">BYE</option>
                                  {approved.map(p => {
                                    const alignmentLabel = p.alignment ? (p.alignment.toLowerCase() === 'luz' ? 'Luz' : 'Oscuridad') : '';
                                    return (
                                      <option key={p.uid} value={p.uid}>
                                        {p.name}{alignmentLabel ? ` - ${alignmentLabel}` : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <button className="btn btn-primary" onClick={handleLaunchLeague} style={{ background: 'var(--success-color)', color: '#000', border: 'none' }}>✔ Publicar Fixture Regular</button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>La ronda regular está activa.</p>
                <button className="btn btn-danger" onClick={handleResetLeague} style={{ width: '100%' }}>🚨 Reiniciar Liga Regular</button>
              </div>
            )}
          </div>

          {/* Generador de Llaves de Playoffs */}
          <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '1rem', color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
              Configurar Playoffs (Llaves)
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  className="btn btn-small"
                  onClick={() => setSelectedPlayoffType('winners')}
                  style={{ flex: 1, background: selectedPlayoffType === 'winners' ? 'var(--gold-primary)' : 'transparent', color: selectedPlayoffType === 'winners' ? '#000' : '#fff', border: 'var(--border-glass)', minHeight: '34px' }}
                >
                  Llave Ganadores
                </button>
                <button 
                  className="btn btn-small"
                  onClick={() => setSelectedPlayoffType('losers')}
                  style={{ flex: 1, background: selectedPlayoffType === 'losers' ? 'var(--gold-primary)' : 'transparent', color: selectedPlayoffType === 'losers' ? '#000' : '#fff', border: 'var(--border-glass)', minHeight: '34px' }}
                >
                  Llave Perdedores
                </button>
              </div>

              {/* Checkboxes de Selección de Jugadores */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Selecciona los participantes ({selectedPlayoffPlayers.length} seleccionados):</span>
                  {selectedPlayoffPlayers.length > 0 && (
                    <button 
                      className="btn btn-small"
                      onClick={() => setSelectedPlayoffPlayers([])}
                      style={{ fontSize: '0.68rem', padding: '2px 8px', minHeight: '22px', background: 'rgba(226, 76, 76, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)' }}
                    >
                      Limpiar selección
                    </button>
                  )}
                </div>
                
                <div style={{ width: '100%', maxHeight: '280px', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', marginTop: '4px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left', minWidth: '480px' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)' }}>
                        <th style={{ padding: '8px 6px', width: '32px', textAlign: 'center' }}>Sel</th>
                        <th style={{ padding: '8px 6px', width: '28px' }}>#</th>
                        <th style={{ padding: '8px 6px' }}>Jugador</th>
                        <th style={{ padding: '8px 6px' }}>Facción</th>
                        <th style={{ padding: '8px 6px', textAlign: 'center', width: '40px' }}>Pts</th>
                        <th style={{ padding: '8px 6px', textAlign: 'center', width: '60px' }}>P/V/E/D</th>
                        <th style={{ padding: '8px 6px', textAlign: 'center', width: '54px' }}>PV ±</th>
                        <th style={{ padding: '8px 6px', textAlign: 'center', width: '50px' }}>Líd ±</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.length === 0 ? (
                        <tr>
                          <td colSpan="8" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                            No hay jugadores aprobados en el ranking.
                          </td>
                        </tr>
                      ) : (
                        standings.map((p, idx) => {
                          const isSelected = selectedPlayoffPlayers.includes(p.uid);
                          const isAlreadyInWinners = winnersBracket && winnersBracket.status === 'active' && winnersBracket.rounds && winnersBracket.rounds[0] && winnersBracket.rounds[0].some(m => m.player1 === p.uid || m.player2 === p.uid);
                          const isAlreadyInLosers = losersBracket && losersBracket.status === 'active' && losersBracket.rounds && losersBracket.rounds[0] && losersBracket.rounds[0].some(m => m.player1 === p.uid || m.player2 === p.uid);
                          
                          const alignmentIcon = p.alignment === 'luz' ? '☀️' : '👁️';
                          const alignmentColor = p.alignment === 'luz' ? 'var(--gold-primary)' : 'var(--danger-color)';
                          const diffVp = p.vpScored - p.vpConceded;
                          const diffLid = p.leadersKilled - p.leadersLost;

                          const handleToggle = () => {
                            if (isSelected) {
                              setSelectedPlayoffPlayers(prev => prev.filter(id => id !== p.uid));
                            } else {
                              setSelectedPlayoffPlayers(prev => [...prev, p.uid]);
                            }
                          };

                          return (
                            <tr 
                              key={p.uid}
                              onClick={handleToggle}
                              style={{ 
                                borderBottom: '1px solid rgba(255,255,255,0.04)', 
                                color: isSelected ? '#fff' : 'var(--text-primary)', 
                                fontWeight: isSelected ? 'bold' : 'normal',
                                background: isSelected ? 'rgba(203, 161, 53, 0.12)' : 'transparent',
                                cursor: 'pointer'
                              }}
                              className="table-row-hover"
                            >
                              <td style={{ padding: '8px 6px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                <input 
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={handleToggle}
                                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                />
                              </td>
                              <td style={{ padding: '8px 6px', color: 'var(--gold-primary)', fontWeight: 'bold' }}>{idx + 1}</td>
                              <td style={{ padding: '8px 6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontSize: '0.8rem', color: alignmentColor }} title={p.alignment}>{alignmentIcon}</span>
                                  <span style={{ fontSize: '0.8rem' }}>{p.name}</span>
                                </div>
                                <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)', display: 'block' }}>@{p.username}</span>
                                {isAlreadyInWinners && <span style={{ color: 'var(--gold-primary)', fontSize: '0.64rem', fontStyle: 'italic', display: 'block' }}>[Llave Ganadores]</span>}
                                {isAlreadyInLosers && <span style={{ color: 'var(--gold-primary)', fontSize: '0.64rem', fontStyle: 'italic', display: 'block' }}>[Llave Perdedores]</span>}
                              </td>
                              <td style={{ padding: '8px 6px', color: 'var(--text-secondary)', fontSize: '0.74rem' }}>{p.faction}</td>
                              <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.82rem', color: 'var(--gold-primary)' }}>{p.points}</td>
                              <td style={{ padding: '8px 6px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{p.matchesPlayed}/{p.wins}/{p.draws}/{p.losses}</td>
                              <td style={{ padding: '8px 6px', textAlign: 'center', fontSize: '0.72rem' }}>
                                <span style={{ color: diffVp > 0 ? 'var(--success-color)' : diffVp < 0 ? 'var(--danger-color)' : 'inherit' }}>
                                  {diffVp > 0 ? `+${diffVp}` : diffVp}
                                </span>
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{p.vpScored}-{p.vpConceded}</div>
                              </td>
                              <td style={{ padding: '8px 6px', textAlign: 'center', fontSize: '0.72rem' }}>
                                <span style={{ color: diffLid > 0 ? 'var(--success-color)' : diffLid < 0 ? 'var(--danger-color)' : 'inherit' }}>
                                  {diffLid > 0 ? `+${diffLid}` : diffLid}
                                </span>
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{p.leadersKilled}-{p.leadersLost}</div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={handlePrepareBracketDraftLightVsDark}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.82rem', padding: '10px 8px' }}
                  >
                    ☀️ vs 👁️ {lang === 'es' ? 'Generar Borrador (Luz vs Oscuridad)' : 'Generate Draft (Light vs Darkness)'}
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    onClick={handlePrepareBracketDraftCivilWar}
                    style={{ 
                      background: 'rgba(239, 68, 68, 0.15)', 
                      border: '1px solid rgba(239, 68, 68, 0.4)', 
                      color: '#fca5a5', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '6px',
                      fontSize: '0.82rem',
                      padding: '10px 8px'
                    }}
                  >
                    ⚔️ {lang === 'es' ? 'Generar Borrador (Guerra Civil)' : 'Generate Draft (Civil War)'}
                  </button>
                </div>

              {draftBracket && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '10px', padding: '10px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(203,161,53,0.2)', borderRadius: '8px' }}>
                  <h4 style={{ color: 'var(--gold-primary)', fontSize: '0.9rem', textAlign: 'center' }}>Borrador de Llave (Tamaño {draftBracket.size})</h4>
                  
                  {draftBracket.rounds[0].map((m, mIdx) => {
                    const approved = players.filter(p => p.status === 'approved' && p.participates !== false);
                    return (
                      <div key={mIdx} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                        <select value={m.player1} onChange={(e) => handleSwapBracketSlot(mIdx, 'player1', e.target.value)}
                          style={{ background: '#111', color: '#fff', fontSize: '0.7rem' }}
                        >
                          <option value="BYE">BYE</option>
                          {approved.map(p => {
                            const alignmentLabel = p.alignment ? (p.alignment.toLowerCase() === 'luz' ? 'Luz' : 'Oscuridad') : '';
                            return (
                              <option key={p.uid} value={p.uid}>
                                {p.name}{alignmentLabel ? ` - ${alignmentLabel}` : ''}
                              </option>
                            );
                          })}
                        </select>
                        <span style={{ color: 'var(--text-muted)' }}>vs</span>
                        <select value={m.player2} onChange={(e) => handleSwapBracketSlot(mIdx, 'player2', e.target.value)}
                          style={{ background: '#111', color: '#fff', fontSize: '0.7rem' }}
                        >
                          <option value="BYE">BYE</option>
                          {approved.map(p => {
                            const alignmentLabel = p.alignment ? (p.alignment.toLowerCase() === 'luz' ? 'Luz' : 'Oscuridad') : '';
                            return (
                              <option key={p.uid} value={p.uid}>
                                {p.name}{alignmentLabel ? ` - ${alignmentLabel}` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    );
                  })}

                  <button className="btn btn-primary" onClick={handleLaunchBracket} style={{ background: 'var(--success-color)', color: '#000', border: 'none' }}>
                    ✔ Publicar Llave Oficial
                  </button>
                </div>
              )}

              {/* Botones de Reset de Llaves Activas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
                {winnersBracket.status === 'active' && (
                  <button className="btn btn-danger btn-small" onClick={() => handleResetBracket('winners')}>
                    🚨 Eliminar Llave Ganadores Activa
                  </button>
                )}
                {losersBracket.status === 'active' && (
                  <button className="btn btn-danger btn-small" onClick={() => handleResetBracket('losers')}>
                    🚨 Eliminar Llave Perdedores Activa
                  </button>
                )}
              </div>

            </div>
          </div>

          {/* Ajustes de la Liga */}
          <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '1rem', color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
              Ajustes de la Liga
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Nombre de la Liga:</label>
                <input 
                  type="text" 
                  value={configData?.name || ''} 
                  onChange={(e) => {
                    const newName = e.target.value;
                    setConfigData(prev => ({ ...prev, name: newName }));
                  }}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Fecha Límite de Inscripción:</label>
                <input 
                  type="date" 
                  value={configData?.registrationDeadline || ''} 
                  onChange={(e) => {
                    const newDate = e.target.value;
                    setConfigData(prev => ({ ...prev, registrationDeadline: newDate }));
                  }}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Ubicación / Lugar de juego:' : 'Location / Venue:'}</label>
                <input 
                  type="text" 
                  value={configData?.location || ''} 
                  onChange={(e) => {
                    const newLocation = e.target.value;
                    setConfigData(prev => ({ ...prev, location: newLocation }));
                  }}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Descripción y Normas (opcional):' : 'Description and Rules (optional):'}</label>
                <textarea 
                  value={configData?.description || ''} 
                  onChange={(e) => {
                    const newDesc = e.target.value;
                    setConfigData(prev => ({ ...prev, description: newDesc }));
                  }}
                  rows={4}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Link al Reglamento (opcional):' : 'Rules Link (optional):'}</label>
                <input 
                  type="text" 
                  value={configData?.rulesLink || ''} 
                  onChange={(e) => {
                    const newLink = e.target.value;
                    setConfigData(prev => ({ ...prev, rulesLink: newLink }));
                  }}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px' }}
                />
              </div>

              <button 
                className="btn btn-primary btn-small"
                onClick={async () => {
                  if (!configData?.name?.trim() || !configData?.registrationDeadline || !configData?.location?.trim()) {
                    alert(lang === 'es' ? "Completa todos los campos obligatorios (nombre, fecha límite, ubicación)." : "Fill out all required fields (name, deadline, location).");
                    return;
                  }
                  try {
                    const cleanedConfig = {
                      ...configData,
                      name: configData.name.trim(),
                      registrationDeadline: configData.registrationDeadline,
                      location: configData.location ? configData.location.trim() : '',
                      description: configData.description ? configData.description.trim() : '',
                      rulesLink: configData.rulesLink ? configData.rulesLink.trim() : ''
                    };
                    if (cleanedConfig.rounds) {
                      cleanedConfig.rounds = roundsArrayToMap(cleanedConfig.rounds);
                    }
                    if (cleanedConfig.winnersBracket && cleanedConfig.winnersBracket.rounds) {
                      cleanedConfig.winnersBracket = {
                        ...cleanedConfig.winnersBracket,
                        rounds: roundsArrayToMap(cleanedConfig.winnersBracket.rounds)
                      };
                    }
                    if (cleanedConfig.losersBracket && cleanedConfig.losersBracket.rounds) {
                      cleanedConfig.losersBracket = {
                        ...cleanedConfig.losersBracket,
                        rounds: roundsArrayToMap(cleanedConfig.losersBracket.rounds)
                      };
                    }
                    await setDoc(doc(db, "players", configData.creatorUid), {
                      createdLeagues: {
                        [selectedLeagueId]: cleanedConfig
                      }
                    }, { merge: true });

                    alert("Ajustes guardados correctamente.");
                    loadLeagueData();
                  } catch (err) {
                    alert("Error al guardar: " + err.message);
                  }
                }}
                style={{ alignSelf: 'flex-start', marginTop: '6px' }}
              >
                Guardar Ajustes
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--danger-color)', marginTop: '24px' }}>
            <h4 style={{ color: 'var(--danger-color)', marginBottom: '8px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ⚠️ {lang === 'es' ? 'Zona de Peligro' : 'Danger Zone'}
            </h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.4' }}>
              {lang === 'es' 
                ? 'Esta acción es irreversible y eliminará permanentemente la liga, todas sus partidas, resultados y clasificaciones de la base de datos.' 
                : 'This action is irreversible and will permanently delete the league, all its matches, results, and standings from the database.'}
            </p>
            <button 
              className="btn" 
              onClick={() => handleDeleteLeagueClick(selectedLeagueId, configData)}
              style={{ background: 'var(--danger-color)', color: '#fff', border: 'none', minHeight: '38px', padding: '0 16px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              🗑️ {lang === 'es' ? 'Eliminar permanentemente esta Liga' : 'Permanently Delete this League'}
            </button>
          </div>

        </div>
      )}

      {/* --- MODAL A: REPORTAR --- */}
      <Modal 
        isOpen={isReportModalOpen} 
        onClose={() => { setIsReportModalOpen(false); setSelectedMatchToReport(null); }}
        title={lang === 'es' ? "Reportar Partida" : "Report Match"}
      >
        {selectedMatchToReport && (() => {
          const { match } = selectedMatchToReport;
          const isP1 = user.uid === match.player1;
          const rivalProfile = isP1 
            ? playersMap[match.player2] || { name: 'BYE' } 
            : playersMap[match.player1] || { name: 'Desconocido' };

          return (
            <form onSubmit={handleSaveReport} style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
              <div style={{ textAlign: 'center', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem' }}>
                {lang === 'es' ? 'Misión' : 'Mission'}: <strong>{match.mission || (lang === 'es' ? 'Eliminatoria Playoffs' : 'Playoffs Elimination')}</strong>
                <br />{lang === 'es' ? 'Rival' : 'Opponent'}: <strong>{rivalProfile.name}</strong>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Tus PV:' : 'Your VP:'}</label>
                  <input type="number" value={myVpReport} onChange={(e) => setMyVpReport(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))} min="0" max="20"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '12px', fontSize: '1rem', outline: 'none', textAlign: 'center' }} required
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'PV de tu Rival:' : 'Opponent\'s VP:'}</label>
                  <input type="number" value={rivalVpReport} onChange={(e) => setRivalVpReport(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))} min="0" max="20"
                    style={{ background: 'rgba(0,0,0,0.3)', border: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', color: '#fff', padding: '12px', fontSize: '1rem', outline: 'none', textAlign: 'center' }} required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={myLeaderKilledReport} onChange={(e) => setMyLeaderKilledReport(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                  {lang === 'es' ? 'Maté al líder enemigo ⚔️' : 'I killed the enemy leader ⚔️'}
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={myLeaderLostReport} onChange={(e) => setMyLeaderLostReport(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                  {lang === 'es' ? 'Mi líder murió en combate 💀' : 'My leader died in combat 💀'}
                </label>
              </div>

              {selectedMatchToReport.isBracket && (
                <div style={{ background: 'rgba(255,169,59,0.05)', border: '1px solid rgba(255,169,59,0.2)', padding: '10px', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--warning-color)', textAlign: 'center' }}>
                  💡 {lang === 'es' ? 'Nota: Las llaves no pueden terminar en empate. Determina un ganador en tu partida.' : 'Note: Brackets cannot end in a draw. Determine a winner for your match.'}
                </div>
              )}

              <button type="submit" className="btn btn-primary" disabled={isSubmittingReport} style={{ marginTop: '6px' }}>
                {isSubmittingReport ? (lang === 'es' ? 'Guardando...' : 'Saving...') : (lang === 'es' ? 'Cargar Reporte' : 'Submit Report')}
              </button>
            </form>
          );
        })()}
      </Modal>

      {/* --- MODAL B: ADMIN EDIT OVERRIDE --- */}
      <Modal
        isOpen={isAdminEditModalOpen}
        onClose={() => { setIsAdminEditModalOpen(false); setSelectedMatchToEditAdmin(null); }}
        title={lang === 'es' ? "Admin Override: Forzar Partida" : "Admin Override: Force Match"}
      >
        {selectedMatchToEditAdmin && (() => {
          const { match } = selectedMatchToEditAdmin;
          const p1 = playersMap[match.player1] || { name: match.player1 };
          const p2 = match.player2 === 'BYE' ? { name: 'BYE' } : playersMap[match.player2] || { name: match.player2 };

          return (
            <form onSubmit={handleAdminSaveOverride} style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
              <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {lang === 'es' ? 'Forzando resultados para:' : 'Forcing results for:'}
                <br /><strong>{p1.name}</strong> vs <strong>{p2.name}</strong>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>PV P1 ({p1.name}):</label>
                  <input type="number" value={adminVpP1} onChange={(e) => setAdminVpP1(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', textAlign: 'center', borderRadius: '4px' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>PV P2 ({p2.name}):</label>
                  <input type="number" value={adminVpP2} onChange={(e) => setAdminVpP2(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', textAlign: 'center', borderRadius: '4px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={adminKilledP1} onChange={(e) => setAdminKilledP1(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                  {lang === 'es' ? 'P1 mató líder enemigo' : 'P1 killed enemy leader'}
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={adminKilledP2} onChange={(e) => setAdminKilledP2(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                  {lang === 'es' ? 'P2 mató líder enemigo' : 'P2 killed enemy leader'}
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: 'var(--warning-color)', fontWeight: 'bold' }}>
                  <input type="checkbox" checked={adminVerified} onChange={(e) => setAdminVerified(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                  {lang === 'es' ? 'Oficializar / Verificar Partida' : 'Officialize / Verify Match'}
                </label>
              </div>

              <button type="submit" className="btn btn-primary" disabled={isAdminSaving} style={{ background: 'var(--danger-color)', border: 'none', color: '#fff', marginTop: '6px' }}>
                {isAdminSaving ? (lang === 'es' ? 'Guardando override...' : 'Saving override...') : (lang === 'es' ? 'Guardar Override Admin' : 'Save Admin Override')}
              </button>
            </form>
          );
        })()}
      </Modal>

      {/* --- MODAL C: ADMIN EDIT PLAYER --- */}
      <Modal
        isOpen={isPlayerEditModalOpen}
        onClose={() => { setIsPlayerEditModalOpen(false); setSelectedPlayerToEdit(null); }}
        title={lang === 'es' ? "Editar Ficha de Jugador" : "Edit Player Profile"}
      >
        {selectedPlayerToEdit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nombre Real:' : 'Real Name:'}</label>
              <input type="text" value={editPlayerName} onChange={(e) => setEditPlayerName(e.target.value)}
                style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px' }}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Teléfono:' : 'Phone:'}</label>
              <input type="text" value={editPlayerPhone} onChange={(e) => setEditPlayerPhone(e.target.value)}
                style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Bando:' : 'Side:'}</label>
                <select value={editPlayerAlignment} onChange={(e) => { setEditPlayerAlignment(e.target.value); setEditPlayerFaction(''); }}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px' }}
                >
                  <option value="luz">{lang === 'es' ? '☀️ Luz' : '☀️ Light'}</option>
                  <option value="oscuridad">{lang === 'es' ? '👁️ Oscuridad' : '👁️ Darkness'}</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Facción:' : 'Faction:'}</label>
                <select value={editPlayerFaction} onChange={(e) => setEditPlayerFaction(e.target.value)}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px' }}
                >
                  <option value="">{lang === 'es' ? '-- Elige Facción --' : '-- Choose Faction --'}</option>
                  <optgroup label={editPlayerAlignment === 'luz' ? (lang === 'es' ? "Listas de Luz" : "Light Lists") : (lang === 'es' ? "Listas de Oscuridad" : "Darkness Lists")}>
                    {(editPlayerAlignment === 'luz' ? LIGHT_FACTIONS : DARK_FACTIONS).map(f => <option key={f} value={f}>{f}</option>)}
                  </optgroup>
                  <optgroup label={editPlayerAlignment === 'luz' ? (lang === 'es' ? "Listas de Luz (Legend)" : "Light Lists (Legend)") : (lang === 'es' ? "Listas de Oscuridad (Legend)" : "Darkness Lists (Legend)")}>
                    {(editPlayerAlignment === 'luz' ? LIGHT_FACTIONS_LEGEND : DARK_FACTIONS_LEGEND).map(f => <option key={f} value={f}>{f}</option>)}
                  </optgroup>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <input 
                type="checkbox" 
                id="editPlayerIsAdmin"
                checked={editPlayerIsAdmin} 
                onChange={(e) => setEditPlayerIsAdmin(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
              />
              <label htmlFor="editPlayerIsAdmin" style={{ fontSize: '0.8rem', color: '#fff', cursor: 'pointer', userSelect: 'none' }}>
                {lang === 'es' ? 'Es Administrador de la Liga' : 'Is League Administrator'}
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
              <input 
                type="checkbox" 
                id="editPlayerParticipates"
                checked={editPlayerParticipates} 
                onChange={(e) => setEditPlayerParticipates(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
              />
              <label htmlFor="editPlayerParticipates" style={{ fontSize: '0.8rem', color: '#fff', cursor: 'pointer', userSelect: 'none' }}>
                {lang === 'es' ? 'Participa en la liga (Jugador activo)' : 'Participates in the league (Active player)'}
              </label>
            </div>

            <button className="btn btn-primary" onClick={handleSavePlayerEdit} disabled={isPlayerSaving} style={{ marginTop: '6px' }}>
              {isPlayerSaving ? (lang === 'es' ? 'Guardando...' : 'Saving...') : (lang === 'es' ? 'Guardar Cambios' : 'Save Changes')}
            </button>
          </div>
        )}
      </Modal>

      {/* --- MODAL D: VISOR DE PDF --- */}
      {selectedMissionPdf && activePdfUrl && (
        <Modal isOpen={true} size="large" onClose={() => { setSelectedMissionPdf(null); setActivePdfUrl(null); }} title={lang === 'es' ? `Reglas de Escenario: ${selectedMissionPdf}` : `Scenario Rules: ${selectedMissionPdf}`}>
          <div className="pdf-modal-container">
            <PdfCanvasViewer 
              url={activePdfUrl} 
              lang={pdfLang} 
              onChangeLang={(newLang) => {
                setPdfLang(newLang);
                try {
                  localStorage.setItem('lobelia_pdf_lang', newLang);
                } catch (_) {}
              }} 
            />
          </div>
        </Modal>
      )}

      {/* --- MODAL E: CREAR NUEVA LIGA --- */}
      <Modal 
        isOpen={isCreateLeagueModalOpen} 
        onClose={() => setIsCreateLeagueModalOpen(false)}
        title={lang === 'es' ? "Crear Nueva Liga" : "Create New League"}
      >
        <form onSubmit={handleCreateLeague} style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Nombre de la Liga:' : 'League Name:'}</label>
            <input 
              type="text" 
              value={newLeagueName} 
              onChange={(e) => setNewLeagueName(e.target.value)} 
              placeholder={lang === 'es' ? "Ej. Liga de Otoño" : "e.g. Autumn League"}
              style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
              required 
            />
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Fecha Límite de Inscripción:' : 'Registration Deadline:'}</label>
            <input 
              type="date" 
              value={newLeagueDeadline} 
              onChange={(e) => setNewLeagueDeadline(e.target.value)}
              style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
              required 
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Ubicación / Lugar de juego:' : 'Location / Venue:'}</label>
            <input 
              type="text" 
              value={newLeagueLocation} 
              onChange={(e) => setNewLeagueLocation(e.target.value)} 
              placeholder={lang === 'es' ? "Ej. Barcelona, Club Bilbo" : "e.g. Barcelona, Club Bilbo"}
              style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
              required 
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Descripción y Normas (opcional):' : 'Description and Rules (optional):'}</label>
            <textarea 
              value={newLeagueDescription} 
              onChange={(e) => setNewLeagueDescription(e.target.value)} 
              placeholder={lang === 'es' ? "Normas de la liga, formato, etc." : "League rules, format, etc."}
              rows={4}
              style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Link al Reglamento (opcional):' : 'Rules Link (optional):'}</label>
            <input 
              type="text" 
              value={newLeagueRulesLink} 
              onChange={(e) => setNewLeagueRulesLink(e.target.value)} 
              placeholder={lang === 'es' ? "Ej. enlace a Google Drive" : "e.g. Link to Google Drive"}
              style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ marginTop: '10px' }}>
            {lang === 'es' ? 'Crear Liga' : 'Create League'}
          </button>
        </form>
      </Modal>

      {/* --- MODAL F: INSCRIBIRSE A LIGA --- */}
      <Modal 
        isOpen={isJoinLeagueModalOpen} 
        onClose={() => setIsJoinLeagueModalOpen(false)}
        title={lang === 'es' ? "Inscripción a la Liga" : "Register to League"}
      >
        {selectedLeagueId && leaguesList[selectedLeagueId] && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(203, 161, 53, 0.12) 0%, rgba(0,0,0,0.5) 100%)',
            border: '1px solid rgba(203, 161, 53, 0.4)',
            borderRadius: '10px',
            padding: '14px',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '1.3rem' }}>🏆</span>
              <h4 style={{ margin: 0, color: 'var(--gold-primary)', fontSize: '1.05rem', fontFamily: 'var(--font-title)' }}>
                {leaguesList[selectedLeagueId].name}
              </h4>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              {leaguesList[selectedLeagueId].location && (
                <span>📍 <strong>{leaguesList[selectedLeagueId].location}</strong></span>
              )}
              {leaguesList[selectedLeagueId].deadline && (
                <span>📅 Cierre: <strong>{leaguesList[selectedLeagueId].deadline}</strong></span>
              )}
            </div>
            {leaguesList[selectedLeagueId].description && (
              <p style={{ margin: '0 0 6px 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                {leaguesList[selectedLeagueId].description}
              </p>
            )}
            {leaguesList[selectedLeagueId].rulesLink && (
              <a
                href={leaguesList[selectedLeagueId].rulesLink.startsWith('http') ? leaguesList[selectedLeagueId].rulesLink : `https://${leaguesList[selectedLeagueId].rulesLink}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', color: 'var(--gold-primary)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                📜 {lang === 'es' ? 'Ver Bases / Reglamento Oficial' : 'View Rules / Guidelines'}
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleJoinLeagueSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Bando:' : 'Side:'}</label>
              <select 
                value={joinAlignment} 
                onChange={(e) => { setJoinAlignment(e.target.value); setJoinFaction(''); }}
                style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
              >
                <option value="luz">{lang === 'es' ? '☀️ Luz' : '☀️ Light'}</option>
                <option value="oscuridad">{lang === 'es' ? '👁️ Oscuridad' : '👁️ Darkness'}</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lang === 'es' ? 'Facción:' : 'Faction:'}</label>
              <select 
                value={joinFaction} 
                onChange={(e) => setJoinFaction(e.target.value)}
                style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px', borderRadius: '4px', outline: 'none' }}
                required
              >
                <option value="">{lang === 'es' ? '-- Facción --' : '-- Faction --'}</option>
                <optgroup label={joinAlignment === 'luz' ? (lang === 'es' ? "Listas de Luz" : "Light Lists") : (lang === 'es' ? "Listas de Oscuridad" : "Darkness Lists")}>
                  {joinFactionsList.normal.map(f => <option key={f} value={f}>{f}</option>)}
                </optgroup>
                <optgroup label={joinAlignment === 'luz' ? (lang === 'es' ? "Listas de Luz (Legend)" : "Light Lists (Legend)") : (lang === 'es' ? "Listas de Oscuridad (Legend)" : "Darkness Lists (Legend)")}>
                  {joinFactionsList.legend.map(f => <option key={f} value={f}>{f}</option>)}
                </optgroup>
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={isJoining} style={{ marginTop: '10px' }}>
            {isJoining ? (lang === 'es' ? 'Inscribiendo...' : 'Registering...') : (lang === 'es' ? 'Confirmar Inscripción' : 'Confirm Registration')}
          </button>
        </form>
      </Modal>

      {/* --- MODAL SHARE: CARTEL OFICIAL DE LIGA (QR & WHATSAPP) --- */}
      {isShareLeagueModalOpen && shareLeagueData && (
        <Modal
          isOpen={true}
          onClose={() => setIsShareLeagueModalOpen(false)}
          title={lang === 'es' ? `Cartel Oficial: ${shareLeagueData.name}` : `Official Poster: ${shareLeagueData.name}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', textAlign: 'center' }}>
            
            {/* Canvas del Cartel Oficial de Convocatoria */}
            <div style={{
              width: '100%',
              maxWidth: '340px',
              margin: '0 auto',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 10px 35px rgba(0,0,0,0.8)',
              border: '1px solid rgba(203, 161, 53, 0.45)',
              background: '#07130C'
            }}>
              <canvas 
                ref={qrCanvasRef} 
                style={{ 
                  display: 'block', 
                  width: '100%', 
                  height: 'auto' 
                }} 
              />
            </div>

            {/* Botones Principales de Compartición */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
              <button
                type="button"
                onClick={handleShareWhatsApp}
                style={{
                  background: '#25D366',
                  border: 'none',
                  color: '#111',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 10px rgba(37, 211, 102, 0.3)'
                }}
              >
                <span>📲</span> {lang === 'es' ? 'Enviar a WhatsApp' : 'Share on WhatsApp'}
              </button>

              <button
                type="button"
                onClick={handleCopyCardImage}
                style={{
                  background: copiedImageToast ? '#2ecc71' : 'rgba(203, 161, 53, 0.15)',
                  border: '1px solid var(--gold-primary)',
                  color: copiedImageToast ? '#fff' : 'var(--gold-primary)',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
                title={lang === 'es' ? 'Copia la imagen para pegarla directamente con Ctrl+V en WhatsApp Web o Discord' : 'Copy image to clipboard to paste with Ctrl+V'}
              >
                <span>🖼️</span> {copiedImageToast ? '✔ Imagen Copiada' : (lang === 'es' ? 'Copiar Imagen' : 'Copy Image')}
              </button>
            </div>

            {/* Fila secundaria: Copiar Texto Formateado y Descargar PNG */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
              <button
                type="button"
                onClick={handleCopyShareText}
                style={{
                  background: copiedTextToast ? '#2ecc71' : 'rgba(255,255,255,0.06)',
                  border: 'var(--border-glass)',
                  color: copiedTextToast ? '#111' : '#fff',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                <span>📝</span> {copiedTextToast ? '✔ Texto Copiado' : (lang === 'es' ? 'Copiar Texto' : 'Copy Text')}
              </button>

              <button
                type="button"
                onClick={handleDownloadPoster}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: 'var(--border-glass)',
                  color: '#fff',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <span>📥</span> {lang === 'es' ? 'Descargar PNG' : 'Download PNG'}
              </button>
            </div>

            {/* Guía visual para WhatsApp Web */}
            <div style={{ 
              background: 'rgba(37, 211, 102, 0.08)', 
              border: '1px solid rgba(37, 211, 102, 0.3)', 
              borderRadius: '8px', 
              padding: '10px 12px', 
              fontSize: '0.74rem', 
              color: '#e2e8f0', 
              lineHeight: '1.45', 
              textAlign: 'left',
              width: '100%',
              boxSizing: 'border-box'
            }}>
              <strong style={{ color: '#25D366', display: 'block', marginBottom: '3px' }}>
                📌 ¿Cómo enviarlo en 1 solo mensaje en WhatsApp Web?
              </strong>
              1. Pulsa <strong>«Copiar Imagen»</strong> y haz <strong>Ctrl + V</strong> en el chat de WhatsApp Web.<br/>
              2. En la ventana de previsualización, pulsa en <em>"Añade un pie de foto..."</em> y pega el texto con el enlace antes de pulsar Enviar.
            </div>

          </div>
        </Modal>
      )}

      {/* --- MODAL G: AÑADIR JUGADOR MANUALMENTE (ADMIN) --- */}
      <Modal
        isOpen={isAddPlayerModalOpen}
        onClose={() => { setIsAddPlayerModalOpen(false); setSelectedUserToAdd(null); }}
        title={lang === 'es' ? "➕ Añadir Jugador a la Liga (Admin)" : "➕ Manually Add Player (Admin)"}
      >
        <form onSubmit={handleConfirmAddPlayer} style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4' }}>
            {lang === 'es' 
              ? 'Busca cualquier usuario registrado en la plataforma para inscribirlo y aprobarlo directamente en esta liga (incluso si las inscripciones están cerradas).' 
              : 'Search any registered user to directly enroll and approve them in this league (even if registrations are closed).'}
          </p>

          {/* Buscador de usuario */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--gold-primary)', fontWeight: 'bold' }}>
              {lang === 'es' ? '1. Buscar Usuario Registrado:' : '1. Search Registered User:'}
            </label>
            <input 
              type="text" 
              placeholder={lang === 'es' ? "Escribe nombre, @usuario o email..." : "Type name, @username or email..."}
              value={addPlayerSearch} 
              onChange={(e) => setAddPlayerSearch(e.target.value)}
              style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '0.88rem' }}
            />
          </div>

          {/* Lista de usuarios filtrados */}
          <div style={{ 
            maxHeight: '160px', 
            overflowY: 'auto', 
            background: 'rgba(0,0,0,0.3)', 
            border: '1px solid rgba(255,255,255,0.06)', 
            borderRadius: '6px', 
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            {isLoadingAllUsers ? (
              <div style={{ textAlign: 'center', padding: '12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {lang === 'es' ? 'Cargando directorio de usuarios...' : 'Loading users directory...'}
              </div>
            ) : allAvailableUsers.filter(u => {
              const q = addPlayerSearch.toLowerCase().trim();
              if (!q) return true;
              return u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
            }).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {lang === 'es' ? 'No se encontraron usuarios disponibles.' : 'No available users found.'}
              </div>
            ) : (
              allAvailableUsers.filter(u => {
                const q = addPlayerSearch.toLowerCase().trim();
                if (!q) return true;
                return u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
              }).map(u => {
                const isSelected = selectedUserToAdd?.uid === u.uid;
                return (
                  <div 
                    key={u.uid}
                    onClick={() => {
                      setSelectedUserToAdd(u);
                      setAddUserAlignment(u.alignment === 'oscuridad' ? 'oscuridad' : 'luz');
                      setAddUserFaction(u.faction || '');
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      background: isSelected ? 'rgba(203, 161, 53, 0.25)' : 'rgba(255,255,255,0.02)',
                      border: isSelected ? '1px solid var(--gold-primary)' : '1px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                    className="table-row-hover"
                  >
                    <div>
                      <strong style={{ fontSize: '0.84rem', color: isSelected ? 'var(--gold-primary)' : '#fff' }}>{u.name}</strong>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '6px' }}>@{u.username}</span>
                    </div>
                    {isSelected && <span style={{ color: 'var(--gold-primary)', fontSize: '0.85rem' }}>✔ Seleccionado</span>}
                  </div>
                );
              })
            )}
          </div>

          {selectedUserToAdd && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(203, 161, 53, 0.05)', border: '1px solid rgba(203, 161, 53, 0.2)', padding: '12px', borderRadius: '8px', marginTop: '4px' }}>
              <div style={{ fontSize: '0.82rem', color: '#fff' }}>
                👤 {lang === 'es' ? 'Configurar inscripción para:' : 'Configure registration for:'} <strong>{selectedUserToAdd.name}</strong> (@{selectedUserToAdd.username})
              </div>

              {/* Bando */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {lang === 'es' ? 'Bando / Alineación:' : 'Side / Alignment:'}
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button 
                    type="button"
                    onClick={() => { setAddUserAlignment('luz'); setAddUserFaction(''); }}
                    style={{
                      padding: '8px',
                      borderRadius: '4px',
                      background: addUserAlignment === 'luz' ? 'var(--gold-primary)' : '#111',
                      color: addUserAlignment === 'luz' ? '#000' : '#fff',
                      fontWeight: 'bold',
                      border: 'var(--border-glass)',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    ☀️ {lang === 'es' ? 'Luz' : 'Light'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => { setAddUserAlignment('oscuridad'); setAddUserFaction(''); }}
                    style={{
                      padding: '8px',
                      borderRadius: '4px',
                      background: addUserAlignment === 'oscuridad' ? 'var(--danger-color)' : '#111',
                      color: '#fff',
                      fontWeight: 'bold',
                      border: 'var(--border-glass)',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    👁️ {lang === 'es' ? 'Oscuridad' : 'Darkness'}
                  </button>
                </div>
              </div>

              {/* Facción */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {lang === 'es' ? 'Facción / Ejército:' : 'Faction / Army:'}
                </label>
                <select 
                  value={addUserFaction} 
                  onChange={(e) => setAddUserFaction(e.target.value)}
                  style={{ background: '#111', border: 'var(--border-glass)', color: '#fff', padding: '8px', borderRadius: '4px', fontSize: '0.82rem' }}
                  required
                >
                  <option value="">{lang === 'es' ? '-- Selecciona una Facción --' : '-- Select a Faction --'}</option>
                  <optgroup label={addUserAlignment === 'luz' ? (lang === 'es' ? "Listas de Luz (Normal)" : "Light Lists (Normal)") : (lang === 'es' ? "Listas de Oscuridad (Normal)" : "Darkness Lists (Normal)")}>
                    {addPlayerFactionsList.normal.map(f => <option key={f} value={f}>{f}</option>)}
                  </optgroup>
                  <optgroup label={addUserAlignment === 'luz' ? (lang === 'es' ? "Listas de Luz (Legend)" : "Light Lists (Legend)") : (lang === 'es' ? "Listas de Oscuridad (Legend)" : "Darkness Lists (Legend)")}>
                    {addPlayerFactionsList.legend.map(f => <option key={f} value={f}>{f}</option>)}
                  </optgroup>
                </select>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={isAddingPlayer || !selectedUserToAdd}
              style={{ flex: 1 }}
            >
              {isAddingPlayer ? (lang === 'es' ? 'Añadiendo...' : 'Adding...') : (lang === 'es' ? 'Confirmar y Añadir a la Liga' : 'Confirm & Add to League')}
            </button>
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={() => { setIsAddPlayerModalOpen(false); setSelectedUserToAdd(null); }}
              style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: 'var(--border-glass)' }}
            >
              {lang === 'es' ? 'Cancelar' : 'Cancel'}
            </button>
          </div>
        </form>
      </Modal>

      {/* --- MODAL DE PERFIL DE JUGADOR --- */}
      <Modal
        isOpen={isPlayerProfileModalOpen}
        onClose={() => { setIsPlayerProfileModalOpen(false); setSelectedPlayerProfile(null); }}
        title={lang === 'es' ? "Perfil del Jugador" : "Player Profile"}
      >
        {selectedPlayerProfile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '10px 0' }}>
            <div style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '16px' }}>
              <div style={{ fontSize: '3rem', margin: '0 auto 12px auto' }}>🛡️</div>
              <h3 style={{ margin: '0', color: 'var(--gold-primary)', fontSize: '1.4rem' }}>{selectedPlayerProfile.name}</h3>
              <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>@{selectedPlayerProfile.username}</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 16px', fontSize: '0.88rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>{lang === 'es' ? "Bando/Alineación:" : "Alignment/Side:"}</span>
              <span style={{ 
                fontWeight: 'bold', 
                color: selectedPlayerProfile.alignment === 'luz' ? 'var(--gold-primary)' : selectedPlayerProfile.alignment === 'oscuridad' ? 'var(--danger-color)' : 'var(--text-primary)' 
              }}>
                {selectedPlayerProfile.alignment === 'luz' 
                  ? (lang === 'es' ? '☀️ Luz' : '☀️ Light') 
                  : selectedPlayerProfile.alignment === 'oscuridad' 
                    ? (lang === 'es' ? '👁️ Oscuridad' : '👁️ Darkness') 
                    : (lang === 'es' ? 'Ninguno' : 'None')}
              </span>

              <span style={{ color: 'var(--text-muted)' }}>{lang === 'es' ? "Facción:" : "Faction:"}</span>
              <span style={{ fontWeight: '500' }}>{selectedPlayerProfile.faction || (lang === 'es' ? 'Desconocida' : 'Unknown')}</span>

              <span style={{ color: 'var(--text-muted)' }}>{lang === 'es' ? "Ranking ELO:" : "ELO Rating:"}</span>
              <span>
                {(() => {
                  const eloVal = selectedPlayerProfile.elo || DEFAULT_ELO;
                  const tier = getEloTier(eloVal, lang);
                  return (
                    <span
                      style={{
                        background: tier.bg,
                        color: tier.color,
                        border: `1px solid ${tier.border}`,
                        borderRadius: '4px',
                        padding: '3px 8px',
                        fontWeight: 'bold',
                        fontSize: '0.82rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}
                    >
                      <span>{tier.badge}</span>
                      <span>{eloVal}</span>
                      <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>({tier.name})</span>
                    </span>
                  );
                })()}
              </span>

              <span style={{ color: 'var(--text-muted)' }}>{lang === 'es' ? "Ubicación:" : "Location:"}</span>
              <span>{selectedPlayerProfile.location || (lang === 'es' ? 'No especificada' : 'Not specified')}</span>
            </div>

            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {user ? (
                user.uid !== selectedPlayerProfile.uid ? (
                  <button 
                    className="btn btn-primary"
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    onClick={() => {
                      onStartChat(selectedPlayerProfile.uid, selectedPlayerProfile.name, selectedPlayerProfile.username);
                      setIsPlayerProfileModalOpen(false);
                      setSelectedPlayerProfile(null);
                    }}
                  >
                    💬 {lang === 'es' ? 'Enviar Mensaje' : 'Send Message'}
                  </button>
                ) : (
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', margin: '4px 0' }}>
                    {lang === 'es' ? "Este es tu propio perfil." : "This is your own profile."}
                  </p>
                )
              ) : (
                <button 
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => {
                    setIsPlayerProfileModalOpen(false);
                    onOpenAuthModal();
                  }}
                >
                  💬 {lang === 'es' ? 'Inicia sesión para enviar mensaje' : 'Log in to send message'}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* --- MODAL CONFIRMACIÓN GLOBAL --- */}
      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        title={lang === 'es' ? 'Confirmación' : 'Confirmation'}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '10px 0' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
            {confirmModalMessage}
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button 
              className="btn btn-primary" 
              onClick={async () => {
                setIsConfirmModalOpen(false);
                if (confirmModalOnConfirm) {
                  await confirmModalOnConfirm();
                }
              }}
              style={{ flex: 1, background: 'var(--success-color)', color: '#000', border: 'none' }}
            >
              {lang === 'es' ? 'Sí, estoy seguro' : 'Yes, I\'m sure'}
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={() => setIsConfirmModalOpen(false)}
              style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: '#fff', border: 'var(--border-glass)' }}
            >
              {lang === 'es' ? 'Cancelar' : 'Cancel'}
            </button>
          </div>
        </div>
      </Modal>

      {/* --- MODAL ALERTA GLOBAL --- */}
      <Modal
        isOpen={isAlertModalOpen}
        onClose={() => setIsAlertModalOpen(false)}
        title={lang === 'es' ? 'Notificación' : 'Notification'}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '10px 0' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
            {alertModalMessage}
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button 
              className="btn btn-primary" 
              onClick={() => setIsAlertModalOpen(false)}
              style={{ flex: 1, background: 'var(--gold-primary)', color: '#000', border: 'none', minHeight: '40px', fontWeight: 'bold' }}
            >
              {lang === 'es' ? 'Aceptar' : 'OK'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
