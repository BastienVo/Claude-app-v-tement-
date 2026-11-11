// Détourage automatique du vêtement (suppression du décor) directement dans le navigateur.
// Le modèle (~40 Mo) est téléchargé une seule fois puis mis en cache par le navigateur.
const BG_LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';

let libPromise;
const loadLib = () => (libPromise ||= import(BG_LIB));

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

const toBlob = (canvas, type = 'image/webp', q = 0.9) =>
  new Promise(r => canvas.toBlob(b => r(b), type, q));

// Réduit la photo avant traitement (plus rapide, moins de mémoire)
export async function downscale(blob, max = 1600) {
  const img = await loadImage(blob);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return toBlob(c, 'image/jpeg', 0.92);
}

// Recadre au plus près du vêtement (pixels non transparents) + petite marge
async function cropToContent(blob, max = 900) {
  const img = await loadImage(blob);
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 20) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return blob; // rien détecté : on garde tel quel
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const scale = Math.min(1, max / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.round(cw * scale); out.height = Math.round(ch * scale);
  out.getContext('2d').drawImage(c, minX, minY, cw, ch, 0, 0, out.width, out.height);
  return toBlob(out, 'image/webp', 0.9);
}

export async function removeBackground(file, onProgress = () => {}) {
  const small = await downscale(file);
  const { removeBackground: rb } = await loadLib();
  const cut = await rb(small, {
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      if (key.startsWith('fetch')) onProgress(`Téléchargement du modèle… ${total ? Math.round((current / total) * 100) : 0}%`);
      else onProgress('Détourage en cours…');
    },
  });
  return cropToContent(cut);
}

// Version sans détourage (juste redimensionnée)
export async function keepOriginal(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return toBlob(c, 'image/webp', 0.88);
}
