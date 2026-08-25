// src/components/AiRulesWidget.jsx
import React, { useState, useEffect, useRef } from 'react';
import { 
  askRulesAi, 
  getRemainingAiQueries, 
  incrementAiUsage, 
  getApiKeysPool, 
  getAiDailyLimit, 
  subscribeToAppConfig 
} from '../utils/geminiRulesAi';
import { trackFeature } from '../utils/analyticsTracker';

const blobToBase64 = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

function AiMessageBubble({ msg, lang }) {
  const isUser = msg.sender === 'user';
  const isLong = (msg.text || '').length > 4000;
  const [expanded, setExpanded] = useState(!isLong);

  const displayText = (!isUser && isLong && !expanded)
    ? msg.text.slice(0, 3800) + '...'
    : msg.text;

  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: isUser ? '88%' : '98%',
        padding: '14px 18px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isUser 
          ? 'linear-gradient(135deg, rgba(203, 161, 53, 0.25), rgba(160, 120, 30, 0.2))' 
          : 'linear-gradient(135deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03))',
        border: isUser ? '1px solid rgba(203, 161, 53, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
        color: '#fff',
        fontSize: '0.92rem',
        lineHeight: '1.55',
        whiteSpace: 'pre-wrap',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: isUser ? '0 4px 15px rgba(203, 161, 53, 0.12)' : '0 4px 15px rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        transition: 'all 0.2s ease'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '0.75rem', color: isUser ? 'var(--gold-primary)' : 'var(--text-secondary)', fontWeight: 'bold', letterSpacing: '0.5px' }}>
          {isUser ? (lang === 'es' ? '👤 Tú' : '👤 You') : (lang === 'es' ? '🧙‍♂️ Lobelia: Tu referí de confianza' : '🧙‍♂️ Lobelia: Your Trusted Referee')}
        </span>
        {msg.hasAudio && (
          <span style={{ fontSize: '0.72rem', background: 'rgba(203, 161, 53, 0.2)', padding: '2px 8px', borderRadius: '12px', color: 'var(--gold-primary)' }}>
            🎙️ {lang === 'es' ? 'Nota de voz' : 'Voice note'}
          </span>
        )}
      </div>

      {msg.audioUrl && (
        <div style={{ marginTop: '2px', marginBottom: '4px' }}>
          <audio controls src={msg.audioUrl} style={{ width: '100%', height: '36px', borderRadius: '8px' }} />
        </div>
      )}

      {displayText && (
        <div style={{ color: isUser ? '#fefefe' : '#e2e8f0' }}>
          {displayText}
        </div>
      )}

      {!isUser && isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            alignSelf: 'flex-start',
            marginTop: '6px',
            background: 'rgba(203, 161, 53, 0.15)',
            border: '1px solid var(--gold-primary)',
            color: 'var(--gold-primary)',
            borderRadius: '8px',
            padding: '4px 12px',
            fontSize: '0.78rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {expanded ? (lang === 'es' ? '▲ Mostrar menos' : '▲ Show less') : (lang === 'es' ? '📖 Leer más...' : '📖 Read more...')}
        </button>
      )}

      {/* Descargo sutil de Transparencia de IA (Reglamento UE 2024/1689 Art. 50) */}
      {!isUser && (
        <div style={{
          marginTop: '6px',
          paddingTop: '6px',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          fontSize: '0.66rem',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          lineHeight: '1.25'
        }}>
          <span>🤖</span>
          <span>
            {lang === 'es'
              ? 'Contenido generado con IA (Reglamento UE 2024/1689). En torneos oficiales, la decisión final vinculante corresponde al árbitro humano del evento.'
              : 'AI-generated content (EU AI Act 2024/1689). In official tournaments, the tournament referee holds final authority.'}
          </span>
        </div>
      )}
    </div>
  );
}

export default function AiRulesWidget({ user, profile, lang, onOpenAuthModal }) {
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [aiDailyLimit, setAiDailyLimitState] = useState(getAiDailyLimit);
  const [adminUnlimited, setAdminUnlimited] = useState(false);
  const [remainingQueries, setRemainingQueries] = useState(() => getAiDailyLimit());

  const isAdminUser = profile?.isAdmin || profile?.isSuperAdmin;
  const isUnlimited = isAdminUser && adminUnlimited;

  // Escuchar configuración global de la App en tiempo real
  useEffect(() => {
    const unsubscribe = subscribeToAppConfig((config) => {
      if (config) {
        if (typeof config.aiDailyLimit === 'number' && config.aiDailyLimit > 0) {
          setAiDailyLimitState(config.aiDailyLimit);
        }
        if (typeof config.adminUnlimitedQueries === 'boolean') {
          setAdminUnlimited(config.adminUnlimitedQueries);
        }
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Estados para grabación de audio
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const shouldAutoSendRef = useRef(false);

  // Referencias para auto-scroll del chat
  const chatContainerRef = useRef(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = (behavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    }
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };

  // Auto-scroll cada vez que cambia el historial o el estado de carga
  useEffect(() => {
    scrollToBottom('smooth');
    const t1 = setTimeout(() => scrollToBottom('smooth'), 80);
    const t2 = setTimeout(() => scrollToBottom('smooth'), 250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [chatHistory, isLoading]);

  const [customApiKey, setCustomApiKey] = useState(() => {
    try {
      return localStorage.getItem('lobelia_gemini_key') || '';
    } catch (_) {
      return '';
    }
  });

  const hasAvailableKey = !!customApiKey || getApiKeysPool().length > 0;

  // Actualizar consultas restantes cuando cambia el usuario o el límite diario
  useEffect(() => {
    if (user) {
      if (isUnlimited) {
        setRemainingQueries(999);
      } else {
        setRemainingQueries(getRemainingAiQueries(user.uid, aiDailyLimit));
      }
    } else {
      setRemainingQueries(0);
    }
  }, [user, aiDailyLimit, isUnlimited]);

  // Manejar temporizador de grabación
  useEffect(() => {
    if (isRecording) {
      setRecordingSeconds(0);
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isRecording]);

  const submitAudioQuery = async (blob, url) => {
    if (!user) {
      if (onOpenAuthModal) onOpenAuthModal();
      return;
    }

    if (!isUnlimited && remainingQueries <= 0) {
      setErrorMessage(
        lang === 'es'
          ? `Has alcanzado el límite de ${aiDailyLimit} consultas diarias. ¡Vuelve mañana para seguir preguntando!`
          : `You have reached your ${aiDailyLimit} daily query limit. Come back tomorrow!`
      );
      return;
    }

    if (!hasAvailableKey) {
      setErrorMessage(
        lang === 'es'
          ? 'Por favor, introduce tu clave API de Gemini en Ajustes para activar el Referí de Reglas.'
          : 'Please enter your Gemini API key in Settings to activate the Rules Referee.'
      );
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    let audioBase64 = null;
    try {
      audioBase64 = await blobToBase64(blob);
    } catch (err) {
      console.error('Error convirtiendo audio a base64:', err);
    }

    const currentText = question.trim();
    const newHistory = [
      ...chatHistory,
      {
        sender: 'user',
        text: currentText,
        hasAudio: true,
        audioUrl: url
      }
    ];
    setChatHistory(newHistory);
    setQuestion('');
    setRecordingSeconds(0);

    try {
      const payload = {
        text: currentText,
        audioBase64: audioBase64,
        mimeType: blob ? blob.type : null
      };

      const answer = await askRulesAi(payload, customApiKey, chatHistory, lang, user?.uid);
      setChatHistory([...newHistory, { sender: 'ai', text: answer }]);
      incrementAiUsage(user.uid);
      trackFeature('ai_query', { hasAudio: true });
      setRemainingQueries(getRemainingAiQueries(user.uid));
    } catch (err) {
      console.error('Error in AI Rules Assistant:', err);
      setErrorMessage(err.message || (lang === 'es' ? 'Error al obtener respuesta de la IA.' : 'Error getting AI response.'));
    }

    setIsLoading(false);
  };

  const startRecording = async () => {
    if (!user) {
      if (onOpenAuthModal) onOpenAuthModal();
      return;
    }
    setErrorMessage('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      shouldAutoSendRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        if (shouldAutoSendRef.current) {
          const blob = new Blob(chunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          submitAudioQuery(blob, url);
        }
      };

      recorder.start(200);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error('Error al acceder al micrófono:', err);
      setErrorMessage(
        lang === 'es'
          ? 'No se pudo acceder al micrófono. Por favor, revisa los permisos de tu navegador.'
          : 'Could not access microphone. Please check browser permissions.'
      );
    }
  };

  const finishAndSendRecording = () => {
    shouldAutoSendRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const cancelRecording = () => {
    shouldAutoSendRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const formatSeconds = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleAsk = async (e) => {
    if (e) e.preventDefault();
    if (!question.trim() || isLoading) return;

    if (!user) {
      if (onOpenAuthModal) onOpenAuthModal();
      return;
    }

    if (!isUnlimited && remainingQueries <= 0) {
      setErrorMessage(
        lang === 'es'
          ? `Has alcanzado el límite de ${aiDailyLimit} consultas diarias. ¡Vuelve mañana para seguir preguntando!`
          : `You have reached your ${aiDailyLimit} daily query limit. Come back tomorrow!`
      );
      return;
    }

    if (!hasAvailableKey) {
      setErrorMessage(
        lang === 'es'
          ? 'Por favor, introduce tu clave API de Gemini en Ajustes para activar el Referí de Reglas.'
          : 'Please enter your Gemini API key in Settings to activate the Rules Referee.'
      );
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    const queryText = question.trim();
    const newHistory = [
      ...chatHistory,
      {
        sender: 'user',
        text: queryText,
        hasAudio: false
      }
    ];
    setChatHistory(newHistory);
    setQuestion('');

    try {
      const payload = {
        text: queryText,
        audioBase64: null,
        mimeType: null
      };

      const answer = await askRulesAi(payload, customApiKey, chatHistory, lang, user?.uid);
      setChatHistory([...newHistory, { sender: 'ai', text: answer }]);
      incrementAiUsage(user.uid);
      trackFeature('ai_query', { hasAudio: false });
      setRemainingQueries(getRemainingAiQueries(user.uid));
    } catch (err) {
      console.error('Error in AI Rules Assistant:', err);
      setErrorMessage(err.message || (lang === 'es' ? 'Error al obtener respuesta de la IA.' : 'Error getting AI response.'));
    }

    setIsLoading(false);
  };

  return (
    <div
      style={{
        background: 'linear-gradient(145deg, rgba(16, 28, 20, 0.95), rgba(24, 18, 12, 0.95))',
        border: '1px solid rgba(203, 161, 53, 0.6)',
        borderRadius: '20px',
        padding: '22px',
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        maxWidth: '850px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Luz ambiental dorada */}
      <div
        style={{
          position: 'absolute',
          top: '-60px',
          right: '-60px',
          width: '180px',
          height: '180px',
          background: 'radial-gradient(circle, rgba(203, 161, 53, 0.18) 0%, rgba(0,0,0,0) 70%)',
          pointerEvents: 'none',
          zIndex: 0
        }}
      />

      {/* Header del Widget */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, rgba(203, 161, 53, 0.25), rgba(0,0,0,0.4))',
              border: '1px solid var(--gold-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.8rem',
              boxShadow: '0 4px 12px rgba(203, 161, 53, 0.2)'
            }}
          >
            🧙‍♂️
          </div>
          <div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', color: 'var(--gold-primary)', fontSize: '1.25rem', letterSpacing: '0.6px', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
              {lang === 'es' ? 'Lobelia: Tu referí de confianza' : 'Lobelia: Your Trusted Referee'}
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {lang === 'es' ? 'Consultora oficial de reglas MESBG (Texto y Notas de voz)' : 'Official MESBG Rules AI (Text & Voice Notes)'}
            </span>
          </div>
        </div>

        {/* Badge de Consultas Diarias */}
        {user ? (
          <span
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              background: (isUnlimited || remainingQueries > 0) ? 'rgba(203, 161, 53, 0.15)' : 'rgba(231, 76, 60, 0.2)',
              border: (isUnlimited || remainingQueries > 0) ? '1px solid var(--gold-primary)' : '1px solid #e74c3c',
              color: (isUnlimited || remainingQueries > 0) ? 'var(--gold-primary)' : '#e74c3c',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
            }}
          >
            {isUnlimited 
              ? (lang === 'es' ? '⚡ Ilimitado (Admin)' : '⚡ Unlimited (Admin)')
              : `⚡ ${remainingQueries}/${aiDailyLimit} ${lang === 'es' ? 'consultas hoy' : 'queries today'}`
            }
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onOpenAuthModal}
            style={{ fontSize: '0.8rem', padding: '6px 14px' }}
          >
            🔒 {lang === 'es' ? `Inicia sesión para preguntar (${aiDailyLimit} gratis/día)` : `Log in to ask (${aiDailyLimit} free/day)`}
          </button>
        )}
      </div>

      {/* Historial de Respuestas */}
      {(chatHistory.length > 0 || isLoading) && (
        <div
          ref={chatContainerRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            maxHeight: '520px',
            overflowY: 'auto',
            padding: '16px',
            background: 'rgba(0, 0, 0, 0.35)',
            borderRadius: '14px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            zIndex: 1,
            scrollBehavior: 'smooth'
          }}
        >
          {chatHistory.map((msg, index) => (
            <AiMessageBubble key={index} msg={msg} lang={lang} />
          ))}

          {/* Indicador de pensamiento con animación */}
          {isLoading && (
            <div
              style={{
                alignSelf: 'flex-start',
                padding: '12px 18px',
                borderRadius: '16px 16px 16px 4px',
                background: 'linear-gradient(135deg, rgba(203, 161, 53, 0.18), rgba(255, 255, 255, 0.03))',
                border: '1px solid rgba(203, 161, 53, 0.4)',
                color: 'var(--gold-primary)',
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
                animation: 'pulse 1.5s infinite'
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>🧙‍♂️</span>
              <span>{lang === 'es' ? 'Lobelia está consultando la base de datos del mod de reglas activo...' : 'Lobelia is consulting active rules mod data...'}</span>
            </div>
          )}

          <div ref={messagesEndRef} style={{ height: '1px', width: '100%' }} />
        </div>
      )}

      {/* Estado de Grabación Activa con Botones Inmediatos */}
      {isRecording && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            background: 'rgba(231, 76, 60, 0.15)',
            border: '1px solid #e74c3c',
            borderRadius: '14px',
            animation: 'pulse 1.5s infinite',
            zIndex: 1,
            flexWrap: 'wrap',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '1.4rem', color: '#e74c3c' }}>🔴</span>
            <div>
              <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '0.92rem' }}>
                {lang === 'es' ? 'Grabando tu consulta de reglas...' : 'Recording your rule question...'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.75)' }}>
                ⏱️ {formatSeconds(recordingSeconds)} (Habla con claridad)
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {/* Botón CANCELAR: Borra el audio y limpia todo */}
            <button
              type="button"
              onClick={cancelRecording}
              style={{
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: '#fff',
                borderRadius: '20px',
                padding: '7px 14px',
                fontSize: '0.82rem',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              ❌ {lang === 'es' ? 'Cancelar y Borrar' : 'Cancel'}
            </button>

            {/* Botón FINALIZAR: Lanza la pregunta de inmediato */}
            <button
              type="button"
              onClick={finishAndSendRecording}
              style={{
                background: 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)',
                border: '1px solid #ff7675',
                color: '#fff',
                borderRadius: '20px',
                padding: '7px 18px',
                fontSize: '0.82rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: '0 2px 10px rgba(231, 76, 60, 0.4)',
                transition: 'all 0.2s'
              }}
            >
              🚀 {lang === 'es' ? 'Finalizar y Preguntar' : 'Finish & Ask'}
            </button>
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'center', width: '100%' }}>
            {lang === 'es' ? '🔒 El audio se procesa de forma efímera para la consulta y no se almacena.' : '🔒 Audio is processed ephemerally for the query and is not stored.'}
          </span>
        </div>
      )}

      {/* Formulario de Entrada (Texto y Micrófono) */}
      <form onSubmit={(e) => handleAsk(e)} style={{ display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 1 }}>
        <div style={{ position: 'relative', width: '100%' }}>
          <textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleAsk(e);
              }
            }}
            placeholder={
              !user
                ? (lang === 'es' ? 'Inicia sesión para consultar al Sabio...' : 'Log in to ask rules...')
                : isRecording
                  ? (lang === 'es' ? 'Grabando audio... Pulsa Finalizar para enviar o Cancelar para borrar.' : 'Recording audio... Click Finish to send.')
                  : (lang === 'es' ? 'Escribe aquí tu duda de reglas o pulsa el micro 🎙️ para enviar una nota de voz...' : 'Type your MESBG question or tap the mic 🎙️ for a voice note...')
            }
            disabled={isLoading || !user || remainingQueries <= 0 || isRecording}
            style={{
              width: '100%',
              padding: '14px 18px',
              paddingRight: '60px',
              borderRadius: '16px',
              border: '1px solid rgba(203, 161, 53, 0.35)',
              background: 'rgba(0, 0, 0, 0.45)',
              color: '#fff',
              fontSize: '0.95rem',
              lineHeight: '1.5',
              outline: 'none',
              resize: 'vertical',
              minHeight: '85px',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
              transition: 'border 0.2s ease, box-shadow 0.2s ease'
            }}
          />

          {/* Botón flotante de Micrófono */}
          <button
            type="button"
            onClick={isRecording ? finishAndSendRecording : startRecording}
            disabled={isLoading || !user || remainingQueries <= 0}
            title={isRecording ? (lang === 'es' ? 'Finalizar y preguntar' : 'Finish & send') : (lang === 'es' ? 'Grabar nota de voz' : 'Record voice note')}
            style={{
              position: 'absolute',
              right: '12px',
              top: '14px',
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: isRecording ? '#e74c3c' : 'rgba(203, 161, 53, 0.2)',
              border: isRecording ? '2px solid #fff' : '1px solid var(--gold-primary)',
              color: isRecording ? '#fff' : 'var(--gold-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.15rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: isRecording ? '0 0 12px #e74c3c' : '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            {isRecording ? '🚀' : '🎙️'}
          </button>
        </div>

        {/* Barra de Acciones Inferior */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {lang === 'es' ? '💡 Enter: Salto de línea | Ctrl+Enter: Enviar' : '💡 Enter: New line | Ctrl+Enter: Send'}
          </span>
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading || !question.trim() || !user || remainingQueries <= 0 || isRecording}
              style={{
                padding: '9px 28px',
                borderRadius: '25px',
                fontSize: '0.95rem',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isLoading ? (lang === 'es' ? 'Pensando...' : 'Thinking...') : (lang === 'es' ? '🧙‍♂️ Preguntar' : '🧙‍♂️ Ask')}
            </button>
          </div>
        </div>
      </form>

      {/* Mensaje de Error */}
      {errorMessage && (
        <div
          style={{
            background: 'rgba(231, 76, 60, 0.15)',
            border: '1px solid #e74c3c',
            color: '#ff9999',
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '0.85rem',
            textAlign: 'center',
            zIndex: 1
          }}
        >
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Configurar Clave API si no está preconfigurada en entorno */}
      {!import.meta.env.VITE_GEMINI_API_KEY && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.06)', zIndex: 1 }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>🔑 Gemini Key:</span>
          <input
            type="password"
            placeholder="AIzaSy..."
            value={customApiKey}
            onChange={(e) => {
              setCustomApiKey(e.target.value);
              try { localStorage.setItem('lobelia_gemini_key', e.target.value); } catch (_) {}
            }}
            style={{ padding: '4px 8px', borderRadius: '6px', border: 'var(--border-glass)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.75rem', flex: 1 }}
          />
        </div>
      )}
    </div>
  );
}
