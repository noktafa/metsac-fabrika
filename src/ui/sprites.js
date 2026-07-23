// Vektörel "sprite" rutinleri — harici asset yok, her şey path/gradyanla çizilir.
// Dünya piksel koordinatında çalışır, durum tutmaz (animT dışarıdan gelir).

import { TILE } from './camera.js';

export const DURUM_RENK = {
  calisiyor: '#68b04a',
  bloke: '#e8c130',
  ac: '#9aa0a6',
  arizali: '#e8842c',
  setup: '#4a90d9',
  bosta: '#6b6b6b',
};

const YAZI = 'ui-monospace, Menlo, monospace';

export function yuvarlakDikdortgen(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr); ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h); ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------- zemin/statik

/** İstasyon kaidesi (statik katmana çizilir) */
export function istasyonKaide(ctx, px, py) {
  const w = 3 * TILE;
  ctx.fillStyle = '#211f1d';
  ctx.fillRect(px - 3, py - 3, w + 6, w + 6);
  ctx.strokeStyle = '#3a3733';
  ctx.lineWidth = 2;
  ctx.strokeRect(px - 3, py - 3, w + 6, w + 6);
}

/**
 * Konveyör zemini + yan raylar (statik). Bant kırıklı çizgidir:
 * b.segs = [{ p, q, dx, dy, len, s0 }], b.uz = toplam uzunluk.
 * Yatay/dikey segmentler + köşe dönüş plakaları desteklenir.
 */
export function bantZemin(ctx, b) {
  const w = TILE * 0.8;
  for (const sg of b.segs || []) {
    ctx.save();
    ctx.translate(sg.p.x, sg.p.y);
    ctx.rotate(Math.atan2(sg.dy, sg.dx));
    // köşeye komşu uçlar yarım bant genişliği taşar → dönüş boşluksuz kapanır
    const e0 = sg.s0 > 0.5 ? w / 2 : 0;
    const e1 = sg.s0 + sg.len < (b.uz || sg.len) - 0.5 ? w / 2 : 0;
    ctx.fillStyle = '#242424';
    ctx.fillRect(-e0, -w / 2, sg.len + e0 + e1, w);
    ctx.fillStyle = '#3c3c3c';
    ctx.fillRect(-e0, -w / 2, sg.len + e0 + e1, 3);
    ctx.fillRect(-e0, w / 2 - 3, sg.len + e0 + e1, 3);
    ctx.restore();
  }
  // köşe dönüş plakaları (segment birleşim noktaları)
  const segs = b.segs || [];
  for (let i = 0; i < segs.length - 1; i++) {
    const j = segs[i].q;
    ctx.fillStyle = '#242424';
    ctx.fillRect(j.x - w / 2, j.y - w / 2, w, w);
    ctx.strokeStyle = '#3c3c3c';
    ctx.lineWidth = 3;
    ctx.strokeRect(j.x - w / 2 + 1.5, j.y - w / 2 + 1.5, w - 3, w - 3);
    ctx.fillStyle = '#3c3c3c';
    ctx.beginPath(); ctx.arc(j.x, j.y, 4, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------------------------------------------------------------- bant (dinamik)

/** Bant hattı üzerinde s (0..b.uz) mesafesindeki dünya noktası */
export function bantNokta(b, s) {
  const segs = b.segs || [];
  if (!segs.length) return { x: 0, y: 0 };
  const ss = Math.max(0, Math.min(b.uz, s));
  for (const sg of segs) {
    if (ss <= sg.s0 + sg.len + 1e-6) {
      const d = ss - sg.s0;
      return { x: sg.p.x + sg.dx * d, y: sg.p.y + sg.dy * d };
    }
  }
  const son = segs[segs.length - 1];
  return { x: son.q.x, y: son.q.y };
}

/** Hareketli şerit dokusu (chevron) — ofset hat uzunluğu (px) cinsinden kayma.
 *  Faz her segmentte s0'a göre düşülür → desen köşelerden kesintisiz akar. */
export function bantSeritler(ctx, b, ofset) {
  const w = TILE * 0.8;
  const adim = 24;
  for (const sg of b.segs || []) {
    if (sg.len <= 0) continue;
    ctx.save();
    ctx.translate(sg.p.x, sg.p.y);
    ctx.rotate(Math.atan2(sg.dy, sg.dx));
    ctx.beginPath();
    ctx.rect(0, -w / 2 + 4, sg.len, w - 8);
    ctx.clip();
    ctx.strokeStyle = '#494949';
    ctx.lineWidth = 2;
    const kay = (((ofset - sg.s0) % adim) + adim) % adim;
    for (let s = kay - adim; s < sg.len + adim; s += adim) {
      ctx.beginPath();
      ctx.moveTo(s, -w / 2 + 4);
      ctx.lineTo(s + 8, 0);
      ctx.lineTo(s, w / 2 - 4);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Bant üstünde akan braket parçaları — kırıklı hat boyunca, köşelerden dönerek */
export function bantParcalari(ctx, b, ofset) {
  const aralik = 58;
  if (!b.uz || b.uz < aralik) return;
  const n = Math.floor(b.uz / aralik);
  for (let i = 0; i < n; i++) {
    const s = (((ofset + i * aralik) % b.uz) + b.uz) % b.uz;
    const p = bantNokta(b, s);
    braket(ctx, p.x, p.y);
  }
}

function braket(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#a7adb4';
  ctx.strokeStyle = '#5c6167';
  ctx.lineWidth = 1;
  ctx.beginPath(); // L-profil sac braket
  ctx.moveTo(-7, -5); ctx.lineTo(7, -5); ctx.lineTo(7, -1);
  ctx.lineTo(-3, -1); ctx.lineTo(-3, 6); ctx.lineTo(-7, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- istasyon

/** Assembling-machine benzeri gövde + dönen dişli + istasyon ikonu */
export function istasyonCiz(ctx, s, st, animT) {
  const x = s.px + 5, y = s.py + 5, w = 3 * TILE - 10;
  ctx.save();
  if (st.durum === 'bosta') ctx.globalAlpha = 0.55;

  // metal gövde (gri-kahve gradyan)
  const gr = ctx.createLinearGradient(x, y, x, y + w);
  gr.addColorStop(0, '#7a7061');
  gr.addColorStop(0.5, '#645b50');
  gr.addColorStop(1, '#4e4740');
  yuvarlakDikdortgen(ctx, x, y, w, w, 8);
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#2c2823';
  ctx.stroke();

  // durum kenarlığı (renk + ikon birlikte — renk körlüğü için ikon rozeti ayrıca var)
  yuvarlakDikdortgen(ctx, x + 2.5, y + 2.5, w - 5, w - 5, 6);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = DURUM_RENK[st.durum] || '#555';
  ctx.stroke();

  // makine iç tabanı
  yuvarlakDikdortgen(ctx, x + 16, y + 16, w - 32, w - 32, 6);
  ctx.fillStyle = '#38332e';
  ctx.fill();

  // dönen rotor/dişli — yalnız çalışırken döner
  const aci = st.durum === 'calisiyor' ? animT * 2.4 : 0;
  disli(ctx, s.cx, s.cy, 26, aci, '#847a6d');

  // köşe perçinleri
  ctx.fillStyle = '#2e2a26';
  for (const [dx, dy] of [[9, 9], [w - 9, 9], [9, w - 9], [w - 9, w - 9]]) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // istasyona özgü ikon
  istasyonIkon(ctx, s.id, s.cx, s.cy);

  // kaynak arkı parıltısı
  if (s.id === 'kaynak' && st.durum === 'calisiyor') kaynakParilti(ctx, s.cx, s.cy - 4, animT);

  // arıza: gövde kararır
  if (st.durum === 'arizali') {
    yuvarlakDikdortgen(ctx, x, y, w, w, 8);
    ctx.fillStyle = 'rgba(10,8,6,0.5)';
    ctx.fill();
  }
  ctx.restore();
}

function istasyonIkon(ctx, id, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#f0ead9';
  ctx.fillStyle = '#f0ead9';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (id === 'kesme') {           // makas
    ctx.beginPath(); ctx.moveTo(-11, -9); ctx.lineTo(12, 9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-11, 9); ctx.lineTo(12, -9); ctx.stroke();
    for (const yy of [-9, 9]) {
      ctx.beginPath(); ctx.arc(-13, yy, 3.4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(1, 0, 2, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'bukme') {    // abkant/mengene: üst zımba + V kalıp + bükülen sac
    ctx.fillRect(-13, -13, 26, 6);
    ctx.beginPath(); ctx.moveTo(-4, -7); ctx.lineTo(0, 1); ctx.lineTo(4, -7); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-11, 12); ctx.lineTo(0, 3); ctx.lineTo(11, 12); ctx.stroke();
  } else if (id === 'kaynak') {   // torç + ark yıldızı
    ctx.beginPath(); ctx.moveTo(12, -12); ctx.lineTo(3, -3); ctx.stroke();
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + 0.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3 + 2);
      ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9 + 2);
      ctx.stroke();
    }
  } else if (id === 'boya') {     // püskürtme tabancası + damlacıklar
    ctx.fillRect(-13, -5, 11, 8);
    ctx.fillRect(-9, 3, 5, 8);
    ctx.beginPath(); ctx.moveTo(-2, -1); ctx.lineTo(3, -1); ctx.stroke();
    for (const [dx, dy] of [[7, -7], [9, -1], [7, 5], [12, -4], [12, 2]]) {
      ctx.beginPath(); ctx.arc(dx, dy, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  } else if (id === 'montaj') {   // vida başı + diş
    ctx.beginPath(); ctx.arc(0, -4, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(5, -4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 1); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-3, 6); ctx.lineTo(3, 8);
    ctx.moveTo(-3, 10); ctx.lineTo(3, 12);
    ctx.stroke();
  }
  ctx.restore();
}

export function disli(ctx, cx, cy, r, aci, renk) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(aci);
  ctx.fillStyle = renk;
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI / 4);
    ctx.fillRect(-3.5, -r - 5, 7, 10);
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f2b27';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Kaynak arkı — mavi-beyaz titrek parıltı (additive) */
export function kaynakParilti(ctx, cx, cy, animT) {
  const f = 0.55 + 0.45 * Math.abs(Math.sin(animT * 23) * Math.sin(animT * 7.3));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
  g.addColorStop(0, `rgba(215,238,255,${(0.9 * f).toFixed(3)})`);
  g.addColorStop(0.4, `rgba(120,180,255,${(0.45 * f).toFixed(3)})`);
  g.addColorStop(1, 'rgba(80,140,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Çevrim ilerleme dairesi (0..1) */
export function ilerlemeHalka(ctx, cx, cy, r, t) {
  ctx.save();
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const tt = Math.max(0, Math.min(1, t || 0));
  if (tt > 0.01) {
    ctx.strokeStyle = '#68b04a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + tt * Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Durum rozeti: renkli çerçeve + duruma özgü ikon (bloke ▮ / aç boş-kutu / arıza anahtar / setup saat) */
export function durumRozet(ctx, cx, cy, durum) {
  const renk = DURUM_RENK[durum] || '#888';
  yuvarlakDikdortgen(ctx, cx - 12, cy - 12, 24, 24, 5);
  ctx.fillStyle = 'rgba(18,16,14,0.88)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = renk;
  ctx.stroke();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = renk;
  ctx.fillStyle = renk;
  ctx.lineCap = 'round';
  if (durum === 'bloke') {
    ctx.fillRect(-4, -7, 8, 14);                       // ▮
  } else if (durum === 'ac') {                          // boş kutu (starved)
    ctx.lineWidth = 2;
    ctx.strokeRect(-7, -3, 14, 9);
    ctx.beginPath();
    ctx.moveTo(-7, -3); ctx.lineTo(-4, -7);
    ctx.moveTo(7, -3); ctx.lineTo(4, -7);
    ctx.stroke();
  } else if (durum === 'arizali') {                     // turuncu anahtar
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, 6); ctx.lineTo(2, -2); ctx.stroke();
    ctx.beginPath(); ctx.arc(4.5, -4.5, 4.5, -2.2, 2.6); ctx.stroke();
  } else if (durum === 'setup') {                       // mavi saat
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, -5);
    ctx.moveTo(0, 0); ctx.lineTo(3.5, 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Factorio-vari yanıp sönen uyarı üçgeni (faz: true=sarı, false=kırmızı) */
export function uyariUcgen(ctx, cx, cy, s, faz) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + s * 0.95, cy + s * 0.75);
  ctx.lineTo(cx - s * 0.95, cy + s * 0.75);
  ctx.closePath();
  ctx.fillStyle = faz ? '#ffd23e' : '#e03c28';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#241f1a';
  ctx.stroke();
  ctx.fillStyle = '#241f1a';
  ctx.font = `bold ${Math.round(s * 1.1)}px ${YAZI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', cx, cy + s * 0.18);
  ctx.restore();
}

// ---------------------------------------------------------------- kasalar/stok

export function sandik(ctx, x, y, s, renk) {
  ctx.fillStyle = renk;
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  ctx.beginPath();
  ctx.moveTo(x + 1, y + 1);
  ctx.lineTo(x + s - 1, y + s - 1);
  ctx.stroke();
}

/** Piramit sandık yığını — n görsel sandık, taban genişliği üçgen sayıdan */
export function sandikYigini(ctx, cx, tabanY, n, renk, s = 15) {
  if (n <= 0) return;
  let kalan = n;
  const tabanW = Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2);
  for (let sira = 0; sira < tabanW && kalan > 0; sira++) {
    const bu = Math.min(kalan, tabanW - sira);
    kalan -= bu;
    const y = tabanY - (sira + 1) * (s - 1);
    const x0 = cx - (bu * s) / 2 + (sira % 2 ? 3 : 0);
    for (let i = 0; i < bu; i++) sandik(ctx, x0 + i * s, y, s - 1, renk);
  }
}

/** Süpermarket (n1): sarı kasa rafları + kesikli saha çizgisi */
export function supermarket(ctx, gx, gy) {
  const x = gx * TILE, y = gy * TILE;
  const w = 3.5 * TILE, h = 2 * TILE;
  ctx.save();
  ctx.fillStyle = '#1f1e1b';
  ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
  ctx.strokeStyle = '#caa53d';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(x - 6, y - 6, w + 12, h + 12);
  ctx.setLineDash([]);
  // raf kasaları (2 kat × 3 göz)
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 3; i++) {
        sandik(ctx, x + 8 + k * (w / 3) + i * 16, y + 7 + r * 44, 14, '#b58f4a');
      }
    }
  }
  // sarı raf kolonları + kirişler (kasaların önünde)
  ctx.fillStyle = '#caa53d';
  for (let k = 0; k <= 3; k++) ctx.fillRect(x + k * (w / 3) - 2, y, 4, h);
  for (let r = 0; r < 2; r++) ctx.fillRect(x, y + 24 + r * 44, w, 5);
  // etiket
  ctx.font = `bold 12px ${YAZI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#caa53d';
  ctx.fillText('SÜPERMARKET · n1', x + w / 2, y + h + 16);
  ctx.restore();
}

/** AGV rota hattı (kesikli, Manhattan kırıklı yol) + durak noktaları.
 *  yol: köşeler dahil tüm çizgi noktaları; duraklar: yalnız yanaşma noktaları. */
export function rotaCiz(ctx, yol, idx = 0, duraklar = null) {
  if (!yol || yol.length < 2) return;
  const renk = idx % 2 ? 'rgba(120,190,255,0.30)' : 'rgba(232,193,112,0.30)';
  ctx.save();
  ctx.strokeStyle = renk;
  ctx.fillStyle = renk;
  ctx.lineWidth = 3;
  ctx.setLineDash([9, 12]);
  ctx.beginPath();
  ctx.moveTo(yol[0].x, yol[0].y);
  for (let i = 1; i < yol.length; i++) ctx.lineTo(yol[i].x, yol[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of duraklar || yol) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** AGV: gövde + sarı-siyah uyarı şeridi + üstte kasa yükü; durakta yükleme animasyonu */
export function agvCiz(ctx, x, y, aci, yukKasa, durakta, animT) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(aci);
  // tekerler
  ctx.fillStyle = '#15161a';
  for (const [dx, dy] of [[-12, -13], [5, -13], [-12, 9], [5, 9]]) ctx.fillRect(dx, dy, 8, 4);
  // gövde
  yuvarlakDikdortgen(ctx, -17, -11, 34, 22, 5);
  ctx.fillStyle = '#3a3f46';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#17191c';
  ctx.stroke();
  // ön sarı-siyah şerit
  ctx.fillStyle = '#d9a520';
  ctx.fillRect(10, -11, 7, 22);
  ctx.fillStyle = '#1c1c1c';
  for (let i = 0; i < 3; i++) ctx.fillRect(10, -7 + i * 8, 7, 4);
  ctx.restore();
  // yük kasaları (rotasyonsuz, üstte okunaklı)
  const nk = Math.max(0, Math.min(6, Math.ceil((yukKasa || 0) / 5)));
  const zipla = durakta ? Math.abs(Math.sin(animT * 7)) * 2.5 : 0;
  for (let i = 0; i < nk; i++) {
    sandik(ctx, x - 13 + (i % 3) * 9, y - 9 - Math.floor(i / 3) * 9 - zipla, 8.5, '#b58f4a');
  }
  // durakta yükleme halkası
  if (durakta) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,210,62,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 22 + Math.abs(Math.sin(animT * 4)) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Hat-yanı kasa rafı (future: hatYaniKasa) */
export function hatYaniRaf(ctx, x, y, kasa) {
  const w = 38, h = 46;
  ctx.fillStyle = '#26241f';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#4d4638';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#4d4638';
  ctx.fillRect(x, y + h / 2 - 2, w, 3);
  const n = Math.max(0, Math.min(8, Math.round(kasa || 0)));
  for (let i = 0; i < n; i++) {
    const kat = Math.floor(i / 4);
    const kol = i % 4;
    sandik(ctx, x + 3 + kol * 8.5, y + (kat === 0 ? h / 2 - 12 : h - 12), 8, '#b58f4a');
  }
}

/** Kırmızı hurda kutusu (Kaynak yanı; sayaç simState'te varsa çizilir) */
export function hurdaKutu(ctx, x, y) {
  ctx.fillStyle = '#7c2418';
  ctx.fillRect(x, y, 24, 18);
  ctx.strokeStyle = '#3a0f08';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, 24, 18);
  ctx.strokeStyle = '#c9c9c9';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + 10, y + 9);
  ctx.moveTo(x + 14, y + 3); ctx.lineTo(x + 19, y + 8);
  ctx.stroke();
}

/** Olay baloncuğu — t: {x, y, mesaj, tip, yas, omur, sabit?} */
export function baloncuk(ctx, t) {
  const RENK = {
    ariza: '#e06428', tamir: '#68b04a', setup: '#4a90d9',
    agvYukleme: '#d9a520', senaryoGecis: '#b9b9b9',
  };
  const kenar = RENK[t.tip] || '#888';
  const alfa = Math.max(0, Math.min(1, (t.omur - t.yas) / 0.6));
  const onek = t.tip === 'ariza' ? '⚠ ' : '';
  const metin = onek + String(t.mesaj || '').slice(0, 44);
  const yukselme = t.sabit ? 0 : Math.min(t.yas, 1) * 10;
  const y = t.y - (t.sabit ? 0 : 30) - yukselme;
  ctx.save();
  ctx.globalAlpha = alfa;
  ctx.font = `12px ${YAZI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(metin).width + 16;
  yuvarlakDikdortgen(ctx, t.x - w / 2, y - 11, w, 22, 6);
  ctx.fillStyle = 'rgba(16,14,12,0.92)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = kenar;
  ctx.stroke();
  if (!t.sabit) {
    ctx.beginPath();
    ctx.moveTo(t.x - 5, y + 11);
    ctx.lineTo(t.x + 5, y + 11);
    ctx.lineTo(t.x, y + 18);
    ctx.closePath();
    ctx.fillStyle = 'rgba(16,14,12,0.92)';
    ctx.fill();
  }
  ctx.fillStyle = '#f0ead9';
  ctx.fillText(metin, t.x, y);
  ctx.restore();
}
