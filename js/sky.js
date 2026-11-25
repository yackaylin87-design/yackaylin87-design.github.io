// Fondo del espacio: estrellas que brillan y caen despacio, y de vez en cuando una estrella fugaz.
// Se pausa cuando la página no está a la vista (para no gastar batería).
(() => {
  const cv = document.getElementById('sky'); if (!cv) return;
  const cx = cv.getContext('2d');
  // Si la computadora pide "menos animaciones", el fondo se mueve más despacio y con menos estrellas fugaces.
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches, vel = quieto ? 0.5 : 1;
  let W = 0, H = 0, dpr = 1, stars = [], fugaces = [], next = 0, raf = 0, last = 0;
  const COLS = ['255,255,255', '200,220,255', '255,230,200', '255,200,170'];

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(320, Math.round(W * H / 5000));
    stars = Array.from({ length: n }, () => star(Math.random() * H));
  }
  function star(y) {
    const z = Math.random(); // profundidad: las cercanas son más grandes y caen más rápido
    return { x: Math.random() * W, y, r: 0.5 + z * 1.6, v: (6 + z * 22) * vel, a: 0.45 + z * 0.55, t: Math.random() * 6.3, s: 0.6 + Math.random() * 2, c: COLS[Math.random() * COLS.length | 0] };
  }
  function fugaz() {
    const ang = (Math.PI / 180) * (55 + Math.random() * 25), sp = 650 + Math.random() * 450;
    fugaces.push({ x: Math.random() * W * 0.9 + W * 0.05, y: -20, vx: Math.cos(ang) * sp * (Math.random() < .5 ? -1 : 1), vy: Math.sin(ang) * sp, life: 0, max: 0.9 + Math.random() * 0.8, len: 90 + Math.random() * 110 });
  }
  function draw(dt) {
    cx.clearRect(0, 0, W, H);
    for (const s of stars) {
      s.y += s.v * dt; s.t += s.s * dt;
      if (s.y > H + 2) Object.assign(s, star(-2));
      const a = s.a * (0.65 + 0.35 * Math.sin(s.t));
      cx.beginPath(); cx.fillStyle = `rgba(${s.c},${a})`; cx.arc(s.x, s.y, s.r, 0, 6.283); cx.fill();
      if (s.r > 1.45) { cx.fillStyle = `rgba(${s.c},${a * 0.18})`; cx.beginPath(); cx.arc(s.x, s.y, s.r * 3, 0, 6.283); cx.fill(); }
    }
    for (let i = fugaces.length - 1; i >= 0; i--) {
      const f = fugaces[i]; f.life += dt; f.x += f.vx * dt; f.y += f.vy * dt;
      const k = Math.min(1, f.life / 0.15) * Math.max(0, 1 - f.life / f.max);
      const m = Math.hypot(f.vx, f.vy), tx = f.x - f.vx / m * f.len, ty = f.y - f.vy / m * f.len;
      const g = cx.createLinearGradient(f.x, f.y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${k})`); g.addColorStop(0.3, `rgba(255,190,140,${k * 0.5})`); g.addColorStop(1, 'rgba(255,120,60,0)');
      cx.strokeStyle = g; cx.lineWidth = 2; cx.lineCap = 'round';
      cx.beginPath(); cx.moveTo(f.x, f.y); cx.lineTo(tx, ty); cx.stroke();
      cx.fillStyle = `rgba(255,255,255,${k})`; cx.beginPath(); cx.arc(f.x, f.y, 1.6, 0, 6.283); cx.fill();
      if (f.life > f.max || f.y > H + 200) fugaces.splice(i, 1);
    }
  }
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    if (t > next) { fugaz(); if (Math.random() < 0.25) fugaz(); next = t + (1200 + Math.random() * 2800) / vel; }
    draw(dt); raf = requestAnimationFrame(loop);
  }
  function start() { if (raf) return; last = performance.now(); raf = requestAnimationFrame(loop); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  addEventListener('resize', size);
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  size(); draw(0); start();
})();
