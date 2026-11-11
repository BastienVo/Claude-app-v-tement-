import * as db from './db.js';
import { removeBackground, keepOriginal } from './image.js';
import { searchClothes, getKey, setKey } from './claude.js';

// ---------- Référentiels ----------
const CATEGORIES = [
  { id: 'haut', label: 'Hauts', icon: '👕' },
  { id: 'pull', label: 'Pulls & sweats', icon: '🧶' },
  { id: 'veste', label: 'Vestes & manteaux', icon: '🧥' },
  { id: 'bas', label: 'Pantalons & jeans', icon: '👖' },
  { id: 'short', label: 'Shorts & jupes', icon: '🩳' },
  { id: 'robe', label: 'Robes & combis', icon: '👗' },
  { id: 'chaussures', label: 'Chaussures', icon: '👟' },
  { id: 'accessoire', label: 'Accessoires', icon: '🧢' },
  { id: 'sport', label: 'Sport', icon: '🏃' },
  { id: 'autre', label: 'Autre', icon: '📦' },
];
const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'];
const STYLES = ['Quotidien', 'Travail', 'Week-end', 'Soirée', 'Sport'];
const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES.at(-1);

// ---------- État ----------
const state = {
  tab: 'wardrobe',
  items: [], outfits: [], wishes: [],
  wardrobeCat: 'all', wardrobeQuery: '',
  outfitStyle: 'all',
  shopTab: 'wishes',
  searchResults: null, searchAdvice: '', searching: false, searchStatus: '',
  suggestions: null,
};

// ---------- Utilitaires ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
const today = () => new Date().toISOString().slice(0, 10);
const fmtPrice = p => (p == null || p === '' || isNaN(p) ? '' : `${Number(p).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`);

const urlCache = new Map();
function imgURL(obj) {
  if (!obj?.image) return '';
  const hit = urlCache.get(obj.id);
  if (hit && hit.blob === obj.image) return hit.url;
  if (hit) URL.revokeObjectURL(hit.url);
  const url = URL.createObjectURL(obj.image);
  urlCache.set(obj.id, { blob: obj.image, url });
  return url;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

const modal = $('#modal');
function openModal(html, onMount) {
  $('#modal-body').innerHTML = `<button class="modal-close" data-close aria-label="Fermer">✕</button>${html}`;
  if (!modal.open) modal.showModal();
  $('#modal-body').scrollTop = 0;
  onMount?.($('#modal-body'));
}
function closeModal() { if (modal.open) modal.close(); }
modal.addEventListener('click', e => {
  if (e.target === modal || e.target.closest('[data-close]')) closeModal();
});

function currentSeason() {
  const m = new Date().getMonth();
  return m >= 2 && m <= 4 ? 'Printemps' : m >= 5 && m <= 7 ? 'Été' : m >= 8 && m <= 10 ? 'Automne' : 'Hiver';
}

async function reload() {
  [state.items, state.outfits, state.wishes] = await Promise.all(['items', 'outfits', 'wishes'].map(db.all));
  state.items.sort((a, b) => b.createdAt - a.createdAt);
  state.outfits.sort((a, b) => b.createdAt - a.createdAt);
  state.wishes.sort((a, b) => b.createdAt - a.createdAt);
}

// Résumé texte de la garde-robe (envoyé à Claude pour des suggestions cohérentes)
function wardrobeSummary() {
  if (!state.items.length) return '';
  return CATEGORIES.map(c => {
    const list = state.items.filter(i => i.category === c.id);
    if (!list.length) return '';
    const desc = list.map(i => [i.name, i.color, i.brand].filter(Boolean).join(' · ')).join(' ; ');
    return `- ${c.label} (${list.length}) : ${desc}`;
  }).filter(Boolean).join('\n');
}

// ---------- Navigation ----------
const TITLES = { wardrobe: 'Garde-robe', outfits: 'Tenues', shopping: 'Achats potentiels' };
$$('.tabbar button').forEach(b => b.addEventListener('click', () => {
  state.tab = b.dataset.tab;
  $$('.tabbar button').forEach(x => x.classList.toggle('active', x === b));
  render();
  window.scrollTo(0, 0);
}));
$('#btn-settings').addEventListener('click', openSettings);

function render() {
  $('#view-title').textContent = TITLES[state.tab];
  ({ wardrobe: renderWardrobe, outfits: renderOutfits, shopping: renderShopping })[state.tab]();
}

// =====================================================================
// GARDE-ROBE
// =====================================================================
function itemCard(i, extra = '') {
  return `<button class="card item-card" data-item="${i.id}">
    <div class="thumb">${i.image ? `<img src="${imgURL(i)}" alt="">` : `<span class="ph">${catById(i.category).icon}</span>`}</div>
    <div class="card-label">${esc(i.name || catById(i.category).label)}</div>${extra}
  </button>`;
}

function renderWardrobe() {
  const q = state.wardrobeQuery.toLowerCase();
  const list = state.items.filter(i =>
    (state.wardrobeCat === 'all' || i.category === state.wardrobeCat) &&
    (!q || [i.name, i.brand, i.color, i.notes].join(' ').toLowerCase().includes(q)));
  const counts = Object.fromEntries(CATEGORIES.map(c => [c.id, state.items.filter(i => i.category === c.id).length]));

  $('#view').innerHTML = `
    <div class="toolbar">
      <input type="search" id="w-search" placeholder="Rechercher (nom, couleur, marque…)" value="${esc(state.wardrobeQuery)}">
    </div>
    <div class="chips">
      <button class="chip ${state.wardrobeCat === 'all' ? 'on' : ''}" data-cat="all">Tout <b>${state.items.length}</b></button>
      ${CATEGORIES.filter(c => counts[c.id]).map(c => `<button class="chip ${state.wardrobeCat === c.id ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${c.label} <b>${counts[c.id]}</b></button>`).join('')}
    </div>
    ${state.items.length === 0 ? `
      <div class="empty">
        <div class="empty-icon">📸</div>
        <h2>Ta garde-robe est vide</h2>
        <p>Prends en photo tes vêtements un par un : le décor est retiré automatiquement pour ne garder que le vêtement.</p>
        <button class="btn primary" id="empty-add">Ajouter mon premier vêtement</button>
      </div>` : list.length === 0 ? `<p class="muted center">Aucun vêtement ne correspond.</p>` :
      `<div class="grid">${list.map(i => itemCard(i)).join('')}</div>`}
    <button class="fab" id="fab-add" aria-label="Ajouter un vêtement">＋</button>`;

  const s = $('#w-search');
  s.addEventListener('input', () => {
    state.wardrobeQuery = s.value;
    const pos = s.selectionStart;
    renderWardrobe();
    const n = $('#w-search'); n.focus(); n.setSelectionRange(pos, pos);
  });
  $$('[data-cat]').forEach(b => b.addEventListener('click', () => { state.wardrobeCat = b.dataset.cat; renderWardrobe(); }));
  $$('[data-item]').forEach(b => b.addEventListener('click', () => itemDetail(b.dataset.item)));
  $('#fab-add').addEventListener('click', () => addItemFlow());
  $('#empty-add')?.addEventListener('click', () => addItemFlow());
}

// --- Ajout d'un vêtement : photo → détourage → fiche ---
function addItemFlow(prefill = {}) {
  openModal(`
    <h2>Nouveau vêtement</h2>
    <p class="muted">Pose le vêtement à plat ou sur un cintre, bien éclairé. Le fond sera retiré automatiquement.</p>
    <div class="photo-actions">
      <label class="btn primary big">📷 Prendre une photo
        <input type="file" accept="image/*" capture="environment" hidden id="in-camera">
      </label>
      <label class="btn big">🖼️ Choisir dans la galerie
        <input type="file" accept="image/*" hidden id="in-gallery">
      </label>
    </div>
    <label class="switch"><input type="checkbox" id="auto-cut" checked> Retirer le décor automatiquement</label>
    <button class="btn ghost" id="no-photo">Continuer sans photo</button>
  `, root => {
    const handle = async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const auto = $('#auto-cut', root).checked;
      await processPhoto(file, auto, prefill);
    };
    $('#in-camera', root).addEventListener('change', handle);
    $('#in-gallery', root).addEventListener('change', handle);
    $('#no-photo', root).addEventListener('click', () => itemForm({ ...prefill }, null));
  });
}

async function processPhoto(file, auto, prefill) {
  openModal(`<div class="processing"><div class="spinner"></div><p id="proc-status">${auto ? 'Préparation…' : 'Traitement…'}</p>
    ${auto ? '<p class="muted small">La première fois, le modèle de détourage est téléchargé (≈ 40 Mo). Ensuite c\'est plus rapide.</p>' : ''}</div>`);
  const status = msg => { const el = $('#proc-status'); if (el) el.textContent = msg; };
  let cut = null, original = null;
  try {
    original = await keepOriginal(file);
    if (auto) cut = await removeBackground(file, status);
  } catch (err) {
    console.error(err);
    toast('Détourage impossible, photo originale conservée.');
  }
  itemForm({ ...prefill }, cut || original, cut ? original : null);
}

function itemForm(item, image, altImage = null) {
  const isNew = !item.id;
  let currentImage = image ?? item.image ?? null;
  let other = altImage;
  const seasons = item.seasons || [];
  openModal(`
    <h2>${isNew ? 'Nouveau vêtement' : 'Modifier'}</h2>
    <div class="preview ${currentImage ? '' : 'none'}"><img id="prev-img" src="${currentImage ? URL.createObjectURL(currentImage) : ''}" alt=""></div>
    ${other ? '<button class="btn ghost small" id="swap-img">↺ Utiliser la photo avec le décor</button>' : ''}
    ${!isNew ? `<label class="btn ghost small">📷 Changer la photo<input type="file" accept="image/*" hidden id="re-photo"></label>` : ''}
    <form id="item-form" class="form">
      <label>Nom<input name="name" required placeholder="Ex : T-shirt blanc col rond" value="${esc(item.name)}"></label>
      <label>Catégorie<select name="category">${CATEGORIES.map(c => `<option value="${c.id}" ${item.category === c.id ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}</select></label>
      <div class="row">
        <label>Couleur<input name="color" placeholder="Blanc" value="${esc(item.color)}"></label>
        <label>Marque<input name="brand" placeholder="Uniqlo" value="${esc(item.brand)}"></label>
      </div>
      <fieldset><legend>Saisons</legend>
        <div class="checks">${SEASONS.map(s => `<label class="check"><input type="checkbox" name="seasons" value="${s}" ${seasons.includes(s) ? 'checked' : ''}> ${s}</label>`).join('')}</div>
        <p class="muted small">Rien de coché = toutes saisons.</p>
      </fieldset>
      <label>Notes<textarea name="notes" rows="2" placeholder="Taille, matière, où acheté…">${esc(item.notes)}</textarea></label>
      <button class="btn primary big" type="submit">${isNew ? 'Ajouter à ma garde-robe' : 'Enregistrer'}</button>
    </form>
  `, root => {
    $('#swap-img', root)?.addEventListener('click', e => {
      [currentImage, other] = [other, currentImage];
      $('#prev-img', root).src = URL.createObjectURL(currentImage);
      e.target.textContent = e.target.textContent.includes('avec') ? '✂︎ Utiliser la photo détourée' : '↺ Utiliser la photo avec le décor';
    });
    $('#re-photo', root)?.addEventListener('change', async e => {
      const f = e.target.files?.[0]; if (!f) return;
      const saved = { ...item, ...Object.fromEntries(new FormData($('#item-form', root))) };
      saved.seasons = new FormData($('#item-form', root)).getAll('seasons');
      await processPhoto(f, true, saved);
    });
    $('#item-form', root).addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const obj = {
        ...item,
        id: item.id || db.uid(),
        name: fd.get('name').trim(),
        category: fd.get('category'),
        color: fd.get('color').trim(),
        brand: fd.get('brand').trim(),
        seasons: fd.getAll('seasons'),
        notes: fd.get('notes').trim(),
        image: currentImage,
        createdAt: item.createdAt || Date.now(),
        wearCount: item.wearCount || 0,
        lastWorn: item.lastWorn || null,
      };
      await db.put('items', obj);
      if (item.fromWish) {
        const w = await db.get('wishes', item.fromWish);
        if (w) await db.put('wishes', { ...w, status: 'achete' });
        delete obj.fromWish; await db.put('items', obj);
      }
      await reload();
      closeModal();
      toast(isNew ? 'Ajouté à ta garde-robe ✓' : 'Modifié ✓');
      render();
    });
  });
}

function itemDetail(id) {
  const i = state.items.find(x => x.id === id);
  if (!i) return;
  const inOutfits = state.outfits.filter(o => o.itemIds.includes(id));
  openModal(`
    <div class="detail-img">${i.image ? `<img src="${imgURL(i)}" alt="">` : `<span class="ph big">${catById(i.category).icon}</span>`}</div>
    <h2>${esc(i.name)}</h2>
    <p class="muted">${catById(i.category).icon} ${catById(i.category).label}${i.color ? ' · ' + esc(i.color) : ''}${i.brand ? ' · ' + esc(i.brand) : ''}</p>
    <div class="tags">${(i.seasons?.length ? i.seasons : ['Toutes saisons']).map(s => `<span class="tag">${s}</span>`).join('')}</div>
    ${i.notes ? `<p>${esc(i.notes)}</p>` : ''}
    <p class="muted small">Porté ${i.wearCount || 0} fois${i.lastWorn ? ` · dernière fois le ${new Date(i.lastWorn).toLocaleDateString('fr-FR')}` : ''}</p>
    ${inOutfits.length ? `<p class="small">Dans ${inOutfits.length} tenue(s) : ${inOutfits.map(o => esc(o.name)).join(', ')}</p>` : ''}
    <div class="actions">
      <button class="btn primary" id="d-wear">👍 Porté aujourd'hui</button>
      <button class="btn" id="d-edit">✏️ Modifier</button>
      <button class="btn danger" id="d-del">🗑️ Supprimer</button>
    </div>
  `, root => {
    $('#d-wear', root).addEventListener('click', async () => { await markWorn([id]); closeModal(); toast('Noté ✓'); render(); });
    $('#d-edit', root).addEventListener('click', () => itemForm(i, null));
    $('#d-del', root).addEventListener('click', async () => {
      if (!confirm(`Supprimer « ${i.name} » ?`)) return;
      await db.del('items', id);
      for (const o of inOutfits) await db.put('outfits', { ...o, itemIds: o.itemIds.filter(x => x !== id) });
      await reload(); closeModal(); render(); toast('Supprimé');
    });
  });
}

async function markWorn(ids) {
  const now = Date.now();
  for (const id of ids) {
    const i = state.items.find(x => x.id === id);
    if (i) await db.put('items', { ...i, wearCount: (i.wearCount || 0) + 1, lastWorn: now });
  }
  await reload();
}

// =====================================================================
// TENUES
// =====================================================================
const DAILY_KEY = 'tenue-du-jour';
function loadDaily() { try { const d = JSON.parse(localStorage.getItem(DAILY_KEY)); return d?.date === today() ? d : null; } catch { return null; } }
function saveDaily(d) { try { localStorage.setItem(DAILY_KEY, JSON.stringify({ ...d, date: today() })); } catch {} }

// Tirage pondéré : favorise les pièces moins portées / pas portées récemment
function pick(list) {
  if (!list.length) return null;
  const now = Date.now();
  const weights = list.map(i => {
    const days = i.lastWorn ? (now - i.lastWorn) / 864e5 : 30;
    return (1 / (1 + (i.wearCount || 0) * 0.3)) * Math.min(1, 0.2 + days / 7);
  });
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < list.length; k++) { r -= weights[k]; if (r <= 0) return list[k]; }
  return list.at(-1);
}

function generateOutfit() {
  const season = currentSeason();
  const fits = state.items.filter(i => !i.seasons?.length || i.seasons.includes(season));
  const pool = cats => fits.filter(i => cats.includes(i.category));

  // 1 fois sur 2, on reprend une tenue "Quotidien" enregistrée si possible
  const daily = state.outfits.filter(o => o.style === 'Quotidien' && o.itemIds.length);
  if (daily.length && Math.random() < 0.5) {
    const o = daily[Math.floor(Math.random() * daily.length)];
    return { outfitId: o.id, itemIds: o.itemIds };
  }

  const ids = [];
  const dress = pool(['robe']);
  if (dress.length && Math.random() < 0.3) ids.push(pick(dress).id);
  else {
    const top = pick(pool(['haut', 'pull']));
    const bottom = pick(pool(season === 'Été' ? ['short', 'bas'] : ['bas', 'short']));
    if (top) ids.push(top.id);
    if (bottom) ids.push(bottom.id);
    if ((season === 'Automne' || season === 'Hiver') && top?.category === 'haut') {
      const layer = pick(pool(['pull'])); if (layer && Math.random() < 0.5) ids.push(layer.id);
    }
  }
  if (season !== 'Été') { const v = pick(pool(['veste'])); if (v) ids.push(v.id); }
  const shoes = pick(pool(['chaussures'])); if (shoes) ids.push(shoes.id);
  const acc = pick(pool(['accessoire'])); if (acc && Math.random() < 0.35) ids.push(acc.id);
  return { outfitId: null, itemIds: ids };
}

function collage(itemIds, cls = '') {
  const items = itemIds.map(id => state.items.find(i => i.id === id)).filter(Boolean);
  if (!items.length) return `<div class="collage empty-collage ${cls}">?</div>`;
  return `<div class="collage n${Math.min(items.length, 6)} ${cls}">${items.slice(0, 6).map(i =>
    `<div class="cell">${i.image ? `<img src="${imgURL(i)}" alt="${esc(i.name)}">` : `<span class="ph">${catById(i.category).icon}</span>`}</div>`).join('')}</div>`;
}

function renderOutfits() {
  let daily = loadDaily();
  if (state.items.length && (!daily || !daily.itemIds.some(id => state.items.find(i => i.id === id)))) {
    daily = generateOutfit(); saveDaily(daily);
  }
  const savedDaily = daily?.outfitId && state.outfits.find(o => o.id === daily.outfitId);
  const list = state.outfits.filter(o => state.outfitStyle === 'all' || o.style === state.outfitStyle);

  $('#view').innerHTML = `
    <section class="daily">
      <div class="daily-head"><h2>Tenue du jour</h2><span class="tag">${currentSeason()}</span></div>
      ${!state.items.length ? '<p class="muted">Ajoute des vêtements dans ta garde-robe pour recevoir une idée de tenue chaque jour.</p>' : `
        ${savedDaily ? `<p class="muted small">Ta tenue « ${esc(savedDaily.name)} »</p>` : ''}
        ${collage(daily.itemIds, 'large')}
        <p class="small">${daily.itemIds.map(id => state.items.find(i => i.id === id)).filter(Boolean).map(i => esc(i.name)).join(' + ')}</p>
        <div class="actions">
          ${daily.worn ? '<span class="tag ok">✓ Portée aujourd\'hui</span>' : '<button class="btn primary" id="dl-wear">👍 Je la porte</button>'}
          <button class="btn" id="dl-shuffle">🔀 Une autre idée</button>
          ${!daily.outfitId ? '<button class="btn" id="dl-save">💾 Enregistrer</button>' : ''}
        </div>`}
    </section>

    <h2 class="section-title">Mes tenues</h2>
    <div class="chips">
      <button class="chip ${state.outfitStyle === 'all' ? 'on' : ''}" data-style="all">Toutes <b>${state.outfits.length}</b></button>
      ${STYLES.map(s => `<button class="chip ${state.outfitStyle === s ? 'on' : ''}" data-style="${s}">${s} <b>${state.outfits.filter(o => o.style === s).length}</b></button>`).join('')}
    </div>
    ${list.length ? `<div class="grid outfits">${list.map(o => `
      <button class="card" data-outfit="${o.id}">
        ${collage(o.itemIds)}
        <div class="card-label">${esc(o.name)}</div>
        <div class="card-sub">${esc(o.style)}${o.wornDates?.length ? ` · portée ${o.wornDates.length}×` : ''}</div>
      </button>`).join('')}</div>`
      : `<p class="muted center">Aucune tenue ${state.outfitStyle === 'all' ? '' : '« ' + esc(state.outfitStyle) + ' » '}pour l'instant.<br>Compose tes looks du quotidien avec le bouton ＋.</p>`}
    <button class="fab" id="fab-outfit" aria-label="Créer une tenue">＋</button>`;

  $('#dl-wear')?.addEventListener('click', async () => {
    await markWorn(daily.itemIds);
    if (daily.outfitId) {
      const o = state.outfits.find(x => x.id === daily.outfitId);
      if (o) await db.put('outfits', { ...o, wornDates: [...(o.wornDates || []), today()] });
      await reload();
    }
    saveDaily({ ...daily, worn: true }); toast('Bonne journée ! ✨'); renderOutfits();
  });
  $('#dl-shuffle')?.addEventListener('click', () => { saveDaily(generateOutfit()); renderOutfits(); });
  $('#dl-save')?.addEventListener('click', () => outfitForm({ itemIds: daily.itemIds, style: 'Quotidien' }));
  $$('[data-style]').forEach(b => b.addEventListener('click', () => { state.outfitStyle = b.dataset.style; renderOutfits(); }));
  $$('[data-outfit]').forEach(b => b.addEventListener('click', () => outfitDetail(b.dataset.outfit)));
  $('#fab-outfit').addEventListener('click', () => {
    if (!state.items.length) return toast('Ajoute d\'abord des vêtements à ta garde-robe');
    outfitForm({ style: state.outfitStyle === 'all' ? 'Quotidien' : state.outfitStyle });
  });
}

function outfitForm(outfit = {}) {
  const isNew = !outfit.id;
  const selected = new Set(outfit.itemIds || []);
  let cat = 'all';
  openModal(`
    <h2>${isNew ? 'Nouvelle tenue' : 'Modifier la tenue'}</h2>
    <form id="o-form" class="form">
      <label>Nom<input name="name" required placeholder="Ex : Jean + chemise bleue" value="${esc(outfit.name)}"></label>
      <label>Style<select name="style">${STYLES.map(s => `<option ${outfit.style === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div id="o-preview"></div>
      <p class="small"><b>Choisis les pièces</b> (<span id="o-count">${selected.size}</span> sélectionnée(s))</p>
      <div class="chips" id="o-cats"></div>
      <div class="grid picker" id="o-grid"></div>
      <button class="btn primary big sticky-bottom" type="submit">${isNew ? 'Créer la tenue' : 'Enregistrer'}</button>
    </form>
  `, root => {
    const draw = () => {
      $('#o-cats', root).innerHTML = [`<button type="button" class="chip ${cat === 'all' ? 'on' : ''}" data-c="all">Tout</button>`,
        ...CATEGORIES.filter(c => state.items.some(i => i.category === c.id)).map(c => `<button type="button" class="chip ${cat === c.id ? 'on' : ''}" data-c="${c.id}">${c.icon} ${c.label}</button>`)].join('');
      $('#o-grid', root).innerHTML = state.items.filter(i => cat === 'all' || i.category === cat).map(i =>
        itemCard(i, selected.has(i.id) ? '<span class="check-badge">✓</span>' : '').replace('class="card item-card"', `type="button" class="card item-card ${selected.has(i.id) ? 'selected' : ''}"`)).join('');
      $('#o-preview', root).innerHTML = selected.size ? collage([...selected]) : '';
      $('#o-count', root).textContent = selected.size;
      $$('[data-c]', root).forEach(b => b.addEventListener('click', () => { cat = b.dataset.c; draw(); }));
      $$('[data-item]', root).forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.item; selected.has(id) ? selected.delete(id) : selected.add(id); draw();
      }));
    };
    draw();
    $('#o-form', root).addEventListener('submit', async e => {
      e.preventDefault();
      if (!selected.size) return toast('Choisis au moins une pièce');
      const fd = new FormData(e.target);
      const obj = { wornDates: [], ...outfit, id: outfit.id || db.uid(), name: fd.get('name').trim(), style: fd.get('style'), itemIds: [...selected], createdAt: outfit.createdAt || Date.now() };
      await db.put('outfits', obj);
      const d = loadDaily();
      if (d && !d.outfitId && isNew && d.itemIds.join() === obj.itemIds.join()) saveDaily({ ...d, outfitId: obj.id });
      await reload(); closeModal(); toast('Tenue enregistrée ✓'); render();
    });
  });
}

function outfitDetail(id) {
  const o = state.outfits.find(x => x.id === id);
  if (!o) return;
  const items = o.itemIds.map(x => state.items.find(i => i.id === x)).filter(Boolean);
  openModal(`
    ${collage(o.itemIds, 'large')}
    <h2>${esc(o.name)}</h2>
    <div class="tags"><span class="tag">${esc(o.style)}</span>${o.wornDates?.length ? `<span class="tag">Portée ${o.wornDates.length}×</span>` : ''}</div>
    <div class="grid small-grid">${items.map(i => itemCard(i)).join('')}</div>
    <div class="actions">
      <button class="btn primary" id="od-wear">👍 Je la porte aujourd'hui</button>
      <button class="btn" id="od-edit">✏️ Modifier</button>
      <button class="btn danger" id="od-del">🗑️ Supprimer</button>
    </div>
  `, root => {
    $$('[data-item]', root).forEach(b => b.addEventListener('click', () => itemDetail(b.dataset.item)));
    $('#od-wear', root).addEventListener('click', async () => {
      await markWorn(o.itemIds);
      await db.put('outfits', { ...o, wornDates: [...(o.wornDates || []), today()] });
      saveDaily({ outfitId: o.id, itemIds: o.itemIds, worn: true });
      await reload(); closeModal(); toast('Bonne journée ! ✨'); render();
    });
    $('#od-edit', root).addEventListener('click', () => outfitForm(o));
    $('#od-del', root).addEventListener('click', async () => {
      if (!confirm(`Supprimer la tenue « ${o.name} » ?`)) return;
      await db.del('outfits', id); await reload(); closeModal(); render(); toast('Supprimée');
    });
  });
}

// =====================================================================
// ACHATS POTENTIELS
// =====================================================================
function productCard(p, actions) {
  const img = p.image ? imgURL(p) : safeUrl(p.imageUrl);
  return `<article class="product">
    <div class="p-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'🛍️'}))">` : '<span class="ph">🛍️</span>'}</div>
    <div class="p-body">
      <div class="p-name">${esc(p.name)}</div>
      <div class="p-meta">${[esc(p.brand), fmtPrice(p.price)].filter(Boolean).join(' · ')}</div>
      ${p.why || p.notes ? `<p class="p-why">${esc(p.why || p.notes)}</p>` : ''}
      <div class="p-actions">
        ${safeUrl(p.url) ? `<a class="btn small" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">Voir ↗</a>` : ''}
        ${actions}
      </div>
    </div>
  </article>`;
}

function renderShopping() {
  const tabs = [['wishes', '💭 Mes envies'], ['search', '🔎 Rechercher'], ['suggest', '✨ Suggestions']];
  $('#view').innerHTML = `
    <div class="segmented">${tabs.map(([k, l]) => `<button class="${state.shopTab === k ? 'on' : ''}" data-shop="${k}">${l}</button>`).join('')}</div>
    <div id="shop-body"></div>`;
  $$('[data-shop]').forEach(b => b.addEventListener('click', () => { state.shopTab = b.dataset.shop; renderShopping(); }));
  ({ wishes: renderWishes, search: renderSearch, suggest: renderSuggestions })[state.shopTab]();
}

function renderWishes() {
  const active = state.wishes.filter(w => w.status !== 'achete');
  const bought = state.wishes.filter(w => w.status === 'achete');
  const total = active.reduce((s, w) => s + (Number(w.price) || 0), 0);
  $('#shop-body').innerHTML = `
    ${active.length ? `<p class="muted small">${active.length} envie(s)${total ? ` · total ${fmtPrice(total)}` : ''}</p>
      <div class="products">${active.map(w => productCard(w, `
        <button class="btn small primary" data-bought="${w.id}">✓ Acheté</button>
        <button class="btn small ghost" data-wedit="${w.id}">✏️</button>
        <button class="btn small ghost" data-wdel="${w.id}">🗑️</button>`)).join('')}</div>`
    : `<div class="empty"><div class="empty-icon">💭</div><h2>Aucune envie pour l'instant</h2>
       <p>Ajoute des articles repérés, ou demande à Claude de chercher pour toi dans l'onglet « Rechercher ».</p></div>`}
    ${bought.length ? `<details class="bought"><summary>Déjà achetés (${bought.length})</summary>
      <div class="products">${bought.map(w => productCard(w, `<button class="btn small ghost" data-wdel="${w.id}">🗑️</button>`)).join('')}</div></details>` : ''}
    <button class="fab" id="fab-wish" aria-label="Ajouter une envie">＋</button>`;

  $('#fab-wish').addEventListener('click', () => wishForm());
  $$('[data-wedit]').forEach(b => b.addEventListener('click', () => wishForm(state.wishes.find(w => w.id === b.dataset.wedit))));
  $$('[data-wdel]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Supprimer cet article ?')) return;
    await db.del('wishes', b.dataset.wdel); await reload(); renderShopping();
  }));
  $$('[data-bought]').forEach(b => b.addEventListener('click', () => {
    const w = state.wishes.find(x => x.id === b.dataset.bought);
    openModal(`<h2>Bravo pour l'achat ! 🎉</h2><p>Tu veux l'ajouter à ta garde-robe ? Prends-le en photo une fois reçu.</p>
      <div class="actions"><button class="btn primary" id="b-add">📷 Ajouter à ma garde-robe</button>
      <button class="btn" id="b-only">Juste marquer comme acheté</button></div>`, root => {
      $('#b-add', root).addEventListener('click', () => addItemFlow({ name: w.name, brand: w.brand, category: w.category, notes: w.url ? `Acheté : ${w.url}` : '', fromWish: w.id }));
      $('#b-only', root).addEventListener('click', async () => { await db.put('wishes', { ...w, status: 'achete' }); await reload(); closeModal(); renderShopping(); });
    });
  }));
}

function wishForm(w = {}) {
  let image = w.image || null;
  openModal(`
    <h2>${w.id ? 'Modifier l\'envie' : 'Nouvelle envie'}</h2>
    <form id="wish-form" class="form">
      <label>Nom<input name="name" required value="${esc(w.name)}" placeholder="Ex : Veste en jean brut"></label>
      <div class="row">
        <label>Marque<input name="brand" value="${esc(w.brand)}"></label>
        <label>Prix (€)<input name="price" type="number" step="0.01" inputmode="decimal" value="${esc(w.price ?? '')}"></label>
      </div>
      <label>Catégorie<select name="category">${CATEGORIES.map(c => `<option value="${c.id}" ${w.category === c.id ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}</select></label>
      <label>Lien<input name="url" type="url" value="${esc(w.url)}" placeholder="https://…"></label>
      <label>Notes<textarea name="notes" rows="2">${esc(w.notes)}</textarea></label>
      <label class="btn ghost small">📷 Ajouter une photo / capture<input type="file" accept="image/*" hidden id="wish-photo"></label>
      <span class="small muted" id="wish-photo-ok">${image ? 'Photo ajoutée ✓' : ''}</span>
      <button class="btn primary big" type="submit">Enregistrer</button>
    </form>`, root => {
    $('#wish-photo', root).addEventListener('change', async e => {
      const f = e.target.files?.[0]; if (!f) return;
      image = await keepOriginal(f); $('#wish-photo-ok', root).textContent = 'Photo ajoutée ✓';
    });
    $('#wish-form', root).addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await db.put('wishes', {
        source: 'manuel', status: 'envie', ...w, id: w.id || db.uid(), createdAt: w.createdAt || Date.now(),
        name: fd.get('name').trim(), brand: fd.get('brand').trim(), price: fd.get('price') ? Number(fd.get('price')) : null,
        category: fd.get('category'), url: fd.get('url').trim(), notes: fd.get('notes').trim(), image,
      });
      await reload(); closeModal(); toast('Envie enregistrée ✓'); state.shopTab = 'wishes'; renderShopping();
    });
  });
}

async function addWishFromProduct(p, source) {
  if (state.wishes.some(w => w.url && w.url === p.url)) return toast('Déjà dans tes envies');
  const cat = CATEGORIES.find(c => c.id === p.category || c.label.toLowerCase().includes(String(p.category || '').toLowerCase()));
  await db.put('wishes', {
    id: db.uid(), createdAt: Date.now(), status: 'envie', source,
    name: p.name, brand: p.brand || '', price: typeof p.price === 'number' ? p.price : null,
    category: cat?.id || 'autre', url: safeUrl(p.url), imageUrl: safeUrl(p.imageUrl), notes: p.why || '',
  });
  await reload(); toast('Ajouté à tes envies ✓');
}

const QUICK_PROMPTS = [
  'Ce qui manque à ma garde-robe pour faire plus de tenues',
  'Des basiques de qualité pour le quotidien',
  'Une veste pour cet hiver',
  'Une paire de baskets qui va avec tout',
  'Une tenue pour un mariage',
];

function renderSearch() {
  const hasKey = !!getKey();
  $('#shop-body').innerHTML = `
    <form id="s-form" class="form card-pad">
      <label>Qu'est-ce que tu cherches ?<textarea name="q" rows="3" required placeholder="Ex : un pull en laine gris pas trop épais, style minimaliste">${esc(state.lastQuery || '')}</textarea></label>
      <div class="chips wrap">${QUICK_PROMPTS.map(p => `<button type="button" class="chip" data-qp="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <label>Budget max par article (€, optionnel)<input name="budget" type="number" inputmode="numeric" value="${esc(state.lastBudget || '')}"></label>
      <button class="btn primary big" type="submit" ${state.searching ? 'disabled' : ''}>${state.searching ? 'Recherche en cours…' : '🔎 Demander à Claude'}</button>
      ${hasKey ? '<p class="muted small">Claude tient compte de ce que tu as déjà dans ta garde-robe.</p>'
        : '<p class="small warn">Pour la recherche dans l\'appli, ajoute ta clé API Anthropic dans les réglages ⚙︎. Sinon, demande-moi directement dans Claude : je mettrai à jour l\'onglet « Suggestions ».</p>'}
    </form>
    <div id="s-results">${searchResultsHTML()}</div>`;

  $$('[data-qp]').forEach(b => b.addEventListener('click', () => { $('#s-form textarea').value = b.dataset.qp; }));
  $('#s-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.lastQuery = fd.get('q'); state.lastBudget = fd.get('budget');
    state.searching = true; state.searchResults = null; state.searchAdvice = ''; state.searchStatus = 'Démarrage…';
    renderSearch();
    try {
      const r = await searchClothes({ query: state.lastQuery, budget: state.lastBudget, wardrobeSummary: wardrobeSummary() }, msg => {
        state.searchStatus = msg; const el = $('#s-status'); if (el) el.textContent = msg;
      });
      state.searchResults = r.results; state.searchAdvice = r.advice;
    } catch (err) {
      console.error(err);
      state.searchResults = []; state.searchAdvice = '';
      toast(err?.status === 401 ? 'Clé API invalide' : (err.message || 'Erreur pendant la recherche'));
    } finally {
      state.searching = false;
      if (state.tab === 'shopping' && state.shopTab === 'search') renderSearch();
    }
  });
  bindProductAdds($('#s-results'), state.searchResults || [], 'claude');
}

function searchResultsHTML() {
  if (state.searching) return `<div class="processing"><div class="spinner"></div><p id="s-status">${esc(state.searchStatus)}</p><p class="muted small">Ça peut prendre une minute.</p></div>`;
  if (!state.searchResults) return '';
  return `${state.searchAdvice ? `<div class="advice">${esc(state.searchAdvice).replace(/\n/g, '<br>')}</div>` : ''}
    ${state.searchResults.length ? `<div class="products">${state.searchResults.map((p, k) => productCard(p, `<button class="btn small primary" data-add="${k}">＋ Envies</button>`)).join('')}</div>`
      : '<p class="muted center">Aucun résultat exploitable. Essaie de reformuler.</p>'}`;
}

function bindProductAdds(root, list, source) {
  $$('[data-add]', root).forEach(b => b.addEventListener('click', async () => {
    await addWishFromProduct(list[+b.dataset.add], source);
    b.textContent = '✓ Ajouté'; b.disabled = true;
  }));
}

async function renderSuggestions() {
  const body = $('#shop-body');
  if (!state.suggestions) {
    body.innerHTML = '<div class="processing"><div class="spinner"></div></div>';
    try {
      const res = await fetch(`data/suggestions.json?t=${Date.now()}`);
      state.suggestions = await res.json();
    } catch { state.suggestions = { items: [] }; }
    if (state.shopTab !== 'suggest' || state.tab !== 'shopping') return;
  }
  const s = state.suggestions;
  body.innerHTML = `
    <div class="advice">
      <b>Sélection préparée par Claude</b>${s.updatedAt ? ` · mise à jour le ${new Date(s.updatedAt).toLocaleDateString('fr-FR')}` : ''}
      ${s.note ? `<p>${esc(s.note)}</p>` : ''}
      <p class="muted small">Pour la mettre à jour : dans Réglages ⚙︎, copie ton inventaire et envoie-le-moi dans Claude avec ce que tu cherches. Je mets à jour cette liste.</p>
    </div>
    ${s.items?.length ? `<div class="products">${s.items.map((p, k) => productCard(p, `<button class="btn small primary" data-add="${k}">＋ Envies</button>`)).join('')}</div>`
      : '<p class="muted center">Pas encore de suggestions.</p>'}`;
  bindProductAdds(body, s.items || [], 'claude');
}

// =====================================================================
// RÉGLAGES
// =====================================================================
function openSettings() {
  const key = getKey();
  openModal(`
    <h2>Réglages</h2>
    <section class="settings-block">
      <h3>📊 Ma garde-robe</h3>
      <p>${state.items.length} vêtement(s) · ${state.outfits.length} tenue(s) · ${state.wishes.filter(w => w.status !== 'achete').length} envie(s)</p>
    </section>
    <section class="settings-block">
      <h3>🤖 Claude</h3>
      <button class="btn" id="st-copy">📋 Copier mon inventaire pour Claude</button>
      <p class="muted small">Colle-le dans une conversation avec Claude pour avoir des conseils ou mettre à jour l'onglet Suggestions.</p>
      <form id="st-key" class="form">
        <label>Clé API Anthropic (pour la recherche dans l'appli)
          <input name="key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(key)}"></label>
        <div class="row"><button class="btn primary" type="submit">Enregistrer la clé</button>${key ? '<button class="btn ghost" type="button" id="st-delkey">Supprimer</button>' : ''}</div>
        <p class="muted small">Stockée uniquement sur cet appareil. Crée une clé sur console.anthropic.com.</p>
      </form>
    </section>
    <section class="settings-block">
      <h3>💾 Sauvegarde</h3>
      <p class="muted small">Tes données sont stockées sur cet appareil. Exporte-les régulièrement (photos incluses).</p>
      <div class="actions">
        <button class="btn" id="st-export">⬇️ Exporter</button>
        <label class="btn">⬆️ Importer<input type="file" accept="application/json,.json" hidden id="st-import"></label>
      </div>
    </section>
  `, root => {
    $('#st-copy', root).addEventListener('click', async () => {
      const txt = `Voici ma garde-robe (${state.items.length} pièces) :\n${wardrobeSummary() || '(vide)'}\n\nMes tenues : ${state.outfits.map(o => `${o.name} [${o.style}]`).join(', ') || 'aucune'}\nMes envies : ${state.wishes.filter(w => w.status !== 'achete').map(w => w.name).join(', ') || 'aucune'}`;
      try { await navigator.clipboard.writeText(txt); toast('Inventaire copié ✓'); }
      catch { prompt('Copie ce texte :', txt); }
    });
    $('#st-key', root).addEventListener('submit', e => { e.preventDefault(); setKey(new FormData(e.target).get('key').trim()); toast('Clé enregistrée ✓'); closeModal(); });
    $('#st-delkey', root)?.addEventListener('click', () => { setKey(''); toast('Clé supprimée'); closeModal(); });
    $('#st-export', root).addEventListener('click', async () => {
      toast('Préparation de la sauvegarde…');
      const data = await db.exportAll();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      a.download = `garde-robe-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    $('#st-import', root).addEventListener('change', async e => {
      const f = e.target.files?.[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const replace = confirm('Remplacer toutes les données actuelles ?\nOK = remplacer · Annuler = fusionner');
        await db.importAll(data, { replace });
        await reload(); closeModal(); render(); toast('Import réussi ✓');
      } catch (err) { toast(err.message || 'Import impossible'); }
    });
  });
}

// ---------- Démarrage ----------
(async function init() {
  await reload();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
})();
