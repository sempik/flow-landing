// Flow — процедурные 3D-наушники в форме полноразмерных «алюминиевых» флагманов (светлый анодированный
// алюминий, подушкообразные чашки-«сквиркл», рама оголовья + сетчатый гамак) и хореография по главам (Three.js r160)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- хелперы ----------
function hpRand(i, k) { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); }
function hpClamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function hpSmooth(a, b, x) { const t = hpClamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
function hpEase(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function hpLerp(a, b, t) { return a + (b - a) * t; }

// замкнутый профиль-суперэллипс (против часовой), [u, v]
function hpSuperProfile(a, b, n, segs) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
  }
  return pts;
}

// протяжка замкнутого профиля вдоль плоской кривой; B — нормаль плоскости кривой; scaleFn(t) — толщина по длине
function hpSweep(pathFn, B, profile, segs, caps, scaleFn) {
  const pos = [], nor = [], uv = [], idx = [];
  const m = profile.length;
  const pn = profile.map((p, i) => {
    const a = profile[(i - 1 + m) % m], b = profile[(i + 1) % m];
    const tu = b[0] - a[0], tv = b[1] - a[1], l = Math.hypot(tu, tv) || 1;
    return [tv / l, -tu / l];
  });
  const P = new THREE.Vector3(), Pa = new THREE.Vector3(), Pb = new THREE.Vector3();
  const T = new THREE.Vector3(), N = new THREE.Vector3();
  const ends = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, k = scaleFn ? scaleFn(t) : 1;
    pathFn(t, P); pathFn(Math.max(0, t - 1e-3), Pa); pathFn(Math.min(1, t + 1e-3), Pb);
    T.subVectors(Pb, Pa).normalize();
    N.crossVectors(B, T).normalize();
    if (i === 0 || i === segs) ends.push({ P: P.clone(), T: T.clone(), N: N.clone(), first: i === 0, k });
    for (let j = 0; j <= m; j++) {
      const q = j % m, u = profile[q][0] * k, v = profile[q][1] * k, nu = pn[q][0], nv = pn[q][1];
      pos.push(P.x + N.x * u + B.x * v, P.y + N.y * u + B.y * v, P.z + N.z * u + B.z * v);
      nor.push(N.x * nu + B.x * nv, N.y * nu + B.y * nv, N.z * nu + B.z * nv);
      uv.push(t, j / m);
    }
  }
  const body = [];
  for (let i = 0; i < segs; i++) for (let j = 0; j < m; j++) {
    const a = i * (m + 1) + j, b = (i + 1) * (m + 1) + j, c = b + 1, d = a + 1;
    body.push(a, b, d, b, c, d);
  }
  hpOrient(body, pos, nor);
  idx.push(...body);
  if (caps) for (const e of ends) {
    const base = pos.length / 3;
    const cn = e.T.clone().multiplyScalar(e.first ? -1 : 1);
    pos.push(e.P.x, e.P.y, e.P.z); nor.push(cn.x, cn.y, cn.z); uv.push(0.5, 0.5);
    for (let j = 0; j < m; j++) {
      const u = profile[j][0] * e.k, v = profile[j][1] * e.k;
      pos.push(e.P.x + e.N.x * u + B.x * v, e.P.y + e.N.y * u + B.y * v, e.P.z + e.N.z * u + B.z * v);
      nor.push(cn.x, cn.y, cn.z); uv.push(0.5 + u, 0.5 + v);
    }
    const tri = [];
    for (let j = 0; j < m; j++) tri.push(base, base + 1 + j, base + 1 + ((j + 1) % m));
    hpOrient(tri, pos, nor);
    idx.push(...tri);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// разворачивает треугольники, если их геометрическая нормаль смотрит против заданной
function hpOrient(tri, pos, nor) {
  let score = 0;
  for (let t = 0; t < tri.length; t += 3 * 7) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    score += gx * (nor[a] + nor[b] + nor[c]) + gy * (nor[a + 1] + nor[b + 1] + nor[c + 1]) + gz * (nor[a + 2] + nor[b + 2] + nor[c + 2]);
  }
  if (score < 0) for (let t = 0; t < tri.length; t += 3) { const x = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = x; }
}

function hpLathe(pts, segs, phiStart, phiLength) {
  return new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(Math.max(p[0], 0.0001), p[1])), segs, phiStart || 0, phiLength || Math.PI * 2);
}

// Контур чашки — «сквиркл»: суперэллипс с большими радиусами углов, чуть выше, чем шире, низ шире верха
// (tp — сужение кверху). Плоскость контура — локальная XZ: X — вертикаль вниз (полувысота hx), Z — вперёд (полуширина hz).
// Точки равномерно по длине.
function hpOutline(hx, hz, n, segs, tp) {
  const F = 2048, raw = [], cum = [0];
  for (let i = 0; i <= F; i++) {
    const t = (i / F) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const x = hx * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    raw.push([x, hz * Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * (1 + (tp || 0) * x / hx)]);
    if (i) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  }
  const L = cum[F], pts = [];
  let k = 0;
  for (let j = 0; j < segs; j++) {
    const d = (j / segs) * L;
    while (k < F - 1 && cum[k + 1] < d) k++;
    const f = (d - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
    pts.push([hpLerp(raw[k][0], raw[k + 1][0], f), hpLerp(raw[k][1], raw[k + 1][1], f)]);
  }
  const nrm = pts.map((p, j) => {
    const A = pts[(j - 1 + segs) % segs], B = pts[(j + 1) % segs];
    const tx = B[0] - A[0], tz = B[1] - A[1], l = Math.hypot(tx, tz) || 1;
    return [tz / l, -tx / l];
  });
  return { pts, nrm, segs, len: L, hx, hz };
}

// «Токарка» по контуру: prof = [[масштаб контура, высота по оси Y, сдвиг по нормали], ...].
// Профиль обходится против часовой в плоскости (масштаб, Y) — нормали наружу.
// planar — UV плоской проекцией (гравировка), иначе UV в единицах длины (для ткани)
function hpPill(O, prof, planar) {
  const m = O.segs, pos = [], uv = [], idx = [];
  const vl = [0];
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i - 1], b = prof[i];
    vl.push(vl[i - 1] + Math.hypot((b[0] - a[0]) * 0.6 + ((b[2] || 0) - (a[2] || 0)), b[1] - a[1]));
  }
  for (let i = 0; i < prof.length; i++) {
    const s = prof[i][0], y = prof[i][1], d = prof[i][2] || 0;
    for (let j = 0; j <= m; j++) {
      const k = j % m, p = O.pts[k], nn = O.nrm[k];
      const x = p[0] * s + nn[0] * d, z = p[1] * s + nn[1] * d;
      pos.push(x, y, z);
      if (planar) uv.push(0.5 + z / (2 * O.hz), 0.5 - x / (2 * O.hx));
      else uv.push((j / m) * O.len, vl[i]);
    }
  }
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * (m + 1) + j, b = (i + 1) * (m + 1) + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  hpWeld(g);
  return g;
}

// сглаживает нормали у вершин с одинаковой позицией (шов развёртки, полюс купола)
function hpWeld(g) {
  const p = g.attributes.position, n = g.attributes.normal, map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = Math.round(p.getX(i) * 1e4) + ',' + Math.round(p.getY(i) * 1e4) + ',' + Math.round(p.getZ(i) * 1e4);
    let e = map.get(key);
    if (!e) { e = [0, 0, 0, []]; map.set(key, e); }
    e[0] += n.getX(i); e[1] += n.getY(i); e[2] += n.getZ(i); e[3].push(i);
  }
  for (const e of map.values()) {
    if (e[3].length < 2) continue;
    const l = Math.hypot(e[0], e[1], e[2]) || 1;
    for (const i of e[3]) n.setXYZ(i, e[0] / l, e[1] / l, e[2] / l);
  }
}

// базис на поверхности купола чашки в точке контура j на высоте y: X — касательная, Y — нормаль поверхности, Z — ~ось чашки
// rFn(y) — масштаб контура на высоте y (профиль «подушки»)
function hpCupFrame(O, rFn, j, y, push) {
  const p = O.pts[j], nn = O.nrm[j];
  const r = rFn(y), e = 0.003;
  const dr = (rFn(y + e) - rFn(Math.max(0, y - e))) / (y - Math.max(0, y - e) + e);
  const pn = p[0] * nn[0] + p[1] * nn[1];
  const R = new THREE.Vector3(nn[0], -dr * pn, nn[1]).normalize();
  const T = new THREE.Vector3().crossVectors(R, new THREE.Vector3(0, 1, 0)).normalize();
  const Z = new THREE.Vector3().crossVectors(T, R);
  const m = new THREE.Matrix4().makeBasis(T, R, Z);
  push = push || 0;
  m.setPosition(p[0] * r + R.x * push, y + R.y * push, p[1] * r + R.z * push);
  return m;
}
// индекс точки контура: на верхней (sx = -1) или нижней (sx = 1) кромке, ближайшей к заданному z
function hpRimAt(O, sx, z) {
  let best = 0, bd = 1e9;
  O.pts.forEach((p, j) => { if (p[0] * sx > 0) { const d = Math.abs(p[1] - z); if (d < bd) { bd = d; best = j; } } });
  return best;
}
// индекс точки контура по направлению (dx, dz)
function hpRimDir(O, dx, dz) {
  let best = 0, bd = -1e9;
  O.pts.forEach((p, j) => { const l = Math.hypot(p[0], p[1]) || 1; const d = (p[0] * dx + p[1] * dz) / l; if (d > bd) { bd = d; best = j; } });
  return best;
}

// Сетчатый гамак оголовья: широкая лента под рамой, повторяет дугу, в сечении — провисающая «U»
// (края у рамы, середина ниже), к концам сужается и сходится в раму. Возвращает геометрию и кромку (для окантовки)
function hpCanopy(pathFn, t0, t1, segs, J, wFn, sagFn, e0) {
  const pos = [], uv = [], idx = [], edgeA = [], edgeB = [];
  const P = new THREE.Vector3(), Pa = new THREE.Vector3(), Pb = new THREE.Vector3(), prev = new THREE.Vector3();
  const T = new THREE.Vector3(), N = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  let L = 0; pathFn(t0, prev);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, t = hpLerp(t0, t1, u);
    pathFn(t, P); L += P.distanceTo(prev); prev.copy(P);
    pathFn(t - 1e-3, Pa); pathFn(t + 1e-3, Pb);
    T.subVectors(Pb, Pa).normalize(); N.crossVectors(T, Z).normalize(); // внутрь дуги
    const w = wFn(u), sg = sagFn(u);
    for (let j = 0; j <= J; j++) {
      const v = (j / J) * 2 - 1, off = e0 + sg * (1 - v * v);
      pos.push(P.x + N.x * off, P.y + N.y * off, v * w);
      uv.push(L, v * w);
    }
    edgeA.push(new THREE.Vector3(P.x + N.x * e0, P.y + N.y * e0, w));
    edgeB.push(new THREE.Vector3(P.x + N.x * e0, P.y + N.y * e0, -w));
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < J; j++) {
    const a = i * (J + 1) + j, b = a + J + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, edge: edgeA.concat(edgeB.reverse()) };
}

function hpCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function hpRingsTexture(base, amp) {
  base = base || 46; amp = amp || 26;
  const c = hpCanvas(4, 512), g = c.getContext('2d');
  for (let y = 0; y < 512; y++) {
    const v = base + Math.floor(hpRand(y, 3) * amp) + (y % 9 === 0 ? 18 : 0);
    g.fillStyle = `rgb(${v},${v + 1},${v + 3})`; g.fillRect(0, y, 4, 1);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function hpGrilleTexture() {
  // перфорированная акустическая сетка: дырки прозрачные (alphaTest)
  const c = hpCanvas(128, 128), g = c.getContext('2d');
  g.fillStyle = '#4a4744'; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) {
    g.beginPath(); g.arc(x * 16 + (y % 2) * 8, y * 16 + 8, 5.2, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7); return t;
}

function hpPcbTexture() {
  const c = hpCanvas(512, 512), g = c.getContext('2d');
  g.fillStyle = '#121a14'; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#c99a45'; g.lineWidth = 3; g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    let x = hpRand(i, 1) * 512, y = hpRand(i, 2) * 512;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      if ((k + i) % 2) x += (hpRand(i, k + 5) - 0.5) * 260; else y += (hpRand(i, k + 9) - 0.5) * 260;
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#e2b866'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#e8e2d6'; g.font = 'bold 22px monospace'; g.fillText('FLOW-HP2 REV.C', 24, 490);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Вязаная акустическая ткань амбушюров (мелкая «косичка») и сетка гамака (ромбическая ячейка):
// карта высот -> нормал-карта + цветовая карта (впадины темнее)
function hpKnitMaps() {
  const N = 128, C = 16, h = new Float32Array(N * N), hm = new Float32Array(N * N);
  const lobe = (fx, fy, cx, ang) => {
    const dx = fx - cx, dy = fy - 0.5, ca = Math.cos(ang), sa = Math.sin(ang);
    const rx = dx * ca + dy * sa, ry = -dx * sa + dy * ca;
    const v = 1 - (rx / 0.2) * (rx / 0.2) - (ry / 0.5) * (ry / 0.5);
    return v > 0 ? Math.sqrt(v) : 0;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = ((x % C) + 0.5) / C, fy = ((y % C) + 0.5) / C;
    h[y * N + x] = Math.max(lobe(fx, fy, 0.29, 0.5), lobe(fx, fy, 0.71, -0.5));
    const gx = ((x + (Math.floor(y / C) % 2) * C / 2) % C + 0.5) / C;
    const d = Math.abs(gx - 0.5) + Math.abs(fy - 0.5);
    hm[y * N + x] = hpSmooth(0.22, 0.4, d);
  }
  const toNormal = (H, k) => {
    const c = hpCanvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const hx = H[y * N + ((x + 1) % N)] - H[y * N + ((x - 1 + N) % N)];
      const hy = H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x];
      let nx = -hx * k, ny = hy * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const o = (y * N + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255; img.data[o + 1] = (ny * 0.5 + 0.5) * 255; img.data[o + 2] = (nz * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  const toColor = (H, lo, hi) => {
    const c = hpCanvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const v = Math.round(255 * (lo + (hi - lo) * H[i])); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  return { knit: toNormal(h, 2.0), knitCol: toColor(h, 0.8, 1), mesh: toNormal(hm, 2.6), meshCol: toColor(hm, 0.3, 1) };
}

// внутренняя ткань амбушюра с буквой стороны (как у оригинала — тон в тон)
function hpSideTexture(letter) {
  const c = hpCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#a19c96'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#9a958f'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 96px "Syne", "Arial", sans-serif';
  g.fillText(letter, 128, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// знак flow для гравировки: белое на прозрачном (используется как alphaMap), ширина ~38% чашки
function hpDrawLogo(canvas) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let fs = 200;
  g.font = `800 ${fs}px "Syne", "Arial Black", sans-serif`;
  const w = g.measureText('flow').width || fs * 2.2;
  fs = fs * (canvas.width * 0.38) / w;
  g.font = `800 ${fs}px "Syne", "Arial Black", sans-serif`;
  g.fillText('flow', canvas.width / 2, canvas.height / 2 + fs * 0.04);
}

// Syne для гравировки на чашке: подключаем с Google Fonts, если вёрстка его ещё не подключила
function hpEnsureSyne(onReady) {
  try {
    if (document.querySelector('link[href*="family=Syne"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap';
    l.onload = () => { if (document.fonts) document.fonts.load('800 100px "Syne"').then(onReady, () => {}); };
    document.head.appendChild(l);
  } catch (e) { /* без Syne — запасной шрифт */ }
}

// Окружение для отражений алюминия: тёплый софтбокс сверху-справа, фиолетовый слева-сзади,
// тёплый «отсвет фона» снизу-спереди и белая полоса сверху — длинные мягкие блики на куполе чашки
// Студийное окружение вместо светлой «комнаты»: тёмная сфера с вертикальным градиентом + софтбоксы.
// Металл получает и светлые длинные блики, и тёмные зоны — без них алюминий выглядит белым пластиком
function hpStudioEnv() {
  const env = new THREE.Scene();
  const sg = new THREE.SphereGeometry(20, 32, 16);
  const col = [], p = sg.attributes.position, c = new THREE.Color();
  const top = new THREE.Color(0x4a4750), mid = new THREE.Color(0x2e2b33), bot = new THREE.Color(0x141118);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 20;
    if (y > 0) c.copy(mid).lerp(top, y); else c.copy(mid).lerp(bot, Math.min(1, -y * 1.6));
    col.push(c.r, c.g, c.b);
  }
  sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const add = (color, k, w, h, x, y, z) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  add(0xffffff, 2.4, 9, 4, 0, 8, 1.5);       // большой верхний софтбокс
  add(0xffd2a8, 2.8, 2.6, 7, 7, 2.5, 3.5);   // тёплый key-стрип справа
  add(0x9d6fff, 2.4, 2.6, 8, -7, 1.5, -3.5); // фиолетовый рим слева-сзади
  add(0xecebf0, 1.5, 10, 5, 0, 0.5, 9);   // мягкий фронтальный fill (анфас чашки в финале)
  add(0xff9a4a, 0.6, 12, 3, 0, -7, 3);       // тёплый отсвет фона снизу
  return env;
}

// ---------- сцена ----------
function createHeadphonesScene(canvas) {
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const DEG = Math.PI / 180;
  const DPR = window.devicePixelRatio || 1;
  // телефон/планшет: меньше сегментов (LOD), без sheen, потолок DPR ниже — средний Android тянет 60 fps
  let LOW = false;
  try { LOW = Math.min(screen.width, screen.height) < 700 || matchMedia('(pointer: coarse)').matches; } catch (e) { /* */ }
  const LQ = (hi, lo) => (LOW ? lo : hi);
  const PR_MAX = LOW ? 1.5 : 1.75;
  // на плотных экранах MSAA почти не виден, а fill-rate съедает
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: DPR < 1.5, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const FOV = 30, CAM_D = 10, TAN = Math.tan(FOV / 2 * DEG);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_D);

  // окружение: студия (тёмный градиент + тёплые/фиолетовые софтбоксы) для отражений в алюминии
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = hpStudioEnv();
  let envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  pmrem.dispose();
  // room не освобождаем сразу: после потери WebGL-контекста окружение пересобирается из неё
  const onCtxLost = (e) => { e.preventDefault(); };
  const onCtxRestored = () => {
    try {
      const pm = new THREE.PMREMGenerator(renderer);
      const old = envRT; envRT = pm.fromScene(room, 0.04); scene.environment = envRT.texture;
      pm.dispose(); old.dispose();
    } catch (err) { console.warn('[flow] env restore failed', err && err.message); }
  };
  canvas.addEventListener('webglcontextlost', onCtxLost, false);
  canvas.addEventListener('webglcontextrestored', onCtxRestored, false);

  // свет (ART.md): тёплый key сверху-справа, фиолетовый рим слева-сзади, слабый холодный fill, тёплый контровой справа-сзади
  scene.add(new THREE.HemisphereLight(0xf4f1ee, 0x1a1422, 0.7));
  const key = new THREE.DirectionalLight(0xffd9b8, 2.4); key.position.set(4, 6, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc9d2ff, 0.45); fill.position.set(-5, 0, 4); scene.add(fill);
  const rimA = new THREE.DirectionalLight(0x9d6fff, 6.5); rimA.position.set(-5, 4, -5); scene.add(rimA);
  const rimB = new THREE.DirectionalLight(0xffa04d, 1.2); rimB.position.set(5, 1, -6); scene.add(rimB);

  // ---------- материалы (один раз) ----------
  const DS = THREE.DoubleSide;
  const plateTex = hpRingsTexture(150, 60), coneTex = hpRingsTexture(80, 70);
  const grilleTex = hpGrilleTexture(), pcbTex = hpPcbTexture();
  const KM = hpKnitMaps();
  const KNIT_TILE = 0.16; // клетка ткани ≈ 0.02 у.е. (≈ 1.3 мм)
  const knitPad = KM.knit; knitPad.repeat.set(1 / KNIT_TILE, 1 / KNIT_TILE);
  const knitCol = KM.knitCol; knitCol.repeat.set(1 / KNIT_TILE, 1 / KNIT_TILE);
  const knitIn = KM.knit.clone(); knitIn.needsUpdate = true; knitIn.repeat.set(6.5, 7.5);
  const meshN = KM.mesh; meshN.repeat.set(1 / 0.055, 1 / 0.055);
  const meshC = KM.meshCol; meshC.repeat.set(1 / 0.055, 1 / 0.055);
  const sideTex = { R: hpSideTexture('R'), L: hpSideTexture('L') };
  const logoCanvas = hpCanvas(1024, 1226); hpDrawLogo(logoCanvas);
  const logoTex = new THREE.CanvasTexture(logoCanvas); logoTex.anisotropy = 4;
  const SILVER = 0xd6d5d3; // светлый анодированный алюминий (Silver/Starlight)
  const WARM = 0xffa04d;
  const mat = {
    // сатиновый анодированный алюминий: мягкие длинные блики
    alu: new THREE.MeshPhysicalMaterial({ color: SILVER, metalness: 1, roughness: 0.44, envMapIntensity: 1.0 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xf1f2f5, metalness: 1, roughness: 0.08 }),
    // мягкое покрытие рамы оголовья и окантовки гамака
    soft: new THREE.MeshPhysicalMaterial({ color: 0xc6c6c8, metalness: 0, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5 }),
    knit: new THREE.MeshPhysicalMaterial({ color: 0xd3d4d6, map: knitCol, metalness: 0, roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5, normalMap: knitPad, normalScale: new THREE.Vector2(0.55, 0.55) }),
    padInR: new THREE.MeshStandardMaterial({ color: 0xffffff, map: sideTex.R, normalMap: knitIn, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95, emissive: WARM, emissiveIntensity: 0 }),
    padInL: new THREE.MeshStandardMaterial({ color: 0xffffff, map: sideTex.L, normalMap: knitIn, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95 }),
    canopy: new THREE.MeshPhysicalMaterial({ color: 0xc8c8ca, map: meshC, normalMap: meshN, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0, roughness: 0.9, sheen: 0.5, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5, side: DS }),
    hole: new THREE.MeshStandardMaterial({ color: 0x0a0909, metalness: 0.2, roughness: 0.6 }),
    seam: new THREE.MeshStandardMaterial({ color: 0x1d1b1a, metalness: 0.3, roughness: 0.6 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1f1d22, metalness: 0.2, roughness: 0.5, side: DS }),
    grille: new THREE.MeshStandardMaterial({ color: 0x9a968f, map: grilleTex, alphaTest: 0.5, metalness: 0.7, roughness: 0.32, side: DS }),
    gun: new THREE.MeshStandardMaterial({ color: 0x8f8b86, metalness: 1, roughness: 0.3 }),
    cone: new THREE.MeshPhysicalMaterial({ color: 0x77736e, map: coneTex, metalness: 0.8, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, side: DS }),
    cap: new THREE.MeshPhysicalMaterial({ color: 0x24211f, metalness: 0.8, roughness: 0.18, clearcoat: 1, emissive: WARM, emissiveIntensity: 0, side: DS }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc8804a, metalness: 1, roughness: 0.28, side: DS }),
    magnet: new THREE.MeshStandardMaterial({ color: 0x34322f, metalness: 1, roughness: 0.25 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xd2cec8, map: plateTex, metalness: 0.9, roughness: 0.3 }),
    basket: new THREE.MeshStandardMaterial({ color: 0x2e2b29, metalness: 0.9, roughness: 0.4, emissive: WARM, emissiveIntensity: 0, side: DS }),
    rimGlow: new THREE.MeshStandardMaterial({ color: 0x1a1008, emissive: WARM, emissiveIntensity: 0, toneMapped: false }),
    pcb: new THREE.MeshStandardMaterial({ color: 0xffffff, map: pcbTex, metalness: 0.25, roughness: 0.45 }),
    chip: new THREE.MeshStandardMaterial({ color: 0x0d0c0c, metalness: 0.4, roughness: 0.3 }),
    battery: new THREE.MeshPhysicalMaterial({ color: 0x3a3836, metalness: 0.5, roughness: 0.35, clearcoat: 0.7 }),
    foam: new THREE.MeshStandardMaterial({ color: 0x2c2a2e, metalness: 0, roughness: 1, side: DS }),
    kapton: new THREE.MeshStandardMaterial({ color: 0xd08a30, metalness: 0.3, roughness: 0.35, side: DS }),
    // светящиеся акценты мимо тонмаппинга, тёплые (ART.md)
    glow: new THREE.MeshStandardMaterial({ color: 0x140a04, emissive: WARM, emissiveIntensity: 0, toneMapped: false }),
    led: new THREE.MeshStandardMaterial({ color: 0x06100a, emissive: 0xbfffe0, emissiveIntensity: 0.9, toneMapped: false }),
    cable: new THREE.MeshStandardMaterial({ color: 0xf0eeeb, metalness: 0, roughness: 0.55 }),
    // лазерная гравировка: тот же металл, но матовее и чуть темнее; форма знака — alphaMap
    logo: new THREE.MeshPhysicalMaterial({ color: 0xc2c0bd, metalness: 1, roughness: 0.68, alphaMap: logoTex, transparent: true, depthWrite: false, emissive: WARM, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    pulse: new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DS }),
  };
  mat.pulse2 = mat.pulse.clone();
  // на слабом железе sheen (лишний BRDF-слой во фрагментном шейдере) выключаем
  if (LOW) ['knit', 'canopy', 'soft'].forEach(k => { mat[k].sheen = 0; });
  const redrawLogo = () => {
    hpDrawLogo(logoCanvas); logoTex.needsUpdate = true;
    ['R', 'L'].forEach(s => { const t = hpSideTexture(s); sideTex[s].image = t.image; sideTex[s].needsUpdate = true; t.dispose(); });
  };
  hpEnsureSyne(redrawLogo);
  if (document.fonts) {
    document.fonts.load('800 200px "Syne"').then(redrawLogo, () => {});
    document.fonts.ready.then(redrawLogo);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', redrawLogo);
  }

  // ---------- геометрия ----------
  // 1 у.е. ≈ 67 мм: высота ~2.7 (187 мм), ширина ~2.45 (169 мм). Чашка 1.40 x 1.17 (94 x 78 мм).
  const CB = 0.70, CA = 0.585, CN = 2.7, TP = 0.065;  // полувысота, полуширина, «квадратность», сужение кверху
  const SD = 0.38, YW = 0.05, DM = 2.6;                // толщина алюминиевой чашки, прямой участок стенки, профиль купола
  // масштаб контура на высоте y: прямая стенка, затем суперэллиптический «подушечный» купол
  const rFn = (y) => (y <= YW ? 1 : Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, (y - YW) / (SD - YW)), DM)), 1 / DM));
  const domeY = (r) => YW + (SD - YW) * Math.pow(Math.max(0, 1 - Math.pow(r, DM)), 1 / DM);
  const PAD_IN = 0.52;                                  // внутренняя плоскость амбушюров (от центра головы)
  const GAP = 0.012, PD = 0.29;                         // шов-магнит и толщина подушки
  const P0 = -GAP, E = P0 - PD;
  const SHELL_IN = PAD_IN - E;                          // ~0.822
  const SHELL_OUT = SHELL_IN + SD;
  const Y_STEM = 0.16;                                  // где штанга входит в верх чашки (по толщине)
  const HX = SHELL_IN + Y_STEM;                         // ось штанги
  const CY = -0.72;                                     // центр чашки по высоте
  const CUP_TOP = CY + CB * rFn(Y_STEM);
  const Y0 = CUP_TOP + 0.175, BAND_B = 1.06;            // концы рамы и высота дуги
  const Y_DET = 0.13;                                   // высота деталей на боковине (кнопки, порт, микрофоны)
  const root = new THREE.Group();
  const parts = [];
  const part = (parent, geo, material, name, tags, place) => {
    const m = new THREE.Mesh(geo, material); m.name = name;
    if (place) { if (place.isMatrix4) m.applyMatrix4(place); else place(m); }
    parent.add(m);
    parts.push({ mesh: m, name, tags: ' ' + (tags || '') + ' ' });
    return m;
  };

  // --- оголовье: рама-дуга (мягкое покрытие) + широкий сетчатый гамак с окантовкой ---
  const bandPath = (t, out) => {
    const f = -Math.PI / 2 + t * Math.PI, s = Math.sin(f), c = Math.cos(f), n = 2.4;
    return out.set(HX * Math.sign(s) * Math.pow(Math.abs(s), 2 / n), Y0 + BAND_B * Math.pow(Math.abs(c), 2 / n), 0);
  };
  // у концов рама чуть толще — там в неё сходится гамак
  const bandScale = (t) => 1 + 0.16 * (Math.exp(-Math.pow((t - 0.1) / 0.05, 2)) + Math.exp(-Math.pow((t - 0.9) / 0.05, 2)));
  part(root, hpSweep(bandPath, new V3(0, 0, 1), hpSuperProfile(0.046, 0.054, 2.6, LQ(24, 14)), LQ(200, 110), true, bandScale), mat.soft, 'band', 'big');
  const CW = 0.315; // полуширина гамака (~0.54 ширины чашки)
  const can = hpCanopy(bandPath, 0.085, 0.915, LQ(150, 80), LQ(16, 10),
    u => 0.035 + (CW - 0.035) * Math.pow(Math.sin(Math.PI * u), 0.32),
    u => 0.012 + 0.15 * Math.pow(Math.sin(Math.PI * u), 0.85), 0.006);
  part(root, can.geo, mat.canopy, 'canopy', 'big');
  part(root, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(can.edge, true), LQ(420, 220), 0.019, LQ(8, 6), true), mat.soft, 'piping', 'big');

  // общие геометрии обеих сторон
  const O = hpOutline(CB, CA, CN, LQ(136, 88), TP);
  // профиль алюминиевой чашки: внутренняя крышка -> мягкая кромка -> короткая стенка -> «подушка» купола
  const shellProf = [[0, 0], [0.4, 0], [0.75, 0], [0.92, 0], [0.972, 0.003], [0.993, 0.012], [1, 0.026]];
  const SR = LQ(48, 28);
  for (let i = 0; i <= SR; i++) {
    const th = (i / SR) * Math.PI / 2;
    shellProf.push([Math.pow(Math.cos(th), 2 / DM), YW + (SD - YW) * Math.pow(Math.sin(th), 2 / DM)]);
  }
  shellProf[shellProf.length - 1][0] = 0;
  const HO = 0.56; // проём амбушюра
  const G = {
    shell: hpPill(O, shellProf),
    // гравировка: лоскут купола r <= 0.62 чуть над поверхностью, UV — плоская проекция
    logo: hpPill(O, Array.from({ length: 15 }, (_, i) => { const r = 0.62 * (1 - i / 14); return [r, domeY(r) + 0.0022]; }), true),
    padBase: hpPill(O, [[0, P0], [0.972, P0], [0.972, 0.002], [0, 0.002]]),
    // подушка той же формы, вровень с чашкой: лицо -> наружу -> стенка вверх -> к чашке -> внутрь проёма
    pad: hpPill(O, [[HO + 0.015, E + 0.05], [HO + 0.04, E + 0.014], [HO + 0.09, E + 0.002], [0.74, E - 0.004], [0.86, E], [0.93, E + 0.018], [0.97, E + 0.055], [0.993, E + 0.11], [1.004, E + 0.18], [1.003, P0 - 0.06], [0.995, P0 - 0.02], [0.978, P0 - 0.004], [0.95, P0], [0.75, P0], [HO, P0], [HO - 0.012, P0 - 0.03], [HO - 0.014, E + 0.13], [HO, E + 0.075], [HO + 0.015, E + 0.05]]),
    padIn: hpPill(O, [[0, E + 0.17], [0.3, E + 0.17], [HO, E + 0.17]], true),
    carrier: hpPill(O, [[0.52, 0.01], [0.9, 0.01], [0.9, 0.03], [0.52, 0.03], [0.52, 0.01]]),
    grille: new THREE.CircleGeometry(0.34, 64).rotateX(Math.PI / 2),
    gasket: new THREE.TorusGeometry(0.3, 0.012, 10, 96).rotateX(Math.PI / 2),
    // драйвер 40 мм: корзина (внешнее кольцо + кольцо магнитной системы + 6 спиц)
    basket: (() => {
      const ribs = [hpLathe([[0.24, 0.032], [0.276, 0.032], [0.276, 0.046], [0.24, 0.046], [0.24, 0.032]], 72), hpLathe([[0.126, 0.168], [0.126, 0.196], [0.134, 0.196], [0.134, 0.168], [0.126, 0.168]], 48)];
      for (let k = 0; k < 6; k++) ribs.push(hpLathe([[0.255, 0.046], [0.13, 0.172]], 4, k * Math.PI / 3, 0.2));
      return mergeGeometries(ribs);
    })(),
    cone: hpLathe([[0.262, 0.032], [0.258, 0.016], [0.246, 0.007], [0.232, 0.01], [0.223, 0.026], [0.2, 0.04], [0.15, 0.064], [0.1, 0.09], [0.066, 0.108]], 72),
    cap: hpLathe([[0, 0.072], [0.028, 0.075], [0.05, 0.086], [0.066, 0.108]], 48),
    coil: new THREE.CylinderGeometry(0.062, 0.062, 0.07, 32, 1, true),
    plate: hpLathe([[0, 0.173], [0.108, 0.173], [0.117, 0.177], [0.12, 0.184], [0.117, 0.191], [0.108, 0.195], [0.06, 0.195], [0.056, 0.2], [0, 0.2]], 64),
    magnet: new THREE.CylinderGeometry(0.106, 0.106, 0.054, 48),
    damp: new THREE.CylinderGeometry(0.25, 0.25, 0.018, 48),
    flex: new RoundedBoxGeometry(0.28, 0.006, 0.09, 2, 0.003),
    screw: mergeGeometries([new THREE.CylinderGeometry(0.014, 0.014, 0.05, 12).translate(0, 0.025, 0), new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16)]),
    // микрофон — узкая щель на боковине
    mic: new RoundedBoxGeometry(0.075, 0.012, 0.02, 2, 0.0095),
    // гнездо шарнира в верхней точке чашки: стальное кольцо с тёмной серединой
    pivot: mergeGeometries([hpLathe([[0.026, 0.0], [0.04, 0.0], [0.045, 0.006], [0.045, 0.012], [0.038, 0.016], [0.026, 0.016], [0.026, 0.0]], 40)]),
    knuckle: mergeGeometries([new THREE.SphereGeometry(0.03, 24, 16), new THREE.CylinderGeometry(0.022, 0.027, 0.05, 20).translate(0, 0.035, 0)]),
    arm: new THREE.CylinderGeometry(0.02, 0.02, (Y0 - 0.05) - (CUP_TOP + 0.03), 20),
    // хромированная муфта на конце рамы
    collar: hpLathe([[0.0001, -0.032], [0.04, -0.032], [0.049, -0.026], [0.051, -0.018], [0.051, 0.022], [0.047, 0.03], [0.0001, 0.03]], 36),
  };
  const armMidY = ((Y0 - 0.05) + (CUP_TOP + 0.03)) / 2;
  // колёсико — рифлёный цилиндр, ось вдоль Y, основание в 0
  const crownGeo = (() => {
    const R = 0.072, H = 0.058, T = 48, NP = T * 4, sh = new THREE.Shape();
    for (let i = 0; i < NP; i++) {
      const a = (i / NP) * Math.PI * 2, r = R * (1 - 0.045 * (0.5 + 0.5 * Math.cos(a * T)));
      if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: H, bevelEnabled: false, steps: 1, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    const top = new THREE.CylinderGeometry(R * 0.86, R * 0.94, 0.008, 48).translate(0, H + 0.004, 0).toNonIndexed();
    return mergeGeometries([g, top]);
  })();

  const pivots = {};
  const buildSide = (side) => {
    const S = side > 0 ? 'R' : 'L';
    const sg = new THREE.Group(); if (side < 0) sg.rotation.y = Math.PI; root.add(sg);
    // правая чашка поворачивается на шарнире вокруг оси штанги
    const sw = side > 0 ? 'sw' : '';
    // муфта рамы, телескопическая штанга, шаровой шарнир
    part(sg, G.collar, mat.steel, S + '.collar', S, m => m.position.set(HX, Y0 - 0.03, 0));
    part(sg, G.arm, mat.steel, S + '.arm', S, m => m.position.set(HX, armMidY, 0));
    part(sg, G.knuckle, mat.steel, S + '.knuckle', S + ' small cam ' + sw, m => m.position.set(HX, CUP_TOP + 0.022, 0));
    // чашка: локальная ось Y — наружу; X — вниз; Z — вперёд (для правой)
    const cf = new THREE.Group(); cf.position.set(SHELL_IN, CY, 0); cf.rotation.z = -Math.PI / 2; sg.add(cf);
    const ct = S + ' cup' + S + ' ' + sw + (side > 0 ? ' keep' : '');
    // мелочь снаружи (кнопки, порт, микрофоны, шарнир) в финале улетает — в «o» остаётся чистая чашка
    const ctr = S + ' cup' + S + ' ' + sw;
    const shell = part(cf, G.shell, mat.alu, S + '.shell', ct + ' big');
    if (side < 0) {
      // гравировка flow на внешней грани левой чашки; UV по z зеркалим, иначе знак читается наоборот
      const lg = G.logo.clone();
      const uv = lg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      const d = new THREE.Mesh(lg, mat.logo); d.renderOrder = 2; d.name = 'logo'; shell.add(d);
    }
    part(cf, G.padBase, mat.seam, S + '.seam', ct);
    part(cf, G.pad, mat.knit, S + '.pad', ct + ' big');
    part(cf, G.padIn, side > 0 ? mat.padInR : mat.padInL, S + '.padIn', ct);
    part(cf, G.grille, mat.grille, S + '.grille', ct, m => m.position.set(0, 0.004, 0));
    part(cf, G.carrier, mat.plastic, S + '.carrier', ct);
    part(cf, G.gasket, mat.plastic, S + '.gasket', ct + ' small', m => m.position.set(0, 0.03, 0));
    // драйвер
    const basketM = part(cf, G.basket, mat.basket, S + '.basket', ct + ' drv');
    if (side > 0) {
      // светящаяся кромка по ободу корзины — только для «героя» гл. 9
      const rg = new THREE.Mesh(new THREE.TorusGeometry(0.279, 0.0055, 10, 120).rotateX(Math.PI / 2), mat.rimGlow);
      rg.position.set(0, 0.039, 0); rg.name = 'rimGlow'; rg.visible = false; basketM.add(rg);
    }
    part(cf, G.cone, mat.cone, S + '.cone', ct + ' drv');
    part(cf, G.cap, mat.cap, S + '.cap', ct + ' drv small');
    part(cf, G.coil, mat.copper, S + '.coil', ct + ' drv small cam', m => m.position.set(0, 0.14, 0));
    part(cf, G.plate, mat.plate, S + '.plate', ct + ' drv');
    part(cf, G.magnet, mat.magnet, S + '.magnet', ct + ' drv', m => m.position.set(0, 0.22, 0));
    part(cf, G.damp, mat.foam, S + '.damp', ct + ' brd', m => m.position.set(0, 0.262, 0));
    part(cf, G.flex, mat.kapton, S + '.flex', ct + ' brd small cam', m => m.position.set(0.02, 0.335, -0.02));
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      part(cf, G.screw, mat.steel, S + '.screw' + k, ct + ' small cam', m => m.position.set(Math.cos(a) * 0.42, 0.012, Math.sin(a) * 0.36));
    }
    // гнездо шарнира в верхней точке чашки
    const jTop = hpRimAt(O, -1, 0);
    part(cf, G.pivot, mat.steel, S + '.pivot', ctr + ' small', hpCupFrame(O, rFn, jTop, Y_STEM, -0.006));
    // микрофоны: верх-перед, перёд, низ-зад
    [[-0.7, 0.72, 0.12], [0.15, 1, 0.1], [0.82, -0.57, 0.11]].forEach(([dx, dz, y], k) => {
      part(cf, G.mic, mat.hole, S + '.mic' + k, ctr + ' small cam', hpCupFrame(O, rFn, hpRimDir(O, dx, dz), y, -0.003));
    });
    if (side > 0) {
      // колёсико (сверху, ближе к задней кромке) и вытянутая кнопка (на передней кромке, вверху)
      const crown = part(cf, crownGeo, mat.alu, 'R.crown', ctr + ' small cam', hpCupFrame(O, rFn, hpRimAt(O, -1, -0.25), Y_DET, -0.01));
      const gr = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.0045, 8, 64).rotateX(Math.PI / 2), mat.glow);
      gr.position.set(0, 0.016, 0); gr.name = 'crownGlow'; gr.visible = false; crown.add(gr);
      // две волны со сдвигом фазы — в любом кадре видно расходящийся пульс
      const pg = new THREE.RingGeometry(0.09, 0.1, 72).rotateX(-Math.PI / 2);
      for (let k = 0; k < 2; k++) {
        const pulse = new THREE.Mesh(pg, k ? mat.pulse2 : mat.pulse); pulse.position.set(0, 0.018, 0); pulse.renderOrder = 3; pulse.name = 'pulse' + k; crown.add(pulse);
      }
      part(cf, new RoundedBoxGeometry(0.2, 0.034, 0.05, 3, 0.016), mat.alu, 'R.button', ctr + ' small cam', hpCupFrame(O, rFn, hpRimDir(O, -0.62, 1), Y_DET, 0.002));
      // порт и индикатор снизу
      const jBot = hpRimAt(O, 1, 0.08);
      part(cf, new RoundedBoxGeometry(0.125, 0.03, 0.042, 3, 0.0145), mat.hole, 'R.usb', ctr + ' small', hpCupFrame(O, rFn, jBot, Y_DET, -0.0135));
      part(cf, new THREE.BoxGeometry(0.075, 0.004, 0.011), mat.gun, 'R.usbTongue', ctr + ' small cam', hpCupFrame(O, rFn, jBot, Y_DET, 0.0005));
      part(cf, new THREE.SphereGeometry(0.009, 12, 8), mat.led, 'R.led', ctr + ' small cam', hpCupFrame(O, rFn, hpRimAt(O, 1, -0.12), Y_DET, -0.004));
      // плата с чипами
      part(cf, new RoundedBoxGeometry(0.46, 0.018, 0.3, 2, 0.008), mat.pcb, 'R.pcb', ct + ' brd', m => m.position.set(0, 0.29, 0));
      const chips = [[0.1, 0.085, 0.07, 0.03], [0.065, 0.065, -0.1, -0.05], [0.09, 0.05, -0.04, 0.09]];
      chips.forEach(([w, d, x, z], k) => part(cf, new RoundedBoxGeometry(w, 0.022, d, 2, 0.005), mat.chip, 'R.chip' + k, ct + ' brd small cam', m => m.position.set(x, 0.309, z)));
      // съёмный кабель (в собранном виде спрятан)
      const jf = new THREE.Group(); jf.applyMatrix4(hpCupFrame(O, rFn, jBot, Y_DET, 0)); cf.add(jf);
      const plugTip = () => new RoundedBoxGeometry(0.118, 0.13, 0.034, 2, 0.016);
      const plugBody = () => new RoundedBoxGeometry(0.15, 0.2, 0.07, 3, 0.03);
      part(jf, plugTip(), mat.steel, 'C.tip', 'cable small', m => m.position.set(0, -0.065, 0));
      part(jf, plugBody(), mat.cable, 'C.body', 'cable', m => m.position.set(0, 0.1, 0));
      part(jf, hpLathe([[0.03, 0.2], [0.024, 0.24], [0.017, 0.29]], 24), mat.cable, 'C.relief', 'cable small');
      const tail = new THREE.CatmullRomCurve3([[0, 0.28, 0], [0, 0.45, 0.02], [0.1, 0.66, 0.1], [0.3, 0.82, 0.25], [0.55, 0.86, 0.45], [0.72, 0.78, 0.66]].map(p => new V3(...p)));
      part(jf, new THREE.TubeGeometry(tail, 140, 0.017, 12, false), mat.cable, 'C.tail', 'cable');
      const end = tail.getPoint(1), tan = tail.getTangent(1);
      const q = new Q().setFromUnitVectors(new V3(0, -1, 0), tan);
      part(jf, plugBody(), mat.cable, 'C.plug2', 'cable', new THREE.Matrix4().compose(end.clone().addScaledVector(tan, 0.1), q, new V3(1, 1, 1)));
      part(jf, plugTip(), mat.steel, 'C.tip2', 'cable small', new THREE.Matrix4().compose(end.clone().addScaledVector(tan, 0.265), q, new V3(1, 1, 1)));
    } else {
      part(cf, new RoundedBoxGeometry(0.5, 0.07, 0.34, 3, 0.024), mat.battery, 'L.battery', ct + ' brd', m => m.position.set(0, 0.3, 0));
      part(cf, new RoundedBoxGeometry(0.2, 0.014, 0.12, 2, 0.006), mat.pcb, 'L.bms', ct + ' brd small cam', m => m.position.set(0.05, 0.345, 0.04));
    }
    pivots[S] = new V3(HX, 0, 0);
  };
  buildSide(1);
  buildSide(-1);

  // ---------- «расплющить»: все детали — прямые потомки model, геометрия центрирована ----------
  // геометрии общие для обеих сторон: центрируем каждую один раз и запоминаем сдвиг
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  for (const pt of parts) {
    const m = pt.mesh;
    const g = m.geometry;
    let c = g.userData.hpC;
    if (!c) {
      g.computeBoundingBox();
      c = g.boundingBox.getCenter(new V3());
      g.translate(-c.x, -c.y, -c.z);
      g.computeBoundingBox(); g.computeBoundingSphere();
      g.userData.hpC = c;
    }
    for (const ch of m.children) ch.position.sub(c);
    const wm = m.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
    pt.rp = new V3(); pt.rq = new Q(); const sc = new V3();
    wm.decompose(pt.rp, pt.rq, sc);
    pt.rs = sc.x;
    pt.radius = g.boundingSphere.radius;
    if (!pt.tags.includes(' cable ')) { tmpBox.copy(g.boundingBox).applyMatrix4(wm); box.union(tmpBox); }
  }
  const center = box.getCenter(new V3());
  const model = new THREE.Group(); scene.add(model);
  for (const pt of parts) {
    pt.rp.sub(center);
    const m = pt.mesh; m.removeFromParent(); m.position.copy(pt.rp); m.quaternion.copy(pt.rq); m.scale.setScalar(pt.rs);
    m.matrixAutoUpdate = true; model.add(m);
  }
  const byName = {}; parts.forEach(p => { byName[p.name] = p; });
  const has = (pt, t) => pt.tags.includes(' ' + t + ' ');
  const swPivot = pivots.R.clone().sub(center);
  // ось кабеля (наружу из порта) в координатах модели
  const jackAxis = new V3(0, 1, 0).applyQuaternion(byName['C.body'].rq).normalize();
  const jackP = byName['R.usb'].rp.clone();

  // параметры разлёта: «инженерный» разнос слоёв чашки вдоль её оси + псевдослучайный разброс
  const AXIAL = {
    padIn: -0.78, pad: -0.62, seam: -0.44, grille: -0.3, screw0: -0.22, screw1: -0.26, screw2: -0.18, screw3: -0.2, carrier: -0.16, gasket: -0.1,
    cap: 0.0, cone: 0.1, basket: 0.22, coil: 0.32, plate: 0.42, magnet: 0.52, damp: 0.6, pcb: 0.68, battery: 0.68, flex: 0.74, bms: 0.78, chip0: 0.82, chip1: 0.86, chip2: 0.8,
    shell: 0.95, mic0: 0.95, mic1: 0.98, mic2: 0.92, crown: 1.0, button: 0.98, usb: 0.92, usbTongue: 0.98, led: 0.95,
    pivot: 0.4, knuckle: 0.5, arm: 0.25, collar: 0.1,
  };
  // штанги/муфты поднимаются умеренно — выше не залезают на слово «ВНУТРИ» над объектом (гл. 8)
  const UP = { pivot: 0.15, knuckle: 0.2, arm: 0.22, collar: 0.25, crown: 0.2, button: 0.22, mic0: 0.2, mic1: -0.1, mic2: -0.3, usb: -0.3, usbTongue: -0.36, led: -0.3 };
  // [доля пути к камере, доп. сдвиг по y, доп. сдвиг по x]
  // левая чашка — выше и левее центра низа, мимо пилюли счётчика глав
  const FLY_BIG = { 'R.pad': [0.3, -0.4, 0.15], 'L.pad': [0.26, -0.3, 0.25], 'L.shell': [0.24, -0.12, -0.05] };
  parts.forEach((pt, i) => {
    pt.sw = has(pt, 'sw'); pt.cable = has(pt, 'cable'); pt.keep = has(pt, 'keep');
    pt.inner = has(pt, 'drv') || has(pt, 'brd') || /screw|grille|gasket|carrier/.test(pt.name);
    const big = has(pt, 'big');
    const rnd = new V3(hpRand(i, 1) - 0.5, hpRand(i, 2) - 0.5, hpRand(i, 3) - 0.5).multiplyScalar(2);
    const out = pt.rp.clone(); out.y *= 0.8;
    const dir = out.multiplyScalar(0.9).add(rnd.clone().multiplyScalar(big ? 0.35 : 0.85));
    dir.z *= 0.75; dir.normalize();
    pt.dir = dir;
    const sideSign = pt.name[0] === 'R' ? 1 : pt.name[0] === 'L' ? -1 : 0;
    const key = pt.name.split('.')[1] || pt.name;
    const ex = new V3();
    if (sideSign && AXIAL[key] !== undefined) {
      ex.x = sideSign * (0.2 + AXIAL[key] * 1.05);
      ex.y = UP[key] || 0;
      ex.addScaledVector(rnd, big ? 0.12 : 0.34);
      // объём: слои чашки расходятся не в одну «инженерную» линию, а вверх-вниз и по глубине
      ex.y += (hpRand(i, 17) - 0.5) * (big ? 0.9 : 0.6);
      ex.z += (hpRand(i, 18) - 0.5) * (big ? 0.8 : 0.6);
      // потолок разлёта: детали не поднимаются выше середины дуги в сборе (над ней — слово главы)
      ex.y = Math.min(ex.y, 0.7 - pt.rp.y);
    } else if (pt.cable) {
      ex.set(1.2, -0.55, 0.35).addScaledVector(rnd, 0.25);
    } else {
      // оголовье: рама уходит назад и вниз, гамак — вперёд и вниз; вверх не летят —
      // над объектом крупное слово «ВНУТРИ» (гл. 8), разлёт не должен его перекрывать
      if (pt.name === 'band') ex.set(0, -0.42, -0.75); else ex.set(0, -0.3, 0.28);
      ex.addScaledVector(rnd, 0.06);
    }
    pt.ex = ex;
    pt.dist = big ? 0.35 + 0.35 * hpRand(i, 4) : 0.75 + 1.25 * hpRand(i, 4);
    pt.axis = new V3(hpRand(i, 5) - 0.5, hpRand(i, 6) - 0.5, hpRand(i, 7) - 0.5).normalize();
    pt.rot = (big ? 0.3 : pt.radius < 0.09 ? 0.8 + 2.2 * hpRand(i, 8) : 0.25 + 0.6 * hpRand(i, 8)) * (hpRand(i, 9) > 0.5 ? 1 : -1);
    pt.spin = (0.15 + 0.35 * hpRand(i, 10)) * (big ? 0.3 : 1);
    pt.delay = hpRand(i, 11);
    pt.fly = has(pt, 'cam') && hpRand(i, 12) < 0.75 ? 0.3 + 0.28 * hpRand(i, 13) : 0;
    // несколько крупных деталей подлетают к камере (вниз, мимо карточки) — разлёт ломает кадр, как в референсе
    // мелочь из верхней половины к камере не летит: подлёт уводит её вверх, на слово «ВНУТРИ»
    if (pt.rp.y + ex.y > 0) pt.fly = 0;
    if (FLY_BIG[pt.name]) { pt.fly = FLY_BIG[pt.name][0]; ex.y += FLY_BIG[pt.name][1]; ex.x += FLY_BIG[pt.name][2]; }
    // «уход за кадр» (гл. 9–10): в мировых координатах — вправо, вверх/вниз и глубоко назад, мимо карточки
    pt.wsc = new V3(0.6 + 2.6 * hpRand(i, 14), (hpRand(i, 15) - 0.5) * 3.6, -(6 + 8 * hpRand(i, 16)));
  });
  // тонкие детали летят приклеенными к своему «носителю», а не отдельными волосками в воздухе
  const FOLLOW = { piping: 'canopy' };
  for (const n in FOLLOW) {
    const pt = byName[n], ld = byName[FOLLOW[n]];
    if (!pt || !ld) continue;
    const iq = ld.rq.clone().invert();
    pt.lead = ld;
    pt.fo = pt.rp.clone().sub(ld.rp).applyQuaternion(iq).divideScalar(ld.rs); // смещение в системе носителя
    pt.fq = iq.clone().multiply(pt.rq);                                          // поворот относительно носителя
    pt.fk = pt.rs / ld.rs;
  }

  // наборы «героев»: 1 — драйвер (гл. 9), 2 — плата + аккумулятор + кнопка + порт (гл. 10)
  const heroSet = (refName, list) => {
    const ref = byName[refName], iq = ref.rq.clone().invert();
    return list.map(([name, spread, manual]) => {
      const pt = byName[name];
      const o = { pt };
      if (manual) { o.p = new V3(...manual); o.q = new Q(); }
      else { o.p = pt.rp.clone().sub(ref.rp).applyQuaternion(iq); o.q = iq.clone().multiply(pt.rq); }
      o.p.y += spread || 0;
      return o;
    });
  };
  const hero1 = heroSet('R.cone', [['R.cap', 0], ['R.cone', 0], ['R.basket', 0.02], ['R.coil', 0.16], ['R.plate', 0.26], ['R.magnet', 0.36]]);
  const hero2 = heroSet('R.pcb', [['R.pcb', 0], ['R.chip0', 0.07], ['R.chip1', 0.07], ['R.chip2', 0.07], ['L.battery', 0, [0.04, -0.17, 0.03]], ['R.button', 0, [0.3, 0.02, -0.22]], ['R.usb', 0, [-0.3, 0.0, -0.2]]]);
  hero1.forEach(h => { h.pt.hero = 1; h.pt.o = h; });
  hero2.forEach(h => { h.pt.hero = 2; h.pt.o = h; });

  // точки фокуса (в координатах модели)
  const FOCI = {
    center: new V3(0, 0, 0),
    cupL: new V3(-SHELL_OUT, CY, 0).sub(center),
    cupR: new V3(HX, CY, 0).sub(center),
    padR: new V3(PAD_IN + 0.12, CY, 0).sub(center),
    touch: byName['R.crown'].rp.clone(),
    jack: jackP.clone(),
  };

  // ---------- ключевые позы глав ----------
  // sx, sy — NDC точки фокуса; z — глубина фокуса; s — масштаб; rx, ry, rz — градусы (YXZ)
  // e — разлёт, aw — «уход за кадр», h1/h2 — герои, sw — поворот правой чашки (0..1 = 0..90°), cb — кабель, tc — пульс колёсика, iso — финал
  // px — дополнительный наклон вокруг мировой оси X (взгляд сверху/снизу), fs — фокус вращается вместе с правой чашкой
  // lg — гравировка flow ловит тёплый блик (гл. 2)
  const KEYS = [
    { f: 'center', sx: 1.45, sy: -0.25, z: -1, s: 0.0001, rx: 20, ry: -80, rz: -25 },
    // ls/lsy — масштаб и высота для низкого альбомного экрана (телефон боком): пин «Flow · наушники» под объектом
    { f: 'center', sx: 0.37, sy: -0.08, z: 0, s: 1.0, rx: 8, ry: 38, rz: -3, msy: 0.24, ms: 0.62, ls: 0.88, lsy: -0.04 },
    // низ чашки выше счётчика глав (~820 px из 900)
    { f: 'cupL', sx: -0.05, sy: -0.13, z: 6.3, s: 1, rx: 6, ry: 68, rz: -6, lg: 1, msx: 0, msy: 0.15, ms: 0.78, mz: 0 },
    // левее рейки точек справа
    { f: 'padR', sx: 0.15, sy: -0.4, z: 5.85, s: 1, rx: 0, ry: -148, rz: -10, px: 8, sw: -1, msx: -0.02, msy: 0.1, ms: 0.74, mf: 'center', mz: 0 },
    // вид сверху-сбоку на колёсико: внешняя грань правой чашки к камере, колёсико — справа сверху на кромке,
    // дальняя чашка и дуга уходят влево-вверх — справа над колёсиком пусто, пин «Колёсико и кнопка» не ложится на объект
    { f: 'touch', sx: 0.36, sy: -0.25, z: 2.6, s: 1, rx: 0, ry: -62, rz: 4, px: 38, tc: 1, msx: 0, msy: 0.2, ms: 0.64 },
    // меньше — между плашкой кода комнаты и чашкой остаётся воздух
    { f: 'center', sx: 0.36, sy: -0.14, z: 0.4, s: 0.8, rx: 12, ry: -112, rz: 6, sw: 0.55, msy: 0.26, ms: 0.75 },
    // орбита источников: объект целиком внутри кольца чипов (чипы — по диагоналям вокруг центра модели),
    // поэтому на десктопе он меньше и по центру орбиты; на мобилке — прежний кадр (mf/mz)
    { f: 'center', sx: 0.29, sy: 0, z: 0, s: 0.76, rx: 0, ry: -30, rz: 0, px: 4, sw: 1.33, gr: 1, msx: 0, msy: 0.3, ms: 0.95, mz: 0 },
    { f: 'jack', sx: 0.3, sy: -0.02, z: 2.4, s: 1, rx: -6, ry: -140, rz: 4, px: -30, cb: 1, msx: -0.04, msy: 0.2, ms: 0.72, mf: 'center', mz: 0 },
    { f: 'center', sx: 0.31, sy: -0.1, z: 0, s: 0.92, rx: 14, ry: 22, rz: -6, e: 1, msx: 0.06, msy: 0.2, ms: 0.46, ls: 0.82, lsy: -0.12 },
    { f: 'center', sx: 0.31, sy: -0.02, z: 0, s: 0.92, rx: 16, ry: 40, rz: -6, e: 1, aw: 1, h1: 1 },
    { f: 'center', sx: 0.31, sy: -0.02, z: 0, s: 0.92, rx: 14, ry: 32, rz: -4, e: 1, aw: 0.55, h2: 1 },
    { f: 'center', sx: 0.34, sy: -0.1, z: 0, s: 0.95, rx: 12, ry: 22, rz: -3, e: 0.45, msy: 0.24, ms: 0.44 },
    { f: 'center', sx: 0.16, sy: -0.04, z: 1.6, s: 1.0, rx: 8, ry: 18, rz: -2 },
    null, // финал — считается из setFinaleTarget
  ];
  const HERO = {
    1: { sx: 0.34, sy: -0.04, z: 1, s: 3.1, msx: 0, msy: 0.42, ms: 1.7 },
    2: { sx: 0.34, sy: -0.02, z: 1, s: 2.7, msx: 0, msy: 0.42, ms: 1.5 },
  };
  const SWF = { padR: 1, cupR: 1 };
  const NUMS = ['sx', 'sy', 'z', 's', 'rx', 'ry', 'rz', 'px', 'fs', 'e', 'aw', 'h1', 'h2', 'sw', 'cb', 'tc', 'gr', 'iso', 'lg'];

  let W = 1, H = 1, aspect = 1;
  let finaleRect = null;
  // раскладку (мобильная/десктопная) сообщает вёрстка; до этого — по пропорциям
  let layout = null;
  const isMob = () => (layout ? layout === 'mobile' : aspect < 0.8);
  const resolveKey = (i, out) => {
    const k = KEYS[i];
    for (const n of NUMS) out[n] = 0;
    out.fv = out.fv || new V3();
    if (!k) { finaleKey(out); return out; }
    for (const n of NUMS) out[n] = k[n] || 0;
    out.fs = SWF[k.f] || 0;
    out.fv.copy(FOCI[k.f]);
    if (isMob()) {
      out.sx = k.msx !== undefined ? k.msx : 0;
      out.sy = k.msy !== undefined ? k.msy : 0.42;
      out.s = k.s * (k.ms !== undefined ? k.ms : 0.62);
      // позы мобилки подобраны под 390x844; на телефонах ниже карточка занимает бо́льшую долю экрана —
      // объект чуть меньше и выше, чтобы не залезать на карточку
      const fH = Math.min(1, Math.max(0.82, (H - 300) / 544));
      out.s *= fH; out.sy += (1 - fH) * 0.5;
      out.z = k.mz !== undefined ? k.mz : (k.z || 0) * 0.5;
      // своя точка фокуса для мобильной раскладки
      if (k.mf) { out.fs = SWF[k.mf] || 0; out.fv.copy(FOCI[k.mf]); }
    } else {
      out.s *= Math.min(1.06, Math.max(0.72, aspect / 1.78));
      if (H < 480) {
        if (k.ls !== undefined) out.s *= k.ls;
        if (k.lsy !== undefined) out.sy = k.lsy;
      }
    }
    return out;
  };
  const finaleKey = (out) => {
    const r = finaleRect || { x: W / 2, y: H / 2, size: H * 0.3 };
    const nx = (r.x / W) * 2 - 1, ny = 1 - (r.y / H) * 2;
    const dist = CAM_D;
    const target = new V3(nx * TAN * dist * aspect, ny * TAN * dist, 0);
    const d = camera.position.clone().sub(target).normalize();
    out.sx = nx; out.sy = ny; out.z = 0;
    // чашка вписывается в «o» по высоте
    out.s = (r.size / H) * TAN * dist / CB;
    out.rx = 0; out.ry = Math.atan2(-d.z, d.x) / DEG; out.rz = Math.asin(d.y) / DEG;
    out.iso = 1;
    out.fv.copy(FOCI.cupR);
    out.abs = true;
  };

  // ---------- состояние ----------
  let target = 0, cur = 0, first = true;
  const pointer = { x: 0, y: 0, cx: 0, cy: 0 };
  const kA = {}, kB = {}, pose = { fv: new V3() };
  const clock = new THREE.Clock();
  // time стартует не с нуля: при выключенном движении (тест, reduced-motion) кадр «пульса» читается
  let time = 0.6, raf = 0, disposed = false, motion = true;
  let lastPointerAt = -10, frameNo = 0, prCap = PR_MAX;
  // адаптивное качество: окна по 30 кадров, медиана dt (единичный фриз не решает), понижение —
  // только после 2 медленных окон подряд. Не меряем первые 3 с, после первого появления модели,
  // ресайза и возврата во вкладку. Ровные 30 fps (энергосбережение) перегрузкой не считаем.
  // Обратно вверх — не раньше 10 с после понижения, если 8 с подряд кадры ровные, и не больше раза за сессию.
  const dtBuf = new Float32Array(30), dtSort = new Float32Array(30);
  const qT0 = performance.now();
  let dtN = 0, slowWins = 0, holdFrames = 0, prDropAt = 0, fastSince = 0, prRaises = 0, modelSeen = false, appliedDpr = 0;
  const holdQuality = (n) => { holdFrames = Math.max(holdFrames, n); dtN = 0; slowWins = 0; fastSince = 0; };
  const onVisChange = () => holdQuality(30);
  document.addEventListener('visibilitychange', onVisChange);
  const tmp = {
    q: new Q(), q2: new Q(), e: new THREE.Euler(), v: new V3(), v2: new V3(), p: new V3(),
    inv: new THREE.Matrix4(), camL: new V3(), mq: new Q(), mqi: new Q(), hw: new V3(), hq: new Q(), hs: new Q(), fv: new V3(),
  };
  const AX_X = new V3(1, 0, 0), AX_Y = new V3(0, 1, 0);
  const swQ = new Q(), eQ = new Q();
  // кадры «героев» — заранее созданные объекты, без аллокаций в кадре
  const heroFrames = { 1: { w: 0, pos: new V3(), q: new Q(), s: 1 }, 2: { w: 0, pos: new V3(), q: new Q(), s: 1 } };
  const hE = new THREE.Euler(), hQ = new Q();
  const crownM = byName['R.crown'].mesh;
  const pulses = [0, 1].map(k => crownM.getObjectByName('pulse' + k));
  const crownGlowM = crownM.getObjectByName('crownGlow');
  const rimGlowM = byName['R.basket'].mesh.getObjectByName('rimGlow');
  const lq = new Q();

  function computePose() {
    const f = cur * 14 - 0.5;
    let i = Math.floor(f), t = f - i;
    if (i < 0) { i = 0; t = 0; }
    if (i >= 13) { i = 13; t = 0; }
    const tt = hpEase(hpClamp01((t - 0.12) / 0.76));
    resolveKey(i, kA);
    resolveKey(Math.min(13, i + 1), kB);
    for (const n of NUMS) pose[n] = hpLerp(kA[n], kB[n], tt);
    pose.fv.copy(kA.fv).lerp(kB.fv, tt);
    pose.fin = i === 13 ? 1 : i === 12 ? tt : 0;
    return pose;
  }

  function apply(dt) {
    const P = computePose();
    const fin = P.fin;
    // поза модели: фокус-точка в (sx, sy) на глубине z
    const dist = CAM_D - P.z;
    const tgt = tmp.p.set(P.sx * TAN * dist * aspect, P.sy * TAN * dist, P.z);
    const live = 1 - fin;
    pointer.cx += (pointer.x - pointer.cx) * Math.min(1, dt * 4);
    pointer.cy += (pointer.y - pointer.cy) * Math.min(1, dt * 4);
    const br = live * DEG;
    tmp.e.set((P.rx + pointer.cy * 4 * live) * DEG + Math.sin(time * 0.7) * br, (P.ry + pointer.cx * 4 * live) * DEG + Math.sin(time * 0.5 + 1) * br, P.rz * DEG, 'YXZ');
    model.quaternion.setFromEuler(tmp.e);
    if (P.px) model.quaternion.premultiply(tmp.q.setFromAxisAngle(AX_X, P.px * DEG));
    const s = Math.max(P.s, 1e-4);
    model.scale.setScalar(s);
    // фокус, привязанный к правой чашке, поворачивается вместе с ней на шарнире
    swQ.setFromAxisAngle(AX_Y, P.sw * Math.PI / 2);
    const fv = tmp.fv.copy(P.fv);
    if (P.fs > 0 && P.sw !== 0) fv.lerp(tmp.v2.copy(P.fv).sub(swPivot).applyQuaternion(swQ).add(swPivot), P.fs);
    model.position.copy(tgt).sub(tmp.v.copy(fv).multiplyScalar(s).applyQuaternion(model.quaternion));
    model.position.y += Math.sin(time * 0.9) * 0.03 * live * s;
    model.visible = P.s > 0.004;
    if (model.visible && !modelSeen) { modelSeen = true; holdQuality(60); }
    model.updateMatrixWorld(true);
    tmp.inv.copy(model.matrixWorld).invert();
    tmp.camL.copy(camera.position).applyMatrix4(tmp.inv);
    tmp.mq.copy(model.quaternion); tmp.mqi.copy(model.quaternion).invert();

    const cbGrow = Math.max(hpSmooth(0, 0.5, P.cb), P.e);
    const cbSlide = 0.2 * hpSmooth(0.35, 1, P.cb) * (1 - P.e);
    const aw = P.aw;
    // телефон боком (низкий экран): разлёт тоже поджимаем — слева карточка, снизу край
    const mobNow = isMob(), lowH = !mobNow && H < 480, exK = mobNow ? 0.62 : lowH ? 0.8 : 1, flyK = mobNow || lowH ? 0.5 : 1;

    // мировые кадры «героев»
    for (const hk of [1, 2]) {
      const hf = heroFrames[hk];
      hf.w = hk === 1 ? P.h1 : P.h2;
      if (hf.w <= 0.001) continue;
      const hd = HERO[hk], mob = isMob();
      const sx = mob ? hd.msx : hd.sx, sy = mob ? hd.msy : hd.sy;
      hf.s = mob ? hd.ms : hd.s;
      const d2 = CAM_D - hd.z;
      hf.pos.set(sx * TAN * d2 * aspect, sy * TAN * d2, hd.z);
      const q = hf.q;
      if (hk === 1) {
        q.setFromEuler(hE.set(14 * DEG, (-52 + Math.sin(time * 0.3) * 8) * DEG, 0, 'YXZ'));
        q.multiply(hQ.setFromAxisAngle(AX_X, -Math.PI / 2 + 0.7));
        q.multiply(hQ.setFromAxisAngle(AX_Y, time * 0.35));
      } else {
        q.setFromEuler(hE.set(0, (-28 + Math.sin(time * 0.35) * 10) * DEG, -8 * DEG, 'YXZ'));
        q.multiply(hQ.setFromAxisAngle(AX_X, 38 * DEG));
      }
    }

    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i], m = pt.mesh;
      if (pt.lead) {
        // тонкая деталь жёстко повторяет движение носителя (он обработан раньше — построен раньше)
        const L = pt.lead.mesh, ls = L.scale.x;
        lq.copy(L.quaternion);
        m.position.copy(pt.fo).multiplyScalar(ls).applyQuaternion(lq).add(L.position);
        m.quaternion.copy(lq).multiply(pt.fq);
        m.scale.setScalar(Math.max(ls * pt.fk, 1e-4));
        m.visible = L.visible;
        continue;
      }
      const p = m.position.copy(pt.rp), q = m.quaternion.copy(pt.rq);
      let sc = pt.rs;
      if (pt.sw && P.sw !== 0) { p.sub(swPivot).applyQuaternion(swQ).add(swPivot); q.premultiply(swQ); }
      if (pt.cable) {
        p.sub(jackP).multiplyScalar(cbGrow).add(jackP).addScaledVector(jackAxis, cbSlide);
        sc *= cbGrow;
      }
      // разлёт
      const ei = hpEase(hpClamp01(P.e * 1.3 - pt.delay * 0.3));
      if (ei > 0) {
        // на узком экране разлёт поджимаем по ширине, а подлёт к камере ослабляем — иначе края режутся
        p.x += pt.ex.x * ei * exK; p.y += pt.ex.y * ei; p.z += pt.ex.z * ei;
        if (aw > 0) p.add(tmp.v.copy(pt.wsc).applyQuaternion(tmp.mqi).multiplyScalar(aw * ei / s));
        if (pt.fly) p.add(tmp.v.copy(tmp.camL).sub(pt.rp).multiplyScalar(pt.fly * flyK * ei * (1 - aw)));
        eQ.setFromAxisAngle(pt.axis, ei * (pt.rot + time * pt.spin));
        q.premultiply(eQ);
        // всё, кроме «героев», к центру гл. 9 полностью уходит в глубину и исчезает
        // неактивный «герой» уходит вместе со всеми — иначе в кадре остаются крапинки
        sc *= pt.hero && heroFrames[pt.hero].w > 0.001 ? 1 - 0.8 * aw : 1 - aw;
      }
      // финал: всё, кроме правой чашки, улетает
      if (P.iso > 0 && !pt.keep) {
        const k = hpEase(P.iso);
        p.addScaledVector(pt.dir, k * 3.2);
        sc *= 1 - k;
      }
      // «герои»
      const hf = pt.hero && heroFrames[pt.hero].w > 0.001 ? heroFrames[pt.hero] : null;
      if (hf) {
        const o = pt.o;
        const hw = tmp.hw.copy(o.p).multiplyScalar(hf.s).applyQuaternion(hf.q).add(hf.pos).applyMatrix4(tmp.inv);
        const hq = tmp.hq.copy(tmp.mqi).multiply(hf.q).multiply(o.q);
        const hsc = hf.s / s;
        const w = hpEase(hf.w);
        p.lerp(hw, w); q.slerp(hq, w); sc = hpLerp(sc, hsc, w);
      }
      m.scale.setScalar(Math.max(sc, 1e-4));
      // начинка закрытой чашки не видна — не рисуем (и экономим draw calls)
      m.visible = sc > 0.003 && (!pt.inner || ei > 0 || !!hf);
    }

    // акценты материалов
    mat.cap.emissiveIntensity = P.h1 * 0.45;
    mat.basket.emissiveIntensity = P.h1 * 0.14;
    mat.rimGlow.emissiveIntensity = P.h1 * 1.0;
    rimGlowM.visible = P.h1 > 0.02;
    mat.padInR.emissiveIntensity = P.gr * 0.05;
    mat.logo.emissiveIntensity = P.lg * 0.12;
    const tc = P.tc;
    // тёплое кольцо вокруг колёсика — только в главе касания
    crownGlowM.visible = tc > 0.02;
    mat.glow.emissiveIntensity = tc * (0.9 + 0.5 * Math.sin(time * 5));
    // волна-касание расходится от колёсика; ребром к камере волну гасим — иначе висит дугой
    let face = 0;
    if (tc > 0.02) {
      tmp.v.set(0, 1, 0).applyQuaternion(crownM.quaternion);
      tmp.v2.copy(tmp.camL).sub(crownM.position).normalize();
      face = hpSmooth(0.1, 0.4, tmp.v.dot(tmp.v2));
    }
    for (let k = 0; k < 2; k++) {
      // в застывшем кадре (time 0.6) одна волна далеко, вторая на полпути
      const pm = pulses[k], ph = (time * 0.85 + 0.2 + k * 0.5) % 1;
      pm.visible = tc > 0.02 && face > 0.01;
      if (pm.visible) { pm.scale.setScalar(0.9 + 1.9 * ph); pm.material.opacity = tc * face * Math.min(1, ph * 5) * Math.min(1, (1 - ph) * 2.5); }
    }
  }

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    W = w; H = h; aspect = w / h;
    appliedDpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(appliedDpr, prCap));
    renderer.setSize(w, h, false);
    camera.aspect = aspect; camera.updateProjectionMatrix();
    holdQuality(30);
  }

  function adaptQuality(dt) {
    if (holdFrames > 0) { holdFrames--; return; }
    const now = performance.now();
    if (document.visibilityState !== 'visible' || now - qT0 < 3000) return;
    dtBuf[dtN++] = dt;
    if (dtN < 30) return;
    dtN = 0;
    dtSort.set(dtBuf); dtSort.sort();
    const med = (dtSort[14] + dtSort[15]) / 2, spread = dtSort[24] - dtSort[5];
    const dpr = window.devicePixelRatio || 1;
    // ровные ~30 fps — лимит браузера (батарея), а не перегрузка GPU
    const capped = med > 0.029 && med < 0.037 && spread < 0.004;
    if (prCap > 1) {
      if (med > 0.022 && !capped && Math.min(dpr, prCap) > 1) {
        if (++slowWins >= 2) { prCap = 1; prDropAt = now; resize(); }
      } else slowWins = 0;
    } else if (prRaises < 1 && dpr > 1 && now - prDropAt > 10000) {
      if (med < 0.0175 && spread < 0.004) {
        if (!fastSince) fastSince = now;
        else if (now - fastSince > 8000) { prRaises++; prCap = PR_MAX; resize(); }
      } else fastSince = 0;
    }
  }

  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (motion) time += dt;
    // смена DPR без смены CSS-размера (окно перенесли на другой монитор, зум) — тоже ресайз
    if (canvas.clientWidth !== W || canvas.clientHeight !== H || (window.devicePixelRatio || 1) !== appliedDpr) resize();
    // без движения (reduced-motion) большой прыжок прогресса не проигрываем хореографией, а перескакиваем;
    // мелкие шаги колеса догоняем как обычно
    if (!motion && Math.abs(target - cur) > 1 / 14) cur = target;
    const k = 1 - Math.pow(1 - 0.12, dt * 60);
    cur += (target - cur) * k;
    if (Math.abs(target - cur) < 1e-5) cur = target;
    adaptQuality(dt);
    // простой: скролл стоит и курсор не двигался 2 с — рисуем через кадр (дыхание остаётся)
    frameNo++;
    const idle = Math.abs(target - cur) < 1e-4 && performance.now() / 1000 - lastPointerAt > 2 && Math.abs(pointer.x - pointer.cx) < 1e-3 && Math.abs(pointer.y - pointer.cy) < 1e-3;
    if (idle && (frameNo & 1)) return;
    apply(idle ? dt * 2 : dt);
    renderer.render(scene, camera);
  }

  resize();
  // прогрев шейдеров: в гл. 0 модель скрыта, а three.js собирает программы только для видимых
  // объектов — без прогрева ~10 программ компилируются разом в кадре появления наушников
  // (фриз посреди доводки интро). Временно показываем всё, компилируем и один раз рисуем
  // модель в точку (первое использование программы дожидается линковки), затем возвращаем как было
  try {
    const saved = [];
    scene.traverse((o) => { saved.push(o, o.visible); o.visible = true; });
    renderer.compile(scene, camera);
    model.scale.setScalar(1e-4);
    model.updateMatrixWorld(true);
    renderer.render(scene, camera);
    renderer.clear();
    for (let i = 0; i < saved.length; i += 2) saved[i].visible = saved[i + 1];
  } catch (err) { /* без прогрева — просто как раньше */ }
  apply(0);
  frame();
  {
    let tris = 0;
    const cnt = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    parts.forEach(p => { tris += cnt(p.mesh.geometry); p.mesh.children.forEach(c => { if (c.geometry) tris += cnt(c.geometry); }); });
    console.info('[flow] headphones: ' + parts.length + ' parts, ~' + Math.round(tris / 1000) + 'k tris');
  }

  const anchorPart = { cupLeft: 'L.shell', cupRight: 'R.shell', touch: 'R.crown', driver: 'R.cone', cable: 'R.usb' };
  // точка якоря в системе детали: у левой чашки — центр внешней грани (там знак flow)
  const anchorOff = { cupLeft: new V3(0, SD / 2, 0) };
  const faceCheck = { cupLeft: true, touch: true };
  const av = new V3(), an = new V3(), ac = new V3();
  return {
    partCount: parts.length,
    setProgress(p) {
      target = hpClamp01(+p || 0);
      if (first) { first = false; cur = target; apply(0); }
    },
    resize,
    setPointer(nx, ny) {
      if (!motion) return;
      pointer.x = Math.max(-1, Math.min(1, nx || 0)); pointer.y = Math.max(-1, Math.min(1, ny || 0));
      lastPointerAt = performance.now() / 1000;
    },
    // 'mobile' | 'desktop' — та же точка переключения, что у вёрстки
    setLayout(mode) {
      const v = mode === 'mobile' ? 'mobile' : mode === 'desktop' ? 'desktop' : null;
      if (v === layout) return;
      layout = v; apply(0);
    },
    // false — время сцены стоит (нет дыхания, вращения, пульса) и курсор не влияет: reduced-motion и тесты
    setMotion(enabled) {
      motion = !!enabled;
      if (!motion) { pointer.x = pointer.y = pointer.cx = pointer.cy = 0; apply(0); }
    },
    getAnchor(name) {
      let visible = model.visible;
      if (name === 'center' || !anchorPart[name]) {
        av.setFromMatrixPosition(model.matrixWorld);
      } else {
        const m = byName[anchorPart[name]].mesh;
        m.updateWorldMatrix(true, false);
        if (anchorOff[name]) av.copy(anchorOff[name]).applyMatrix4(m.matrixWorld);
        else av.setFromMatrixPosition(m.matrixWorld);
        visible = visible && m.visible && m.scale.x * model.scale.x > 0.05;
        if (faceCheck[name]) {
          an.set(0, 1, 0).applyQuaternion(m.quaternion).applyQuaternion(model.quaternion);
          ac.copy(camera.position).sub(av).normalize();
          visible = visible && an.dot(ac) > 0.15;
        }
      }
      const ndc = av.project(camera);
      const x = (ndc.x + 1) / 2 * W, y = (1 - ndc.y) / 2 * H;
      visible = visible && ndc.z < 1 && x > 0 && x < W && y > 0 && y < H;
      return { x, y, visible };
    },
    setFinaleTarget(rect) {
      if (rect && rect.size > 0) finaleRect = { x: +rect.x, y: +rect.y, size: +rect.size };
    },
    dispose() {
      disposed = true; cancelAnimationFrame(raf);
      if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', redrawLogo);
      document.removeEventListener('visibilitychange', onVisChange);
      canvas.removeEventListener('webglcontextlost', onCtxLost, false);
      canvas.removeEventListener('webglcontextrestored', onCtxRestored, false);
      const geos = new Set();
      parts.forEach(pt => { geos.add(pt.mesh.geometry); pt.mesh.children.forEach(c => c.geometry && geos.add(c.geometry)); });
      geos.forEach(g => g.dispose());
      Object.values(mat).forEach(m => m.dispose());
      [plateTex, coneTex, grilleTex, pcbTex, logoTex, knitPad, knitCol, knitIn, meshN, meshC, sideTex.R, sideTex.L].forEach(t => t.dispose());
      room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      envRT.dispose();
      renderer.dispose();
    },
  };
}
