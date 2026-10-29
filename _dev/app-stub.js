// Заглушка app.js для проверки сцены отдельно от вёрстки.
// ?p=0..1 — глобальный прогресс, ?ch=N — центр главы N (0 = интро, 1..12 главы, 13 = финал)
{
  const qs = new URLSearchParams(location.search);
  const CHAPTERS = 14;
  let p = 0;
  if (qs.has('p')) p = parseFloat(qs.get('p'));
  else if (qs.has('ch')) p = (parseInt(qs.get('ch'), 10) + 0.5) / CHAPTERS;
  const canvas = document.getElementById('scene');
  if (typeof createHeadphonesScene === 'function') {
    const scene = createHeadphonesScene(canvas);
    scene.setProgress(p);
    addEventListener('resize', () => scene.resize());
  }
  requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; }));
}
