// Flow — процедурные 3D-наушники и хореография по главам (Three.js r160)
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

// базис «на ободе чашки»: X — касательная, Y — радиально наружу, Z — вдоль оси чашки
function hpRimMatrix(a, y, r) {
  const R = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const A = new THREE.Vector3(0, 1, 0);
  const Tg = new THREE.Vector3().crossVectors(R, A);
  const m = new THREE.Matrix4().makeBasis(Tg, R, A);
  m.setPosition(R.x * r, y, R.z * r);
  return m;
}

function hpCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function hpRingsTexture(base, amp) {
  base = base || 46; amp = amp || 26;
  const c = hpCanvas(4, 512), g = c.getContext('2d');
  for (let y = 0; y < 512; y++) {
    const v = base + Math.floor(hpRand(y, 3) * amp) + (y % 9 === 0 ? 18 : 0);
    g.fillStyle = `rgb(${v},${v + 2},${v + 6})`; g.fillRect(0, y, 4, 1);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function hpFabricTexture() {
  // перфорированная металлическая сетка: дырки прозрачные (alphaTest), сквозь них виден драйвер
  const c = hpCanvas(128, 128), g = c.getContext('2d');
  g.fillStyle = '#9aa3ad'; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) {
    g.beginPath(); g.arc(x * 16 + (y % 2) * 8, y * 16 + 8, 5.2, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7); return t;
}

function hpPcbTexture() {
  const c = hpCanvas(512, 512), g = c.getContext('2d');
  g.fillStyle = '#0d3a31'; g.fillRect(0, 0, 512, 512);
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
  g.fillStyle = '#e8d9b0'; g.font = 'bold 22px monospace'; g.fillText('FLOW-HP1 REV.B', 24, 490);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// мелкое «зерно» кожи для bumpMap
function hpGrainTexture() {
  const c = hpCanvas(128, 128), g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 110 + Math.floor((hpRand(i, 21) * 0.6 + hpRand(i >> 1, 22) * 0.4) * 120);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 2); return t;
}

function hpDrawLogo(canvas) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const k = canvas.width / 1024;
  g.font = `400 ${300 * k}px "Bagel Fat One", "Arial Black", sans-serif`;
  g.fillText('flow', canvas.width / 2, canvas.height / 2 + 14 * k);
}

function hpAddEnvPanels(env) {
  const add = (color, k, w, h, x, y, z) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  add(0x43e0ee, 4.5, 2.2, 7, -6, 2, -4);
  add(0x43e0ee, 3.5, 2.2, 7, 6, 1, -4.5);
  add(0x43e0ee, 2.5, 8, 1.2, 0, 6.5, -2);
  add(0xff8a2a, 3.2, 12, 5, 0, -2, 8);
  add(0xffb060, 1.8, 8, 3, 0, 5, 7);
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
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const FOV = 30, CAM_D = 10, TAN = Math.tan(FOV / 2 * DEG);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_D);

  // окружение: RoomEnvironment + бирюзовые и тёплые панели для отражений
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

  // свет: мягкий key сверху, тёплый фронт от оранжевого фона, сильные циановые римы сзади-сбоку
  scene.add(new THREE.HemisphereLight(0xffc89a, 0x1a0b05, 0.55));
  const key = new THREE.DirectionalLight(0xfff0e0, 1.5); key.position.set(1.5, 6, 4); scene.add(key);
  const warm = new THREE.DirectionalLight(0xff7a2e, 1.6); warm.position.set(-2, -1.5, 6); scene.add(warm);
  // два рима вместо трёх: левый поднят выше и забирает на себя верхний контур
  const rimA = new THREE.DirectionalLight(0x5ae6f2, 8.2); rimA.position.set(-5, 5, -4.6); scene.add(rimA);
  const rimB = new THREE.DirectionalLight(0x43e0ee, 6.4); rimB.position.set(6, 2.4, -3.8); scene.add(rimB);

  // ---------- материалы (один раз) ----------
  const DS = THREE.DoubleSide;
  const plateTex = hpRingsTexture(150, 60), coneTex = hpRingsTexture(80, 70);
  const ringsTex = hpRingsTexture(), fabricTex = hpFabricTexture(), pcbTex = hpPcbTexture(), grainTex = hpGrainTexture();
  const logoCanvas = hpCanvas(2048, 1024); hpDrawLogo(logoCanvas);
  const logoTex = new THREE.CanvasTexture(logoCanvas); logoTex.colorSpace = THREE.SRGBColorSpace; logoTex.anisotropy = 4;
  const mat = {
    band: new THREE.MeshPhysicalMaterial({ color: 0x2a2d33, metalness: 0.9, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2, side: DS }),
    shell: new THREE.MeshPhysicalMaterial({ color: 0x1d1f23, metalness: 0.72, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.28, side: DS }),
    panel: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: ringsTex, metalness: 0.95, roughness: 0.34, clearcoat: 0.35, clearcoatRoughness: 0.22, envMapIntensity: 0.38, side: DS }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc6ced6, metalness: 1, roughness: 0.16, side: DS }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.2, roughness: 0.5, side: DS }),
    leather: new THREE.MeshPhysicalMaterial({ color: 0x141417, metalness: 0, roughness: 0.62, sheen: 0.35, sheenColor: new THREE.Color(0x0f3036), sheenRoughness: 0.5, envMapIntensity: 0.5, bumpMap: grainTex, bumpScale: 0.004, side: DS }),
    stitch: new THREE.MeshStandardMaterial({ color: 0x6f7a84, roughness: 0.7, side: DS }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x8a939c, map: fabricTex, alphaTest: 0.5, metalness: 0.7, roughness: 0.32, emissive: 0x1fb8c9, emissiveIntensity: 0, side: DS }),
    gun: new THREE.MeshStandardMaterial({ color: 0x7d868f, metalness: 1, roughness: 0.3, side: DS }),
    // диффузор: светлее и с заметными концентрическими рёбрами — читается как мембрана, а не плоский диск
    cone: new THREE.MeshPhysicalMaterial({ color: 0x66707a, map: coneTex, metalness: 0.8, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, side: DS }),
    cap: new THREE.MeshPhysicalMaterial({ color: 0x1e2328, metalness: 0.8, roughness: 0.18, clearcoat: 1, emissive: 0x1fb8c9, emissiveIntensity: 0, side: DS }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc8804a, metalness: 1, roughness: 0.28, side: DS }),
    magnet: new THREE.MeshStandardMaterial({ color: 0x2b3036, metalness: 1, roughness: 0.25, side: DS }),
    // точёный металл: концентрические риски вместо ровной серой заливки
    plate: new THREE.MeshStandardMaterial({ color: 0xc8d0d8, map: plateTex, metalness: 0.9, roughness: 0.3, side: DS }),
    basket: new THREE.MeshStandardMaterial({ color: 0x2a3036, metalness: 0.9, roughness: 0.4, emissive: 0x43e0ee, emissiveIntensity: 0, side: DS }),
    rimGlow: new THREE.MeshStandardMaterial({ color: 0x0a1416, emissive: 0x43e0ee, emissiveIntensity: 0, toneMapped: false, side: DS }),
    pcb: new THREE.MeshStandardMaterial({ color: 0xffffff, map: pcbTex, metalness: 0.25, roughness: 0.45, side: DS }),
    chip: new THREE.MeshStandardMaterial({ color: 0x0d0d10, metalness: 0.4, roughness: 0.3, side: DS }),
    battery: new THREE.MeshPhysicalMaterial({ color: 0x33424e, metalness: 0.5, roughness: 0.35, clearcoat: 0.7, side: DS }),
    // светящиеся акценты мимо тонмаппинга: ACES обесцвечивает яркий циан в мятно-белый, а нужен точный #43e0ee
    glow: new THREE.MeshStandardMaterial({ color: 0x0a1416, emissive: 0x43e0ee, emissiveIntensity: 1.0, toneMapped: false, side: DS }),
    cable: new THREE.MeshStandardMaterial({ color: 0x1a1b1f, metalness: 0.2, roughness: 0.55, side: DS }),
    // логотип — прозрачная плоскость с мягкой альфой из canvas: ровный край без MSAA и alphaTest
    logo: new THREE.MeshStandardMaterial({ color: 0x0f5c66, map: logoTex, emissive: 0x43e0ee, emissiveMap: logoTex, emissiveIntensity: 0.82, metalness: 0.3, roughness: 0.35, toneMapped: false, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    pulse: new THREE.MeshBasicMaterial({ color: 0x43e0ee, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: DS }),
  };
  mat.pulse2 = mat.pulse.clone();
  const redrawLogo = () => { hpDrawLogo(logoCanvas); logoTex.needsUpdate = true; };
  if (document.fonts) {
    document.fonts.load('400 300px "Bagel Fat One"').then(redrawLogo, () => {});
    document.fonts.ready.then(redrawLogo);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', redrawLogo);
  }

  // ---------- геометрия ----------
  // Размеры (у.е.): высота ~2.75, чашка Ø1.12
  const XF = 1.16;            // плоскость вилки/слайдера
  const CY = -0.85;           // центр чашки по высоте
  const CUP_IN = 0.98;        // внутренняя плоскость чашки (от неё вглубь — амбушюр)
  const RF = 0.64;            // радиус вилки
  const YC = 0.28;            // концы оголовья
  const BAND_B = 1.06;
  const SHELL_R = 0.559;
  const root = new THREE.Group();
  const parts = [];
  const part = (parent, geo, material, name, tags, place) => {
    const m = new THREE.Mesh(geo, material); m.name = name;
    if (place) { if (place.isMatrix4) m.applyMatrix4(place); else place(m); }
    parent.add(m);
    parts.push({ mesh: m, name, tags: ' ' + (tags || '') + ' ' });
    return m;
  };

  // --- оголовье ---
  const bandPath = (a, b, f0, f1, n) => (t, out) => {
    const f = hpLerp(f0, f1, t), s = Math.sin(f), c = Math.cos(f);
    return out.set(a * Math.sign(s) * Math.pow(Math.abs(s), 2 / n), YC + b * Math.pow(Math.abs(c), 2 / n), 0);
  };
  const Bz = new V3(0, 0, 1);
  part(root, hpSweep(bandPath(XF, BAND_B, -Math.PI / 2, Math.PI / 2, 2.6), Bz, hpSuperProfile(0.032, 0.135, 5, 32), 160, true), mat.band, 'band', 'big');
  const cushPath = bandPath(XF - 0.095, BAND_B - 0.092, -1.18, 1.18, 2.6);
  part(root, hpSweep(cushPath, Bz, hpSuperProfile(0.058, 0.152, 3.2, 36), 120, true), mat.leather, 'cushion', 'big');
  {
    // прошивка — пунктир по нижней стороне подушки у краёв
    const dashes = [];
    const P = new V3(), Pa = new V3(), Pb = new V3();
    for (let i = 0; i < 64; i++) {
      const t = 0.03 + (i / 63) * 0.94;
      cushPath(t, P); cushPath(t - 0.002, Pa); cushPath(t + 0.002, Pb);
      const T = Pb.clone().sub(Pa).normalize(), N = new V3().crossVectors(Bz, T).normalize();
      for (const v of [-0.118, 0.118]) {
        const g = new THREE.BoxGeometry(0.026, 0.008, 0.008);
        const m = new THREE.Matrix4().makeBasis(T, N, Bz);
        m.setPosition(P.clone().addScaledVector(N, -0.05).addScaledVector(Bz, v));
        g.applyMatrix4(m); dashes.push(g);
      }
    }
    part(root, mergeGeometries(dashes), mat.stitch, 'stitch', 'big');
  }

  const pivots = {};
  const buildSide = (side) => {
    const S = side > 0 ? 'R' : 'L';
    const sg = new THREE.Group(); if (side < 0) sg.rotation.y = Math.PI; root.add(sg);
    // в финале в «o» остаётся только сама чашка: вилка, оси и ступица улетают вместе с остальным
    const sw = side > 0 ? 'sw' : '';
    // торцевая заглушка оголовья, слайдер с рисками
    part(sg, new RoundedBoxGeometry(0.115, 0.27, 0.285, 4, 0.052), mat.band, S + '.endcap', S, m => m.position.set(XF, YC + 0.0, 0));
    const sTop = YC - 0.06, sBot = CY + RF + 0.08;
    part(sg, new RoundedBoxGeometry(0.036, sTop - sBot, 0.115, 2, 0.014), mat.steel, S + '.slider', S, m => m.position.set(XF, (sTop + sBot) / 2, 0));
    {
      const ticks = [];
      for (let i = 0; i < 7; i++) {
        const g = new THREE.BoxGeometry(0.006, 0.006, i % 3 === 0 ? 0.08 : 0.05);
        g.translate(XF + 0.019, sBot + 0.07 + i * 0.03, 0); ticks.push(g);
      }
      part(sg, mergeGeometries(ticks), mat.plastic, S + '.ticks', S);
    }
    // ярмо: ступица + U-вилка + оси-шарниры
    part(sg, new RoundedBoxGeometry(0.11, 0.12, 0.15, 3, 0.04), mat.band, S + '.hub', S + (side > 0 ? ' sw' : ''), m => m.position.set(XF, CY + RF + 0.06, 0));
    const forkPath = (t, out) => { const th = -0.1 + t * (Math.PI + 0.2); return out.set(XF, CY + RF * Math.sin(th), RF * Math.cos(th)); };
    part(sg, hpSweep(forkPath, new V3(1, 0, 0), hpSuperProfile(0.033, 0.056, 4, 28), 96, true), mat.band, S + '.fork', S + ' ' + sw);
    for (const zs of [1, -1]) {
      const g = mergeGeometries([new THREE.CylinderGeometry(0.026, 0.026, 0.15, 20), new THREE.CylinderGeometry(0.036, 0.04, 0.018, 28).translate(0, 0.08, 0)]);
      g.rotateX(zs * Math.PI / 2);
      part(sg, g, mat.gun, S + '.pin' + (zs > 0 ? 'F' : 'B'), S + ' small cam ' + sw, m => m.position.set(XF, CY, zs * 0.605));
    }
    // чашка: локальная ось Y — наружу; X — вниз; Z — вперёд (для правой)
    const cf = new THREE.Group(); cf.position.set(CUP_IN, CY, 0); cf.rotation.z = -Math.PI / 2; sg.add(cf);
    const ct = S + ' cup' + S + ' ' + sw + (side > 0 ? ' keep' : '');
    // мелочь на ободе (кнопки, порт, микрофон) в финале улетает — в «o» остаётся ровный круг
    const ctr = S + ' cup' + S + ' ' + sw;
    part(cf, hpLathe([[0.46, 0], [0.535, 0], [0.548, 0.012], [0.556, 0.04], [SHELL_R, 0.1], [0.558, 0.18], [0.553, 0.25], [0.54, 0.3], [0.518, 0.334], [0.492, 0.351], [0.476, 0.356]], 96), mat.shell, S + '.shell', ct + ' big');
    part(cf, new THREE.TorusGeometry(0.477, 0.014, 12, 120).rotateX(Math.PI / 2), mat.steel, S + '.trim', ct, m => m.position.set(0, 0.356, 0));
    const domePts = []; for (let i = 0; i <= 12; i++) { const r = (i / 12) * 0.472; domePts.push([r, 0.372 - 0.024 * Math.pow(r / 0.472, 2.2)]); }
    const panel = part(cf, hpLathe(domePts, 96), mat.panel, S + '.panel', ct);
    if (side < 0) {
      const dg = new THREE.PlaneGeometry(0.66, 0.33);
      dg.applyMatrix4(new THREE.Matrix4().makeBasis(new V3(0, 0, -1), new V3(-1, 0, 0), new V3(0, 1, 0)));
      const d = new THREE.Mesh(dg, mat.logo); d.position.set(0, 0.376, 0); d.renderOrder = 2; panel.add(d);
    } else {
      part(cf, new THREE.TorusGeometry(0.4, 0.0075, 10, 120).rotateX(Math.PI / 2), mat.glow, 'R.ring', ct, m => m.position.set(0, 0.362, 0));
      // две волны со сдвигом фазы — в любом кадре видно расходящийся пульс
      const pg = new THREE.RingGeometry(0.384, 0.416, 96).rotateX(-Math.PI / 2);
      for (let k = 0; k < 2; k++) {
        const pulse = new THREE.Mesh(pg, k ? mat.pulse2 : mat.pulse); pulse.position.set(0, 0.378, 0); pulse.renderOrder = 3; pulse.name = 'pulse' + k; panel.add(pulse);
      }
    }
    // амбушюр, ткань, перегородка
    const padProf = hpSuperProfile(0.128, 0.122, 3, 32).map(([u, v]) => [0.412 + u, -0.122 + v]); padProf.push(padProf[0]);
    part(cf, hpLathe(padProf, 96), mat.leather, S + '.pad', ct + ' big');
    part(cf, new THREE.CircleGeometry(0.292, 72).rotateX(Math.PI / 2), mat.fabric, S + '.fabric', ct, m => m.position.set(0, -0.035, 0));
    part(cf, new THREE.CylinderGeometry(0.455, 0.455, 0.016, 72), mat.plastic, S + '.baffle', ct, m => m.position.set(0, -0.006, 0));
    // драйвер
    // корзина: внешнее кольцо + кольцо вокруг магнитной системы + 6 спиц
    const ribs = [hpLathe([[0.24, 0.032], [0.276, 0.032], [0.276, 0.046], [0.24, 0.046], [0.24, 0.032]], 72), hpLathe([[0.126, 0.168], [0.126, 0.196], [0.134, 0.196], [0.134, 0.168], [0.126, 0.168]], 48)];
    for (let k = 0; k < 6; k++) ribs.push(hpLathe([[0.255, 0.046], [0.13, 0.172]], 4, k * Math.PI / 3, 0.2));
    const frameM = part(cf, mergeGeometries(ribs), mat.basket, S + '.frame', ct + ' drv');
    if (side > 0) {
      // светящаяся кромка по ободу корзины — только для «героя» гл. 9
      const rg = new THREE.Mesh(new THREE.TorusGeometry(0.279, 0.0055, 10, 120).rotateX(Math.PI / 2), mat.rimGlow);
      rg.position.set(0, 0.039, 0); rg.name = 'rimGlow'; rg.visible = false; frameM.add(rg);
    }
    // диффузор: валик подвеса + глубокий конус (вогнут к уху, вершина назад)
    part(cf, hpLathe([[0.262, 0.032], [0.258, 0.016], [0.246, 0.007], [0.232, 0.01], [0.223, 0.026], [0.2, 0.04], [0.15, 0.064], [0.1, 0.09], [0.066, 0.108]], 72), mat.cone, S + '.cone', ct + ' drv');
    part(cf, hpLathe([[0, 0.072], [0.028, 0.075], [0.05, 0.086], [0.066, 0.108]], 48), mat.cap, S + '.cap', ct + ' drv small');
    part(cf, new THREE.CylinderGeometry(0.062, 0.062, 0.07, 32, 1, true), mat.copper, S + '.coil', ct + ' drv small cam', m => m.position.set(0, 0.14, 0));
    // верхняя пластина магнитопровода с фасками — читается как металл, а не плоская крышка
    part(cf, hpLathe([[0, 0.173], [0.108, 0.173], [0.117, 0.177], [0.12, 0.184], [0.117, 0.191], [0.108, 0.195], [0.06, 0.195], [0.056, 0.2], [0, 0.2]], 64), mat.plate, S + '.plate', ct + ' drv');
    part(cf, new THREE.CylinderGeometry(0.106, 0.106, 0.054, 48), mat.magnet, S + '.magnet', ct + ' drv', m => m.position.set(0, 0.22, 0));
    // винты под амбушюром
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3 + 0.5;
      const g = mergeGeometries([new THREE.CylinderGeometry(0.014, 0.014, 0.05, 12).translate(0, 0.025, 0), new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16)]);
      part(cf, g, mat.steel, S + '.screw' + k, ct + ' small cam', m => m.position.set(Math.cos(a) * 0.4, -0.02, Math.sin(a) * 0.4));
    }
    // микрофон на ободе
    {
      const g = mergeGeometries([new THREE.CylinderGeometry(0.03, 0.03, 0.014, 24), new THREE.TorusGeometry(0.031, 0.005, 8, 32).rotateX(Math.PI / 2).translate(0, 0.007, 0)]);
      part(cf, g, mat.steel, S + '.mic', ctr + ' small cam', hpRimMatrix(2.45, 0.22, 0.552));
    }
    if (side > 0) {
      // плата с чипами, кнопки, USB-C
      part(cf, new RoundedBoxGeometry(0.46, 0.018, 0.3, 2, 0.008), mat.pcb, 'R.pcb', ct + ' brd', m => m.position.set(0, 0.268, 0));
      const chips = [[0.1, 0.085, 0.07, 0.03], [0.065, 0.065, -0.1, -0.05], [0.09, 0.05, -0.04, 0.09]];
      chips.forEach(([w, d, x, z], k) => part(cf, new RoundedBoxGeometry(w, 0.022, d, 2, 0.005), mat.chip, 'R.chip' + k, ct + ' brd small cam', m => m.position.set(x, 0.287, z)));
      part(cf, new RoundedBoxGeometry(0.1, 0.034, 0.055, 2, 0.013), mat.plastic, 'R.btn0', ctr + ' small cam', hpRimMatrix(-0.55, 0.2, 0.562));
      part(cf, new RoundedBoxGeometry(0.065, 0.034, 0.055, 2, 0.013), mat.plastic, 'R.btn1', ctr + ' small cam', hpRimMatrix(-0.82, 0.2, 0.562));
      part(cf, new RoundedBoxGeometry(0.11, 0.02, 0.045, 2, 0.008), mat.chip, 'R.usb', ctr + ' small', hpRimMatrix(0.02, 0.18, 0.556));
      part(cf, new THREE.BoxGeometry(0.07, 0.012, 0.012), mat.steel, 'R.usbTongue', ctr + ' small cam', hpRimMatrix(0.02, 0.18, 0.565));
    } else {
      part(cf, new RoundedBoxGeometry(0.4, 0.06, 0.26, 3, 0.022), mat.battery, 'L.battery', ct + ' brd');
      parts[parts.length - 1].mesh.position.set(0, 0.268, 0);
      part(cf, new THREE.TorusGeometry(0.03, 0.008, 10, 28).rotateX(Math.PI / 2), mat.steel, 'L.jackRing', ct + ' small', hpRimMatrix(0.35, 0.17, 0.556));
      part(cf, new THREE.SphereGeometry(0.012, 12, 8), mat.glow, 'L.led', ct + ' small cam', hpRimMatrix(-0.32, 0.24, 0.556));
      // съёмный кабель с джеком 3.5 (в собранном виде спрятан)
      const jf = new THREE.Group(); jf.applyMatrix4(hpRimMatrix(0.35, 0.17, 0.556)); cf.add(jf);
      const tipPts = (y0, dir) => [[0.0001, -0.15], [0.012, -0.148], [0.017, -0.14], [0.017, -0.11], [0.0135, -0.104], [0.017, -0.098], [0.017, -0.07], [0.0135, -0.064], [0.017, -0.058], [0.019, 0]].map(([r, y]) => [r, y0 + y * dir]);
      part(jf, hpLathe(tipPts(0, 1), 32), mat.steel, 'C.tip', 'cable small');
      part(jf, hpLathe([[0.019, 0], [0.034, 0.004], [0.038, 0.02], [0.038, 0.11], [0.034, 0.13], [0.02, 0.14]], 40), mat.band, 'C.body', 'cable');
      part(jf, hpLathe([[0.02, 0.14], [0.016, 0.19], [0.012, 0.23]], 24), mat.cable, 'C.relief', 'cable small');
      const tail = new THREE.CatmullRomCurve3([[0, 0.22, 0], [0, 0.4, 0.02], [0.08, 0.62, 0.12], [0.24, 0.78, 0.3], [0.42, 0.8, 0.52], [0.5, 0.7, 0.74]].map(p => new V3(...p)));
      part(jf, new THREE.TubeGeometry(tail, 140, 0.015, 12, false), mat.cable, 'C.tail', 'cable');
      const end = tail.getPoint(1), tan = tail.getTangent(1);
      const plugM = new THREE.Matrix4().compose(end, new Q().setFromUnitVectors(new V3(0, 1, 0), tan), new V3(1, 1, 1));
      part(jf, hpLathe([[0.012, 0], [0.016, 0.03], [0.02, 0.07], [0.034, 0.08], [0.038, 0.1], [0.038, 0.19], [0.034, 0.205], [0.019, 0.21]], 40), mat.band, 'C.plug2', 'cable', plugM);
      part(jf, hpLathe(tipPts(0.21, -1), 32), mat.steel, 'C.tip2', 'cable small', plugM);
    }
    pivots[S] = new V3(XF, 0, 0);
  };
  buildSide(1);
  buildSide(-1);

  // ---------- «расплющить»: все детали — прямые потомки model, геометрия центрирована ----------
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  for (const pt of parts) {
    const m = pt.mesh;
    const g = m.geometry; g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new V3());
    g.translate(-c.x, -c.y, -c.z);
    for (const ch of m.children) ch.position.sub(c);
    const wm = m.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
    pt.rp = new V3(); pt.rq = new Q(); const sc = new V3();
    wm.decompose(pt.rp, pt.rq, sc);
    pt.rs = sc.x;
    g.computeBoundingSphere();
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
  // ось кабеля (наружу из гнезда) в координатах модели
  const jackAxis = new V3(0, 1, 0).applyQuaternion(byName['C.body'].rq).normalize();
  const jackP = byName['L.jackRing'].rp.clone();

  // параметры разлёта: «инженерный» разнос слоёв чашки вдоль её оси + псевдослучайный разброс
  const AXIAL = {
    pad: -0.62, fabric: -0.4, screw0: -0.22, screw1: -0.26, screw2: -0.18, baffle: -0.12, cap: 0.0, cone: 0.1, frame: 0.22,
    coil: 0.32, plate: 0.42, magnet: 0.52, pcb: 0.66, battery: 0.66, chip0: 0.8, chip1: 0.84, chip2: 0.78,
    shell: 0.9, trim: 1.08, panel: 1.18, ring: 1.3, mic: 0.95, btn0: 0.95, btn1: 1.0, usb: 0.9, usbTongue: 0.98, led: 0.95, jackRing: 0.92,
    fork: 0.3, pinF: 0.45, pinB: 0.45, hub: 0.25, slider: 0.15, ticks: 0.3, endcap: 0.2,
  };
  const UP = { hub: 0.32, slider: 0.55, ticks: 0.7, endcap: 0.75, fork: 0.12, pinF: 0.0, pinB: 0.0 };
  // [доля пути к камере, доп. сдвиг по y, доп. сдвиг по x]
  const FLY_BIG = { 'R.pad': [0.36, -0.55, 0.1], 'R.panel': [0.3, -0.35, 0.25], 'L.shell': [0.32, -0.6, 0.35] };
  parts.forEach((pt, i) => {
    pt.sw = has(pt, 'sw'); pt.cable = has(pt, 'cable'); pt.keep = has(pt, 'keep');
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
      ex.y = (UP[key] || 0) + (/mic|btn|usb|led|jack/.test(key) ? -0.25 : 0);
      ex.addScaledVector(rnd, big ? 0.12 : 0.34);
      // объём: слои чашки расходятся не в одну «инженерную» линию, а вверх-вниз и по глубине
      ex.y += (hpRand(i, 17) - 0.5) * (big ? 0.9 : 0.6);
      ex.z += (hpRand(i, 18) - 0.5) * (big ? 0.8 : 0.6);
    } else if (pt.cable) {
      ex.set(-1.2, -0.55, 0.35).addScaledVector(rnd, 0.25);
    } else {
      // оголовье: дуга вверх, подушка и прошивка чуть ниже
      ex.set(0, pt.name === 'band' ? 0.62 : pt.name === 'stitch' ? 0.18 : 0.36, pt.name === 'stitch' ? 0.25 : 0).addScaledVector(rnd, 0.06);
    }
    pt.ex = ex;
    pt.dist = big ? 0.35 + 0.35 * hpRand(i, 4) : 0.75 + 1.25 * hpRand(i, 4);
    pt.axis = new V3(hpRand(i, 5) - 0.5, hpRand(i, 6) - 0.5, hpRand(i, 7) - 0.5).normalize();
    pt.rot = (big ? 0.3 : pt.radius < 0.09 ? 0.8 + 2.2 * hpRand(i, 8) : 0.25 + 0.6 * hpRand(i, 8)) * (hpRand(i, 9) > 0.5 ? 1 : -1);
    pt.spin = (0.15 + 0.35 * hpRand(i, 10)) * (big ? 0.3 : 1);
    pt.delay = hpRand(i, 11);
    pt.fly = has(pt, 'cam') && hpRand(i, 12) < 0.75 ? 0.3 + 0.28 * hpRand(i, 13) : 0;
    // несколько крупных деталей подлетают к камере (вниз, мимо карточки) — разлёт ломает кадр, как в референсе
    if (FLY_BIG[pt.name]) { pt.fly = FLY_BIG[pt.name][0]; ex.y += FLY_BIG[pt.name][1]; ex.x += FLY_BIG[pt.name][2]; }
    // «уход за кадр» (гл. 9–10): в мировых координатах — вправо, вверх/вниз и глубоко назад, мимо карточки
    pt.wsc = new V3(0.6 + 2.6 * hpRand(i, 14), (hpRand(i, 15) - 0.5) * 3.6, -(6 + 8 * hpRand(i, 16)));
  });
  // тонкие детали летят приклеенными к своему «носителю», а не отдельными волосками в воздухе
  const FOLLOW = { stitch: 'cushion', 'L.trim': 'L.shell', 'R.trim': 'R.shell', 'R.ring': 'R.panel' };
  for (const n in FOLLOW) {
    const pt = byName[n], ld = byName[FOLLOW[n]];
    if (!pt || !ld) continue;
    const iq = ld.rq.clone().invert();
    pt.lead = ld;
    pt.fo = pt.rp.clone().sub(ld.rp).applyQuaternion(iq).divideScalar(ld.rs); // смещение в системе носителя
    pt.fq = iq.clone().multiply(pt.rq);                                          // поворот относительно носителя
    pt.fk = pt.rs / ld.rs;
  }

  // наборы «героев»: 1 — драйвер (гл. 9), 2 — плата + аккумулятор + амбушюр (гл. 10)
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
  const hero1 = heroSet('R.cone', [['R.cap', 0], ['R.cone', 0], ['R.frame', 0.02], ['R.coil', 0.16], ['R.plate', 0.26], ['R.magnet', 0.36]]);
  const hero2 = heroSet('R.pcb', [['R.pcb', 0], ['R.chip0', 0.07], ['R.chip1', 0.07], ['R.chip2', 0.07], ['L.battery', 0, [0.04, -0.17, 0.03]], ['R.btn0', 0, [0.3, 0.02, -0.22]], ['R.usb', 0, [-0.3, 0.0, -0.2]]]);
  hero1.forEach(h => { h.pt.hero = 1; h.pt.o = h; });
  hero2.forEach(h => { h.pt.hero = 2; h.pt.o = h; });

  // точки фокуса (в координатах модели)
  const FOCI = {
    center: new V3(0, 0, 0),
    cupL: new V3(-(CUP_IN + 0.37), CY, 0).sub(center),
    cupR: new V3(XF, CY, 0).sub(center),
    padR: new V3(CUP_IN - 0.12, CY, 0).sub(center),
    touch: new V3(CUP_IN + 0.37, CY, 0).sub(center),
    jack: jackP.clone(),
  };

  // ---------- ключевые позы глав ----------
  // sx, sy — NDC точки фокуса; z — глубина фокуса; s — масштаб; rx, ry, rz — градусы (YXZ)
  // e — разлёт, aw — «уход за кадр», h1/h2 — герои, sw — поворот правой чашки (0..1 = 0..90°), cb — кабель, tc — пульс сенсора, iso — финал
  // px — дополнительный наклон вокруг мировой оси X (взгляд сверху/снизу), fs — фокус вращается вместе с правой чашкой
  const KEYS = [
    { f: 'center', sx: 1.45, sy: -0.25, z: -1, s: 0.0001, rx: 20, ry: -80, rz: -25 },
    { f: 'center', sx: 0.37, sy: -0.06, z: 0, s: 1.0, rx: 9, ry: 34, rz: -3, msy: 0.24, ms: 0.56 },
    { f: 'cupL', sx: -0.05, sy: -0.22, z: 7.3, s: 1, rx: 6, ry: 70, rz: -6, msx: 0, msy: 0.4, ms: 0.8 },
    { f: 'padR', sx: 0.24, sy: -0.4, z: 6.4, s: 1, rx: 0, ry: -148, rz: -10, px: 8, sw: -1, msx: 0.05, msy: 0.38, ms: 0.75 },
    // вид сверху-сбоку на сенсор, крупный план: панель занимает правую половину, остальное уходит за край
    { f: 'touch', sx: 0.33, sy: -0.18, z: 7.0, s: 1, rx: 0, ry: -122, rz: -4, px: 30, tc: 1, msx: 0, msy: 0.36, ms: 0.85 },
    { f: 'center', sx: 0.36, sy: -0.14, z: 0.4, s: 1, rx: 12, ry: -112, rz: 6, sw: 0.55, msy: 0.26, ms: 0.6 },
    { f: 'padR', sx: 0.52, sy: -0.08, z: 4.4, s: 1, rx: 0, ry: -30, rz: 0, px: 4, sw: 1.33, gr: 1, msx: 0, msy: 0.4, ms: 0.8 },
    { f: 'jack', sx: 0.3, sy: -0.1, z: 1.6, s: 1, rx: -8, ry: 140, rz: 4, px: -8, cb: 1, msx: 0, msy: 0.5, ms: 0.8 },
    { f: 'center', sx: 0.31, sy: -0.04, z: 0, s: 0.95, rx: 14, ry: 22, rz: -6, e: 1, msx: 0.08, msy: 0.24, ms: 0.4 },
    { f: 'center', sx: 0.31, sy: -0.02, z: 0, s: 0.95, rx: 16, ry: 40, rz: -6, e: 1, aw: 1, h1: 1 },
    { f: 'center', sx: 0.31, sy: -0.02, z: 0, s: 0.95, rx: 14, ry: 32, rz: -4, e: 1, aw: 0.55, h2: 1 },
    { f: 'center', sx: 0.34, sy: -0.1, z: 0, s: 0.95, rx: 12, ry: 22, rz: -3, e: 0.45, msy: 0.24, ms: 0.44 },
    { f: 'center', sx: 0.16, sy: -0.04, z: 1.6, s: 1.0, rx: 8, ry: 18, rz: -2 },
    null, // финал — считается из setFinaleTarget
  ];
  const HERO = {
    1: { sx: 0.34, sy: -0.04, z: 1, s: 3.1, msx: 0, msy: 0.42, ms: 1.7 },
    2: { sx: 0.34, sy: -0.02, z: 1, s: 2.7, msx: 0, msy: 0.42, ms: 1.5 },
  };
  const SWF = { padR: 1, touch: 1, cupR: 1 };
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
      out.z = (k.z || 0) * 0.5;
    } else {
      out.s *= Math.min(1.06, Math.max(0.72, aspect / 1.78));
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
    out.s = (r.size / H) * TAN * dist / SHELL_R;
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
  const pulses = [0, 1].map(k => byName['R.panel'].mesh.getObjectByName('pulse' + k));
  const rimGlowM = byName['R.frame'].mesh.getObjectByName('rimGlow');
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
      m.visible = sc > 0.003;
    }

    // акценты материалов
    mat.cap.emissiveIntensity = P.h1 * 0.45;
    mat.basket.emissiveIntensity = P.h1 * 0.14;
    mat.rimGlow.emissiveIntensity = P.h1 * 1.0;
    rimGlowM.visible = P.h1 > 0.02;
    mat.fabric.emissiveIntensity = P.gr * 0.08;
    const tc = P.tc;
    mat.glow.emissiveIntensity = 1.0 + tc * 0.6 * (0.5 + 0.5 * Math.sin(time * 5));
    // волна-касание расходится от центра сенсорной панели к ободу и гаснет до него.
    // Аддитивный циан читается свечением только над тёмной панелью: за ободом, на прозрачном холсте,
    // он смешивается с оранжевым CSS-фоном в бледно-жёлтое кольцо. Ребром к камере волну тоже гасим —
    // иначе она висит над чашкой жёлтой дугой
    let face = 0;
    if (tc > 0.02) {
      const pnl = byName['R.panel'].mesh;
      tmp.v.set(0, 1, 0).applyQuaternion(pnl.quaternion);
      tmp.v2.copy(tmp.camL).sub(pnl.position).normalize();
      face = hpSmooth(0.2, 0.5, tmp.v.dot(tmp.v2));
    }
    for (let k = 0; k < 2; k++) {
      // в застывшем кадре (time 0.6) одна волна у обода, вторая на полпути от центра
      const pm = pulses[k], ph = (time * 0.85 + 0.2 + k * 0.5) % 1;
      pm.visible = tc > 0.02 && face > 0.01;
      // внешний радиус 0.416 * 1.1 = 0.458 < радиуса панели 0.472
      if (pm.visible) { pm.scale.setScalar(0.45 + 0.65 * ph); pm.material.opacity = tc * face * Math.min(1, ph * 5) * Math.min(1, (1 - ph) * 2.5); }
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
  console.info('[flow] headphones: ' + parts.length + ' parts');

  const anchorPart = { cupLeft: 'L.panel', cupRight: 'R.shell', touch: 'R.ring', driver: 'R.cone', cable: 'C.body' };
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
        av.setFromMatrixPosition(m.matrixWorld);
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
      parts.forEach(pt => { pt.mesh.geometry.dispose(); pt.mesh.children.forEach(c => c.geometry && c.geometry.dispose()); });
      Object.values(mat).forEach(m => m.dispose());
      [ringsTex, plateTex, coneTex, fabricTex, pcbTex, logoTex, grainTex].forEach(t => t.dispose());
      room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      envRT.dispose();
      renderer.dispose();
    },
  };
}
