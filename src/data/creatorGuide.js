// src/data/creatorGuide.js
// ─────────────────────────────────────────────────────────────────────────────
// Manual Oficial y Plantillas para Creadores de Mods de La Cuchara de Lobelia
// Guía Exhaustiva Paso a Paso: Módulo 1 (Misiones) y Módulo 2 (Árbitro IA)
// ─────────────────────────────────────────────────────────────────────────────

export const CREATOR_GUIDE_MD = `# 📚 Manual Oficial para Creadores de Mods
### La Cuchara de Lobelia — Motor Neutral v3.0 (Schema v1.0)

Bienvenido a la guía oficial para creadores de la comunidad de **La Cuchara de Lobelia**.

La aplicación opera como un **motor neutral y abierto**: no contiene reglas ni documentos propietarios dentro de sus servidores. Son los aficionados, clubes y organizadores de torneos quienes crean y comparten paquetes de datos mediante **enlaces públicos externos** (como GitHub, Gist o Pastebin).

---

## 🎯 Los 2 Módulos Principales de la Comunidad

1. **🎲 MÓDULO 1: Mod de Misiones & Visor de Mapas** (Escenarios 1v1 y 2v2, soporte online y descarga 100% Offline para torneos).
2. **🤖 MÓDULO 2: Mod de Árbitro IA** (Base de conocimiento indexada de reglas, suplementos, preguntas frecuentes y aclaraciones para el asistente consultivo).

*(El módulo de Constructor de Listas de Ejército queda reservado para futuras fases del proyecto).*

---

# 🎲 GUÍA 1: CÓMO CREAR UN MOD DE MISIONES Y ESCENARIOS

Un mod de misiones permite a los jugadores y torneos:
* Utilizar el **Selector Aleatorio de Misiones de Torneo** (Pools de Misiones).
* Abrir el **Visor de Mapas y Despliegue en PDF** en español e inglés directamente desde la app.
* **Descarga 100% Offline:** Guardar todos los PDFs en la memoria del navegador del móvil (IndexedDB) para jugar en sótanos o lugares sin cobertura.

---

### 📂 Paso 1.1: Estructura de Carpetas en tu Repositorio (GitHub)

Crea un repositorio público en [GitHub.com](https://github.com) con la siguiente estructura exacta:

\`\`\`text
📁 mi-pack-misiones/
│
├── 📄 mod-misiones.json          <-- Archivo de configuración en la RAÍZ
│
└── 📁 pdfs/                      <-- Carpeta principal de documentos PDF
    ├── 📄 DOMINATION_ES.pdf      <-- Misiones 1v1 van en la raíz de pdfs/
    ├── 📄 DOMINATION_EN.pdf
    ├── 📄 TO THE DEATH!_ES.pdf
    ├── 📄 TO THE DEATH!_EN.pdf
    ├── 📄 HOLD GROUND_ES.pdf
    ├── 📄 HOLD GROUND_EN.pdf
    ├── ... (resto de misiones 1v1)
    │
    └── 📁 2vs2/                  <-- Subcarpeta OBLIGATORIA para misiones 2vs2
        ├── 📄 NO ESCAPE_ES.pdf
        ├── 📄 NO ESCAPE_EN.pdf
        ├── 📄 TOTAL CONQUEST_ES.pdf
        ├── 📄 TOTAL CONQUEST_EN.pdf
        ├── 📄 TAKE & HOLD_ES.pdf
        ├── 📄 TAKE & HOLD_EN.pdf
        ├── 📄 CLASH OF CHAMPIONS_ES.pdf
        ├── 📄 CLASH OF CHAMPIONS_EN.pdf
        ├── 📄 CORNERED_ES.pdf
        ├── 📄 CORNERED_EN.pdf
        ├── 📄 DUEL OF WITS_ES.pdf
        └── 📄 DUEL OF WITS_EN.pdf
\`\`\`

> 💡 **Regla fundamental:**
> * Los PDFs de las misiones individuales (1v1) se colocan sueltos dentro de \`pdfs/\`.
> * Los PDFs de las misiones por parejas (2vs2) se colocan dentro de \`pdfs/2vs2/\`.

---

### 🏷️ Paso 1.2: Tabla Oficial de Claves de Misión

El motor de La Cuchara de Lobelia reconoce exactamente las siguientes claves en el JSON:

#### ⚔️ Misiones 1 vs 1 (24 Escenarios en \`pdfs/\`):
| Clave de Misión en JSON | Nombre Archivo Español (\`fileEs\`) | Nombre Archivo Inglés (\`fileEn\`) |
| :--- | :--- | :--- |
| \`"Domination"\` | \`DOMINATION_ES.pdf\` | \`DOMINATION_EN.pdf\` |
| \`"To the Death!"\` | \`TO THE DEATH!_ES.pdf\` | \`TO THE DEATH!_EN.pdf\` |
| \`"Hold Ground"\` | \`HOLD GROUND_ES.pdf\` | \`HOLD GROUND_EN.pdf\` |
| \`"Destroy the Supplies"\` | \`DESTROY THE SUPPLIES_ES.pdf\` | \`DESTROY THE SUPPLIES_EN.pdf\` |
| \`"Reconnoitre"\` | \`RECONNOITRE_ES.pdf\` | \`RECONNOITRE_EN.pdf\` |
| \`"Fog of War"\` | \`FOG OF WAR_ES.pdf\` | \`FOG OF WAR_EN.pdf\` |
| \`"Capture & Control"\` | \`CAPTURE & CONTROL_ES.pdf\` | \`CAPTURE & CONTROL_EN.pdf\` |
| \`"Breakthrough"\` | \`BREAKTHROUGH_ES.pdf\` | \`BREAKTHROUGH_EN.pdf\` |
| \`"Stake a Claim"\` | \`STAKE A CLAIM_ES.pdf\` | \`STAKE A CLAIM_EN.pdf\` |
| \`"Lords of Battle"\` | \`LORDS OF BATTLE_ES.pdf\` | \`LORDS OF BATTLE_EN.pdf\` |
| \`"Assassination"\` | \`ASSASSINATION_ES.pdf\` | \`ASSASSINATION_EN.pdf\` |
| \`"Contest of Champions"\` | \`CONTEST OF CHAMPIONS_ES.pdf\` | \`CONTEST OF CHAMPIONS_EN.pdf\` |
| \`"Heirloom of Ages Past"\` | \`HEIRLOOM OF AGES PAST_ES.pdf\` | \`HEIRLOOM OF AGES PAST_EN.pdf\` |
| \`"Sites of Power"\` | \`SITES OF POWER_ES.pdf\` | \`SITES OF POWER_EN.pdf\` |
| \`"Command the Battlefield"\`| \`COMMAND THE BATTLEFIELD_ES.pdf\`| \`COMMAND THE BATTLEFIELD_EN.pdf\`|
| \`"Retrieval"\` | \`RETRIEVAL_ES.pdf\` | \`RETRIEVAL_EN.pdf\` |
| \`"Seize the Prizes"\` | \`SEIZE THE PRIZES_ES.pdf\` | \`SEIZE THE PRIZES_EN.pdf\` |
| \`"Treasure Hoard"\` | \`TREASURE HOARD_ES.pdf\` | \`TREASURE HOARD_EN.pdf\` |
| \`"Storm the Camp"\` | \`STORM THE CAMP_ES.pdf\` | \`STORM THE CAMP_EN.pdf\` |
| \`"Divide & Conquer"\` | \`DIVIDE & CONQUER_ES.pdf\` | \`DIVIDE & CONQUER_EN.pdf\` |
| \`"Escort the Wounded"\` | \`ESCORT THE WOUNDED_ES.pdf\` | \`ESCORT THE WOUNDED_EN.pdf\` |
| \`"Clash by Moonlight"\` | \`CLASH BY MOONLIGHT_ES.pdf\` | \`CLASH BY MOONLIGHT_EN.pdf\` |
| \`"Lead from the Front"\` | \`LEAD FROM THE FRONT_ES.pdf\` | \`LEAD FROM THE FRONT_EN.pdf\` |
| \`"Convergence"\` | \`CONVERGENCE_ES.pdf\` | \`CONVERGENCE_EN.pdf\` |

#### 🛡️ Misiones 2 vs 2 (6 Escenarios en \`pdfs/2vs2/\`):
| Clave de Misión en JSON | Nombre Archivo Español (\`fileEs\`) | Nombre Archivo Inglés (\`fileEn\`) |
| :--- | :--- | :--- |
| \`"No Escape"\` | \`2vs2/NO ESCAPE_ES.pdf\` | \`2vs2/NO ESCAPE_EN.pdf\` |
| \`"Total Conquest"\` | \`2vs2/TOTAL CONQUEST_ES.pdf\` | \`2vs2/TOTAL CONQUEST_EN.pdf\` |
| \`"Take & Hold"\` | \`2vs2/TAKE & HOLD_ES.pdf\` | \`2vs2/TAKE & HOLD_EN.pdf\` |
| \`"Clash of Champions"\` | \`2vs2/CLASH OF CHAMPIONS_ES.pdf\` | \`2vs2/CLASH OF CHAMPIONS_EN.pdf\` |
| \`"Cornered"\` | \`2vs2/CORNERED_ES.pdf\` | \`2vs2/CORNERED_EN.pdf\` |
| \`"Duel of Wits"\` | \`2vs2/DUEL OF WITS_ES.pdf\` | \`2vs2/DUEL OF WITS_EN.pdf\` |

---

### 📄 Paso 1.3: Plantilla del Archivo \`mod-misiones.json\`

\`\`\`json
{
  "modId": "pack-misiones-torneo-2026",
  "modName": "Pack Oficial de Misiones y Torneos 2026",
  "modVersion": "1.0.0",
  "modAuthor": "Tu Nombre o Club",
  "gameSystem": "MESBG",
  "schemaVersion": "1.0",
  "description": "24 escenarios 1v1 y 6 escenarios 2v2 con mapas detallados de despliegue y objetivos.",
  "capabilities": ["missions"],
  "tags": ["misiones", "mapas", "escenarios", "torneo"],
  "missionPdfs": {
    "baseUrl": "https://raw.githubusercontent.com/TU_USUARIO/TU_REPOSITORIO/main/pdfs/",
    "missions1v1": {
      "Domination": { "fileEs": "DOMINATION_ES.pdf", "fileEn": "DOMINATION_EN.pdf" },
      "To the Death!": { "fileEs": "TO THE DEATH!_ES.pdf", "fileEn": "TO THE DEATH!_EN.pdf" },
      "Hold Ground": { "fileEs": "HOLD GROUND_ES.pdf", "fileEn": "HOLD GROUND_EN.pdf" },
      "Destroy the Supplies": { "fileEs": "DESTROY THE SUPPLIES_ES.pdf", "fileEn": "DESTROY THE SUPPLIES_EN.pdf" },
      "Reconnoitre": { "fileEs": "RECONNOITRE_ES.pdf", "fileEn": "RECONNOITRE_EN.pdf" },
      "Fog of War": { "fileEs": "FOG OF WAR_ES.pdf", "fileEn": "FOG OF WAR_EN.pdf" },
      "Capture & Control": { "fileEs": "CAPTURE & CONTROL_ES.pdf", "fileEn": "CAPTURE & CONTROL_EN.pdf" },
      "Breakthrough": { "fileEs": "BREAKTHROUGH_ES.pdf", "fileEn": "BREAKTHROUGH_EN.pdf" },
      "Stake a Claim": { "fileEs": "STAKE A CLAIM_ES.pdf", "fileEn": "STAKE A CLAIM_EN.pdf" },
      "Lords of Battle": { "fileEs": "LORDS OF BATTLE_ES.pdf", "fileEn": "LORDS OF BATTLE_EN.pdf" },
      "Assassination": { "fileEs": "ASSASSINATION_ES.pdf", "fileEn": "ASSASSINATION_EN.pdf" },
      "Contest of Champions": { "fileEs": "CONTEST OF CHAMPIONS_ES.pdf", "fileEn": "CONTEST OF CHAMPIONS_EN.pdf" },
      "Heirloom of Ages Past": { "fileEs": "HEIRLOOM OF AGES PAST_ES.pdf", "fileEn": "HEIRLOOM OF AGES PAST_EN.pdf" },
      "Sites of Power": { "fileEs": "SITES OF POWER_ES.pdf", "fileEn": "SITES OF POWER_EN.pdf" },
      "Command the Battlefield": { "fileEs": "COMMAND THE BATTLEFIELD_ES.pdf", "fileEn": "COMMAND THE BATTLEFIELD_EN.pdf" },
      "Retrieval": { "fileEs": "RETRIEVAL_ES.pdf", "fileEn": "RETRIEVAL_EN.pdf" },
      "Seize the Prizes": { "fileEs": "SEIZE THE PRIZES_ES.pdf", "fileEn": "SEIZE THE PRIZES_EN.pdf" },
      "Treasure Hoard": { "fileEs": "TREASURE HOARD_ES.pdf", "fileEn": "TREASURE HOARD_EN.pdf" },
      "Storm the Camp": { "fileEs": "STORM THE CAMP_ES.pdf", "fileEn": "STORM THE CAMP_EN.pdf" },
      "Divide & Conquer": { "fileEs": "DIVIDE & CONQUER_ES.pdf", "fileEn": "DIVIDE & CONQUER_EN.pdf" },
      "Escort the Wounded": { "fileEs": "ESCORT THE WOUNDED_ES.pdf", "fileEn": "ESCORT THE WOUNDED_EN.pdf" },
      "Clash by Moonlight": { "fileEs": "CLASH BY MOONLIGHT_ES.pdf", "fileEn": "CLASH BY MOONLIGHT_EN.pdf" },
      "Lead from the Front": { "fileEs": "LEAD FROM THE FRONT_ES.pdf", "fileEn": "LEAD FROM THE FRONT_EN.pdf" },
      "Convergence": { "fileEs": "CONVERGENCE_ES.pdf", "fileEn": "CONVERGENCE_EN.pdf" }
    },
    "missions2v2": {
      "No Escape": { "fileEs": "2vs2/NO ESCAPE_ES.pdf", "fileEn": "2vs2/NO ESCAPE_EN.pdf" },
      "Total Conquest": { "fileEs": "2vs2/TOTAL CONQUEST_ES.pdf", "fileEn": "2vs2/TOTAL CONQUEST_EN.pdf" },
      "Take & Hold": { "fileEs": "2vs2/TAKE & HOLD_ES.pdf", "fileEn": "2vs2/TAKE & HOLD_EN.pdf" },
      "Clash of Champions": { "fileEs": "2vs2/CLASH OF CHAMPIONS_ES.pdf", "fileEn": "2vs2/CLASH OF CHAMPIONS_EN.pdf" },
      "Cornered": { "fileEs": "2vs2/CORNERED_ES.pdf", "fileEn": "2vs2/CORNERED_EN.pdf" },
      "Duel of Wits": { "fileEs": "2vs2/DUEL OF WITS_ES.pdf", "fileEn": "2vs2/DUEL OF WITS_EN.pdf" }
    }
  }
}
\`\`\`

---

# 🤖 GUÍA 2: CÓMO CREAR UN MOD DE ÁRBITRO DE REGLAS IA

El Árbitro de Reglas con Inteligencia Artificial utiliza una base de conocimiento estructurada para responder dudas en mesa de juego con **citas exactas de páginas, aclaraciones oficiales y resolución paso a paso de casos complejos**.

---

### 📄 Paso 2.1: Estructura del Archivo JSON para Árbitro IA

El archivo contiene el array \`rulesKnowledge\`. Cada entrada representa un bloque temático de reglas, acción heroica, regla especial o FAQ:

\`\`\`json
{
  "modId": "suplemento-reglas-ia-2026",
  "modName": "Suplemento de Reglas y FAQs 2026",
  "modVersion": "1.0.0",
  "modAuthor": "Comunidad Arbitral MESBG",
  "gameSystem": "MESBG",
  "schemaVersion": "1.0",
  "description": "Base de conocimiento exhaustiva con reglas de combate, acciones heroicas, magia y aclaraciones oficiales.",
  "capabilities": ["rules_ai"],
  "tags": ["ia", "reglas", "faqs", "arbitro", "combate"],
  "rulesKnowledge": [
    {
      "id": "combate_combates_multiples",
      "title": "Combates Múltiples y División de Ataques",
      "category": "Fase de Combate",
      "page": "Pág. 44-46",
      "book": "Manual de Reglas",
      "summary": "Resolución de combates donde intervienen varias miniaturas en peana con peana.",
      "fullText": "Cuando varias miniaturas están trabadas en un mismo combate, el bando que obtenga el resultado más alto en el Duelo resulta vencedor. El jugador vencedor puede distribuir los Ataques de sus miniaturas entre los enemigos trabados en el combate que se encuentren a su alcance...",
      "tags": ["combate", "duelo", "ataques", "herir", "apoyo"],
      "faqs": [
        "¿Puede una miniatura que apoya con lanza repartir sus ataques a un objetivo diferente? Sí, siempre que esté trabada legalmente a través de la miniatura frontal.",
        "¿Cómo se resuelve si ambos bandos empatan la tirada más alta? Se compara el Atributo de Combate (C/F). Si persiste el empate, se efectúa una tirada de desempate (1-3 bando de la Oscuridad, 4-6 bando de la Luz)."
      ]
    },
    {
      "id": "acciones_heroicas_combate",
      "title": "Combate Heroico (Heroic Combat)",
      "category": "Acciones Heroicas",
      "page": "Pág. 68",
      "book": "Manual de Reglas",
      "summary": "Permite a un Héroe y miniaturas aliadas trabadas mover y trabar de nuevo si eliminan a todos los enemigos en su combate.",
      "fullText": "Un Héroe puede declarar un Combate Heroico al inicio de la Fase de Combate gastando 1 punto de Poder. Ese combate se resuelve en primer lugar. Si todas las miniaturas enemigas en ese combate resultan eliminadas, el Héroe y las miniaturas aliadas que participaron en él pueden realizar un movimiento inmediato de hasta su distancia máxima de Movimiento...",
      "tags": ["poder", "combate heroico", "fase de combate", "heroe", "movimiento"],
      "faqs": [
        "¿Puede el héroe trabar a nuevos enemigos con el movimiento adicional? Sí, e incluso trabar a miniaturas que no estaban previamente en combate.",
        "¿Se pueden lanzar proyectiles durante el movimiento de Combate Heroico? No, este movimiento es exclusivamente para trabar o recolocarse."
      ]
    }
  ]
}
\`\`\`

---

### ✍️ Paso 2.2: Consejos de Redacción para que la IA responda a la perfección

1. **Citas y Fuentes Claras:** Rellena siempre \`page\` (ej: \`"Pág. 45"\`) y \`book\` (ej: \`"Manual de Reglas"\`). La IA usará estos datos para responder diciendo: *"Según el Manual de Reglas (Pág. 45)..."*.
2. **Campo \`tags\` (Palabras Clave):** Añade sinónimos y términos habituales de búsqueda en mesa (ej: \`["lanza", "apoyo", "monstruo", "arrollar", "derribado"]\`).
3. **Array \`faqs\`:** Escribe las dudas más polémicas o frecuentes que suelen surgir en torneos con su respuesta inequívoca. La IA consultará directamente este apartado para dar veredictos rápidos e indiscutibles.

---

# 🌐 CÓMO PUBLICAR TU MOD EN EL TALLER COMUNITARIO

Una vez que tengas tu archivo \`.json\` subido a tu GitHub público:

1. Entra en **La Cuchara de Lobelia** ➔ Pestaña **Mods**.
2. Pulsa en **\`📤 Publicar Mi Mod (URL)\`**.
3. Pega el enlace directo a tu archivo (ej: \`https://raw.githubusercontent.com/tu-usuario/tu-repo/main/mod.json\`).
4. Pulsa **\`🔍 Probar\`**: La app comprobará el archivo y rellenará el nombre y las opciones automáticamente.
5. Haz clic en **\`Publicar en el Taller\`**.

👉 **¡Listo!** A partir de ese momento, cualquier jugador del mundo podrá encontrar tu mod en el buscador, instalarlo con 1 clic en su móvil y dejarte reseñas de 5 estrellas ⭐.
`;

// ── PLANTILLAS DESCARGABLES MINIMALISTAS Y ACTUALIZADAS ───────────────────────

export const TEMPLATE_MOD_1_MISSIONS = {
  modId: "pack-misiones-ejemplo",
  modName: "Pack de Misiones Oficiales",
  modVersion: "1.0.0",
  modAuthor: "Tu Nombre o Club",
  gameSystem: "MESBG",
  schemaVersion: "1.0",
  description: "Plantilla para 24 escenarios 1v1 y 6 escenarios 2v2 con soporte para visor PDF online y descarga offline.",
  capabilities: ["missions"],
  tags: ["misiones", "escenarios", "mapas", "torneo"],
  missionPdfs: {
    baseUrl: "https://raw.githubusercontent.com/TU_USUARIO/TU_REPOSITORIO/main/pdfs/",
    missions1v1: {
      "Domination": { "fileEs": "DOMINATION_ES.pdf", "fileEn": "DOMINATION_EN.pdf" },
      "To the Death!": { "fileEs": "TO THE DEATH!_ES.pdf", "fileEn": "TO THE DEATH!_EN.pdf" },
      "Hold Ground": { "fileEs": "HOLD GROUND_ES.pdf", "fileEn": "HOLD GROUND_EN.pdf" },
      "Destroy the Supplies": { "fileEs": "DESTROY THE SUPPLIES_ES.pdf", "fileEn": "DESTROY THE SUPPLIES_EN.pdf" },
      "Reconnoitre": { "fileEs": "RECONNOITRE_ES.pdf", "fileEn": "RECONNOITRE_EN.pdf" },
      "Fog of War": { "fileEs": "FOG OF WAR_ES.pdf", "fileEn": "FOG OF WAR_EN.pdf" },
      "Capture & Control": { "fileEs": "CAPTURE & CONTROL_ES.pdf", "fileEn": "CAPTURE & CONTROL_EN.pdf" },
      "Breakthrough": { "fileEs": "BREAKTHROUGH_ES.pdf", "fileEn": "BREAKTHROUGH_EN.pdf" },
      "Stake a Claim": { "fileEs": "STAKE A CLAIM_ES.pdf", "fileEn": "STAKE A CLAIM_EN.pdf" },
      "Lords of Battle": { "fileEs": "LORDS OF BATTLE_ES.pdf", "fileEn": "LORDS OF BATTLE_EN.pdf" },
      "Assassination": { "fileEs": "ASSASSINATION_ES.pdf", "fileEn": "ASSASSINATION_EN.pdf" },
      "Contest of Champions": { "fileEs": "CONTEST OF CHAMPIONS_ES.pdf", "fileEn": "CONTEST OF CHAMPIONS_EN.pdf" },
      "Heirloom of Ages Past": { "fileEs": "HEIRLOOM OF AGES PAST_ES.pdf", "fileEn": "HEIRLOOM OF AGES PAST_EN.pdf" },
      "Sites of Power": { "fileEs": "SITES OF POWER_ES.pdf", "fileEn": "SITES OF POWER_EN.pdf" },
      "Command the Battlefield": { "fileEs": "COMMAND THE BATTLEFIELD_ES.pdf", "fileEn": "COMMAND THE BATTLEFIELD_EN.pdf" },
      "Retrieval": { "fileEs": "RETRIEVAL_ES.pdf", "fileEn": "RETRIEVAL_EN.pdf" },
      "Seize the Prizes": { "fileEs": "SEIZE THE PRIZES_ES.pdf", "fileEn": "SEIZE THE PRIZES_EN.pdf" },
      "Treasure Hoard": { "fileEs": "TREASURE HOARD_ES.pdf", "fileEn": "TREASURE HOARD_EN.pdf" },
      "Storm the Camp": { "fileEs": "STORM THE CAMP_ES.pdf", "fileEn": "STORM THE CAMP_EN.pdf" },
      "Divide & Conquer": { "fileEs": "DIVIDE & CONQUER_ES.pdf", "fileEn": "DIVIDE & CONQUER_EN.pdf" },
      "Escort the Wounded": { "fileEs": "ESCORT THE WOUNDED_ES.pdf", "fileEn": "ESCORT THE WOUNDED_EN.pdf" },
      "Clash by Moonlight": { "fileEs": "CLASH BY MOONLIGHT_ES.pdf", "fileEn": "CLASH BY MOONLIGHT_EN.pdf" },
      "Lead from the Front": { "fileEs": "LEAD FROM THE FRONT_ES.pdf", "fileEn": "LEAD FROM THE FRONT_EN.pdf" },
      "Convergence": { "fileEs": "CONVERGENCE_ES.pdf", "fileEn": "CONVERGENCE_EN.pdf" }
    },
    "missions2v2": {
      "No Escape": { "fileEs": "2vs2/NO ESCAPE_ES.pdf", "fileEn": "2vs2/NO ESCAPE_EN.pdf" },
      "Total Conquest": { "fileEs": "2vs2/TOTAL CONQUEST_ES.pdf", "fileEn": "2vs2/TOTAL CONQUEST_EN.pdf" },
      "Take & Hold": { "fileEs": "2vs2/TAKE & HOLD_ES.pdf", "fileEn": "2vs2/TAKE & HOLD_EN.pdf" },
      "Clash of Champions": { "fileEs": "2vs2/CLASH OF CHAMPIONS_ES.pdf", "fileEn": "2vs2/CLASH OF CHAMPIONS_EN.pdf" },
      "Cornered": { "fileEs": "2vs2/CORNERED_ES.pdf", "fileEn": "2vs2/CORNERED_EN.pdf" },
      "Duel of Wits": { "fileEs": "2vs2/DUEL OF WITS_ES.pdf", "fileEn": "2vs2/DUEL OF WITS_EN.pdf" }
    }
  }
};

export const TEMPLATE_MOD_2_RULES_AI = {
  modId: "suplemento-reglas-ia-ejemplo",
  modName: "Suplemento de Reglas y FAQs para Árbitro IA",
  modVersion: "1.0.0",
  modAuthor: "Tu Nombre o Club",
  gameSystem: "MESBG",
  schemaVersion: "1.0",
  description: "Base de conocimiento indexada de reglas, acciones heroicas y FAQs para el Árbitro IA.",
  capabilities: ["rules_ai"],
  tags: ["ia", "reglas", "faqs", "arbitro"],
  rulesKnowledge: [
    {
      id: "ejemplo_combate_multiple",
      title: "Combates Múltiples y Distribución de Ataques",
      category: "Fase de Combate",
      page: "Pág. 44-46",
      book: "Manual de Reglas",
      summary: "Resolución de combates donde intervienen varias miniaturas en peana con peana.",
      fullText: "Cuando varias miniaturas están trabadas en un mismo combate, el bando que obtenga el resultado más alto en el Duelo resulta vencedor...",
      tags: ["combate", "duelo", "ataques", "herir", "apoyo"],
      faqs: [
        "¿Puede una miniatura que apoya con lanza repartir sus ataques a un objetivo diferente? Sí, siempre que esté trabada legalmente a través de la miniatura frontal."
      ]
    }
  ]
};
