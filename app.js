// Flow — вёрстка, интро, скролл, главы, UI.
// Весь код в IIFE: верхнеуровневых имён нет (склеивается в один module-скрипт с headphones.js).
(() => {
  const N = 14;                       // 0 — интро, 1..12 — главы, 13 — финал
  const INTRO_END = 0.9 / N;          // на этом прогрессе интро полностью отыграно
  const NAMES = ['Интро', 'Звук', 'Подпись', 'Тишина', 'Нажатие','Комната', 'Источники', 'Чат', 'Внутри', 'Драйвер', 'История', 'Вместе', 'Слушайте', 'Финал'];

  const root = document.documentElement;
  // модуль догрузился уже после аварийной статичной раскладки, а человек в ней листает:
  // не перехватываем страницу (иначе его выбросит обратно в интро наверх)
  if (window.__flowFallback && window.scrollY > 0) return;
  const skipIntro = !!window.__flowSkip;
  window.__flowFallback = false;
  // модуль всё-таки загрузился (пусть и поздно) — снимаем аварийную статичную раскладку
  root.classList.remove('no-js-fallback', 'no-3d');
  const qs = new URLSearchParams(location.search);
  // ---------- тестовые параметры ----------
  let testP = null;
  if (qs.has('p')) {
    const v = parseFloat(qs.get('p'));
    if (Number.isFinite(v)) testP = Math.min(1, Math.max(0, v));
  } else if (qs.has('ch')) {
    const c = parseInt(qs.get('ch'), 10);
    if (Number.isFinite(c)) testP = (Math.min(13, Math.max(0, c)) + 0.5) / N;
  }
  const isTest = testP !== null;
  // headless Chrome сообщает prefers-reduced-motion: reduce, поэтому в тестовом режиме
  // показываем полную версию; ?rm=1 включает упрощённую принудительно.
  const reduced = qs.has('rm') || (!isTest && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (isTest) root.classList.add('is-test');
  if (reduced) root.classList.add('is-reduced');
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  // ---------- утилиты ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const sineIO = (t) => (1 - Math.cos(Math.PI * t)) / 2;
  const pad2 = (n) => String(n).padStart(2, '0');
  const rand = (seed) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  let W = innerWidth, H = innerHeight;
  // одна точка переключения для вёрстки и сцены — тот же media query, что в CSS:
  // узкий портрет или портрет уже 4:5. Телефон в альбомной ориентации — компактная «десктопная» раскладка
  const mqMobile = matchMedia('(max-width: 720px) and (orientation: portrait), (max-aspect-ratio: 4/5)');
  const isMobile = () => mqMobile.matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  // ---------- 3D-сцена ----------
  const canvas = $('#scene');
  let scene = null;
  if (typeof createHeadphonesScene === 'function') {
    try { scene = createHeadphonesScene(canvas); } catch (e) { scene = null; console.warn('[flow] 3D недоступно:', e && e.message); }
  }
  if (!scene) root.classList.add('no-3d');
  const syncLayout = () => {
    if (scene && scene.setLayout) { try { scene.setLayout(isMobile() ? 'mobile' : 'desktop'); } catch (e) { /* */ } }
  };
  syncLayout();
  if (scene && scene.setMotion) { try { scene.setMotion(!reduced && !isTest); } catch (e) { /* */ } }
  // число деталей в карточке 8 = реальное число мешей сцены
  if (scene && Number.isFinite(scene.partCount) && scene.partCount > 0) {
    const pc = $('#parts-count');
    if (pc) pc.textContent = String(scene.partCount);
  }
  // холст сцены можно чуть ужать CSS-трансформом (гл. 3 и 8, см. applyStage) — тогда точки якорей
  // из системы холста переводим в экранные тем же масштабом вокруг той же опорной точки
  const stage = { s: 1, ox: 0, oy: 0 };
  const toScreen = (a) => (stage.s === 1 ? a
    : { x: stage.ox + (a.x - stage.ox) * stage.s, y: stage.oy + (a.y - stage.oy) * stage.s, visible: a.visible });
  const anchorOf = (name, fallback) => {
    if (scene && scene.getAnchor) {
      try {
        let a = scene.getAnchor(name);
        if ((!a || !a.visible) && fallback) a = scene.getAnchor(fallback);
        if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) return toScreen(a);
      } catch (e) { /* без якоря */ }
    }
    return { x: W * 0.68, y: H * 0.56, visible: !scene };
  };
  // точка детали без проверки видимости (для раскладки чипов по силуэту)
  const rawAnchor = (name) => {
    if (!scene || !scene.getAnchor) return null;
    try {
      const a = scene.getAnchor(name);
      return a && Number.isFinite(a.x) && Number.isFinite(a.y) ? toScreen(a) : null;
    } catch (e) { return null; }
  };

  // ---------- разбивка слов на буквы ----------
  const splitLetters = (el) => {
    const text = el.textContent;
    el.textContent = '';
    const letters = [];
    for (const ch of text) {
      const s = document.createElement('span');
      s.className = ch === ' ' ? 'gl gl-space' : 'gl';
      s.textContent = ch === ' ' ? ' ' : ch;
      el.appendChild(s);
      letters.push(s);
    }
    return letters;
  };
  const words = $$('.giant-word, .peek-word').map((el, wi) => {
    const letters = splitLetters(el);
    return {
      el, letters, ch: +el.dataset.ch, fx: el.dataset.fx || '',
      vec: letters.map((_, j) => {
        const r1 = rand(wi * 17 + j * 3 + 1), r2 = rand(wi * 17 + j * 3 + 2), r3 = rand(wi * 17 + j * 3 + 3);
        return { x: (r1 - 0.5) * 3.4, y: (r2 - 0.5) * 2.6 - 0.2, r: (r3 - 0.5) * 110, s: (r1 + r2) * 0.45 - 0.35 };
      }),
    };
  });
  // гигантские слова не должны вылезать из правой колонки
  const fitWords = () => {
    for (const w of words) {
      w.el.style.fontSize = '';
      const fs = parseFloat(getComputedStyle(w.el).fontSize);
      // у букв есть поля под градиентный текст, компенсированные отрицательным margin:
      // реальный вклад буквы в строку — ширина бокса плюс (отрицательные) отступы
      const total = w.letters.reduce((s, L) => {
        const cs = getComputedStyle(L);
        return s + L.offsetWidth + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
      }, 0);
      const maxW = w.el.clientWidth * 0.98;
      if (total > maxW && total > 0) w.el.style.fontSize = `${(fs * maxW / total).toFixed(1)}px`;
    }
  };
  const finaleEl = $('#finale');
  const finaleLetters = $$('.fl-part', finaleEl);
  finaleLetters.forEach((s) => s.classList.add('gl'));

  // ---------- карточки, пины, панели ----------
  // прозрачность и блюр пишем не на обёртку, а на сами стеклянные блоки: иначе обёртка становится
  // backdrop root и backdrop-filter карточки перестаёт видеть 3D-сцену под собой
  const cards = $$('.card-wrap').map((el) => {
    const media = $('.media', el);
    const fx = [$('.card', el)].concat(media ? Array.from(media.children) : []).filter(Boolean);
    // неактивная карточка не получает фокус и не находится поиском по странице
    el.inert = true;
    return { el, ch: +el.dataset.ch, state: '', fx, lo: '', lf: '', live: false };
  });
  // правый край колонки карточек (без transform): панели и чипы у объекта не заходят под карточку
  let cardRight = 0;
  // нижний счётчик глав: подпись под объектом его обходит
  const counterEl = $('[data-test="counter"]');
  let counterBox = null;
  const anchorLayer = $('.anchor-layer');
  const pins = $$('.anchor-layer .pin, .anchor-layer .anchored').map((el) => {
    const pn = { el, ch: +el.dataset.ch, anchor: el.dataset.anchor, fallback: el.dataset.fallback || 'center', place: el.dataset.place || '' };
    // подпись сбоку от детали стоит за силуэтом объекта, к самой точке ведёт тонкая линия-выноска
    if (pn.place === 'side') {
      pn.lead = document.createElement('i');
      pn.lead.className = 'pin-lead';
      anchorLayer.insertBefore(pn.lead, anchorLayer.firstChild);
    }
    return pn;
  });
  const orbitEl = $('.orbit');
  const orbit = { el: orbitEl, ch: +orbitEl.dataset.ch, anchor: orbitEl.dataset.anchor, fallback: orbitEl.dataset.fallback, chips: $$('.chip', orbitEl), side: '' };
  // размеры пинов/панелей/чипов меряем при старте и ресайзе, а не в каждом кадре (без форс-лейаута)
  const measureSizes = () => {
    for (const pn of pins) { pn.w = pn.el.offsetWidth; pn.h = pn.el.offsetHeight; }
    for (const c of orbit.chips) { c._w = c.offsetWidth; c._h = c.offsetHeight; }
    cardRight = 0;
    for (const c of cards) cardRight = Math.max(cardRight, c.el.offsetLeft + c.el.offsetWidth);
    const cr = counterEl ? counterEl.getBoundingClientRect() : null;
    counterBox = cr && cr.width ? { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom } : null;
  };
  measureSizes();

  // ---------- рейка ----------
  const railDots = $('#rail-dots');
  const dots = [];
  for (let i = 1; i <= 12; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rail-dot'; b.dataset.goto = String(i);
    b.dataset.test = 'rail-dot'; b.dataset.chapter = String(i);
    b.setAttribute('aria-label', `Глава ${pad2(i)} — ${NAMES[i]}`);
    railDots.appendChild(b); dots.push(b);
  }

  const counterNum = $('#counter-num'), counterName = $('#counter-name');
  const progressFill = $('#progress-fill');
  const chromeEls = $$('.chrome');
  const menu = $('#menu'), menuToggle = $('.menu-toggle', menu), menuLinks = $$('.menu-list a', menu);
  const hint = $('#scroll-hint');

  // ---------- интро ----------
  const intro = $('#intro'), beam = $('#intro-beam'), beamGlow = $('#intro-glow'), wordsBox = $('#intro-words'), rows = $$('.iw-row', intro);
  const cup = $('#intro-cup'), cupBody = $('#cup-body'), cupPad = $('#cup-pad'), cupBand = $('#cup-band'), fill = $('#intro-fill');
  // стартовый кадр: знак ∞ на плитке, ореол и подпись «flow · a study in sound» — гаснут с первым движением
  const cupInf = $('#cup-inf'), introHalo = $('#intro-halo'), introCap = $('#intro-cap');
  const finaleCta = $('#finale-cta');
  let ipAuto = 0;
  // человек уже сам листал/жал клавиши: старт после шрифтов не сбрасывает его наверх
  let userActed = false;

  // ---------- прокрутка: Lenis + ScrollTrigger ----------
  let lenis = null, trigger = null;
  const hasGsap = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';
  if (!isTest && !reduced && typeof window.Lenis === 'function') {
    try { lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true }); } catch (e) { lenis = null; }
  }
  if (hasGsap) {
    gsap.registerPlugin(ScrollTrigger);
    if (lenis) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    }
    trigger = ScrollTrigger.create({ trigger: '#track', start: 'top top', end: 'bottom bottom' });
  } else if (lenis) {
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  // на тач-устройствах innerHeight скачет, когда адресная строка прячется/появляется, — прогресс
  // дёргался бы без действий пользователя. Там знаменатель кэшируем и считаем по «большому» вьюпорту
  // (трек и сцена на 100lvh), пересчёт — только при настоящем ресайзе
  let maxScrollC = 0;
  const calcMaxScroll = () => {
    const vh = coarse ? ($('.track-ch') ? $('.track-ch').offsetHeight : innerHeight) : innerHeight;
    return Math.max(1, document.documentElement.scrollHeight - vh);
  };
  const maxScroll = () => (coarse ? (maxScrollC || (maxScrollC = calcMaxScroll())) : calcMaxScroll());
  // прогресс считаем прямо из позиции прокрутки (а не из trigger.progress — тот отстаёт при ресайзе)
  const readProgress = () => {
    if (testP !== null) return testP;
    // Lenis сам двигает window.scrollY каждый кадр, так что это и есть актуальная позиция
    return clamp(window.scrollY / maxScroll());
  };
  const scrollToP = (p, opts = {}) => {
    const y = clamp(p) * maxScroll();
    const immediate = !!(opts.immediate || opts.instant);
    if (lenis) {
      if (immediate) { window.scrollTo(0, y); lenis.scrollTo(y, { immediate: true, force: true }); }
      else lenis.scrollTo(y, { duration: opts.duration ?? 1.8, easing: (t) => 1 - Math.pow(1 - t, 4), lock: !!opts.lock, force: true });
    } else window.scrollTo({ top: y, behavior: immediate || reduced ? 'auto' : 'smooth' });
  };
  const gotoChapter = (i, opts) => {
    if (testP !== null) testP = null;
    userActed = true;
    stopAuto();
    if (i === 'top') return scrollToP(0, opts);
    scrollToP((clamp(+i, 0, 13) + 0.5) / N, opts);
  };
  const chapterOf = (p) => clamp(Math.floor(p * N), 0, 13);
  window.__flow = {
    state: () => { const p = readProgress(); return { chapter: chapterOf(p), progress: p }; },
    goTo: (n, opts = {}) => gotoChapter(n === 'top' ? 'top' : +n, opts),
  };

  // мобильное меню: закрываем одним способом — класс и aria-expanded всегда вместе
  const closeMenu = (refocus) => {
    if (!menu.classList.contains('is-open')) return;
    menu.classList.remove('is-open'); menuToggle.setAttribute('aria-expanded', 'false');
    if (refocus) { try { menuToggle.focus(); } catch (e) { /* */ } }
  };
  // клики по якорям
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    closeMenu();
    gotoChapter(a.dataset.goto === 'top' ? 'top' : +a.dataset.goto);
  });
  menuToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains('is-open');
    menu.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) closeMenu(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Esc') closeMenu(true); });
  // подстраховка: сцену (overflow: clip) не должен прокручивать ни фокус, ни поиск по странице
  const stageEl = $('#stage');
  if (stageEl) stageEl.addEventListener('scroll', () => { if (stageEl.scrollTop || stageEl.scrollLeft) { stageEl.scrollTop = 0; stageEl.scrollLeft = 0; } });
  hint.addEventListener('click', () => {
    if (activeCh >= 13) gotoChapter('top');
    else gotoChapter(Math.max(1, activeCh + 1));
  });
  $('#intro-skip').addEventListener('click', () => gotoChapter(1, { duration: 1.4 }));

  // параллакс от курсора
  addEventListener('pointermove', (e) => {
    if (!scene || !scene.setPointer || e.pointerType === 'touch') return;
    scene.setPointer((e.clientX / W) * 2 - 1, -((e.clientY / H) * 2 - 1));
  }, { passive: true });

  // ---------- финальная «дырка» буквы o ----------
  const hole = $('#finale-hole'), baseline = $('#finale-baseline');
  let finaleTarget = null;
  const measureFinale = () => {
    const r = hole.getBoundingClientRect();
    if (!r.width) return;
    const cs = getComputedStyle(hole);
    const fs = parseFloat(cs.fontSize);
    let gx = r.left + r.width / 2, gy, size;
    const base = baseline.getBoundingClientRect().bottom;
    try {
      const c = document.createElement('canvas').getContext('2d');
      c.font = `800 ${fs}px "Syne"`;
      const m = c.measureText('o');
      const left = r.left - m.actualBoundingBoxLeft, right = r.left + m.actualBoundingBoxRight;
      gx = (left + right) / 2;
      gy = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      // «o» у Syne 800 — овал почти 2:1, а чашка круглая. Соседние буквы подтянуты к дырке
      // отрицательным margin; диаметр — меньшее из «видимого зазора» и 1.35 высоты буквы
      const ml = Math.max(0, -(parseFloat(cs.marginLeft) || 0)), mr = Math.max(0, -(parseFloat(cs.marginRight) || 0));
      const gap = (right - left) - ml - mr;
      const hgt = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      size = Math.max(hgt, Math.min(gap * 0.92, hgt * 1.32));
    } catch (e) {
      gy = base - fs * 0.3; size = r.width * 0.9;
    }
    // логотип сдвинут transform-ом вверх — rect его уже учитывает.
    // Координаты — в системе холста без CSS-масштаба (холст лежит на всю сцену), поэтому rect сцены
    const cr = (stageEl || canvas).getBoundingClientRect();
    finaleTarget = { x: gx - cr.left, y: gy - cr.top, size };
    if (scene && scene.setFinaleTarget) { try { scene.setFinaleTarget(finaleTarget); } catch (e) { /* */ } }
    // мобильный финал: под словом — призыв и кнопка «Скачать»
    if (finaleCta) finaleCta.style.top = `${(base + fs * 0.26).toFixed(1)}px`;
  };

  // ---------- отрисовка интро ----------
  const renderIntro = (ip) => {
    if (ip >= 1) { if (!intro.classList.contains('is-done')) intro.classList.add('is-done'); return; }
    intro.classList.remove('is-done');
    const m = smooth(0.06, 0.34, ip);                      // прямоугольник -> силуэт чашки
    const base = Math.min(W, H);
    const sc = lerp(1, clamp(base / 900, 0.5, 1.4) * 2.05, easeIO(m));
    const cx = lerp(W / 2, W * (isMobile() ? 0.27 : 0.25), easeIO(m));
    const cy = lerp(H / 2, H * 0.5, m);
    const rot = -22 * Math.sin(Math.PI * m) * (1 - smooth(0.3, 0.42, ip));
    cup.style.transform = `translate(${cx - 80}px, ${cy - 80}px) rotate(${rot}deg) scale(${sc})`;
    cup.style.opacity = String(1 - smooth(0.74, 0.86, ip));
    // морф форм
    cupBody.setAttribute('x', lerp(-32, -22, m).toFixed(2));
    cupBody.setAttribute('y', lerp(-20, -35, m).toFixed(2));
    cupBody.setAttribute('width', lerp(64, 36, m).toFixed(2));
    cupBody.setAttribute('height', lerp(40, 70, m).toFixed(2));
    cupBody.setAttribute('rx', lerp(8, 14, m).toFixed(2));
    const pw = lerp(0, 13, smooth(0.15, 0.32, ip));
    cupPad.setAttribute('x', (14 - 0.5).toFixed(2));
    cupPad.setAttribute('width', Math.max(0.01, pw).toFixed(2));
    cupPad.setAttribute('height', lerp(30, 58, m).toFixed(2));
    cupPad.setAttribute('y', (-lerp(30, 58, m) / 2).toFixed(2));
    cupBand.style.strokeDashoffset = String(100 * (1 - smooth(0.14, 0.36, ip)));
    // стартовая плитка — иконка Flow: ∞ на ней, ореол и подпись под ней уходят, как только плитка начинает морф
    if (cupInf) cupInf.style.opacity = (1 - smooth(0.01, 0.08, ip)).toFixed(3);
    if (introHalo) introHalo.style.opacity = (1 - smooth(0.02, 0.3, ip)).toFixed(3);
    if (introCap) {
      const co = 1 - smooth(0, 0.09, ip);
      introCap.style.opacity = co.toFixed(3);
      introCap.style.transform = `translateY(${((1 - co) * 14).toFixed(1)}px)`;
    }
    // апекс конуса: правый край амбушюра
    const rr = (rot * Math.PI) / 180;
    const lx = 13.5 + pw;
    const ax = cx + Math.cos(rr) * lx * sc, ay = cy + Math.sin(rr) * lx * sc;
    // световой конус
    const b = smooth(0.22, 0.56, ip), spread = smooth(0.26, 0.72, ip);
    const f = smooth(0.58, 0.9, ip);
    const L = (W - ax + W * 0.3) * easeOut(b);
    // в конце луч сам раскрывается почти до 90° и заливает экран светом, как в референсе
    const th = (Math.min(86, lerp(4, 23, spread) + 63 * easeIO(smooth(0.56, 0.8, ip))) * Math.PI) / 180;
    const h0 = 24 * sc, fh = h0 + L * Math.tan(th);
    const beamClip = b > 0
      ? `polygon(${ax}px ${ay - h0}px, ${ax + L}px ${ay - fh}px, ${ax + L}px ${ay + fh}px, ${ax}px ${ay + h0}px)`
      : 'polygon(0 0, 0 0, 0 0)';
    beam.style.clipPath = beamClip;
    // фиолетовый ореол вокруг луча: та же форма, размытая обёрткой
    if (beamGlow) beamGlow.style.clipPath = beamClip;
    wordsBox.style.transform = `translateY(calc(-50% + ${ay - H / 2}px))`;
    rows.forEach((r, k) => {
      const dir = k % 2 ? 1 : -1;
      r.style.transform = `translateX(${(dir * (ip * 26 - 6) + (k - 1) * 9)}vw)`;
    });
    // заливка фоном сайта (тёмный + свечения): мягкое пятно растёт изнутри луча (правее силуэта), силуэт чашки виден до конца
    const fx = ax + W * 0.35, fy = ay;
    const R = Math.hypot(Math.max(fx, W - fx), Math.max(fy, H - fy)) * easeIO(f) * 2.0;
    if (f <= 0) fill.style.opacity = '0';
    else {
      const soft = `radial-gradient(circle at ${fx.toFixed(1)}px ${fy.toFixed(1)}px, #000 ${(R * 0.55).toFixed(1)}px, transparent ${R.toFixed(1)}px)`;
      fill.style.webkitMaskImage = soft; fill.style.maskImage = soft;
      fill.style.opacity = String(smooth(0, 0.35, f));
    }
    intro.style.opacity = String(1 - smooth(0.9, 1, ip));
  };

  // ---------- слова по буквам ----------
  const renderWord = (w, d, noExit) => {
    const vis = d > -1 && d < (noExit ? 9 : 1);
    if (!vis) { if (w.el.style.visibility !== 'hidden') w.el.style.visibility = 'hidden'; return; }
    if (w.el.style.visibility !== 'visible') w.el.style.visibility = 'visible';
    // буквы выезжают из-под маски (clip-path), а не проявляются прозрачностью:
    // полупрозрачный циан на оранжевом даёт грязно-оливковый цвет. Маска нужна, пока буквы
    // движутся строкой; у «рассыпающихся» слов на время разлёта её снимаем.
    // В покое (-0.06..0.14) буквы стоят на месте и маска не нужна — снимаем её, иначе прямой край
    // clip-path обрезал бы фиолетовое свечение слова прямоугольником.
    const clip = (w.fx !== 'scatter-in' && d < -0.06) || (!noExit && w.fx !== 'scatter-out' && d > 0.14);
    if (clip !== w.clip) { w.clip = clip; w.el.classList.toggle('is-masked', clip); }
    // пока буквы выезжают из-под маски, свечение снимаем: прямой край маски резал бы его ступенькой
    const moving = clip;
    if (moving !== w.moving) { w.moving = moving; w.el.classList.toggle('is-moving', moving); }
    const n = w.letters.length, stg = 0.13;
    for (let j = 0; j < n; j++) {
      let x = 0, y = 0, r = 0, s = 1, o = 1;
      if (w.fx !== 'scatter-in') {
        if (d < -0.06) {
          const k = clamp((d + 0.82) / 0.76);
          const e = easeOut(clamp(k * (1 + stg * (n - 1)) - stg * j));
          // буква поднимается из-под нижнего края маски
          y += (1 - e) * 1.15; s *= 0.82 + 0.18 * e; if (e < 0.01) o = 0;
        }
      } else {
        // собирается из рассыпанных: проявление только в самом начале полёта, далеко от центра
        o *= smooth(-0.97, -0.86, d);
      }
      if (!noExit && w.fx !== 'scatter-out' && d > 0.14) {
        const k = clamp((d - 0.14) / 0.6);
        const e = easeIO(clamp(k * (1 + stg * (n - 1)) - stg * j));
        // уходит вверх под верхний край маски
        y -= e * 1.35; s *= 1 - e * 0.15; if (e > 0.99) o = 0;
      }
      let sc = 0;
      if (w.fx === 'scatter-out') { sc = 0.06 * smooth(-0.5, 0, d) + 0.9 * smooth(0.04, 0.85, d); o *= 1 - smooth(0.8, 0.95, d); }
      if (w.fx === 'scatter-in') { sc = 1 - smooth(-0.9, -0.04, d); }
      if (sc > 0) {
        const v = w.vec[j];
        x += v.x * sc; y += v.y * sc; r += v.r * sc; s *= 1 + v.s * sc;
      }
      const L = w.letters[j];
      L.style.transform = `translate3d(${x.toFixed(3)}em, ${y.toFixed(3)}em, 0) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(3)})`;
      L.style.opacity = o.toFixed(3);
    }
  };

  const renderFinale = (d) => {
    if (d < -0.95) { finaleEl.style.visibility = 'hidden'; return; }
    finaleEl.style.visibility = 'visible';
    const n = finaleLetters.length, stg = 0.18;
    const k = clamp((d + 0.9) / 0.78);
    finaleLetters.forEach((L, j) => {
      const e = easeOut(clamp(k * (1 + stg * (n - 1)) - stg * j));
      L.style.transform = `translate3d(0, ${((1 - e) * 0.25).toFixed(3)}em, 0) scale(${(0.7 + 0.3 * e).toFixed(3)})`;
      L.style.opacity = e.toFixed(3);
    });
  };
  let ctaO = '';
  const renderFinaleCta = (d) => {
    if (!finaleCta) return;
    const o = smooth(-0.45, -0.08, d), os = o.toFixed(3);
    if (os === ctaO) return;
    ctaO = os;
    finaleCta.style.opacity = os;
    finaleCta.style.visibility = o > 0.01 ? 'visible' : 'hidden';
    finaleCta.style.transform = `translateY(${((1 - o) * 18).toFixed(1)}px)`;
    finaleCta.classList.toggle('is-live', o > 0.5);
  };

  // ---------- карточки ----------
  const renderCard = (c, d) => {
    const a = Math.abs(d);
    if (a >= 1) {
      if (c.state !== 'off') { c.el.style.visibility = 'hidden'; c.state = 'off'; }
      if (c.live) { c.live = false; c.el.classList.remove('is-live'); c.el.inert = true; }
      return;
    }
    if (c.state !== 'on') { c.state = 'on'; c.el.style.visibility = 'visible'; }
    const hold = 0.13;
    const t = clamp((a - hold) / (1 - hold));
    let y, o, blur = 0;
    // прозрачность пересекает 0.5 ровно на границе глав (|d| = 0.5): в любой точке
    // прокрутки «главная» (непрозрачнее половины) только карточка текущей главы,
    // а уходящая/входящая видны полупрозрачными краями — как в референсе
    if (reduced) {
      // упрощённое движение: короткий фейд без перекрытия — уходящая гаснет до границы глав,
      // входящая проявляется после неё, две карточки никогда не лежат друг на друге
      y = -Math.sign(d) * t * 40;
      o = 1 - smooth(0.3, 0.47, a);
    } else {
      const D = H * 0.92;
      y = -Math.sign(d) * sineIO(t) * D;
      if (d > 0) { o = 1 - smooth(0.3, 0.7, a); blur = smooth(0.3, 0.95, t) * 6; }
      else { o = 1 - smooth(0.26, 0.74, a); }
    }
    c.el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    const os = o.toFixed(3), fs = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
    if (os !== c.lo || fs !== c.lf) {
      c.lo = os; c.lf = fs;
      for (const el of c.fx) { el.style.opacity = os; el.style.filter = fs; }
    }
    // клик и фокус — по одному порогу: Tab не уводит на невидимую соседнюю карточку
    const live = a < 0.4;
    if (live !== c.live) { c.live = live; c.el.classList.toggle('is-live', live); c.el.inert = !live; }
  };

  // ---------- пины / якорные панели ----------
  const placeEl = (el, x, y) => { el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`; };
  const renderPins = (chF, time) => {
    for (const pn of pins) {
      const d = chF - (pn.ch + 0.5);
      let v = 1 - smooth(0.16, 0.46, Math.abs(d));
      if (v <= 0.001) {
        if (pn.el.style.visibility !== 'hidden') pn.el.style.visibility = 'hidden';
        if (pn.lead && pn.lead.style.visibility !== 'hidden') pn.lead.style.visibility = 'hidden';
        continue;
      }
      const a = anchorOf(pn.anchor, pn.fallback);
      if (!a.visible) v = 0;
      let x = a.x, y = a.y;
      const w = pn.w, h = pn.h, mob = isMobile();
      // на десктопе (и телефоне в альбомной) левая граница — край колонки карточек, а не экрана
      const xLo = mob ? 16 : Math.max(16, cardRight + 12);
      if (pn.place === 'left') {
        // плашка прижата к левому краю чашки на её середине и чуть заходит на корпус
        // отступ считаем от обода чашки (экранный радиус ≈ 0.17·min(W,H)), а не от её центра
        // плюс зазор ~24 px: карточка кода не упирается в чашку
        x = a.x - w - Math.min(W, H) * 0.2 - 24; y = a.y - h * 0.15;
        // на мобилке компактная плашка уходит под чашку, влево — не закрывает драйвер
        if (mob) { x = 16; y = a.y + Math.min(W, H) * 0.12; }
        x = clamp(x, xLo, Math.max(xLo, W - w - (mob ? 16 : 70)));
        y = clamp(y, 90, Math.max(90, mob ? H * 0.58 - h : H - h - 90));
        y += (1 - v) * 24;
      } else {
        // pin: якорь — центр «+» (margin -17px). below — подпись под объектом, side — сбоку от детали
        const side = pn.place === 'side';
        if (pn.place === 'below') { x = a.x - w / 2 + 17; y = a.y + H * (mob ? 0.17 : H < 480 ? 0.34 : 0.3); }
        else if (side) {
          // за силуэтом объекта: на десктопе — правее оголовья над колёсиком, на мобилке — в пустом углу
          // справа сверху (правее оголовья, над ближней чашкой), к точке ведёт выноска
          if (mob) { x = W - 10 - w + 17; y = a.y - H * 0.14; }
          else { x = a.x + Math.min(W, H) * 0.2; y = a.y - H * 0.1; }
        }
        const pLo = mob ? 34 : Math.max(34, xLo + 17);
        // низкий альбом (телефон боком): сцена ставит объект выше, подпись уходит под него почти до низа
        const low = !mob && H < 480;
        const pHi = side && mob ? W - 10 - w + 17 : W - w - (mob ? 12 : 60);
        x = clamp(x, pLo, Math.max(pLo, pHi)); y = clamp(y, low ? 60 : 100, Math.max(100, mob ? H * 0.6 : low ? H - h + 17 - 14 : H - 110));
        // и не ложится на счётчик глав: если пересекаются — сдвигаем левее счётчика (бокс пина = x−17, y−17)
        if (low && counterBox && y - 17 + h > counterBox.t - 6 && x - 17 + w > counterBox.l - 12 && x - 17 < counterBox.r) {
          x = Math.max(pLo, counterBox.l - 12 - w + 17);
        }
        y += (1 - v) * 12;
      }
      const vs = v > 0.001 ? 'visible' : 'hidden';
      if (pn.el.style.visibility !== vs) pn.el.style.visibility = vs;
      pn.el.style.opacity = v.toFixed(3);
      placeEl(pn.el, x, y);
      if (pn.lead) {
        // выноска: от точки детали (кольцо) к «+» подписи, не доходя до него 15 px
        const dx = x - a.x, dy = y - a.y, len = Math.hypot(dx, dy) - 15;
        const ls = vs === 'visible' && len > 8 ? 'visible' : 'hidden';
        if (pn.lead.style.visibility !== ls) pn.lead.style.visibility = ls;
        if (ls === 'visible') {
          pn.lead.style.opacity = v.toFixed(3);
          pn.lead.style.width = `${len.toFixed(1)}px`;
          pn.lead.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0) rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`;
        }
      }
    }
    // орбита источников
    const d = chF - (orbit.ch + 0.5);
    const v = 1 - smooth(0.12, 0.5, Math.abs(d));
    if (v <= 0.001) { if (orbit.el.style.visibility !== 'hidden') orbit.el.style.visibility = 'hidden'; return; }
    if (orbit.el.style.visibility !== 'visible') orbit.el.style.visibility = 'visible';
    // чипы стоят за силуэтом наушников, а не на нём: размер чашки на экране оцениваем по расстоянию
    // между якорями чашек. Десктоп — две колонки по бокам (слева Jamendo/Audius, справа Яндекс/SoundCloud),
    // мобилка — две строки под объектом. Чипы выезжают от чашки наружу и слегка покачиваются
    const mob = isMobile();
    const c0 = anchorOf(orbit.anchor, orbit.fallback);
    let cl = rawAnchor('cupLeft'), cr = rawAnchor('cupRight');
    if (!cl || !cr) { cl = { x: c0.x - W * 0.12, y: c0.y }; cr = { x: c0.x + W * 0.12, y: c0.y }; }
    const lx = Math.min(cl.x, cr.x), rx = Math.max(cl.x, cr.x);
    const hw = Math.max((rx - lx) * 0.36, Math.min(W, H) * 0.09), hh = hw * 1.25;
    const side = mob ? 'b' : 'lr';
    if (side !== orbit.side) {
      orbit.side = side;
      orbit.chips.forEach((chip, i) => {
        chip.classList.toggle('chip--r', !mob && i < 2);
        chip.classList.toggle('chip--l', !mob && i >= 2);
      });
    }
    const cLo = mob ? 12 : Math.max(12, cardRight + 12);
    const gapOut = 30;
    // мобилка: строка 1 — Яндекс Музыка + SoundCloud, строка 2 — Audius + Jamendo, по центру экрана
    const rowsY = mob ? Math.min(cr.y + hh + 22, H * 0.6 - 2 * (orbit.chips[0]._h || 30) - 10) : 0;
    orbit.chips.forEach((chip, i) => {
      const vi = clamp(v * 1.6 - i * 0.15);
      const w = chip._w, h = chip._h;
      const bob = reduced ? 0 : Math.sin(time * 1.1 + i * 1.7) * 4;
      let x, y;
      if (mob) {
        const pair = i < 2 ? [0, 1] : [2, 3];
        const rowW = orbit.chips[pair[0]]._w + orbit.chips[pair[1]]._w + 8;
        x = (W - rowW) / 2 + (i % 2 ? orbit.chips[pair[0]]._w + 8 : 0);
        y = rowsY + (i < 2 ? 0 : h + 8) + (1 - vi) * 14;
        x = clamp(x, 12, Math.max(12, W - w - 12));
      } else {
        const right = i < 2, top = i === 0 || i === 3;
        const g = gapOut * (0.35 + 0.65 * vi) + Math.abs(d) * 30;
        x = right ? rx + hw + g : lx - hw - g - w;
        // столбики слегка расходятся по вертикали при прокрутке — параллакс вместо вращения по орбите
        y = (cl.y + cr.y) / 2 + (top ? -hh * 0.62 : hh * 0.42) - h / 2 + d * (right ? -40 : 40) + bob;
        x = clamp(x, cLo, Math.max(cLo, W - w - 70)); y = clamp(y, 90, Math.max(90, H - h - 80));
      }
      chip.style.opacity = vi.toFixed(3);
      chip.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(0.85 + 0.15 * vi).toFixed(3)})`;
    });
  };

  // ---------- масштаб холста в главе 3 ----------
  // гл. 3 (макро амбушюра): объект чуть меньше и выше — низ амбушюра кончается над счётчиком глав.
  // Масштаб плавно растёт от центров соседних глав к центру своей, догоняет прокрутку тем же lerp, что и сцена.
  // Край ужатого холста растушёван маской, чтобы деталь, уходящая за кадр, не обрезалась прямой линией.
  // top: true — опорная точка внизу (холст ужимается к низу), для глав, где мешает верх кадра
  const ZONES = [{ c: 3.5, s: 0.915, top: false }];
  let sP = -1, stageT = 0, stageKey = '', stageMask = '';
  const applyStage = (p, time) => {
    const dt = stageT ? clamp(time - stageT, 0, 0.1) : 0;
    stageT = time;
    if (sP < 0 || isTest || (reduced && Math.abs(p - sP) > 1 / N)) sP = p;
    else { sP += (p - sP) * (1 - Math.pow(0.88, dt * 60)); if (Math.abs(p - sP) < 1e-5) sP = p; }
    let s = 1, z = null;
    if (scene && !isMobile()) {
      const chS = sP * N;
      for (const zn of ZONES) {
        const b = 1 - smooth(0, 1, Math.abs(chS - zn.c));
        if (b > 0) { s = 1 - (1 - zn.s) * b; z = zn; }
      }
    }
    if (s > 0.9995) { s = 1; z = null; }
    stage.s = s; stage.ox = W * 0.66; stage.oy = z && z.top ? H : 0;
    const key = z ? `${s.toFixed(4)}|${stage.ox.toFixed(1)}|${stage.oy}` : '';
    if (key !== stageKey) {
      stageKey = key;
      canvas.style.transformOrigin = z ? `${stage.ox.toFixed(1)}px ${stage.oy}px` : '';
      canvas.style.transform = z ? `scale(${s.toFixed(4)})` : '';
    }
    const mk = !z ? '' : `linear-gradient(${z.top ? 'to top' : 'to bottom'}, #000 calc(100% - 48px), transparent)`;
    if (mk !== stageMask) { stageMask = mk; canvas.style.webkitMaskImage = mk; canvas.style.maskImage = mk; }
  };

  // ---------- обвязка ----------
  let activeCh = -1;
  // после первого полного интро обвязка остаётся на экране и поверх интро:
  // «В начало» возвращает на кремовый экран, но рейка и меню продолжают работать
  let introSeen = false;
  let lastCo = '', lastCream = null, lastFill = '';
  const renderChrome = (p, chF, ip) => {
    const ch = clamp(Math.floor(chF), 0, 13);
    if (!introSeen && ip >= 1) { introSeen = true; root.classList.add('intro-seen'); }
    const cream = introSeen && ip < 0.8;
    if (cream !== lastCream) { lastCream = cream; root.classList.toggle('on-cream', cream); }
    const co = (introSeen ? 1 : smooth(0.78, 0.98, ip)).toFixed(3);
    if (co !== lastCo) {
      lastCo = co;
      for (const el of chromeEls) {
        el.style.opacity = co;
        el.style.visibility = +co > 0.01 ? 'visible' : 'hidden';
      }
    }
    const pf = `scaleX(${p.toFixed(4)})`;
    if (pf !== lastFill) { lastFill = pf; progressFill.style.transform = pf; }
    if (ch === activeCh) return;
    activeCh = ch;
    // раскрытое мобильное меню не висит поверх сцены, когда страницу листают дальше
    closeMenu();
    const shown = clamp(ch, 1, 12);
    counterNum.textContent = `${pad2(shown)} / 12`;
    counterName.textContent = NAMES[ch === 0 ? 1 : ch];
    dots.forEach((dt, i) => {
      const n = i + 1;
      const on = ch >= 1 && n === shown;
      dt.classList.toggle('is-on', on);
      if (on) dt.setAttribute('aria-current', 'true'); else dt.removeAttribute('aria-current');
      dt.classList.toggle('is-past', ch >= 1 && n < shown);
    });
    menuLinks.forEach((l) => {
      const g = +l.dataset.goto;
      const on = (g === 1 && ch >= 1 && ch <= 4) || (g === 5 && ch >= 5 && ch <= 7) || (g === 8 && ch >= 8 && ch <= 11) || (g === 12 && ch >= 12);
      l.classList.toggle('is-on', on && !l.classList.contains('menu-cta'));
    });
    root.classList.toggle('is-finale', ch >= 13);
  };

  // ---------- главный кадр ----------
  let lastP = -1;
  // reduced-motion: переход по рейке/меню/«В начало» — мгновенный прыжок прокрутки;
  // сцена тоже перескакивает (см. setMotion в headphones.js), а смену кадра прикрываем коротким фейдом
  const fadeEls = [canvas, $('.giant-layer'), finaleEl, $('.anchor-layer'), $('.card-layer')].filter(Boolean);
  const fadeJump = () => {
    for (const el of fadeEls) {
      try { if (el.animate) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }); } catch (e) { /* */ }
    }
  };
  const render = (time) => {
    // на тач-устройствах W/H меняет только настоящий ресайз (адресная строка их не трогает)
    if (!coarse && (innerWidth !== W || innerHeight !== H)) { W = innerWidth; H = innerHeight; }
    const p = readProgress();
    const chF = p * N;
    const ipScroll = clamp(p / INTRO_END);
    // автопроигрывание интро не держит его в середине навсегда: как только интро пройдено
    // прокруткой, автопрогресс сбрасываем — при возврате наверх интро отыгрывается от начала
    if (ipAuto && !autoTween && ipScroll >= 1) ipAuto = 0;
    const ip = Math.max(ipScroll, ipAuto);
    if (reduced && lastP >= 0 && Math.abs(p - lastP) > 1 / N) fadeJump();
    if (scene && p !== lastP) { try { scene.setProgress(p); } catch (e) { /* */ } }
    lastP = p;
    applyStage(p, time);
    renderIntro(ip);
    for (const c of cards) renderCard(c, chF - (c.ch + 0.5));
    for (const w of words) renderWord(w, chF - (w.ch + 0.5), false);
    renderFinale(chF - 13.5);
    renderFinaleCta(chF - 13.5);
    renderPins(chF, time);
    renderChrome(p, chF, ip);
  };

  // автозапуск интро: через 1.2 с силуэт и луч, затем плавно к главе 1
  let autoTimers = [], autoTween = null, autoStopped = isTest || reduced, autoScrollUntil = 0;
  // колесо во время авто-доводки к главе 1: сбрасываем цель Lenis на текущую позицию
  // (capture на window срабатывает раньше обработчика Lenis), иначе шаг колеса
  // прибавится к цели доводки и глава 1 проскочит
  addEventListener('wheel', () => {
    if (lenis && performance.now() < autoScrollUntil) {
      autoScrollUntil = 0;
      try { lenis.scrollTo(window.scrollY, { immediate: true, force: true }); } catch (e) { /* */ }
    }
  }, { capture: true, passive: true });
  const stopAuto = () => {
    autoStopped = true;
    autoTimers.forEach(clearTimeout); autoTimers = [];
    if (autoTween) { autoTween.kill(); autoTween = null; }
  };
  const startAuto = () => {
    if (autoStopped || readProgress() > 0.002) return;
    if (hasGsap) {
      const o = { v: ipAuto };
      autoTween = gsap.to(o, {
        v: 0.6, duration: 2.1, ease: 'power1.inOut',
        onUpdate: () => { ipAuto = o.v; },
        onComplete: () => {
          autoTween = null;
          if (!autoStopped && readProgress() < INTRO_END * 0.5) {
            autoStopped = true; autoScrollUntil = performance.now() + 2400;
            scrollToP(1.5 / N, { duration: 2.2 });
          }
        },
      });
    } else {
      ipAuto = 0.6;
    }
  };
  // Tab, модификаторы и Escape — не «листание»: не гасим автоинтро и не считаем взаимодействием
  const PASSIVE_KEY = /^(Tab|Shift|Control|Alt|AltGraph|Meta|OS|CapsLock|Escape|Esc|ContextMenu|F\d{1,2})$/;
  ['wheel', 'touchstart', 'keydown'].forEach((ev) => addEventListener(ev, (e) => {
    if (ev === 'keydown' && (PASSIVE_KEY.test(e.key || '') || e.ctrlKey || e.metaKey || e.altKey)) return;
    userActed = true;
    if (!autoStopped) stopAuto();
    // тестовый режим: при первом живом взаимодействии переносим прогресс в реальный скролл
    if (testP !== null) { const tp = testP; testP = null; window.scrollTo(0, tp * maxScroll()); if (trigger) ScrollTrigger.update(); }
  }, { passive: true }));

  // ---------- resize ----------
  // при смене размера держим тот же прогресс (ту же главу), а не те же пиксели прокрутки
  let resizeRaf = 0, keepP = null, layoutW = innerWidth, layoutH = innerHeight;
  addEventListener('resize', () => {
    // мобильная адресная строка прячется/появляется при прокрутке: меняется только высота.
    // Тут ничего не перестраиваем и не скроллим — иначе гасится инерция и всё дёргается
    // (холст и трек на 100lvh от этого не зависят; W/H тоже не трогаем — амплитуда карточек не прыгает)
    if (coarse && innerWidth === layoutW && Math.abs(innerHeight - layoutH) < 160) return;
    if (keepP === null && testP === null) keepP = lastP >= 0 ? lastP : readProgress();
    W = innerWidth; H = innerHeight;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      W = innerWidth; H = innerHeight; layoutW = W; layoutH = H;
      maxScrollC = 0;
      syncLayout();
      if (lenis && typeof lenis.resize === 'function') { try { lenis.resize(); } catch (e) { /* */ } }
      if (keepP !== null) { scrollToP(keepP, { immediate: true }); keepP = null; }
      if (scene && scene.resize) { try { scene.resize(); } catch (e) { /* */ } }
      fitWords();
      measureSizes();
      measureFinale();
      if (trigger) ScrollTrigger.refresh();
      lastP = -1;
      render(performance.now() / 1000);
    });
  });

  // ---------- старт ----------
  const fontsReady = () => {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const loads = [
      '800 100px "Unbounded"', '700 32px "Unbounded"', '400 15px "Onest"', '500 14px "Onest"',
      '600 10px "Onest"', '800 100px "Syne"',
    ].map((f) => document.fonts.load(f, 'АБВflow').catch(() => null));
    return Promise.race([Promise.all(loads).then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 2500))]);
  };

  const loop = () => { render(performance.now() / 1000); };
  // шрифты пришли позже таймаута (медленная сеть, display=swap): перемеряем слова, пины и «дырку» o.
  // loadingdone приходит на каждую пачку шрифтов — схлопываем в один пересчёт за кадр
  let started = false, remeasureRaf = 0;
  const remeasure = () => {
    if (!started || remeasureRaf) return;
    remeasureRaf = requestAnimationFrame(() => {
      remeasureRaf = 0;
      fitWords(); measureSizes(); measureFinale();
      lastP = -1;
    });
  };
  const start = () => {
    if (started) return;
    started = true;
    fitWords();
    measureSizes();
    measureFinale();
    if (isTest) {
      // мгновенно, без Lenis и анимаций. Окно не прокручиваем: headless-скриншот
      // снимает документ с верха, и fixed-слои уезжают. Состояние берётся из testP.
      if (trigger) ScrollTrigger.refresh();
    } else if (!userActed) {
      if (skipIntro) {
        // «Пропустить интро» нажали ещё до загрузки модуля — сразу в главу 1
        autoStopped = true;
        scrollToP(1.5 / N, { immediate: true });
      } else {
        window.scrollTo(0, 0);
        if (lenis) lenis.scrollTo(0, { immediate: true });
        autoTimers.push(setTimeout(startAuto, 1200));
      }
    }
    lastP = -1;
    render(performance.now() / 1000);
    if (document.fonts) {
      try {
        document.fonts.ready.then(remeasure, () => {});
        if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', remeasure);
      } catch (e) { /* */ }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { root.dataset.ready = '1'; }));
  };

  // рендер-цикл идёт сразу: если человек начнёт листать до прихода шрифтов, сцена и карточки
  // уже отвечают на прокрутку (Lenis к этому моменту крутится в том же тикере)
  render(performance.now() / 1000);
  if (hasGsap) gsap.ticker.add(loop);
  else { const raf = () => { loop(); requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
  // перемеры — после шрифтов
  fontsReady().then(start, start);
})();
