// Отладочная заглушка app.js для сцены: ?ch / ?p, ?dbg=1 рисует якоря, ?fx&fy&fs — цель финала
{
  const qs = new URLSearchParams(location.search);
  const CHAPTERS = 14;
  let p = 0;
  if (qs.has('p')) p = parseFloat(qs.get('p'));
  else if (qs.has('ch')) p = (parseInt(qs.get('ch'), 10) + 0.5) / CHAPTERS;
  const canvas = document.getElementById('scene');
  const sc = createHeadphonesScene(canvas);
  if (qs.has('fs')) {
    const r = { x: +qs.get('fx'), y: +qs.get('fy'), size: +qs.get('fs') };
    sc.setFinaleTarget(r);
    const o = document.createElement('div'); o.className = 'hp-dbg-o';
    Object.assign(o.style, { left: (r.x - r.size / 2) + 'px', top: (r.y - r.size / 2) + 'px', width: r.size + 'px', height: r.size + 'px' });
    document.body.appendChild(o);
  } else if (qs.has('dbg')) {
    const s = innerHeight * 0.3;
    const o = document.createElement('div'); o.className = 'hp-dbg-o';
    Object.assign(o.style, { left: (innerWidth / 2 - s / 2) + 'px', top: (innerHeight / 2 - s / 2) + 'px', width: s + 'px', height: s + 'px' });
    document.body.appendChild(o);
  }
  sc.setProgress(p);
  addEventListener('resize', () => sc.resize());
  if (qs.has('dbg')) {
    const names = ['cupLeft', 'cupRight', 'touch', 'driver', 'cable', 'center'];
    const els = names.map(n => { const d = document.createElement('div'); d.className = 'hp-dbg-a'; d.innerHTML = '<span>' + n + '</span>'; document.body.appendChild(d); return d; });
    const tick = () => {
      names.forEach((n, i) => { const a = sc.getAnchor(n); els[i].style.left = a.x + 'px'; els[i].style.top = a.y + 'px'; els[i].style.opacity = a.visible ? 1 : 0.25; });
      requestAnimationFrame(tick);
    };
    tick();
  }
  requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; }));
}
