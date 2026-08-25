// src/views/Missions.jsx
import React, { useState, useEffect } from 'react';
import Modal from '../components/Modal';
import PdfCanvasViewer from '../components/PdfCanvasViewer';
import { trackFeature } from '../utils/analyticsTracker';
import { getActiveModData, MOD_LAYERS, getMissionPdfUrlAsync } from '../utils/modManager';

export default function Missions({ lang, translations, setLang, setView }) {
  const t = translations[lang];

  // 1. Estado reactivo del Mod de Misiones activo
  const [missionsMod, setMissionsMod] = useState(() => getActiveModData(null, MOD_LAYERS.MISSIONS));

  useEffect(() => {
    const handleModChange = () => {
      setMissionsMod(getActiveModData(null, MOD_LAYERS.MISSIONS));
    };
    window.addEventListener('lobelia_mod_changed', handleModChange);
    return () => window.removeEventListener('lobelia_mod_changed', handleModChange);
  }, []);

  const pdfConfig = missionsMod?.missionPdfs || null;
  const pools1v1 = pdfConfig?.pools1v1 || [];
  const missions2v2 = pdfConfig?.missions2v2List || (pdfConfig?.missions2v2 ? Object.keys(pdfConfig.missions2v2) : []);
  const displayInfo = pdfConfig?.displayInfo || {};
  const scenarioFaqs = pdfConfig?.faqs || {};

  const hasMissions = pools1v1.length > 0 || missions2v2.length > 0;

  const [mode, setMode] = useState('1vs1'); // '1vs1' o '2vs2'
  const [rounds, setRounds] = useState(3);
  const [selectedMission, setSelectedMission] = useState(null);
  const [activePdfUrl, setActivePdfUrl] = useState(null);
  const [pdfLang, setPdfLang] = useState(() => {
    try {
      const stored = localStorage.getItem('lobelia_pdf_lang');
      if (stored === 'es' || stored === 'en') return stored;
    } catch (_) {}
    return lang;
  });

  // Sincronizar pdfLang con lang si no se ha guardado una preferencia explícita
  useEffect(() => {
    try {
      const stored = localStorage.getItem('lobelia_pdf_lang');
      if (!stored) {
        setPdfLang(lang);
      }
    } catch (_) {}
  }, [lang]);
  
  // Guardamos las rondas generadas en el estado: { missionName: roundNumber }
  const [roundBadges, setRoundBadges] = useState({});

  // 1. Selector Aleatorio Simple
  const handleRandomSelect = () => {
    if (mode === '1vs1') {
      const allMissions = pools1v1.flatMap(pool => pool.items);
      if (allMissions.length === 0) return;
      const randomMission = allMissions[Math.floor(Math.random() * allMissions.length)];
      setRoundBadges({ [randomMission]: 1 });
      openPdf(randomMission);
    } else {
      if (missions2v2.length === 0) return;
      const randomMission = missions2v2[Math.floor(Math.random() * missions2v2.length)];
      setRoundBadges({ [randomMission]: 1 });
      openPdf(randomMission);
    }
  };

  // 2. Generador de Rondas de Torneo
  const handleGenerateRounds = () => {
    const badges = {};
    let lastSelected = null;

    if (mode === '1vs1') {
      if (pools1v1.length === 0) return;
      // Barajar los índices de las categorías
      const poolIndexes = pools1v1.map((_, i) => i);
      for (let i = poolIndexes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [poolIndexes[i], poolIndexes[j]] = [poolIndexes[j], poolIndexes[i]];
      }

      // Tomar tantos pools como rondas queramos
      const chosenPoolIndexes = poolIndexes.slice(0, Math.min(rounds, pools1v1.length));

      chosenPoolIndexes.forEach((poolIdx, roundOrder) => {
        const pool = pools1v1[poolIdx];
        if (pool.items && pool.items.length > 0) {
          const mission = pool.items[Math.floor(Math.random() * pool.items.length)];
          badges[mission] = roundOrder + 1;
          lastSelected = mission;
        }
      });
    } else {
      if (missions2v2.length === 0) return;
      const shuffled2v2 = [...missions2v2];
      for (let i = shuffled2v2.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled2v2[i], shuffled2v2[j]] = [shuffled2v2[j], shuffled2v2[i]];
      }
      
      const chosenMissions = shuffled2v2.slice(0, Math.min(rounds, missions2v2.length));
      chosenMissions.forEach((mission, roundOrder) => {
        badges[mission] = roundOrder + 1;
        lastSelected = mission;
      });
    }

    setRoundBadges(badges);
    setSelectedMission(null);
  };

  // 3. Abrir visor de PDF
  const openPdf = (missionName) => {
    setSelectedMission(missionName);
    trackFeature('mission_view', { mission: missionName, mode });
  };

  useEffect(() => {
    if (!selectedMission) {
      setActivePdfUrl(null);
      return;
    }
    let isMounted = true;
    getMissionPdfUrlAsync(selectedMission, pdfLang, mode).then(url => {
      if (isMounted) setActivePdfUrl(url);
    });
    return () => { isMounted = false; };
  }, [selectedMission, pdfLang, mode, missionsMod]);

  // 4. Compartir Rondas (Mobile Native Share / Fallback Clipboard)
  const handleShare = async () => {
    const roundsMap = {};
    Object.entries(roundBadges).forEach(([mission, round]) => {
      roundsMap[round] = mission;
    });

    const sortedRounds = Object.keys(roundsMap).sort((a, b) => parseInt(a) - parseInt(b));
    if (sortedRounds.length === 0) return;

    let shareText = lang === 'es' 
      ? `🏆 *Rondas del Torneo (MESBG)* 🏆\n\n`
      : `🏆 *Tournament Rounds (MESBG)* 🏆\n\n`;

    sortedRounds.forEach(r => {
      shareText += `Ronda ${r}: *${displayInfo[roundsMap[r]]?.[lang] || roundsMap[r]}*\n`;
    });

    shareText += `\nGenerado en: https://ningrael.github.io/CucharaLobelia-B/`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'La Cuchara de Lobelia - Rondas',
          text: shareText
        });
      } catch (err) {
        console.warn('Share api failed', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        alert(lang === 'es' ? '¡Lista copiada al portapapeles!' : 'List copied to clipboard!');
      } catch (err) {
        alert(shareText);
      }
    }
  };

  const handleGoToMods = () => {
    if (setView) {
      setView('mods');
    } else {
      const modsTabBtn = document.querySelector('[data-tab="mods"]');
      if (modsTabBtn) modsTabBtn.click();
      else window.location.hash = '#mods';
    }
  };

  // ZERO-STATE: Si no hay mod de misiones instalado
  if (!hasMissions) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <div className="glass-card" style={{ textAlign: 'center', padding: '50px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
          <div style={{ fontSize: '3.5rem', filter: 'drop-shadow(0 0 12px rgba(203, 161, 53, 0.4))' }}>🗺️</div>
          <h3 style={{ color: 'var(--gold-primary)', margin: 0, fontSize: '1.4rem', fontFamily: 'var(--font-title)' }}>
            {lang === 'es' ? 'No hay ningún Mod de Misiones activo' : 'No Missions Mod currently active'}
          </h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '540px', fontSize: '0.92rem', lineHeight: '1.6', margin: 0 }}>
            {lang === 'es' 
              ? 'La Cuchara de Lobelia es un motor neutral y abierto. Para cargar mapas, escenarios de juego y reglas de misiones, importa un paquete de mod compatible desde la sección Mods o crea el tuyo propio.'
              : 'La Cuchara de Lobelia is an open and neutral engine. To load maps, scenarios, and mission rules, import a compatible mod package from the Mods section or create your own.'}
          </p>
          <button 
            className="btn btn-primary" 
            onClick={handleGoToMods}
            style={{ marginTop: '10px', padding: '12px 24px', fontSize: '1rem', fontWeight: 'bold', borderRadius: '10px' }}
          >
            🧩 {lang === 'es' ? 'Gestionar Mods' : 'Manage Mods'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>
      {/* Selector de Modo (1vs1 / 2vs2) */}
      <div 
        style={{
          display: 'flex',
          background: 'rgba(0,0,0,0.2)',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          border: 'var(--border-glass)'
        }}
      >
        <button 
          className="btn btn-small"
          onClick={() => { setMode('1vs1'); setRoundBadges({}); setSelectedMission(null); }}
          style={{
            flex: 1,
            background: mode === '1vs1' ? 'linear-gradient(135deg, #1d3321 0%, #112114 100%)' : 'transparent',
            border: mode === '1vs1' ? 'var(--border-gold)' : '1px solid transparent',
            color: mode === '1vs1' ? 'var(--gold-primary)' : 'var(--text-muted)',
            boxShadow: 'none',
            minHeight: '40px'
          }}
        >
          Matched Play (1vs1)
        </button>
        <button 
          className="btn btn-small"
          onClick={() => { setMode('2vs2'); setRoundBadges({}); setSelectedMission(null); }}
          style={{
            flex: 1,
            background: mode === '2vs2' ? 'linear-gradient(135deg, #1d3321 0%, #112114 100%)' : 'transparent',
            border: mode === '2vs2' ? 'var(--border-gold)' : '1px solid transparent',
            color: mode === '2vs2' ? 'var(--gold-primary)' : 'var(--text-muted)',
            boxShadow: 'none',
            minHeight: '40px'
          }}
        >
          {lang === 'es' ? 'Doble (2vs2)' : 'Doubles (2v2)'}
        </button>
      </div>

      {/* Dos Banners Principales Interactivos (Random Naranja & Rondas de Torneo) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', width: '100%' }}>
        {/* 1. Botón Principal Naranja: Misión Random */}
        <div
          onClick={handleRandomSelect}
          className="hero-card-highlight"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderRadius: '16px',
            cursor: 'pointer',
            background: 'linear-gradient(135deg, rgba(230, 126, 34, 0.28) 0%, rgba(160, 64, 0, 0.35) 100%)',
            border: '1px solid #e67e22',
            boxShadow: '0 4px 18px rgba(230, 126, 34, 0.25)',
            transition: 'all 0.2s ease'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '2rem', filter: 'drop-shadow(0 0 8px rgba(243, 156, 18, 0.6))' }}>🎲</span>
            <div>
              <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#ffb74d', fontFamily: 'var(--font-title)', letterSpacing: '0.5px' }}>
                {lang === 'es' ? 'Elige una misión random' : 'Pick a random mission'}
              </h4>
              <span style={{ fontSize: '0.78rem', color: 'rgba(255, 255, 255, 0.8)' }}>
                {lang === 'es' ? 'Selección y visor instantáneo' : 'Instant random mission & PDF'}
              </span>
            </div>
          </div>
          <span style={{ color: '#ffb74d', fontSize: '1.3rem', fontWeight: 'bold' }}>➔</span>
        </div>

        {/* 2. Botón Rondas de Torneo con Stepper Integrado */}
        <div
          className="hero-card-highlight"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(22, 38, 25, 0.85) 0%, rgba(12, 20, 14, 0.95) 100%)',
            border: '1px solid rgba(203, 161, 53, 0.4)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            gap: '10px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '140px' }}>
            <span style={{ fontSize: '1.8rem', filter: 'drop-shadow(0 0 6px var(--gold-glow))' }}>🏆</span>
            <div>
              <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--gold-primary)', fontFamily: 'var(--font-title)', letterSpacing: '0.5px' }}>
                {lang === 'es' ? 'Rondas de torneo' : 'Tournament rounds'}
              </h4>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                {lang === 'es' ? 'Genera sin repetir pool' : 'Generate non-repeating pools'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="stepper-container" style={{ maxWidth: '90px', height: '34px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px' }}>
              <button 
                type="button" 
                className="stepper-btn" 
                style={{ width: '28px', height: '34px', fontSize: '0.9rem', padding: 0 }}
                onClick={() => setRounds(Math.max(1, rounds - 1))}
              >
                -
              </button>
              <input 
                type="number" 
                className="stepper-input" 
                style={{ width: '34px', height: '34px', fontSize: '0.88rem' }} 
                value={rounds} 
                readOnly 
              />
              <button 
                type="button" 
                className="stepper-btn" 
                style={{ width: '28px', height: '34px', fontSize: '0.9rem', padding: 0 }}
                onClick={() => setRounds(Math.min(6, rounds + 1))}
              >
                +
              </button>
            </div>

            <button 
              className="btn btn-primary btn-small"
              onClick={handleGenerateRounds}
              style={{ minHeight: '34px', padding: '0 12px', fontSize: '0.8rem', borderRadius: '8px', fontWeight: 'bold' }}
            >
              ⚡ {lang === 'es' ? 'Generar' : 'Generate'}
            </button>
          </div>
        </div>
      </div>

      {/* Botón Compartir Rondas si se han generado */}
      {Object.keys(roundBadges).length > 0 && (
        <button
          className="btn btn-primary btn-small"
          onClick={handleShare}
          style={{ width: '100%', minHeight: '34px', fontSize: '0.8rem', padding: '6px', borderRadius: '10px' }}
        >
          📤 {lang === 'es' ? 'Compartir Rondas Generadas' : 'Share Generated Rounds'}
        </button>
      )}

      {/* --- GRID DE MISIONES 1VS1 (DASHBOARD COMPACTO) --- */}
      {mode === '1vs1' && (
        <div className="missions-dashboard-grid">
          {pools1v1.map((pool, pIdx) => (
            <div key={pIdx} className="pool-subcard">
              <div className="pool-title" title={pool.name[lang] || pool.name.es}>
                {pool.name[lang] || pool.name.es}
              </div>
              <div className="pool-missions-grid">
                {(pool.items || []).map((mission, mIdx) => {
                  const roundNum = roundBadges[mission];
                  const isSelected = selectedMission === mission;
                  const faqData = scenarioFaqs[mission];
                  let roundClass = "";
                  if (roundNum) {
                    roundClass = ` active-round-${roundNum}`;
                  }
                  
                  return (
                    <button
                      key={mIdx}
                      onClick={() => openPdf(mission)}
                      className={`mission-pill-btn${roundClass}`}
                      style={{
                        borderColor: isSelected ? 'var(--gold-primary)' : undefined,
                        boxShadow: isSelected ? '0 0 8px var(--gold-glow)' : undefined,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2px',
                        position: 'relative'
                      }}
                      title={mission}
                    >
                      <span>{displayInfo[mission]?.[lang] || mission}</span>
                      {faqData && (
                        <span 
                          style={{
                            fontSize: '0.52rem',
                            fontWeight: 'bold',
                            padding: '0px 4px',
                            borderRadius: '3px',
                            background: faqData.type === 'errata' ? 'rgba(231, 76, 60, 0.25)' : 'rgba(203, 161, 53, 0.2)',
                            color: faqData.type === 'errata' ? '#ff7675' : 'var(--gold-primary)',
                            border: faqData.type === 'errata' ? '1px solid rgba(231, 76, 60, 0.5)' : '1px solid rgba(203, 161, 53, 0.4)',
                            marginTop: '1px',
                            lineHeight: 1.2
                          }}
                        >
                          {faqData.type === 'errata' ? '🔴 Errata' : '⚡ FAQ'}
                        </span>
                      )}
                      {roundNum && (
                        <span className="mission-pill-badge">
                          {roundNum}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- GRID DE MISIONES 2VS2 --- */}
      {mode === '2vs2' && (
        <div className="glass-card" style={{ padding: '16px' }}>
          <h4 style={{ fontSize: '0.9rem', color: 'var(--gold-primary)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', marginBottom: '14px', fontFamily: 'var(--font-title)' }}>
            {lang === 'es' ? 'Misiones por Parejas (2vs2)' : 'Doubles Missions (2v2)'}
          </h4>
          <div 
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px'
            }}
          >
            {missions2v2.map((mission, idx) => {
              const roundNum = roundBadges[mission];
              const isSelected = selectedMission === mission;
              const faqData = scenarioFaqs[mission];
              let roundClass = "";
              if (roundNum) {
                roundClass = ` active-round-${roundNum}`;
              }

              return (
                <button
                  key={idx}
                  onClick={() => openPdf(mission)}
                  className={`mission-pill-btn${roundClass}`}
                  style={{
                    padding: '12px 10px',
                    fontSize: '0.85rem',
                    minHeight: '64px',
                    borderRadius: '8px',
                    borderColor: isSelected ? 'var(--gold-primary)' : undefined,
                    boxShadow: isSelected ? '0 0 10px var(--gold-glow)' : undefined,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                  title={mission}
                >
                  <span>{displayInfo[mission]?.[lang] || mission}</span>
                  {faqData && (
                    <span 
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 'bold',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: 'rgba(203, 161, 53, 0.2)',
                        color: 'var(--gold-primary)',
                        border: '1px solid rgba(203, 161, 53, 0.4)'
                      }}
                    >
                      ⚡ FAQ
                    </span>
                  )}
                  {roundNum && (
                    <span 
                      className="mission-pill-badge"
                      style={{ width: '18px', height: '18px', fontSize: '10px', top: '-6px', right: '-6px' }}
                    >
                      {roundNum}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Modal 
        isOpen={!!selectedMission} 
        onClose={() => { setSelectedMission(null); setActivePdfUrl(null); }}
        title={selectedMission ? `${displayInfo[selectedMission]?.[lang] || selectedMission}` : ''}
        size="large"
      >
        <div className="pdf-modal-container" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          
          {/* CUADRO DESTACADO: ACTUALIZADO POR FAQ / ERRATA OFICIAL */}
          {selectedMission && scenarioFaqs[selectedMission] && (() => {
            const faq = scenarioFaqs[selectedMission];
            const info = faq[lang] || faq.es;
            const isErrata = faq.type === 'errata';
            
            return (
              <div
                style={{
                  background: isErrata 
                    ? 'linear-gradient(135deg, rgba(231, 76, 60, 0.16) 0%, rgba(30, 10, 10, 0.9) 100%)'
                    : 'linear-gradient(135deg, rgba(203, 161, 53, 0.16) 0%, rgba(25, 20, 10, 0.9) 100%)',
                  border: isErrata ? '1px solid rgba(231, 76, 60, 0.6)' : '1px solid rgba(203, 161, 53, 0.6)',
                  borderRadius: '12px',
                  padding: '14px 18px',
                  boxShadow: isErrata ? '0 4px 16px rgba(231, 76, 60, 0.2)' : '0 4px 16px rgba(0, 0, 0, 0.4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>{isErrata ? '🔴' : '⚡'}</span>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: isErrata ? '#ff7675' : 'var(--gold-primary)', fontFamily: 'var(--font-heading)', letterSpacing: '0.4px' }}>
                      {info.title}
                    </h4>
                  </div>
                  <span 
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      padding: '2px 10px',
                      borderRadius: '12px',
                      background: isErrata ? '#e74c3c' : 'var(--gold-primary)',
                      color: '#000'
                    }}
                  >
                    {isErrata ? (lang === 'es' ? 'ERRATA OFICIAL' : 'OFFICIAL ERRATA') : (lang === 'es' ? 'FAQ OFICIAL' : 'OFFICIAL FAQ')}
                  </span>
                </div>

                <div style={{ fontSize: '0.84rem', color: '#e2e8f0', fontWeight: '500' }}>
                  {info.summary}
                </div>

                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.82rem', color: 'rgba(255,255,255,0.9)', display: 'flex', flexDirection: 'column', gap: '5px', lineHeight: '1.45' }}>
                  {(info.points || []).map((pt, pIdx) => (
                    <li key={pIdx}>
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {activePdfUrl ? (
            <>
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
              <div style={{ textAlign: 'center', fontSize: '0.8rem' }}>
                <a 
                  href={activePdfUrl || '#'} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  style={{ color: 'var(--gold-primary)', textDecoration: 'underline' }}
                >
                  {lang === 'es' ? '¿Problemas con el visor? Abre el PDF directo' : 'Trouble viewing? Open PDF directly'}
                </a>
              </div>
            </>
          ) : (
            <div style={{
              textAlign: 'center', padding: '32px 16px', background: 'rgba(0,0,0,0.3)',
              borderRadius: '12px', border: '1px dashed rgba(203,161,53,0.4)', marginTop: '8px'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>📦</div>
              <h3 style={{ color: 'var(--gold-primary)', margin: '0 0 8px 0', fontSize: '1.15rem' }}>
                {lang === 'es' ? 'Mod de Misiones Requerido' : 'Missions Mod Required'}
              </h3>
              <p style={{ color: '#bbb', fontSize: '0.85rem', maxWidth: '480px', margin: '0 auto 18px auto', lineHeight: '1.5' }}>
                {lang === 'es'
                  ? 'La Cuchara de Lobelia es un motor neutral que no almacena ni distribuye archivos ni mapas de terceros sujetos a derechos de autor. Para visualizar el mapa de despliegue y el documento completo de este escenario, instala un Mod de Misiones compatible desde la sección Mods.'
                  : 'La Cuchara de Lobelia is a neutral engine that does not store or distribute third-party copyrighted materials or maps. To view the deployment map and official scenario document, please install a compatible Missions Mod in the Mods tab.'}
              </p>
              <button
                onClick={() => {
                  setSelectedMission(null);
                  setActivePdfUrl(null);
                  handleGoToMods();
                }}
                style={{
                  background: 'var(--gold-primary)', color: '#111', border: 'none', padding: '10px 22px',
                  borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.88rem', boxShadow: '0 4px 12px rgba(203,161,53,0.3)'
                }}
              >
                🧩 {lang === 'es' ? 'Ir a la Sección de Mods' : 'Go to Mods Section'}
              </button>
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
}
