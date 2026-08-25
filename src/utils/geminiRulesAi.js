import { db } from './firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { getRulesKnowledgeFromMod, getAiPromptFromMod } from './modManager';

const DEFAULT_MAX_DAILY_QUERIES = 30;
let cachedMaxDailyQueries = (() => {
  try {
    const val = localStorage.getItem('lobelia_ai_daily_limit');
    return val ? parseInt(val, 10) : DEFAULT_MAX_DAILY_QUERIES;
  } catch (_) {
    return DEFAULT_MAX_DAILY_QUERIES;
  }
})();

export function getAiDailyLimit() {
  return cachedMaxDailyQueries || DEFAULT_MAX_DAILY_QUERIES;
}

export function setAiDailyLimit(limit) {
  const num = parseInt(limit, 10);
  if (!isNaN(num) && num > 0) {
    cachedMaxDailyQueries = num;
    try {
      localStorage.setItem('lobelia_ai_daily_limit', num.toString());
    } catch (_) {}
  }
}

const ADMIN_CONFIG_UID = 'xXhjkWRjh0hVBjcYr2qAAFRvGL82';

// Escuchar cambios de configuración global en Firestore (con soporte dual para app_config/global y players/{adminUid})
export function subscribeToAppConfig(callback) {
  try {
    const adminDocRef = doc(db, 'players', ADMIN_CONFIG_UID);
    return onSnapshot(adminDocRef, (snap) => {
      if (snap.exists()) {
        const pData = snap.data();
        const config = pData.appConfig || {};
        if (config.aiDailyLimit && typeof config.aiDailyLimit === 'number') {
          setAiDailyLimit(config.aiDailyLimit);
        }
        if (callback) callback(config);
      } else {
        if (callback) callback({ aiDailyLimit: DEFAULT_MAX_DAILY_QUERIES });
      }
    }, (err) => {
      console.warn('[AppConfig] Error listening to admin config:', err);
      // Fallback a app_config/global
      try {
        const configDocRef = doc(db, 'app_config', 'global');
        return onSnapshot(configDocRef, (snap2) => {
          if (snap2.exists()) {
            const data = snap2.data();
            if (data.aiDailyLimit && typeof data.aiDailyLimit === 'number') {
              setAiDailyLimit(data.aiDailyLimit);
            }
            if (callback) callback(data);
          } else {
            if (callback) callback({ aiDailyLimit: cachedMaxDailyQueries });
          }
        }, () => {
          if (callback) callback({ aiDailyLimit: cachedMaxDailyQueries });
        });
      } catch (_) {
        if (callback) callback({ aiDailyLimit: cachedMaxDailyQueries });
      }
    });
  } catch (err) {
    console.warn('[AppConfig] Could not set up snapshot listener:', err);
    if (callback) callback({ aiDailyLimit: cachedMaxDailyQueries });
    return () => {};
  }
}

export function getRemainingAiQueries(userUid, customMax) {
  if (!userUid) return 0;
  const maxLimit = customMax || getAiDailyLimit();
  const today = new Date().toISOString().slice(0, 10);
  const key = `lobelia_ai_usage_${userUid}_${today}`;
  try {
    const used = parseInt(localStorage.getItem(key) || '0', 10);
    return Math.max(0, maxLimit - used);
  } catch (_) {
    return maxLimit;
  }
}

export function incrementAiUsage(userUid) {
  if (!userUid) return;
  const today = new Date().toISOString().slice(0, 10);
  const key = `lobelia_ai_usage_${userUid}_${today}`;
  try {
    const used = parseInt(localStorage.getItem(key) || '0', 10);
    localStorage.setItem(key, (used + 1).toString());
  } catch (_) {}
}

// Registro y estadísticas de uso por cada API Key individual
export function recordKeyUsage(keyIdx) {
  const today = new Date().toISOString().slice(0, 10);
  const dayKey = `lobelia_key_stats_${keyIdx}_${today}`;
  const totalKey = `lobelia_key_stats_${keyIdx}_total`;
  try {
    const dayCount = parseInt(localStorage.getItem(dayKey) || '0', 10);
    const totalCount = parseInt(localStorage.getItem(totalKey) || '0', 10);
    localStorage.setItem(dayKey, (dayCount + 1).toString());
    localStorage.setItem(totalKey, (totalCount + 1).toString());
  } catch (_) {}
}

export function getKeyUsageStats(customApiKey = '') {
  const keys = getApiKeysPool(customApiKey);
  const today = new Date().toISOString().slice(0, 10);

  return keys.map((k, idx) => {
    const dayKey = `lobelia_key_stats_${idx}_${today}`;
    const totalKey = `lobelia_key_stats_${idx}_total`;
    let todayQueries = 0;
    let totalQueries = 0;

    try {
      todayQueries = parseInt(localStorage.getItem(dayKey) || '0', 10);
      totalQueries = parseInt(localStorage.getItem(totalKey) || '0', 10);
    } catch (_) {}

    const masked = k.length > 10 
      ? `${k.slice(0, 7)}...${k.slice(-4)}`
      : 'Clave API';

    return {
      index: idx,
      maskedKey: masked,
      todayQueries,
      totalQueries,
      dailyCapacity: 1500,
      isActive: idx === activeKeyIndex,
      isPrimary: idx === 0
    };
  });
}

const STOP_WORDS = new Set([
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para', 'con',
  'no', 'una', 'su', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le', 'ya', 'o', 'este', 'sí', 'porque',
  'esta', 'son', 'entre', 'está', 'cuando', 'muy', 'sin', 'sobre', 'también', 'me', 'hasta', 'hay',
  'donde', 'quien', 'desde', 'todo', 'nos', 'durante', 'todos', 'uno', 'les', 'ni', 'contra', 'otros',
  'the', 'of', 'and', 'to', 'in', 'is', 'it', 'you', 'that', 'he', 'was', 'for', 'on', 'are', 'as',
  'with', 'his', 'they', 'at', 'be', 'this', 'have', 'from', 'or', 'one', 'had', 'by', 'word', 'but'
]);

// Diccionario bidireccional español <-> inglés para términos clave de MESBG y ontología de estados
const MESBG_TRANSLATIONS = {
  // Español -> Inglés
  'monstruo': 'monster monsters monstrous brutal power attack rend hurl barge trample',
  'monstruos': 'monsters monstrous brutal power attack',
  'monstruosa': 'monstrous monster',
  'monstruoso': 'monstrous monster',
  'carga': 'charge charges charging control zone',
  'cargas': 'charges charge charging',
  'cargando': 'charging charge',
  'caballeria': 'cavalry horse mount mounted charge bonus extra attack knockdown',
  'caballería': 'cavalry horse mount mounted charge bonus extra attack knockdown',
  'caballo': 'horse cavalry mount',
  'montura': 'mount horse cavalry warg fell beast',
  'montado': 'mounted cavalry rider',
  'combate': 'fight combat duel strike duel roll fight value',
  'combates': 'fights combats duel strikes',
  'disparo': 'shoot shooting missile bow archery in the way line of sight',
  'disparos': 'shooting missile bows archery in the way',
  'arco': 'bow missile archery shooting',
  'arcos': 'bows missile archery shooting',
  'lanza': 'spear spears support supporting base contact line of sight',
  'lanzas': 'spears spear support supporting',
  'pica': 'pike pikes support supporting two ranks',
  'picas': 'pikes pike support supporting',
  'escudo': 'shield shields shielding defence bonus',
  'escudos': 'shields shield shielding',
  'armadura': 'armour armor heavy defence',
  'heroe': 'hero heroes might will fate heroic tier leader captain',
  'héroe': 'hero heroes might will fate heroic tier leader captain',
  'heroes': 'heroes hero',
  'héroes': 'heroes hero',
  'poder': 'might heroic action point point of might',
  'voluntad': 'will magic spell cast resist',
  'destino': 'fate wound save wound prevention',
  'herida': 'wound wounds casualty casualties slain death',
  'heridas': 'wounds wound casualty casualties slain',
  'agallas': 'courage valor stand fast bravery test',
  'coraje': 'courage valor bravery test',
  'desmoronamiento': 'break broken point break-point 50% casualties starting army',
  'desmoronado': 'broken break 50% courage test',
  'panico': 'panic courage test',
  'terror': 'terror courage charge test charge test',
  'caudillo': 'chieftain captain hero leader',
  'lider': 'leader general hero valour legend fortitude',
  'líder': 'leader general hero valour legend fortitude',
  'magia': 'magic spell spells cast casting resist will',
  'hechizo': 'spell spells magic cast range',
  'hechizos': 'spells spell magic cast',
  'volar': 'fly flying fly-move terrain',
  'arrollar': 'barge hurl rend trample brutal power attack',
  'derribado': 'prone knocked down stand up combat trapped strikes doubled',
  'suelo': 'prone knocked down stand up',
  'atrapado': 'trapped backing away make way double strikes',
  'atrapar': 'trapped backing away double strikes',
  'apoyo': 'support supporting spear pike base contact',
  'apoyar': 'support supporting spear pike base contact',
  'movimiento': 'move movement advance charge difficult terrain',
  'mover': 'move movement advance',
  'prioridad': 'priority initiative priority roll roll-off',
  'iniciativa': 'priority initiative priority roll',
  'tumulario': 'barrow wight barrow-wight paralysed immobilise',
  'tumularios': 'barrow wight barrow-wights paralysed',
  'paralizar': 'paralyse paralyze immobilise transfix spell cannot use might will fate fight 1',
  'paralisis': 'paralyse paralyze immobilise transfix spell cannot use might will fate fight 1',
  'parálisis': 'paralyse paralyze immobilise transfix spell cannot use might will fate fight 1',
  'espectro': 'spectre spectres angmar a ghostly weapon',
  'espectros': 'spectres spectre angmar',
  'sombra': 'shade shades angmar chill aura',
  'sombras': 'shades shade angmar',
  'licantropo': 'werewolf werewolves angmar',
  'licántropo': 'werewolf werewolves angmar',
  'licantropos': 'werewolves werewolf angmar',
  'licántropos': 'werewolves werewolf angmar',
  'transfix': 'transfix inmovilizar immobilise paralyse fight 1 no actions',
  'inmovilizar': 'transfix immobilise paralyse fight 1 no actions',
  'inmovilizado': 'transfix immobilised paralyse fight 1 no actions',
  'pega': 'fight attacks strength combat strike',
  'pegar': 'fight attacks strength combat strike',
  'mueve': 'move movement distance',
  'gulavhar': 'gulavhar gûlavhar terror arnor wounds attacks',
  'buhrdur': 'buhrdur buhrdûr troll chieftain',
  'saruman': 'saruman blanco white council isengard voice palantir',
  'palantir': 'palantir saruman priority active special rules battlefield',
  'palantír': 'palantir saruman priority active special rules battlefield',
  'maelstrom': 'maelstrom of battle deployment reinforcements reserves active special rules battlefield entry',
  'refuerzos': 'reinforcements arriving reserve board edge active special rules battlefield',
  'reservas': 'reserves reinforcement deployment arriving active rules',
  'estandarte': 'banner banners 3 re-roll duel roll duel aura',
  'estandartes': 'banners banner 3 re-roll duel roll',
  'aura': 'aura bubbles radius banner area of effect range',
  'cobertura': 'in the way obstacle intervening models line of sight',
  'despliegue': 'deployment deploy maelstrom setup starting position',
  'arma a dos manos': 'two-handed weapon two handed -1 to duel roll +1 to wound',
  'dos manos': 'two-handed two handed weapon -1 duel +1 wound',
  // English -> Español
  'spell': 'hechizo magia lanzamiento poder magico',
  'spells': 'hechizos magia poderes magicos',
  'cast': 'lanzar lanzamiento magia hechizo',
  'casting': 'lanzamiento lanzar magia',
  'magic': 'magia hechizo hechizos voluntad',
  'cavalry': 'caballería caballo montura carga',
  'mount': 'montura caballo bestia alada huargo',
  'mounted': 'montado caballería jinete',
  'wound': 'herida herir heridas destino',
  'wounds': 'heridas herida destino',
  'shoot': 'disparo disparar proyectil arco',
  'shooting': 'disparo disparos arquería',
  'bow': 'arco arcos disparo',
  'spear': 'lanza lanzas apoyo apoyar',
  'spears': 'lanzas lanza apoyo',
  'shield': 'escudo escudos escudarse',
  'trapped': 'atrapado retroceder doblar golpes',
  'courage': 'agallas coraje chequeo valor',
  'might': 'poder heroico punto de poder',
  'will': 'voluntad magia resistir',
  'fate': 'destino salvar herida',
  'broken': 'desmoronado desmoronamiento break point 50%',
  'charge': 'carga cargar combate trabado',
  'strike': 'golpe golpear herir combate',
  'saruman': 'saruman blanco white council isengard voice palantir',
  'palantir': 'palantir saruman priority active special rules battlefield',
  'palantír': 'palantir saruman priority active special rules battlefield',
  'maelstrom': 'maelstrom of battle deployment reinforcements reserves active special rules battlefield entry',
  'refuerzos': 'reinforcements arriving reserve board edge active special rules battlefield',
  'reservas': 'reserves reinforcement deployment arriving active rules',
  'prone': 'derribado en el suelo no dispara no apoya',
  'reinforcements': 'refuerzos reservas despliegue maelstrom fuera de mesa',
  'banner': 'estandarte repetir dado 1'
};

function normalizeQuery(q) {
  let text = (q || '').toLowerCase();
  text = text.replace(/\b1\b/g, '1 uno one');
  text = text.replace(/\b2\b/g, '2 dos two');
  text = text.replace(/\b3\b/g, '3 tres three');
  text = text.replace(/\b4\b/g, '4 cuatro four');
  text = text.replace(/\b5\b/g, '5 cinco five');
  text = text.replace(/\b6\b/g, '6 seis six');
  return text;
}

/**
 * Construye el Canon Inteligente Completo de Reglas para Grounding sin recortes erróneos.
 * Incluye SIEMPRE el 100% de las Reglas Base (Combate, Lanzas, Movimiento, etc.),
 * el 100% de las FAQs oficiales y las reglas de ejército/perfiles relevantes.
 */
function buildGroundedContext(queryText, uid = null) {
  const activeKnowledge = getRulesKnowledgeFromMod(uid);

  if (!activeKnowledge || activeKnowledge.length === 0) {
    return '';
  }

  const queryLower = normalizeQuery(queryText);
  
  // 1. REGLAMENTO PRINCIPAL: Siempre incluido al 100% (Núcleo de Combate, Apoyo, Disparo, Magia, etc.)
  const coreRules = activeKnowledge.filter(doc => doc.category === 'Reglamento Principal');

  // 2. FAQS & ERRATAS OFICIALES: Siempre incluidas al 100% (Prioridad legal suprema)
  const faqs = activeKnowledge.filter(doc => doc.category === 'FAQ & Erratas');

  // 3. REGLAS DE EJÉRCITO Y PERFILES ESPECÍFICOS:
  // Identifica términos de facciones, héroes o reglas de lista mencionadas en la consulta
  const nonCorePages = activeKnowledge.filter(doc => doc.category !== 'Reglamento Principal' && doc.category !== 'FAQ & Erratas');
  
  // Filtrar páginas de ejército relevantes con scoring semántico
  const queryTerms = queryLower.replace(/[^\wáéíóúñü]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t));
  
  const relevantArmies = nonCorePages.filter(doc => {
    const contentLower = (doc.content || '').toLowerCase();
    const bookLower = (doc.book || '').toLowerCase();

    // Siempre incluir páginas que declaren "SPECIAL RULES" o reglas de lista si hay coincidencia temática
    if (queryLower.includes('saruman') && (contentLower.includes('saruman') || contentLower.includes('palantir') || contentLower.includes('isengard'))) return true;
    if ((queryLower.includes('five') || queryLower.includes('cinco')) && (contentLower.includes('five armies') || contentLower.includes('stand together') || doc.page == 106 || doc.page == 105)) return true;
    if ((queryLower.includes('mumak') || queryLower.includes('mûmak') || queryLower.includes('harad')) && (contentLower.includes('mumak') || contentLower.includes('harad') || contentLower.includes('war beast') || doc.page >= 192)) return true;
    if (queryLower.includes('rohan') && (contentLower.includes('rohan') || contentLower.includes('theoden') || contentLower.includes('riders of theoden'))) return true;
    if ((queryLower.includes('mordor') || queryLower.includes('nazgul') || queryLower.includes('nazgûl')) && (contentLower.includes('mordor') || contentLower.includes('witch-king'))) return true;
    if (queryLower.includes('gondor') && (contentLower.includes('minas tirith') || contentLower.includes('gondor') || contentLower.includes('boromir'))) return true;

    // Coincidencias por términos generales
    let matchCount = 0;
    for (const term of queryTerms) {
      if (contentLower.includes(term) || bookLower.includes(term)) {
        matchCount++;
      }
    }
    return matchCount >= 2;
  }).slice(0, 30); // Limitar perfiles adicionales para no sobrecargar el token budget

  const sections = [
    '=== BASE DE REGLAS DEL MOD ACTIVO ===\n' + 
      coreRules.map(p => `[p.${p.page || '-'}] ${p.content}`).join('\n\n'),
    '=== FAQS Y ERRATAS DEL MOD ACTIVO ===\n' + 
      faqs.map(p => `[FAQ ${p.book || ''} p.${p.page || '-'}] ${p.content}`).join('\n\n'),
    '=== REGLAS ESPECÍFICAS Y PERFILES DEL MOD ACTIVO ===\n' + 
      relevantArmies.map(p => `[${p.book || ''} p.${p.page || '-'}] ${p.content}`).join('\n\n')
  ];

  return sections.join('\n\n');
}

const SYSTEM_INSTRUCTION_ES = `
Eres Lobelia: Tu referí de confianza, consultora y árbitra lúdica para partidas y juegos de estrategia de miniaturas. Tu objetivo es resolver dudas de reglas de forma clara, amigable y rigurosa basándote en la base de datos del mod de reglas activo.
Tu cometido es resolver consultas de reglas con máxima fidelidad, claridad y precisión, basándote en los libros oficiales, perfiles y Erratas/FAQs proporcionadas.

ESTRUCTURA OBLIGATORIA DE RESPUESTA EN DOS BLOQUES:
Para garantizar la máxima precisión y una respuesta limpia para el usuario, DEBES estructurar tu salida obligatoriamente en estas dos etiquetas XML:

<analisis_interno>
Borrador mental breve y conciso (máximo 4 a 6 líneas) donde verificas:
1. Posición y estado de las miniaturas según la regla consultada.
2. Texto exacto del reglamento o FAQ aplicable.
3. Conclusión técnica.
</analisis_interno>

<dictamen>
Aquí redactas la respuesta final que leerá el usuario:
- Responde directamente a la pregunta con lenguaje natural, claro y sin florituras ni títulos teatrales (ej: "No, ninguno de los dos puede repetir los 1s para herir." o "Sí, pueden hacerlo...").
- Explica de forma concisa y sencilla el porqué según el reglamento (1 o 2 párrafos cortos).
- Fuentes citadas:
📚 Fuentes citadas:
- 📖 [Official Book Name in English, ej: Rules Manual] | Sección: [Nombre] | Pág. [Número]
</dictamen>

NORMAS DE COMUNICACIÓN:
1. Lenguaje 100% natural, directo y en el idioma del usuario (español si escribe en español; inglés si escribe en inglés).
2. Cero relleno, sin saludos innecesarios ni dramatizaciones.
3. Basa todas tus resoluciones y cálculos estrictamente en el texto del reglamento y FAQs aportados.
`;

const SYSTEM_INSTRUCTION_EN = `
You are Lobelia: The Supreme Official Rules Referee and Arbitrator for miniature wargames.
Your mission is to resolve rules queries with maximum fidelity, clarity, and precision, based on the official rulebooks, profiles, and Erratas/FAQs provided.

MANDATORY TWO-BLOCK XML RESPONSE STRUCTURE:
To guarantee maximum accuracy and a clean final output for the player, your response MUST be structured in two XML blocks:

<internal_analysis>
Short mental scratchpad (max 4 to 6 lines) verifying:
1. Model state, position, and conditions according to the queried rule.
2. Exact verbatim wording of the applicable rulebook or FAQ.
3. Technical conclusion.
</internal_analysis>

<ruling>
Write the clean, final answer that the player will read:
- Answer the question directly with clear, natural language without theatrical titles (e.g. "No, neither model can re-roll 1s to wound." or "Yes, they can...").
- Explain concisely and simply why according to the rules (1 or 2 short paragraphs).
- Cited sources:
📚 Cited sources:
- 📖 [Official Book Name in English, e.g. Rules Manual] | Section: [Name] | Page [Number]
</ruling>

COMMUNICATION RULES:
1. 100% natural and direct language in English.
2. Zero fluff, no filler greetings.
3. Base all rulings and calculations strictly on the provided rulebooks and FAQs.
`;

/**
 * Extracts the clean official ruling from the model's output, stripping internal reasoning scratchpad.
 */
export function parseOfficialRuling(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  // 1. Extraer contenido de <dictamen> o <ruling> si está cerrado
  const match = rawText.match(/<(?:dictamen|ruling)>([\s\S]*?)<\/(?:dictamen|ruling)>/i);
  if (match && match[1].trim()) {
    return match[1].trim();
  }

  // 2. Si <dictamen> o <ruling> fue abierto pero no cerrado
  const openMatch = rawText.match(/<(?:dictamen|ruling)>([\s\S]*)/i);
  if (openMatch && openMatch[1].trim()) {
    return openMatch[1].trim();
  }

  // 3. Fallback: eliminar cualquier bloque <analisis_interno> (esté cerrado o abierto)
  let cleaned = rawText
    .replace(/<(?:analisis_interno|internal_analysis|thinking|scratchpad)>[\s\S]*?(?:<\/(?:analisis_interno|internal_analysis|thinking|scratchpad)>|$)/gi, '')
    .replace(/<\/?(?:dictamen|ruling|analisis_interno|internal_analysis)>/gi, '')
    .trim();

  return cleaned || rawText.trim();
}

const CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-pro-latest'
];

let activeKeyIndex = 0;

/**
 * Returns available Gemini API keys pool from env or custom key.
 */
export function getApiKeysPool(customApiKey = '') {
  if (customApiKey && customApiKey.trim()) {
    return [customApiKey.trim()];
  }

  const rawEnvKeys = import.meta.env.VITE_GEMINI_API_KEYS || import.meta.env.VITE_GEMINI_API_KEY || '';
  const parsedKeys = rawEnvKeys
    .split(/[,;\n]+/)
    .map(k => k.trim())
    .filter(k => k.length > 10);

  return parsedKeys.length > 0 ? parsedKeys : [];
}

/**
 * Queries Gemini API with Grounded Rule Knowledge from official PDFs (supports text and audio).
 * Automatically rotates and falls back across API keys pool on quota/rate limit errors.
 */
export async function askRulesAi(input, customApiKey = '', conversationHistory = [], lang = 'es', uid = null) {
  const isEnglish = (lang === 'en' || lang === 'EN');

  const keysPool = getApiKeysPool(customApiKey);

  if (keysPool.length === 0) {
    throw new Error('No se ha configurado ninguna clave API de Gemini (VITE_GEMINI_API_KEY).');
  }

  const queryText = typeof input === 'string' ? input : (input?.text || '');
  const audioBase64 = typeof input === 'object' ? input?.audioBase64 : null;
  const mimeType = typeof input === 'object' ? (input?.mimeType || 'audio/webm') : null;

  // Construir contexto con datos del mod de reglas activo
  const contextSnippet = buildGroundedContext(queryText, uid);

  if (!contextSnippet) {
    return isEnglish
      ? `🧙‍♂️ **Lobelia**: In order to answer rules questions and adjudicate game situations, please import and activate a **Rules / AI Referee Mod** in the **Mods** tab (🧩).\n\nLa Cuchara de Lobelia is an open engine that processes only the data and mods you import locally onto your device.`
      : `🧙‍♂️ **Lobelia**: Para poder resolver dudas de reglas e interpretar situaciones de juego, necesitas importar y activar un **Mod de Reglas / Árbitro IA** en la sección **Mods** (🧩).\n\nLa Cuchara de Lobelia es un motor abierto que procesa únicamente los datos y mods que importas localmente en tu dispositivo.`;
  }

  const userPromptWithContext = isEnglish
    ? `
<ACTIVE_RULES_MOD_KNOWLEDGE_BASE>
${contextSnippet}
</ACTIVE_RULES_MOD_KNOWLEDGE_BASE>

[CRITICAL INSTRUCTION - ANSWER 100% IN ENGLISH]
1. Write your ENTIRE response in ENGLISH.
2. Translate all book/section names into English.
3. Do NOT output any Spanish text.

[PLAYER'S QUESTION]
${queryText ? `"${queryText}"` : 'Please resolve the player\'s rules question in English.'}
`
    : `
<BASE_DE_CONOCIMIENTO_MOD_REGLAS_ACTIVO>
${contextSnippet}
</BASE_DE_CONOCIMIENTO_MOD_REGLAS_ACTIVO>

[DIRECTRIZ CRÍTICA DE IDIOMA Y RESOLUCIÓN]
1. Identifica el idioma del usuario y responde exclusivamente en ese mismo idioma.
2. Incluye fuentes citadas en el mismo idioma de la respuesta.

[CONSULTA DEL JUGADOR]
${queryText ? `"${queryText}"` : 'Resuelve la duda de reglas planteada.'}
`;

  const userParts = [];
  if (audioBase64 && mimeType) {
    userParts.push({ inlineData: { mimeType: mimeType.split(';')[0], data: audioBase64 } });
  }
  userParts.push({ text: userPromptWithContext });

  const modCustomPrompt = getAiPromptFromMod(uid);
  const baseSystemPrompt = isEnglish ? SYSTEM_INSTRUCTION_EN : SYSTEM_INSTRUCTION_ES;
  const finalSystemPrompt = modCustomPrompt
    ? `${baseSystemPrompt}\n\n[DIRECTIVA DE PERSONALIDAD Y ÁRBITRO DEL MOD ACTIVO]\n${modCustomPrompt}`
    : baseSystemPrompt;

  const payload = {
    system_instruction: {
      parts: [{ text: finalSystemPrompt }]
    },
    contents: [...conversationHistory.map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text || '' }]
    })), { role: 'user', parts: userParts }],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 4000
    }
  };

  let lastError = null;

  for (let attempt = 0; attempt < keysPool.length; attempt++) {
    const currentKeyIdx = (activeKeyIndex + attempt) % keysPool.length;
    const apiKey = keysPool[currentKeyIdx];

    for (const model of CANDIDATE_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${response.status}`;
          
          if (response.status === 404 || response.status === 503 || errMsg.includes('not found') || errMsg.includes('UNAVAILABLE')) {
            console.warn(`[GeminiRulesAi] Modelo ${model} no disponible, probando siguiente...`);
            continue;
          }

          if (response.status === 429 || errMsg.includes('quota') || errMsg.includes('exhausted')) {
            lastError = new Error(`Cuota agotada en clave #${currentKeyIdx + 1}: ${errMsg}`);
            break; 
          }
          throw new Error(`Error: ${errMsg}`);
        }

        const data = await response.json();
        const rawResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawResponse) throw new Error('Respuesta vacía.');

        activeKeyIndex = currentKeyIdx;
        recordKeyUsage(currentKeyIdx);
        return parseOfficialRuling(rawResponse);
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw new Error(`No se pudo obtener respuesta tras intentar con las claves: ${lastError?.message}`);
}
