// Service IA : par défaut traitements déterministes locaux.
// Les appels aux APIs externes (Gemini, Eden AI, Replicate, Stability AI) passent
// EXCLUSIVEMENT par l'Edge Function `ai-proxy` via supabase.functions.invoke().
// Aucune clé API ne doit être présente dans des variables VITE_* ou dans ce fichier.
import { supabase } from './supabaseService';
import { Project, Task, Contact } from '../types';
import { logger } from './loggerService';

const GEMINI_MODEL = 'gemini-1.5-flash';
const EDENAI_MODEL = 'openai/gpt-4o-mini';

/** Opt-in explicite : sans `true`, aucun appel réseau vers les APIs IA externes. */
const EXTERNAL_TEXT_AI_ENABLED =
  import.meta.env.VITE_ENABLE_EXTERNAL_TEXT_AI === 'true';

const IMAGE_API_PROVIDER: 'replicate' | 'stability' =
  (import.meta.env.VITE_IMAGE_API_PROVIDER as 'replicate' | 'stability') || 'replicate';

let externalTextAiBootLogged = false;
function logExternalTextAiBootOnce() {
  if (externalTextAiBootLogged) return;
  externalTextAiBootLogged = true;
  logger.info(
    'data',
    EXTERNAL_TEXT_AI_ENABLED
      ? 'IA texte externe activée (via Edge Function ai-proxy).'
      : 'IA texte externe désactivée — traitements déterministes locaux (aucun appel cloud sans VITE_ENABLE_EXTERNAL_TEXT_AI=true).',
    { externalTextAi: EXTERNAL_TEXT_AI_ENABLED },
  );
}
logExternalTextAiBootOnce();

// ---------- Appel via ai-proxy ----------

type AiProxyProvider = 'gemini' | 'edenai' | 'replicate' | 'stability';

async function callAiProxy<T = unknown>(
  provider: AiProxyProvider,
  action: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; data?: T; error?: string }>(
    'ai-proxy',
    { body: { provider, action, payload } },
  );
  if (error) throw new Error(`ai-proxy réseau: ${error.message}`);
  if (!data?.ok) throw new Error(`ai-proxy erreur: ${data?.error ?? 'inconnue'}`);
  return data.data as T;
}

// ---------- Gemini ----------
const callGeminiAPI = async (prompt: string, systemPrompt?: string): Promise<string> => {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }],
      },
    ],
  };
  const result = await callAiProxy<{
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
  }>('gemini', 'generateContent', { model: GEMINI_MODEL, body });

  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('La réponse Gemini est vide ou mal formée.');
  return text;
};

// ---------- EdenAI ----------
const callEdenAIAPI = async (prompt: string, systemPrompt?: string): Promise<string> => {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const result = await callAiProxy<{ choices?: Array<{ message: { content: string } }> }>(
    'edenai',
    'chat',
    {
      body: {
        model: EDENAI_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
      },
    },
  );
  return result?.choices?.[0]?.message?.content || 'Aucune réponse générée.';
};

// ---------- Fallback texte ----------
const callAI = async (prompt: string, systemPrompt?: string): Promise<string> => {
  if (!EXTERNAL_TEXT_AI_ENABLED) return '';

  try {
    const result = await callGeminiAPI(prompt, systemPrompt);
    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn('⚠️ Gemini a échoué, bascule vers Eden AI:', msg);
  }

  try {
    const result = await callEdenAIAPI(prompt, systemPrompt);
    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('❌ Eden AI a également échoué:', msg);
    return "Erreur lors de la communication avec l'IA. Veuillez réessayer.";
  }
};

// ---------- Exports dépréciés (compatibilité) ----------

/** @deprecated Module ai_coach retiré - utiliser un autre module */
export const runAICoach = async (_prompt: string): Promise<string> => {
  return "Ce module n'est plus disponible.";
};

/** @deprecated Module gen_ai_lab retiré - utiliser un autre module */
export const runGenAILab = async (_prompt: string): Promise<string> => {
  return "Ce module n'est plus disponible.";
};

export const enhanceTask = async (task: Task): Promise<Task> => task;

export const identifyRisks = async (_project: Project): Promise<string[]> => [
  'Risque technique',
  'Risque de délai',
];

export const generateOKRs = async (
  projectDescription: string,
  projectTitle?: string,
  projectStatus?: string,
  projectTasks?: Array<{ text?: string; title?: string }>,
): Promise<Array<{
  title: string;
  keyResults: Array<{ title: string; target: number; unit: string }>;
}>> => {
  console.log('🤖 Génération IA OKRs - Démarrage pour projet:', projectTitle || 'Sans titre');

  const projectContext = `
Projet: ${projectTitle || 'Sans titre'}
Description: ${projectDescription || 'Aucune description'}
Statut: ${projectStatus || 'Non défini'}
${projectTasks && projectTasks.length > 0 ? `Tâches principales:\n${projectTasks.slice(0, 5).map((t) => `- ${t.text || t.title || 'Tâche'}`).join('\n')}` : ''}
  `.trim();

  const systemPrompt = `Tu es un expert en gestion d'objectifs et OKRs (Objectives and Key Results). 
Analyse le projet fourni et génère 2-3 objectifs stratégiques adaptés et pertinents pour ce projet spécifique.
Chaque objectif doit avoir 2-4 Key Results mesurables avec des unités appropriées (%, nombre, score, etc.).
Les OKRs doivent être:
- Spécifiques au projet (pas génériques)
- Mesurables et actionnables
- Réalistes mais ambitieux
- Alignés avec les objectifs du projet

Retourne uniquement un JSON valide avec cette structure exacte:
[
  {
    "title": "Titre de l'objectif stratégique",
    "keyResults": [
      {
        "title": "Description du Key Result mesurable",
        "target": nombre_cible,
        "unit": "unité (% ou texte)"
      }
    ]
  }
]`;

  const prompt = `${projectContext}\n\nGénère des OKRs professionnels et adaptés pour ce projet.`;

  try {
    if (EXTERNAL_TEXT_AI_ENABLED) {
      const response = await callAI(prompt, systemPrompt);
      try {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log('✅ Génération IA OKRs - OKRs générés par IA:', parsed.length);
          return parsed;
        }
      } catch {
        console.warn('⚠️ Impossible de parser la réponse IA, utilisation des OKRs par défaut');
      }
    }

    // Fallback déterministe
    const combined = `${(projectTitle || '').toLowerCase()} ${(projectDescription || '').toLowerCase()}`;
    const isMarketing = /marketing|campagne|promotion|publicité/.test(combined);
    const isTech = /développement|plateforme|application|software|web|mobile/.test(combined);
    const isBusiness = /partenariat|client|vente|commercial|business/.test(combined);
    const isProduct = /produit|feature|fonctionnalité/.test(combined);
    const isHR = /rh|recrutement|talent|ressource humaine/.test(combined);

    if (isMarketing) {
      return [
        {
          title: `Lancer avec succès ${projectTitle || 'le projet'} et obtenir une adoption rapide`,
          keyResults: [
            { title: "Atteindre 10 000 inscriptions d'utilisateurs au cours du premier mois", target: 10000, unit: 'utilisateurs' },
            { title: 'Sécuriser 50 partenaires pour intégrer la solution', target: 50, unit: 'partenaires' },
            { title: "Atteindre un score de satisfaction de 8,5/10", target: 8.5, unit: '/10' },
          ],
        },
        {
          title: "Maximiser l'impact de la campagne et générer un ROI positif",
          keyResults: [
            { title: 'Générer 100 000 impressions sur les réseaux sociaux', target: 100000, unit: 'impressions' },
            { title: 'Atteindre un taux de clic de 3% sur les publicités', target: 3, unit: '%' },
            { title: 'Convertir 500 prospects qualifiés en clients', target: 500, unit: 'clients' },
          ],
        },
      ];
    }

    if (isTech) {
      return [
        {
          title: `Développer et déployer ${projectTitle || 'la solution'} avec excellence technique`,
          keyResults: [
            { title: 'Réduire le temps de chargement de 50%', target: 50, unit: '%' },
            { title: "Atteindre 99,9% de disponibilité de la plateforme", target: 99.9, unit: '%' },
            { title: "Implémenter 100% des fonctionnalités demandées", target: 100, unit: '%' },
          ],
        },
        {
          title: "Optimiser l'expérience utilisateur et les performances",
          keyResults: [
            { title: "Atteindre un score d'utilisabilité de 8,5/10", target: 8.5, unit: '/10' },
            { title: 'Réduire les erreurs critiques de 90%', target: 90, unit: '%' },
          ],
        },
      ];
    }

    if (isBusiness || isProduct) {
      return [
        {
          title: `Développer ${projectTitle || 'les objectifs business'} et augmenter les revenus`,
          keyResults: [
            { title: 'Signer 20 nouveaux partenariats stratégiques', target: 20, unit: 'partenariats' },
            { title: 'Augmenter les revenus de 30%', target: 30, unit: '%' },
            { title: 'Atteindre un taux de satisfaction partenaire de 9/10', target: 9, unit: '/10' },
          ],
        },
      ];
    }

    if (isHR) {
      return [
        {
          title: `Améliorer les processus RH et développer les talents pour ${projectTitle || 'le projet'}`,
          keyResults: [
            { title: 'Recruter 10 talents qualifiés', target: 10, unit: 'talents' },
            { title: "Atteindre un taux de rétention de 95%", target: 95, unit: '%' },
            { title: "Former 100% de l'équipe aux nouvelles compétences", target: 100, unit: '%' },
          ],
        },
      ];
    }

    return [
      {
        title: `Réussir ${projectTitle || 'le projet'} dans les délais et le budget`,
        keyResults: [
          { title: "Respecter 100% des échéances du projet", target: 100, unit: '%' },
          { title: 'Maintenir le budget dans les limites prévues', target: 100, unit: '%' },
          { title: 'Atteindre un score de satisfaction de 8/10', target: 8, unit: '/10' },
        ],
      },
      {
        title: `Délivrer ${projectTitle || 'les livrables'} avec excellence et qualité`,
        keyResults: [
          { title: "Compléter 100% des livrables prévus", target: 100, unit: '%' },
          { title: 'Obtenir une validation client de 9/10', target: 9, unit: '/10' },
          { title: 'Réduire les retours/corrections de 80%', target: 80, unit: '%' },
        ],
      },
    ];
  } catch (error) {
    console.error('❌ Erreur génération OKRs:', error);
    return [
      {
        title: `Atteindre les objectifs de ${projectTitle || 'ce projet'}`,
        keyResults: [
          { title: "Respecter les échéances à 100%", target: 100, unit: '%' },
          { title: 'Maintenir le budget prévu', target: 100, unit: '%' },
          { title: 'Atteindre une satisfaction de 8/10', target: 8, unit: '/10' },
        ],
      },
    ];
  }
};

function coerceEmailContext(context: string | Record<string, unknown>): string {
  if (typeof context === 'string' && context.trim()) return context.trim();
  return 'Prise de contact et présentation de notre offre';
}

export const draftSalesEmail = async (
  contact: Contact,
  context: string | Record<string, unknown>,
): Promise<string> => {
  const topic = coerceEmailContext(context);
  const targetEmail = (contact.workEmail || contact.personalEmail || '').trim() || '(email non renseigné)';

  if (EXTERNAL_TEXT_AI_ENABLED) {
    const prompt = `Rédige un email commercial professionnel pour contacter ${contact.name} de ${contact.company || 'leur entreprise'} concernant: ${topic}. Adresse du destinataire: ${targetEmail}. Ton amical mais professionnel, de 2-3 paragraphes maximum.`;
    const ai = await callAI(prompt, 'Tu es un expert en communication commerciale B2B.');
    if (ai.trim()) return ai;
  }

  const company = contact.company || 'votre structure';
  return [
    `Objet : ${topic} — échange avec ${contact.name}`,
    '',
    `Bonjour ${contact.name},`,
    '',
    `Je me permets de vous contacter au sujet : ${topic}. Nous accompagnons des organisations comme ${company} sur ce type de besoin.`,
    '',
    `Seriez-vous disponible pour un court échange ? Vous pouvez me répondre à ${targetEmail !== '(email non renseigné)' ? targetEmail : 'cette adresse'}.`,
    '',
    'Cordialement,',
    '[Votre nom]',
    '',
    '— Brouillon généré localement (sans IA cloud).',
  ].join('\n');
};

function extractiveTitleAndBody(raw: string): { title: string; body: string } {
  const text = raw.trim();
  const lines = text.split('\n').filter((l) => l.trim());
  const firstLine = (lines[0] || text.slice(0, 72)).trim();
  const title = firstLine.replace(/^#+\s*/, '').slice(0, 80) || 'Document';
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const excerpt = sentences.slice(0, 7).join(' ') || text.slice(0, 1200);
  const words = text.toLowerCase().match(/[a-zàâäéèêëïîôùûç0-9]{4,}/g) || [];
  const freq = new Map<string, number>();
  for (const w of words) {
    if (w.length < 4) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  const bullets = top.length
    ? ['', '**Termes saillants (fréquence locale)**', ...top.map((t) => `- ${t}`)]
    : [];
  const body = [
    `## Résumé extractif`,
    '',
    excerpt,
    ...bullets,
    '',
    `---`,
    '',
    `*Document structuré localement (sans IA cloud).*`,
  ].join('\n');
  return { title, body };
}

export const summarizeAndCreateDoc = async (
  text: string,
): Promise<{ title: string; content: string } | null> => {
  if (!text || !text.trim()) return null;

  if (EXTERNAL_TEXT_AI_ENABLED) {
    try {
      const systemPrompt = `Tu es un assistant de documentation professionnel.
Résume et structure le texte fourni en Markdown clair et hiérarchisé (titres, listes, tableaux si utile).
Donne un TITRE court et informatif (<= 80 caractères).
Réponds exclusivement en JSON de la forme:
{"title":"...","content":"markdown"}`;

      const raw = await callAI(text, systemPrompt);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed?.title && parsed?.content) {
          return { title: String(parsed.title).slice(0, 80), content: String(parsed.content) };
        }
      }
    } catch {
      /* fallback local ci-dessous */
    }
  }

  const { title, body } = extractiveTitleAndBody(text);
  return { title, content: body };
};

export interface KnowledgeDocParams {
  topic: string;
  audience?: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  outline?: string;
}

function deterministicKnowledgeDoc(params: KnowledgeDocParams): { title: string; content: string } {
  const { topic, audience = 'équipe', tone = 'professionnel', length = 'medium', outline } = params;
  const title = `Note : ${topic}`.slice(0, 80);
  const depth =
    length === 'short'
      ? 'Version courte — points essentiels uniquement.'
      : length === 'long'
      ? 'Version détaillée — sections étendues.'
      : 'Version standard.';
  const lines = (outline || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const plan = lines.length
    ? lines.map((l) => `- ${l}`).join('\n')
    : '- Contexte et objectifs\n- Points clés à traiter\n- Prochaines étapes';
  const content = [
    `# ${title}`,
    '',
    `**Public** : ${audience} · **Ton** : ${tone} · ${depth}`,
    '',
    `## Vue d'ensemble`,
    `Ce document structure localement le sujet « ${topic} » sans appel à un service IA externe.`,
    '',
    `## Plan`,
    plan,
    '',
    `## Ressources complémentaires`,
    `- Adapter ce canevas avec vos procédures internes COYA.`,
    '',
    `---`,
    `*Généré localement (déterministe).*`,
  ].join('\n');
  return { title, content };
}

export const generateKnowledgeDocument = async (
  params: KnowledgeDocParams,
): Promise<{ title: string; content: string }> => {
  if (!EXTERNAL_TEXT_AI_ENABLED) return deterministicKnowledgeDoc(params);

  const { topic, audience = 'équipe', tone = 'professionnel', length = 'medium', outline } = params;
  const lengthHint =
    length === 'short' ? '300-500 mots' : length === 'long' ? '900-1200 mots' : '600-800 mots';
  const systemPrompt = `Tu es un rédacteur technique. Rédige un document de base de connaissances clair et structuré en Markdown. Utilise des titres (H1..H3), listes, et si utile des tableaux.
Le ton doit être ${tone}. Public visé: ${audience}. Longueur cible: ${lengthHint}.
Termine par une section "Ressources complémentaires" si pertinent.
Réponds en JSON {"title":"...","content":"markdown"}.`;
  const prompt = `Sujet: ${topic}\n\n${outline ? `Plan/points à couvrir:\n${outline}\n\n` : ''}Rédige maintenant le document complet.`;

  const raw = await callAI(prompt, systemPrompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.title && parsed?.content) {
        return { title: String(parsed.title).slice(0, 80), content: String(parsed.content) };
      }
    } catch {
      /* noop */
    }
  }
  return deterministicKnowledgeDoc(params);
};

function improveKnowledgeContentLocal(markdown: string, tone: string): string {
  const raw = markdown.trim();
  if (!raw) return markdown;
  const paras = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const body = paras.join('\n\n');
  return [
    `## Introduction`,
    `Contenu revu localement (ton visé : ${tone}). Les paragraphes suivants reprennent votre texte sans reformulation cloud.`,
    '',
    body,
    '',
    `## Synthèse`,
    `- Structure ajoutée automatiquement — vérifiez la formulation métier avant publication.`,
    '',
    `---`,
    `*Amélioration locale (sans IA externe).*`,
  ].join('\n');
}

export const improveKnowledgeContent = async (
  content: string,
  tone = 'professionnel',
): Promise<string> => {
  if (!content || !content.trim()) return content;
  if (!EXTERNAL_TEXT_AI_ENABLED) return improveKnowledgeContentLocal(content, tone);

  const systemPrompt = `Tu es un éditeur technique. Réécris et améliore ce contenu en Markdown avec un ton ${tone}. Clarifie, structure (H2/H3), corrige les fautes, ajoute une courte intro et une conclusion utile. Ne change pas le sens.`;
  const improved = await callAI(content, systemPrompt);
  return improved.trim() ? improved : improveKnowledgeContentLocal(content, tone);
};

function deterministicAgentReply(prompt: string, context?: string): string {
  const p = prompt.toLowerCase();
  const ctx = context ? `Contexte indiqué : ${context}. ` : '';
  if (/mot de passe|password|connexion|login/i.test(p)) {
    return `${ctx}Pour vous connecter à COYA, utilisez votre email et mot de passe. En cas d'oubli, utilisez « Mot de passe oublié » sur l'écran de connexion (lien envoyé par Supabase Auth).`;
  }
  if (/r[oô]le|permission|acc[eè]s|module/i.test(p)) {
    return `${ctx}Les rôles et modules visibles dépendent des permissions configurées par votre administrateur (Profil / Module labels). Contactez un admin organisation si un module manque.`;
  }
  return `${ctx}Réponse automatique locale : pour une aide métier précise, précisez le module (Finance, RH, Projets, etc.) et l'action souhaitée. L'assistant conversationnel cloud est désactivé par défaut dans cette installation.`;
}

export const runAIAgent = async (prompt: string, context?: string): Promise<string> => {
  if (!EXTERNAL_TEXT_AI_ENABLED) return deterministicAgentReply(prompt, context);

  const professionalPolicy = `
Tu es "Coya", un assistant IA professionnel intégré à la plateforme COYA.
Objectif: aider sur le travail, les modules de l'application, procédures administratives, réglementation sénégalaise, gestion de projet, RH, Finance, Juridique, et bonnes pratiques professionnelles.
Règles:
- Ton: professionnel, clair, concis, actionnable.
- Refuse poliment tout contenu inapproprié (insultes, haine, sexe, violence, spam) et réoriente vers un sujet professionnel.
- Pour les sujets réglementaires sénégalais: précise si nécessaire que l'information peut nécessiter validation officielle et cite les références connues quand possible.
- Structure quand utile avec listes, étapes, et exemples.
- Si la question est ambiguë, pose 1-2 questions de clarification.
- Si tu n'es pas certain, indique les hypothèses.
`;

  const scopedContext = context ? `Contexte module: ${context}.` : '';
  const systemPrompt = `${professionalPolicy}\n${scopedContext}`.trim();
  const out = await callAI(prompt, systemPrompt);
  return out.trim() || deterministicAgentReply(prompt, context);
};

export const runAuthAIAssistant = async (prompt: string): Promise<string> => {
  if (!EXTERNAL_TEXT_AI_ENABLED) {
    const q = prompt.toLowerCase();
    if (/mot de passe|password|oubli|reset|récup/i.test(q)) {
      return 'Utilisez le lien « Mot de passe oublié » sur la page de connexion : un email Supabase vous permet de définir un nouveau mot de passe. Vérifiez aussi les courriers indésirables.';
    }
    if (/inscription|signup|compte|créer/i.test(q)) {
      return "Pour créer un compte, complétez le formulaire d'inscription avec un email valide. Si l'organisation impose une validation, attendez l'activation par un administrateur.";
    }
    if (/r[oô]le|permission|acc[eè]s/i.test(q)) {
      return "Votre rôle et vos modules visibles sont définis par l'administrateur de votre organisation dans COYA. Après connexion, seuls les modules autorisés apparaissent dans le menu.";
    }
    return 'Assistant cloud désactivé dans cette installation (réponses locales). Pour la connexion COYA : email + mot de passe, ou « Mot de passe oublié » si besoin.';
  }
  const systemPrompt =
    "Tu es un assistant IA spécialisé dans l'aide et le support pour les utilisateurs. Réponds de manière professionnelle et utile.";
  const out = await callAI(prompt, systemPrompt);
  return out.trim() || 'Réponse indisponible pour le moment. Réessayez ou contactez votre administrateur COYA.';
};

// ---------- Génération d'images (via ai-proxy) ----------

const PLACEHOLDER_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNgYGD4DwABBAEAQP/4YQAAAABJRU5ErkJggg==';

export const generateImage = async (prompt: string): Promise<string> => {
  if (!prompt || !prompt.trim()) throw new Error('Le prompt est requis pour générer une image');

  const hasImageProvider =
    import.meta.env.VITE_ENABLE_IMAGE_AI === 'true';
  if (!hasImageProvider) {
    console.warn('⚠️ Génération image désactivée (VITE_ENABLE_IMAGE_AI=true requis), utilisation du placeholder.');
    return PLACEHOLDER_IMAGE_BASE64;
  }

  try {
    if (IMAGE_API_PROVIDER === 'replicate') {
      const prediction = await callAiProxy<{
        id?: string;
        status?: string;
        urls?: { get?: string };
        output?: string[];
      }>('replicate', 'create_prediction', {
        version: '27b93a2413e7f36cd83da926f3656280b2931564ff050bf9575f1f9be9c32123',
        input: { prompt, width: 512, height: 512, num_outputs: 1 },
      });

      let status = prediction.status;
      let pollId = prediction.id;

      while (status === 'starting' || status === 'processing') {
        await new Promise((r) => setTimeout(r, 1500));
        const updated = await callAiProxy<{
          status?: string;
          output?: string[];
        }>('replicate', 'get_prediction', { id: pollId });
        status = updated.status ?? 'failed';
        if (updated.output?.length) {
          const imgRes = await fetch(updated.output[0]);
          const blob = await imgRes.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      }
      throw new Error(`La génération d'image a échoué avec le statut: ${status}`);
    }

    if (IMAGE_API_PROVIDER === 'stability') {
      const result = await callAiProxy<{ base64?: string }>('stability', 'generate', {
        endpoint: 'https://api.stability.ai/v2beta/stable-image/generate/sd3',
        body: { prompt, output_format: 'png', aspect_ratio: '1:1' },
      });
      return result?.base64 || PLACEHOLDER_IMAGE_BASE64;
    }

    return PLACEHOLDER_IMAGE_BASE64;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("❌ Erreur génération d'image:", msg);
    return PLACEHOLDER_IMAGE_BASE64;
  }
};

export const editImage = async (
  imageData: string,
  mimeType: string,
  editPrompt: string,
): Promise<{ image: string }> => {
  if (!imageData || !editPrompt || !editPrompt.trim()) {
    throw new Error("L'image et le prompt d'édition sont requis");
  }
  try {
    const enhancedPrompt = `${editPrompt}, based on the original image, same style and composition`;
    const generatedBase64 = await generateImage(enhancedPrompt);
    return { image: generatedBase64 };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Erreur lors de l'édition d'image: ${msg}`);
  }
};

export const enhanceProjectTasks = async (tasks: Task[]): Promise<Task[]> => tasks;

export const generateStatusReport = async (project: Project): Promise<string> => {
  const taskSummary = project.tasks.map((t) => `- ${t.text} (${t.status})`).join('\n');
  const local = [
    `# Rapport de statut — ${project.title}`,
    '',
    `- **Statut projet** : ${project.status}`,
    `- **Échéance** : ${project.dueDate || 'Non définie'}`,
    '',
    `## Description`,
    project.description || '(non renseignée)',
    '',
    `## Tâches`,
    taskSummary || '(aucune tâche listée)',
    '',
    `---`,
    `*Rapport généré localement.*`,
  ].join('\n');
  if (!EXTERNAL_TEXT_AI_ENABLED) return local;

  const prompt = `Génère un rapport de statut professionnel pour le projet "${project.title}". Description: ${project.description}. Statut: ${project.status}. Tâches:\n${taskSummary}\n\nDate échéance: ${project.dueDate || 'Non définie'}`;
  const systemPrompt = 'Tu es un expert en gestion de projet. Génère des rapports de statut clairs et professionnels.';
  const ai = await callAI(prompt, systemPrompt);
  return ai.trim() || local;
};

export const summarizeTasks = async (tasks: Task[]): Promise<string> => {
  const taskList = tasks
    .map((t, i) => `${i + 1}. ${t.text} (Priorité: ${t.priority}, Statut: ${t.status})`)
    .join('\n');
  const done = tasks.filter((t) => String(t.status).toLowerCase() === 'done').length;
  const local = [
    `## Synthèse des tâches (${tasks.length} au total, ${done} terminées)`,
    '',
    taskList || '(aucune tâche)',
    '',
    `---`,
    `*Résumé déterministe local.*`,
  ].join('\n');
  if (!EXTERNAL_TEXT_AI_ENABLED) return local;

  const prompt = `Résume et analyse les tâches suivantes:\n${taskList}\n\nFournis un résumé concis de l'état d'avancement.`;
  const systemPrompt = "Tu es un expert en gestion de projets. Résume efficacement l'état des tâches.";
  const ai = await callAI(prompt, systemPrompt);
  return ai.trim() || local;
};
