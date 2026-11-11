// Recherche de vêtements avec Claude (recherche web) depuis l'appli.
// La clé API est stockée uniquement sur ton appareil (localStorage) et envoyée directement à Anthropic.
const SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const MODEL = 'claude-opus-5-5';
const KEY_STORAGE = 'anthropic-api-key';

export const getKey = () => { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } };
export const setKey = k => { try { k ? localStorage.setItem(KEY_STORAGE, k) : localStorage.removeItem(KEY_STORAGE); } catch {} };

const SYSTEM = `Tu es le styliste personnel et l'assistant shopping de l'utilisateur. Tu réponds en français.
Tu connais sa garde-robe actuelle (fournie dans le message). Utilise la recherche web pour trouver de VRAIS produits
actuellement en vente (de préférence sur des boutiques livrant en France), qui correspondent à la demande, au budget,
et qui se marient bien avec ce qu'il possède déjà. Évite de proposer ce qu'il a déjà en double.

Termine ta réponse par un unique bloc \`\`\`json contenant un tableau (6 éléments maximum) d'objets :
{"name": string, "brand": string, "price": number|null, "currency": "EUR", "category": string,
 "url": string (lien direct vers la fiche produit), "imageUrl": string|null, "why": string (1 phrase : pourquoi ça lui va / avec quoi le porter)}
N'invente jamais de lien : n'inclus que des URL vues dans tes résultats de recherche.`;

function extractJSON(text) {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const raw = blocks.length ? blocks[blocks.length - 1][1] : (text.match(/\[[\s\S]*\]/) || [])[0];
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function searchClothes({ query, budget, wardrobeSummary }, onStatus = () => {}) {
  const apiKey = getKey();
  if (!apiKey) throw new Error('Ajoute ta clé API Anthropic dans les réglages (⚙︎) pour lancer une recherche.');
  onStatus('Connexion à Claude…');
  const { default: Anthropic } = await import(SDK);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const userMsg = [
    `Ma demande : ${query}`,
    budget ? `Budget max par article : ${budget} €` : '',
    `Ma garde-robe actuelle :\n${wardrobeSummary || '(vide pour le moment)'}`,
  ].filter(Boolean).join('\n\n');

  const messages = [{ role: 'user', content: userMsg }];
  let response;
  for (let i = 0; i < 5; i++) {
    onStatus(i === 0 ? 'Claude cherche des vêtements sur le web…' : 'Claude continue la recherche…');
    response = await client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'FR' } },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 },
      ],
      messages,
    }).finalMessage();
    if (response.stop_reason !== 'pause_turn') break;
    // Reprise automatique : on renvoie la réponse partielle, le serveur continue.
    messages.splice(1, messages.length - 1, { role: 'assistant', content: response.content });
  }

  if (response.stop_reason === 'refusal') throw new Error('Claude n\'a pas pu traiter cette demande. Essaie de la reformuler.');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const results = extractJSON(text);
  const advice = text.replace(/```json[\s\S]*?```/g, '').trim();
  return { results, advice };
}
