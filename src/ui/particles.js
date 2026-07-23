// Sınırlı parçacık havuzu — kıvılcım + duman (arıza görseli).
// Dünya koordinatında çalışır; maks sayı aşılınca yeni parçacık düşer.

export function createParticles(maks = 100) {
  const liste = [];

  function kivilcim(x, y) {
    if (liste.length >= maks) return;
    liste.push({
      tip: 'k', x, y,
      vx: (Math.random() - 0.5) * 110,
      vy: -50 - Math.random() * 90,
      yas: 0, omur: 0.35 + Math.random() * 0.3,
    });
  }

  function duman(x, y) {
    if (liste.length >= maks) return;
    liste.push({
      tip: 'd', x, y,
      vx: (Math.random() - 0.5) * 12,
      vy: -16 - Math.random() * 14,
      boy: 3 + Math.random() * 3,
      yas: 0, omur: 1.1 + Math.random() * 0.9,
    });
  }

  function guncelle(dt) {
    for (let i = liste.length - 1; i >= 0; i--) {
      const p = liste[i];
      p.yas += dt;
      if (p.yas >= p.omur) { liste.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.tip === 'k') p.vy += 380 * dt;      // yerçekimi
      else p.boy += 9 * dt;                      // duman büyür
    }
  }

  function ciz(ctx) {
    for (const p of liste) {
      const t = p.yas / p.omur;
      if (p.tip === 'k') {
        ctx.fillStyle = t < 0.4 ? 'rgba(255,236,160,' : 'rgba(255,150,60,';
        ctx.fillStyle += (1 - t).toFixed(2) + ')';
        ctx.fillRect(p.x, p.y, 2.5, 2.5);
      } else {
        ctx.fillStyle = `rgba(150,150,150,${(0.28 * (1 - t)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.boy, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return { kivilcim, duman, guncelle, ciz, get sayi() { return liste.length; } };
}
