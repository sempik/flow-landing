// Функциональный автотест лендинга Flow. Запускается на VPS: node test-remote.js <dir>
// В <dir> лежит index.html; результат — <dir>/out/report.json, report.txt и *.jpg
// Проверяет то, что не видно на статичных скриншотах: реальный скролл, клики, ресайз,
// мобилку, reduced-motion, шрифты, переполнения, ошибки консоли.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const DIR = process.argv[2];
const OUT = path.join(DIR, 'out');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.join(DIR, 'index.html');

const fails = [];
const warns = [];
const notes = [];
const fail = (test, detail) => fails.push({ test, detail });
const warn = (test, detail) => warns.push({ test, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(browser, { w, h, mobile = false, query = '', reduced = false, label }) {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') fail(`${label}: console.error`, m.text().slice(0, 300));
    else if (t === 'warning' || t === 'warn') warn(`${label}: console.warn`, m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => fail(`${label}: uncaught exception`, String(e && e.message || e).slice(0, 400)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.includes('favicon')) fail(`${label}: request failed`, `${u} — ${r.failure() && r.failure().errorText}`);
  });
  await page.goto(URL + (query ? '?' + query : ''), { waitUntil: 'load', timeout: 90000 });
  try {
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 30000 });
  } catch {
    fail(`${label}: data-ready`, 'document.documentElement.dataset.ready !== "1" через 30 с');
  }
  await page.evaluate(() => document.fonts && document.fonts.ready);
  return page;
}

// Снимок состояния страницы: глава по хукам, счётчик, рейка, видимые карточки, переполнения
async function snapshot(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.5 &&
        r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    const st = window.__flow && typeof window.__flow.state === 'function' ? window.__flow.state() : null;
    const counter = document.querySelector('[data-test="counter"]');
    const dots = [...document.querySelectorAll('[data-test="rail-dot"]')];
    const activeDot = dots.find((d) => d.getAttribute('aria-current') === 'true' || d.classList.contains('is-active'));
    const cards = [...document.querySelectorAll('[data-test="card"]')].filter(vis).map((c) => +c.dataset.chapter);
    // текст, вылезающий из своих блоков внутри видимых карточек и пилюль
    const overflow = [];
    document.querySelectorAll('[data-test="card"] *, [data-test="counter"], header *, [data-test="menu-link"]').forEach((el) => {
      if (!vis(el) || !el.childElementCount && !el.textContent.trim()) return;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible') overflow.push(el.className || el.tagName);
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) overflow.push('за краем экрана: ' + (el.className || el.tagName) + ' «' + el.textContent.trim().slice(0, 30) + '»');
    });
    return {
      scrollY: Math.round(scrollY),
      maxScroll: document.documentElement.scrollHeight - innerHeight,
      hScroll: document.documentElement.scrollWidth > innerWidth + 1,
      state: st,
      counter: counter ? counter.textContent.replace(/\s+/g, ' ').trim() : null,
      activeDot: activeDot ? +activeDot.dataset.chapter : null,
      dots: dots.length,
      cards,
      overflow: [...new Set(overflow)].slice(0, 8),
      blurLayers: [...document.querySelectorAll('*')].filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.backdropFilter && cs.backdropFilter !== 'none') && vis(el);
      }).length,
    };
  });
}

function checkSnapshot(label, s) {
  if (s.hScroll) fail(`${label}: горизонтальный скролл`, `scrollWidth > innerWidth на scrollY=${s.scrollY}`);
  for (const o of s.overflow) fail(`${label}: переполнение`, `${o} (scrollY=${s.scrollY})`);
  if (!s.state) return;
  const ch = s.state.chapter;
  if (ch >= 1 && ch <= 12) {
    const num = String(ch).padStart(2, '0');
    if (s.counter && !s.counter.includes(num + ' / 12')) fail(`${label}: счётчик`, `глава ${ch}, а счётчик «${s.counter}»`);
    if (s.dots && s.activeDot !== ch) fail(`${label}: рейка`, `глава ${ch}, активная точка ${s.activeDot}`);
    if (!s.cards.includes(ch)) fail(`${label}: карточка`, `глава ${ch}, видимые карточки [${s.cards}]`);
    if (s.cards.length > 1) fail(`${label}: карточки наслаиваются`, `глава ${ch} в покое, видимые карточки [${s.cards}]`);
  }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files'],
  });
  try {
    // 1. Десктоп: загрузка, хуки, шрифты, ссылки
    let page = await openPage(browser, { w: 1600, h: 900, label: 'desktop' });
    const hooks = await page.evaluate(() => ({
      flow: !!(window.__flow && window.__flow.state && window.__flow.goTo),
      counter: !!document.querySelector('[data-test="counter"]'),
      dots: document.querySelectorAll('[data-test="rail-dot"]').length,
      cards: document.querySelectorAll('[data-test="card"]').length,
      menu: document.querySelectorAll('[data-test="menu-link"]').length,
      toTop: !!document.querySelector('[data-test="to-top"]'),
      downloads: [...document.querySelectorAll('[data-test="download"]')].map((a) => a.href),
    }));
    notes.push('hooks: ' + JSON.stringify(hooks));
    if (!hooks.flow) fail('хуки', 'нет window.__flow.state/goTo (см. SPEC, раздел «Функциональный автотест»)');
    if (!hooks.counter) fail('хуки', 'нет [data-test="counter"]');
    if (hooks.dots !== 12) fail('хуки', `[data-test="rail-dot"]: ${hooks.dots}, нужно 12`);
    if (hooks.cards !== 12) fail('хуки', `[data-test="card"]: ${hooks.cards}, нужно 12`);
    if (!hooks.menu) fail('хуки', 'нет [data-test="menu-link"]');
    if (!hooks.toTop) fail('хуки', 'нет [data-test="to-top"]');
    if (!hooks.downloads.length) fail('ссылки', 'нет [data-test="download"]');
    for (const h of hooks.downloads) if (!h.startsWith('https://flowww.space')) fail('ссылки', `download ведёт на ${h}`);

    const fonts = await page.evaluate(async () => {
      const probe = [['Unbounded', 'Ж'], ['Onest', 'Ж'], ['Syne', 'f']];
      const res = {};
      for (const [f, ch] of probe) {
        try { await document.fonts.load(`700 32px "${f}"`, ch); } catch {}
        res[f] = document.fonts.check(`700 32px "${f}"`, ch);
      }
      return res;
    });
    for (const [f, ok] of Object.entries(fonts)) if (!ok) fail('шрифты', `${f} не загрузился (или нет нужных глифов)`);

    const deadLinks = await page.evaluate(() => [...document.querySelectorAll('a')]
      .filter((a) => { const h = a.getAttribute('href'); return !h || h === '#' && !a.dataset.chapter && a.dataset.test !== 'to-top'; })
      .map((a) => a.textContent.trim().slice(0, 30)));
    for (const d of deadLinks) warn('ссылки', `пустая ссылка «${d}»`);

    // 2. Десктоп: реальная прокрутка колесом через всю страницу
    await page.mouse.move(1000, 450);
    const seen = new Set();
    let lastCh = -1, backwards = 0;
    {
      // состояние до первой прокрутки: интро само доезжает до главы 1
      await sleep(2500);
      const s0 = await snapshot(page);
      checkSnapshot('desktop-старт', s0);
      if (s0.state) { seen.add(s0.state.chapter); lastCh = s0.state.chapter; }
    }
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel({ deltaY: 700 });
      await sleep(1300);
      const s = await snapshot(page);
      checkSnapshot('desktop-скролл', s);
      if (s.state) {
        seen.add(s.state.chapter);
        if (s.state.chapter < lastCh) backwards++;
        lastCh = s.state.chapter;
      }
      if (i % 4 === 0) await page.screenshot({ path: path.join(OUT, `sweep_${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 70 });
      if (s.scrollY >= s.maxScroll - 2) { notes.push(`скролл колесом дошёл до низа за ${i + 1} шагов`); break; }
      if (i === 39) fail('скролл', `за 40 прокруток колесом не дошли до конца (scrollY ${s.scrollY} из ${s.maxScroll})`);
    }
    notes.push('главы при прокрутке: ' + [...seen].sort((a, b) => a - b).join(','));
    if (backwards) fail('скролл', `глава уменьшалась при прокрутке вниз ${backwards} раз`);
    for (let c = 1; c <= 13; c++) if (seen.size && !seen.has(c)) warn('скролл', `глава ${c} ни разу не была активной при прокрутке по 700px`);

    // 3. Клики: «В начало», точки рейки, меню
    const toTop = await page.$('[data-test="to-top"]');
    if (toTop) {
      await toTop.click().catch((e) => fail('клик «В начало»', e.message));
      await sleep(3500);
      const s = await snapshot(page);
      if (s.scrollY > 50) fail('клик «В начало»', `после клика scrollY=${s.scrollY}`);
    }
    for (const target of [3, 8, 12]) {
      const dot = await page.$(`[data-test="rail-dot"][data-chapter="${target}"]`);
      if (!dot) continue;
      await dot.click().catch((e) => fail(`клик по точке ${target}`, e.message));
      await sleep(3500);
      const s = await snapshot(page);
      checkSnapshot(`после клика по точке ${target}`, s);
      if (s.state && s.state.chapter !== target) fail(`клик по точке ${target}`, `оказались в главе ${s.state.chapter}`);
    }
    const menu = await page.$$('[data-test="menu-link"]');
    for (const m of menu) {
      const target = await m.evaluate((el) => +el.dataset.chapter || null);
      if (!target) continue;
      await m.click().catch((e) => fail(`клик меню → ${target}`, e.message));
      await sleep(3500);
      const s = await snapshot(page);
      if (s.state && s.state.chapter !== target) fail(`клик меню → ${target}`, `оказались в главе ${s.state.chapter}`);
    }

    // 4. Ресайз посреди страницы: десктоп → мобилка → десктоп
    if (hooks.flow) {
      await page.evaluate(() => window.__flow.goTo(13, { instant: true }));
      await sleep(1500);
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      await sleep(2000);
      let s = await snapshot(page);
      checkSnapshot('ресайз в 390', s);
      await page.screenshot({ path: path.join(OUT, 'resize_390_ch13.jpg'), type: 'jpeg', quality: 75 });
      await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
      await sleep(2000);
      s = await snapshot(page);
      checkSnapshot('ресайз обратно в 1600', s);
      if (s.state && s.state.chapter !== 13) fail('ресайз', `после ресайза глава сменилась на ${s.state.chapter}`);
      await page.screenshot({ path: path.join(OUT, 'resize_back_1600_ch13.jpg'), type: 'jpeg', quality: 75 });
    }
    const blurMax = (await snapshot(page)).blurLayers;
    notes.push(`видимых слоёв с backdrop-filter: ${blurMax}`);
    await page.close();

    // 5. ?ch=N детерминированность
    for (const n of [1, 7, 13]) {
      page = await openPage(browser, { w: 1600, h: 900, query: 'ch=' + n, label: `?ch=${n}` });
      const s = await snapshot(page);
      checkSnapshot(`?ch=${n}`, s);
      if (s.state && s.state.chapter !== n) fail(`?ch=${n}`, `открылась глава ${s.state.chapter}`);
      await page.close();
    }

    // 6. Мобилка: загрузка с нуля и прокрутка
    page = await openPage(browser, { w: 390, h: 844, mobile: true, label: 'mobile' });
    {
      // первый экран: даём интро само доехать до главы 1 (1.2 с пауза + ~2 с луч + ~2.2 с доводка),
      // иначе кадр ловит слово FLOW на середине выезда из-под маски
      await sleep(6500);
      const s0 = await snapshot(page);
      checkSnapshot('mobile-старт', s0);
      if (s0.state && s0.state.chapter !== 1) warn('mobile-старт', `после автоинтро глава ${s0.state.chapter}, ожидалась 1`);
      await page.screenshot({ path: path.join(OUT, 'mobile_start.jpg'), type: 'jpeg', quality: 75 });
    }
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.scrollBy(0, Math.round(innerHeight * 0.9)));
      await sleep(1300);
      const s = await snapshot(page);
      checkSnapshot('mobile-скролл', s);
      if (i % 4 === 0) {
        // кадр для глаз — в покое главы: доводим до центра ближайшей главы и ждём, пока сцена и буквы встанут.
        // Промежуточные позиции прокрутки (буквы на полпути из-под маски) проверяет checkSnapshot выше
        if (s.state && s.state.chapter >= 1 && s.state.chapter <= 13) {
          await page.evaluate((n) => window.__flow.goTo(n, { instant: true }), s.state.chapter);
          await sleep(1600);
          checkSnapshot('mobile-глава', await snapshot(page));
        }
        await page.screenshot({ path: path.join(OUT, `mobile_${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 70 });
      }
      if (s.scrollY >= s.maxScroll - 2) break;
    }
    await page.close();

    // 7. prefers-reduced-motion
    page = await openPage(browser, { w: 1600, h: 900, reduced: true, query: 'ch=6', label: 'reduced-motion' });
    checkSnapshot('reduced-motion', await snapshot(page));
    await page.screenshot({ path: path.join(OUT, 'reduced_ch6.jpg'), type: 'jpeg', quality: 75 });
    await page.close();
  } catch (e) {
    fail('тест упал', String(e && e.stack || e).slice(0, 600));
  } finally {
    await browser.close();
  }

  // дубли (одна и та же проблема на многих шагах) схлопываем
  const uniq = (arr) => {
    const m = new Map();
    for (const x of arr) { const k = x.test + '|' + x.detail.replace(/scrollY=\d+/g, ''); m.set(k, { ...x, count: (m.get(k)?.count || 0) + 1 }); }
    return [...m.values()];
  };
  const report = { ok: fails.length === 0, fails: uniq(fails), warns: uniq(warns), notes };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const txt = [
    report.ok ? 'РЕЗУЛЬТАТ: OK, ошибок нет' : `РЕЗУЛЬТАТ: ОШИБОК ${report.fails.length}`,
    ...report.fails.map((f) => `FAIL [${f.test}] ${f.detail}${f.count > 1 ? ` (×${f.count})` : ''}`),
    ...report.warns.map((f) => `WARN [${f.test}] ${f.detail}${f.count > 1 ? ` (×${f.count})` : ''}`),
    ...notes.map((n) => `NOTE ${n}`),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.txt'), txt);
  console.log(txt);
})();
