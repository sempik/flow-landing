// Flow — процедурные 3D-наушники (форма полноразмерных «алюминиевых» наушников со стальной рамой
// и сетчатым оголовьем) и хореография по главам (Three.js r160)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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

// протяжка замкнутого профиля вдоль плоской кривой; B — нормаль плоскости кривой
function hpSweep(pathFn, B, profile, segs, caps) {
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
    const t = i / segs;
    pathFn(t, P); pathFn(Math.max(0, t - 1e-3), Pa); pathFn(Math.min(1, t + 1e-3), Pb);
    T.subVectors(Pb, Pa).normalize();
    N.crossVectors(B, T).normalize();
    if (i === 0 || i === segs) ends.push({ P: P.clone(), T: T.clone(), N: N.clone(), first: i === 0 });
    for (let j = 0; j <= m; j++) {
      const k = j % m, u = profile[k][0], v = profile[k][1], nu = pn[k][0], nv = pn[k][1];
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
      const u = profile[j][0], v = profile[j][1];
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

// Контур чашки — вытянутый скруглённый прямоугольник (суперэллипс), равномерно по длине.
// Плоскость контура — локальная XZ: X — вертикаль (половина высоты hx), Z — вперёд (половина ширины hz).
function hpOutline(hx, hz, n, segs) {
  const F = 2048, raw = [], cum = [0];
  for (let i = 0; i <= F; i++) {
    const t = (i / F) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    raw.push([hx * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), hz * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
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

// «Токарка» по контуру-стадиону: prof = [[масштаб контура, высота по оси Y, сдвиг по нормали], ...].
// Профиль идёт так же, как у LatheGeometry (внешняя стенка — снизу вверх), нормали наружу.
// planar — UV плоской проекцией (для круглых наклеек), иначе UV в единицах длины (для ткани)
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

// сглаживает нормали у вершин с одинаковой позицией (шов развёртки, центр крышки)
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

// базис на боковой стенке чашки: X — касательная, Y — нормаль наружу, Z — ось чашки
function hpRim(O, j, y, push) {
  const p = O.pts[j], nn = O.nrm[j];
  const R = new THREE.Vector3(nn[0], 0, nn[1]);
  const A = new THREE.Vector3(0, 1, 0);
  const T = new THREE.Vector3().crossVectors(R, A);
  const m = new THREE.Matrix4().makeBasis(T, R, A);
  m.setPosition(p[0] + nn[0] * (push || 0), y, p[1] + nn[1] * (push || 0));
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

// провисающий сетчатый «гамак» оголовья: лента между концами рамы, шире рамы, к концам сужается
function hpCanopy(A, Y0, B, n, segs, J, wFn, lift) {
  const pos = [], uv = [], idx = [];
  const P = new THREE.Vector3(), Pa = new THREE.Vector3(), Pb = new THREE.Vector3(), prev = new THREE.Vector3();
  const T = new THREE.Vector3(), N = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), D = new THREE.Vector3();
  const path = (t, out) => {
    const f = -Math.PI / 2 + t * Math.PI, s = Math.sin(f), c = Math.cos(f);
    return out.set(A * Math.sign(s) * Math.pow(Math.abs(s), 2 / n), Y0 + B * Math.pow(Math.abs(c), 2 / n), 0);
  };
  let L = 0; path(0, prev);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; path(t, P);
    L += P.distanceTo(prev); prev.copy(P);
    path(Math.max(0, t - 1e-3), Pa); path(Math.min(1, t + 1e-3), Pb);
    T.subVectors(Pb, Pa).normalize(); N.crossVectors(T, Z).normalize();
    if (N.dot(D.set(P.x, P.y - Y0 + 0.3, 0)) < 0) N.negate();
    const w = wFn(t);
    for (let j = 0; j <= J; j++) {
      const v = (j / J) * 2 - 1;
      pos.push(P.x + N.x * lift * v * v, P.y + N.y * lift * v * v, v * w);
      uv.push(L, v * w);
    }
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
  return g;
}

function hpCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function hpRingsTexture(base, amp) {
  base = base || 46; amp = amp || 26;
  const c = hpCanvas(4, 512), g = c.getContext('2d');
  for (let y = 0; y < 512; y++) {
    const v = base + Math.floor(hpRand(y, 3) * amp) + (y % 9 === 0 ? 18 : 0);
    g.fillStyle = `rgb(${v},${v + 1},${v + 4})`; g.fillRect(0, y, 4, 1);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function hpGrilleTexture() {
  // перфорированная акустическая сетка: дырки прозрачные (alphaTest)
  const c = hpCanvas(128, 128), g = c.getContext('2d');
  g.fillStyle = '#3a3546'; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) {
    g.beginPath(); g.arc(x * 16 + (y % 2) * 8, y * 16 + 8, 5.2, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7); return t;
}

function hpPcbTexture() {
  const c = hpCanvas(512, 512), g = c.getContext('2d');
  g.fillStyle = '#16122a'; g.fillRect(0, 0, 512, 512);
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
  g.fillStyle = '#d9cff5'; g.font = 'bold 22px monospace'; g.fillText('FLOW-HP2 REV.C', 24, 490);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Вязаная акустическая ткань: карта высот «петель» -> нормал-карта; сетка гамака — ромбы-дырки (альфа)
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
    // трикотажная «косичка»: две наклонные петли в клетке
    h[y * N + x] = Math.max(lobe(fx, fy, 0.29, 0.5), lobe(fx, fy, 0.71, -0.5));
    // сетка гамака: ромбическая ячейка, перемычки выпуклые
    const gx = ((x + (Math.floor(y / C) % 2) * C / 2) % C + 0.5) / C;
    const d = Math.abs(gx - 0.5) + Math.abs(fy - 0.5);
    hm[y * N + x] = hpSmooth(0.26, 0.42, d);
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
  const knit = toNormal(h, 2.2), mesh = toNormal(hm, 3.0);
  const ac = hpCanvas(N, N), ag = ac.getContext('2d'), ai = ag.createImageData(N, N);
  for (let i = 0; i < N * N; i++) { const v = 40 + hm[i] * 215; ai.data[i * 4] = ai.data[i * 4 + 1] = ai.data[i * 4 + 2] = v; ai.data[i * 4 + 3] = 255; }
  ag.putImageData(ai, 0, 0);
  const alpha = new THREE.CanvasTexture(ac); alpha.wrapS = alpha.wrapT = THREE.RepeatWrapping;
  return { knit, mesh, alpha };
}

// внутренняя ткань амбушюра с крупной буквой стороны
function hpSideTexture(letter) {
  const c = hpCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#7d6f9e'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#887aa9'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 96px "Syne", "Rubik", "Arial", sans-serif';
  g.fillText(letter, 128, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function hpDrawLogo(canvas) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const k = canvas.width / 1024;
  g.font = `800 ${280 * k}px "Syne", "Rubik", "Arial Black", sans-serif`;
  g.fillText('flow', canvas.width / 2, canvas.height / 2 + 6 * k);
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

function hpAddEnvPanels(env) {
  const add = (color, k, w, h, x, y, z) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  // яркий фиолетовый в отражениях ACES уводит в голубой — держим его умеренным и чуть теплее
  add(0xa66cf5, 3.2, 2.4, 7, -6, 2, -4);
  add(0x38bdf8, 0.45, 2.2, 7, 6, 1, -4.5);
  add(0xc4a1ff, 2.6, 8, 1.2, 0, 6.5, -2);
}

// ---------- сцена ----------
function createHeadphonesScene(canvas) {
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const DEG = Math.PI / 180;
  const DPR = window.devicePixelRatio || 1;
  // на плотных экранах MSAA почти не виден, а fill-rate съедает
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: DPR < 1.5, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const FOV = 30, CAM_D = 10, TAN = Math.tan(FOV / 2 * DEG);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_D);

  // окружение: RoomEnvironment + фиолетовые/голубые панели для отражений в алюминии
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  hpAddEnvPanels(room);
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

  // свет под тёмный фон: мягкий белый key сверху-спереди, фиолетовый и голубой римы сзади — силуэт читается
  scene.add(new THREE.HemisphereLight(0xd8ccff, 0x0c0a14, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 6, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xd2c8ee, 0.7); fill.position.set(-5, -1, 4); scene.add(fill);
  const rimA = new THREE.DirectionalLight(0x9d6fff, 7.5); rimA.position.set(-5, 4.5, -4.5); scene.add(rimA);
  // голубой рим строго сзади: обводит силуэт, но не ложится отливом на видимые рёбра алюминия
  const rimB = new THREE.DirectionalLight(0x38bdf8, 2.6); rimB.position.set(3.5, 1.5, -7.5); scene.add(rimB);

  // ---------- материалы (один раз) ----------
  const DS = THREE.DoubleSide;
  const plateTex = hpRingsTexture(150, 60), coneTex = hpRingsTexture(80, 70);
  const grilleTex = hpGrilleTexture(), pcbTex = hpPcbTexture();
  const KM = hpKnitMaps();
  const KNIT_TILE = 0.2; // клетка ткани ≈ 0.025 у.е.
  const knitPad = KM.knit; knitPad.repeat.set(1 / KNIT_TILE, 1 / KNIT_TILE);
  const knitIn = KM.knit.clone(); knitIn.needsUpdate = true; knitIn.repeat.set(5.5, 6.5);
  const meshN = KM.mesh; meshN.repeat.set(1 / 0.16, 1 / 0.16);
  const meshA = KM.alpha; meshA.repeat.set(1 / 0.16, 1 / 0.16);
  const sideTex = { R: hpSideTexture('R'), L: hpSideTexture('L') };
  const logoCanvas = hpCanvas(2048, 1024); hpDrawLogo(logoCanvas);
  const logoTex = new THREE.CanvasTexture(logoCanvas); logoTex.colorSpace = THREE.SRGBColorSpace; logoTex.anisotropy = 4;
  const ALU = 0xac9bd2; // фиолетовый анодированный алюминий, приглушённая лаванда
  const mat = {
    // сатиновый анодированный металл: шероховатость выше и приглушённые отражения, без перламутра по рёбрам
    alu: new THREE.MeshPhysicalMaterial({ color: ALU, metalness: 1, roughness: 0.42, envMapIntensity: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xe8e9ef, metalness: 1, roughness: 0.12 }),
    // ткань амбушюров — в тон алюминию или чуть темнее: база темнее и насыщеннее, блеск ворса слабее (иначе подушки белеют)
    knit: new THREE.MeshPhysicalMaterial({ color: 0x6d5d9c, metalness: 0, roughness: 0.92, sheen: 0.5, sheenColor: new THREE.Color(0xa38ce4), sheenRoughness: 0.5, normalMap: knitPad, normalScale: new THREE.Vector2(0.9, 0.9) }),
    padInR: new THREE.MeshStandardMaterial({ color: 0xffffff, map: sideTex.R, normalMap: knitIn, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.92, emissive: 0x9d6fff, emissiveIntensity: 0 }),
    padInL: new THREE.MeshStandardMaterial({ color: 0xffffff, map: sideTex.L, normalMap: knitIn, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.92 }),
    canopy: new THREE.MeshStandardMaterial({ color: 0xa496c8, alphaMap: meshA, transparent: true, depthWrite: false, normalMap: meshN, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0.1, roughness: 0.75, side: DS }),
    hole: new THREE.MeshStandardMaterial({ color: 0x06050a, metalness: 0.2, roughness: 0.6 }),
    seam: new THREE.MeshStandardMaterial({ color: 0x15121d, metalness: 0.4, roughness: 0.5 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1b1824, metalness: 0.2, roughness: 0.5, side: DS }),
    grille: new THREE.MeshStandardMaterial({ color: 0x8a82a0, map: grilleTex, alphaTest: 0.5, metalness: 0.7, roughness: 0.32, side: DS }),
    gun: new THREE.MeshStandardMaterial({ color: 0x8a8597, metalness: 1, roughness: 0.3 }),
    // диффузор: заметные концентрические рёбра — читается как мембрана, а не плоский диск
    cone: new THREE.MeshPhysicalMaterial({ color: 0x6c6680, map: coneTex, metalness: 0.8, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, side: DS }),
    cap: new THREE.MeshPhysicalMaterial({ color: 0x221d2e, metalness: 0.8, roughness: 0.18, clearcoat: 1, emissive: 0x9d6fff, emissiveIntensity: 0, side: DS }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc8804a, metalness: 1, roughness: 0.28, side: DS }),
    magnet: new THREE.MeshStandardMaterial({ color: 0x2f2c38, metalness: 1, roughness: 0.25 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xcfcbe0, map: plateTex, metalness: 0.9, roughness: 0.3 }),
    basket: new THREE.MeshStandardMaterial({ color: 0x2c2838, metalness: 0.9, roughness: 0.4, emissive: 0x9d6fff, emissiveIntensity: 0, side: DS }),
    rimGlow: new THREE.MeshStandardMaterial({ color: 0x120c1e, emissive: 0xc4a1ff, emissiveIntensity: 0, toneMapped: false }),
    pcb: new THREE.MeshStandardMaterial({ color: 0xffffff, map: pcbTex, metalness: 0.25, roughness: 0.45 }),
    chip: new THREE.MeshStandardMaterial({ color: 0x0d0c12, metalness: 0.4, roughness: 0.3 }),
    battery: new THREE.MeshPhysicalMaterial({ color: 0x3b3550, metalness: 0.5, roughness: 0.35, clearcoat: 0.7 }),
    // светящиеся акценты мимо тонмаппинга: ACES обесцвечивает насыщенный фиолетовый в бледный
    glow: new THREE.MeshStandardMaterial({ color: 0x0e0a18, emissive: 0x9d6fff, emissiveIntensity: 1.0, toneMapped: false }),
    led: new THREE.MeshStandardMaterial({ color: 0x06121a, emissive: 0x38bdf8, emissiveIntensity: 1.2, toneMapped: false }),
    cable: new THREE.MeshStandardMaterial({ color: 0xe9e5f2, metalness: 0, roughness: 0.55 }),
    // логотип — прозрачная плоскость с мягкой альфой: подсвеченная гравировка
    logo: new THREE.MeshStandardMaterial({ color: 0x2a1d52, map: logoTex, emissive: 0xb48cff, emissiveMap: logoTex, emissiveIntensity: 1.35, metalness: 0.6, roughness: 0.3, toneMapped: false, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    // обычное смешивание: аддитивный фиолетовый поверх светлого алюминия выгорает в белое
    pulse: new THREE.MeshBasicMaterial({ color: 0x9d6fff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DS }),
  };
  mat.pulse2 = mat.pulse.clone();
  const redrawLogo = () => {
    hpDrawLogo(logoCanvas); logoTex.needsUpdate = true;
    ['R', 'L'].forEach(s => { const t = hpSideTexture(s); sideTex[s].image = t.image; sideTex[s].needsUpdate = true; t.dispose(); });
  };
  hpEnsureSyne(redrawLogo);
  if (document.fonts) {
    document.fonts.load('800 280px "Syne"').then(redrawLogo, () => {});
    document.fonts.ready.then(redrawLogo);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', redrawLogo);
  }

  // ---------- геометрия ----------
  // Размеры (у.е. ≈ 6.7 мм): высота ~2.8, ширина ~2.6. Чашка — стадион 1.31 x 1.06.
  const CB = 0.655, CA = 0.53, CN = 3.2; // полувысота, полуширина и «квадратность» чашки
  const SD = 0.43;                       // глубина алюминиевой чашки
  const PAD_IN = 0.45;                   // внутренняя плоскость амбушюров
  const P0 = -0.018, PD = 0.40, E = P0 - PD; // от плоскости чашки: зазор-магнит, толщина подушки
  const SHELL_IN = PAD_IN - E;           // ~0.868
  const SHELL_OUT = SHELL_IN + SD;
  const HX = SHELL_IN + SD / 2;          // ось шарнира/штанги
  const CY = -0.72;                      // центр чашки по высоте
  const CUP_TOP = CY + CB;
  const Y0 = 0.36, BAND_B = 1.02;        // концы рамы и высота дуги
  const root = new THREE.Group();
  const parts = [];
  const part = (parent, geo, material, name, tags, place) => {
    const m = new THREE.Mesh(geo, material); m.name = name;
    if (place) { if (place.isMatrix4) m.applyMatrix4(place); else place(m); }
    parent.add(m);
    parts.push({ mesh: m, name, tags: ' ' + (tags || '') + ' ' });
    return m;
  };

  // --- оголовье: стальная дуга-рама + сетчатый гамак под ней ---
  const bandPath = (t, out) => {
    const f = -Math.PI / 2 + t * Math.PI, s = Math.sin(f), c = Math.cos(f), n = 2.5;
    return out.set(HX * Math.sign(s) * Math.pow(Math.abs(s), 2 / n), Y0 + BAND_B * Math.pow(Math.abs(c), 2 / n), 0);
  };
  part(root, hpSweep(bandPath, new V3(0, 0, 1), hpSuperProfile(0.019, 0.03, 4, 20), 160, true), mat.steel, 'band', 'big');
  part(root, hpCanopy(HX - 0.035, Y0 + 0.08, BAND_B - 0.26, 2.15, 140, 14, t => 0.075 + 0.185 * Math.pow(Math.sin(Math.PI * t), 0.4), 0.03), mat.canopy, 'canopy', 'big');

  // общие геометрии обеих сторон
  const O = hpOutline(CB, CA, CN, 160);
  const G = {
    // чашка: внутренняя крышка, прямая стенка, мягкое скругление к плоской внешней грани
    shell: hpPill(O, [[0, 0], [0.5, 0], [0.86, 0], [1, 0, -0.045], [1, 0.012, -0.016], [1, 0.04, 0], [1, 0.18, 0.003], [1, 0.3, 0], [1, 0.345, -0.006], [1, 0.38, -0.022], [1, 0.405, -0.045], [1, 0.421, -0.075], [1, 0.429, -0.105], [0.74, 0.433], [0.55, 0.4375], [0.36, 0.4405], [0.2, 0.442], [0.08, 0.4425], [0, 0.4425]]),
    padBase: hpPill(O, [[0, P0], [0.955, P0], [0.955, 0], [0, 0]]),
    // толстая подушка той же формы: ухо -> наружу -> стенка вверх -> к чашке -> внутрь проёма
    pad: hpPill(O, [[0.6, E + 0.05], [0.615, E + 0.016], [0.66, E + 0.002], [0.76, E - 0.004], [0.87, E + 0.002], [0.94, E + 0.025], [0.98, E + 0.075], [0.998, E + 0.15], [1.0, E + 0.24], [0.997, P0 - 0.1], [0.985, P0 - 0.04], [0.965, P0 - 0.008], [0.94, P0], [0.75, P0], [0.6, P0], [0.585, P0 - 0.025], [0.585, E + 0.12], [0.6, E + 0.05]]),
    padIn: hpPill(O, [[0, P0 - 0.03], [0.3, P0 - 0.03], [0.6, P0 - 0.03]], true),
    ring: (() => {
      const pts = O.pts.map(p => new V3(p[0] * 0.74, SD + 0.004, p[1] * 0.74));
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 220, 0.0055, 6, true);
    })(),
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
    screw: mergeGeometries([new THREE.CylinderGeometry(0.014, 0.014, 0.05, 12).translate(0, 0.025, 0), new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16)]),
    // три микрофонных отверстия в ряд
    mic: mergeGeometries([-1, 0, 1].map(k => new THREE.CylinderGeometry(0.0115, 0.0115, 0.01, 14).translate(k * 0.03, 0, 0))),
    pivot: mergeGeometries([new THREE.CylinderGeometry(0.066, 0.072, 0.036, 40), new THREE.TorusGeometry(0.06, 0.006, 8, 40).rotateX(Math.PI / 2).translate(0, 0.018, 0)]),
    knuckle: mergeGeometries([new THREE.SphereGeometry(0.036, 24, 16), new THREE.CylinderGeometry(0.023, 0.03, 0.05, 20).translate(0, 0.04, 0)]),
    arm: new THREE.CylinderGeometry(0.019, 0.019, (Y0 - 0.15) - (CUP_TOP + 0.06), 20),
    stem: hpLathe([[0.0001, -0.115], [0.02, -0.113], [0.029, -0.104], [0.032, -0.085], [0.032, 0.085], [0.029, 0.1], [0.02, 0.11], [0.0001, 0.112]], 28),
    anchor: new RoundedBoxGeometry(0.05, 0.13, 0.17, 3, 0.022),
  };
  const armMidY = ((Y0 - 0.15) + (CUP_TOP + 0.06)) / 2;
  // Digital Crown — рифлёный цилиндр, ось вдоль Y, основание в 0
  const crownGeo = (() => {
    const R = 0.068, H = 0.062, T = 44, NP = T * 4, sh = new THREE.Shape();
    for (let i = 0; i < NP; i++) {
      const a = (i / NP) * Math.PI * 2, r = R * (1 - 0.05 * (0.5 + 0.5 * Math.cos(a * T)));
      if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: H, bevelEnabled: false, steps: 1, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    const top = new THREE.CylinderGeometry(R * 0.86, R * 0.93, 0.008, 48).translate(0, H + 0.004, 0).toNonIndexed();
    return mergeGeometries([g, top]);
  })();

  const pivots = {};
  const buildSide = (side) => {
    const S = side > 0 ? 'R' : 'L';
    const sg = new THREE.Group(); if (side < 0) sg.rotation.y = Math.PI; root.add(sg);
    // правая чашка поворачивается на шарнире вокруг оси штанги
    const sw = side > 0 ? 'sw' : '';
    // гильза рамы, телескопическая штанга, шаровой шарнир, крепление гамака
    part(sg, G.stem, mat.steel, S + '.stem', S, m => m.position.set(HX, Y0 - 0.06, 0));
    part(sg, G.arm, mat.steel, S + '.arm', S, m => m.position.set(HX, armMidY, 0));
    part(sg, G.anchor, mat.alu, S + '.anchor', S, m => m.position.set(HX - 0.035, Y0 + 0.07, 0));
    part(sg, G.knuckle, mat.steel, S + '.knuckle', S + ' small cam ' + sw, m => m.position.set(HX, CUP_TOP + 0.035, 0));
    // чашка: локальная ось Y — наружу; X — вниз; Z — вперёд (для правой)
    const cf = new THREE.Group(); cf.position.set(SHELL_IN, CY, 0); cf.rotation.z = -Math.PI / 2; sg.add(cf);
    const ct = S + ' cup' + S + ' ' + sw + (side > 0 ? ' keep' : '');
    // мелочь снаружи (кнопки, порт, микрофоны, шарнир) в финале улетает — в «o» остаётся чистая чашка
    const ctr = S + ' cup' + S + ' ' + sw;
    const shell = part(cf, G.shell, mat.alu, S + '.shell', ct + ' big');
    if (side < 0) {
      const dg = new THREE.PlaneGeometry(0.8, 0.4);
      dg.applyMatrix4(new THREE.Matrix4().makeBasis(new V3(0, 0, -1), new V3(-1, 0, 0), new V3(0, 1, 0)));
      const d = new THREE.Mesh(dg, mat.logo); d.position.set(0, SD + 0.0135, 0); d.renderOrder = 2; d.name = 'logo'; shell.add(d);
    } else {
      part(cf, G.ring, mat.glow, 'R.ring', ct);
    }
    part(cf, G.padBase, mat.seam, S + '.padBase', ct);
    part(cf, G.pad, mat.knit, S + '.pad', ct + ' big');
    part(cf, G.padIn, side > 0 ? mat.padInR : mat.padInL, S + '.padIn', ct);
    part(cf, G.grille, mat.grille, S + '.grille', ct, m => m.position.set(0, 0.004, 0));
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
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      part(cf, G.screw, mat.steel, S + '.screw' + k, ct + ' small cam', m => m.position.set(Math.cos(a) * 0.4, 0.012, Math.sin(a) * 0.36));
    }
    // шарнир на верхней кромке чашки
    const jTop = hpRimAt(O, -1, 0);
    part(cf, G.pivot, mat.alu, S + '.pivot', ctr + ' small', hpRim(O, jTop, SD / 2, 0.004));
    // микрофоны: верх-перед, перёд, низ-зад
    [[-0.72, 0.7, 0.3], [0.2, 1, 0.24], [0.8, -0.6, 0.27]].forEach(([dx, dz, y], k) => {
      part(cf, G.mic, mat.hole, S + '.mic' + k, ctr + ' small cam', hpRim(O, hpRimDir(O, dx, dz), y, -0.0035));
    });
    if (side > 0) {
      // Digital Crown (сзади) и вытянутая кнопка шумоподавления (спереди) на верхней кромке
      const crown = part(cf, crownGeo, mat.alu, 'R.crown', ctr + ' small cam', hpRim(O, hpRimAt(O, -1, -0.235), SD / 2, -0.012));
      const gr = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.0045, 8, 64).rotateX(Math.PI / 2), mat.glow);
      gr.position.set(0, 0.014, 0); gr.name = 'crownGlow'; crown.add(gr);
      // две волны со сдвигом фазы — в любом кадре видно расходящийся пульс
      const pg = new THREE.RingGeometry(0.086, 0.096, 72).rotateX(-Math.PI / 2);
      for (let k = 0; k < 2; k++) {
        const pulse = new THREE.Mesh(pg, k ? mat.pulse2 : mat.pulse); pulse.position.set(0, 0.016, 0); pulse.renderOrder = 3; pulse.name = 'pulse' + k; crown.add(pulse);
      }
      part(cf, new RoundedBoxGeometry(0.15, 0.04, 0.05, 3, 0.019), mat.alu, 'R.button', ctr + ' small cam', hpRim(O, hpRimAt(O, -1, 0.215), SD / 2, 0.004));
      // порт USB-C и индикатор снизу
      const jBot = hpRimAt(O, 1, 0.08);
      part(cf, new RoundedBoxGeometry(0.125, 0.03, 0.042, 3, 0.0145), mat.hole, 'R.usb', ctr + ' small', hpRim(O, jBot, SD / 2, -0.0135));
      part(cf, new THREE.BoxGeometry(0.075, 0.004, 0.011), mat.gun, 'R.usbTongue', ctr + ' small cam', hpRim(O, jBot, SD / 2, 0.0005));
      part(cf, new THREE.SphereGeometry(0.011, 12, 8), mat.led, 'R.led', ctr + ' small cam', hpRim(O, hpRimAt(O, 1, -0.11), SD / 2, -0.004));
      // плата с чипами
      part(cf, new RoundedBoxGeometry(0.46, 0.018, 0.3, 2, 0.008), mat.pcb, 'R.pcb', ct + ' brd', m => m.position.set(0, 0.29, 0));
      const chips = [[0.1, 0.085, 0.07, 0.03], [0.065, 0.065, -0.1, -0.05], [0.09, 0.05, -0.04, 0.09]];
      chips.forEach(([w, d, x, z], k) => part(cf, new RoundedBoxGeometry(w, 0.022, d, 2, 0.005), mat.chip, 'R.chip' + k, ct + ' brd small cam', m => m.position.set(x, 0.309, z)));
      // съёмный кабель USB-C (в собранном виде спрятан)
      const jf = new THREE.Group(); jf.applyMatrix4(hpRim(O, jBot, SD / 2, 0)); cf.add(jf);
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
      part(cf, new RoundedBoxGeometry(0.2, 0.014, 0.12, 2, 0.006), mat.pcb, 'L.bms', ct + ' brd small cam', m => m.position.set(0.05, 0.35, 0.06));
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
    padIn: -0.78, pad: -0.62, padBase: -0.42, grille: -0.3, screw0: -0.22, screw1: -0.26, screw2: -0.18, screw3: -0.2, gasket: -0.12,
    cap: 0.0, cone: 0.1, basket: 0.22, coil: 0.32, plate: 0.42, magnet: 0.52, pcb: 0.66, battery: 0.66, bms: 0.76, chip0: 0.8, chip1: 0.84, chip2: 0.78,
    shell: 0.95, ring: 1.1, mic0: 0.95, mic1: 0.98, mic2: 0.92, crown: 1.0, button: 0.98, usb: 0.92, usbTongue: 0.98, led: 0.95,
    pivot: 0.4, knuckle: 0.5, arm: 0.25, stem: 0.12, anchor: 0.05,
  };
  // штанги/гильзы поднимаются умеренно — выше не залезают на слово «ВНУТРИ» над объектом (гл. 8)
  const UP = { pivot: 0.2, knuckle: 0.25, arm: 0.3, stem: 0.38, anchor: 0.42, crown: 0.25, button: 0.3, mic0: 0.25, mic1: -0.1, mic2: -0.3, usb: -0.3, usbTongue: -0.36, led: -0.3 };
  // [доля пути к камере, доп. сдвиг по y, доп. сдвиг по x]
  // левая чашка — выше и левее центра низа, мимо пилюли счётчика глав
  const FLY_BIG = { 'R.pad': [0.36, -0.55, 0.1], 'L.pad': [0.26, -0.3, 0.25], 'L.shell': [0.24, -0.12, -0.05] };
  parts.forEach((pt, i) => {
    pt.sw = has(pt, 'sw'); pt.cable = has(pt, 'cable'); pt.keep = has(pt, 'keep');
    pt.inner = has(pt, 'drv') || has(pt, 'brd') || /screw|grille|gasket/.test(pt.name);
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
      // потолок разлёта: детали не поднимаются выше верха дуги в сборе
      ex.y = Math.min(ex.y, 0.95 - pt.rp.y);
    } else if (pt.cable) {
      ex.set(1.2, -0.55, 0.35).addScaledVector(rnd, 0.25);
    } else {
      // оголовье: рама уходит назад и чуть вниз, гамак — вперёд и вниз; вверх не летят —
      // над объектом крупное слово «ВНУТРИ» (гл. 8), разлёт не должен его перекрывать
      if (pt.name === 'band') ex.set(0, -0.28, -0.7); else ex.set(0, -0.14, 0.25);
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
  const FOLLOW = { 'R.ring': 'R.shell' };
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
  // e — разлёт, aw — «уход за кадр», h1/h2 — герои, sw — поворот правой чашки (0..1 = 0..90°), cb — кабель, tc — пульс Digital Crown, iso — финал
  // px — дополнительный наклон вокруг мировой оси X (взгляд сверху/снизу), fs — фокус вращается вместе с правой чашкой
  const KEYS = [
    { f: 'center', sx: 1.45, sy: -0.25, z: -1, s: 0.0001, rx: 20, ry: -80, rz: -25 },
    // ls/lsy — масштаб и высота для низкого альбомного экрана (телефон боком): пин «Flow · наушники» под объектом
    { f: 'center', sx: 0.37, sy: -0.08, z: 0, s: 1.0, rx: 8, ry: 38, rz: -3, msy: 0.24, ms: 0.56, ls: 0.88, lsy: -0.04 },
    // низ чашки выше счётчика глав (~820 px из 900)
    { f: 'cupL', sx: -0.05, sy: -0.13, z: 6.3, s: 1, rx: 6, ry: 68, rz: -6, msx: 0, msy: 0.4, ms: 0.8 },
    // левее рейки точек справа
    { f: 'padR', sx: 0.15, sy: -0.4, z: 5.85, s: 1, rx: 0, ry: -148, rz: -10, px: 8, sw: -1, msx: 0.05, msy: 0.38, ms: 0.75 },
    // вид сверху-сбоку на Digital Crown: внешняя грань правой чашки к камере, Crown — справа сверху на кромке,
    // дальняя чашка и дуга уходят влево-вверх — справа над Crown пусто, пин «Колёсико и кнопка» не ложится на объект
    { f: 'touch', sx: 0.36, sy: -0.25, z: 2.6, s: 1, rx: 0, ry: -62, rz: 4, px: 38, tc: 1, msx: 0, msy: 0.2, ms: 0.64 },
    // меньше — между плашкой кода комнаты и чашкой остаётся воздух
    { f: 'center', sx: 0.36, sy: -0.14, z: 0.4, s: 0.8, rx: 12, ry: -112, rz: 6, sw: 0.55, msy: 0.26, ms: 0.75 },
    // орбита источников: объект целиком внутри кольца чипов (чипы — по диагоналям вокруг центра модели),
    // поэтому на десктопе он меньше и по центру орбиты; на мобилке — прежний кадр (mf/mz)
    { f: 'center', sx: 0.29, sy: 0, z: 0, s: 0.76, rx: 0, ry: -30, rz: 0, px: 4, sw: 1.33, gr: 1, msx: 0, msy: 0.4, ms: 0.8 / 0.76, mf: 'padR', mz: 1.15 },
    { f: 'jack', sx: 0.3, sy: -0.02, z: 2.4, s: 1, rx: -6, ry: -140, rz: 4, px: -30, cb: 1, msx: 0, msy: 0.5, ms: 0.8 },
    { f: 'center', sx: 0.31, sy: -0.04, z: 0, s: 0.92, rx: 14, ry: 22, rz: -6, e: 1, msx: 0.08, msy: 0.24, ms: 0.4 },
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
  const NUMS = ['sx', 'sy', 'z', 's', 'rx', 'ry', 'rz', 'px', 'fs', 'e', 'aw', 'h1', 'h2', 'sw', 'cb', 'tc', 'gr', 'iso'];

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
    // чашка-стадион вписывается в «o» по высоте
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
  let lastPointerAt = -10, frameNo = 0, prCap = 1.5;
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
    const mobNow = isMob(), exK = mobNow ? 0.62 : 1, flyK = mobNow ? 0.5 : 1;

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
    mat.padInR.emissiveIntensity = P.gr * 0.06;
    const tc = P.tc;
    // контур на правой чашке: тихий в главах, ярче в финале и на касании
    mat.glow.emissiveIntensity = 0.55 + 0.6 * P.iso + tc * (0.6 + 0.5 * Math.sin(time * 5));
    // волна-касание расходится от Digital Crown; ребром к камере волну гасим — иначе висит дугой
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
        else if (now - fastSince > 8000) { prRaises++; prCap = 1.5; resize(); }
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
    parts.forEach(p => { const g = p.mesh.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; });
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
      [plateTex, coneTex, grilleTex, pcbTex, logoTex, knitPad, knitIn, meshN, meshA, sideTex.R, sideTex.L].forEach(t => t.dispose());
      room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      envRT.dispose();
      renderer.dispose();
    },
  };
}
