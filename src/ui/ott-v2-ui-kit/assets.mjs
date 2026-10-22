export const ASSET_SOURCE = new URL('./assets/ott-elements-simple.png', import.meta.url).href;
export const ASSETS = Object.freeze({
  rock: [37,151,351,235], paper: [425,141,407,231], scissors: [879,75,339,345],
  fire: [23,457,379,363], water: [433,525,393,279], bush: [861,509,375,307],
  chasm: [31,883,373,329], castle: [455,855,345,351]
});
export function createAsset(name, { label = '', size } = {}) {
  const region = ASSETS[name];
  if (!region) throw new TypeError(`Unknown OTT asset: ${name}`);
  const [x,y,w,h] = region, scale = 96 / Math.max(w,h);
  const root = document.createElement('span');
  root.className = 'ott-art';
  root.dataset.asset = name;
  if (label) { root.setAttribute('role','img'); root.setAttribute('aria-label',label); }
  else root.setAttribute('aria-hidden','true');
  if (size !== undefined) {
    if (!Number.isFinite(size) || size <= 0) throw new TypeError('Asset size must be a positive number.');
    root.style.width = `${size}px`; root.style.height = `${size}px`;
  }
  const crop = document.createElement('span'); crop.className = 'ott-art__crop';
  crop.style.width = `${w * scale}%`; crop.style.height = `${h * scale}%`;
  const img = document.createElement('img');
  img.src = ASSET_SOURCE; img.alt = ''; img.draggable = false; img.decoding = 'async';
  img.style.width = `${125400 / w}%`; img.style.left = `${-100*x/w}%`; img.style.top = `${-100*y/h}%`;
  crop.append(img); root.append(crop); return root;
}
