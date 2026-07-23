// MetSac A.Ş. — görsel katman (Factorio hissiyatlı top-down tile render).
// Sözleşme: createRenderer(canvas, factoryData) → { draw(simState, realDtSn), resize(), screenToTile(px, py) }
// Simülasyon mantığına dokunmaz; yalnızca simState okur. Harici asset yok.

import { TILE, computeFitRect, zoomAt } from './camera.js';
import { createParticles } from './particles.js';
import {
  formatAdet, formatKasa, formatSure,
  crateCountFor, bufferRatio, bufferRenk, lerp,
} from './format.js';
import * as spr from './sprites.js';

const YAZI = 'ui-monospace, Menlo, monospace';

export function createRenderer(canvas, factoryData) {
  const ctx = canvas.getContext('2d');
  const belge = canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const dprAl = () => (typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1);

  // ---------------------------------------------------------- yerleşim (U-hat)
  const istasyonlar = (factoryData.stations || []).map(s => ({
    id: s.id,
    ad: s.ad,
    darbogaz: !!s.darbogaz,
    gx: s.grid.x, gy: s.grid.y,
    px: s.grid.x * TILE, py: s.grid.y * TILE,
    cx: (s.grid.x + 1.5) * TILE, cy: (s.grid.y + 1.5) * TILE,
  }));
  const istById = Object.fromEntries(istasyonlar.map(s => [s.id, s]));
  // Süpermarket (n1) U'nun İÇ koridorunda: yalnız future'da çizilir ve iç bölgede
  // kaldığı için dünya bbox'ını büyütmez (P7 — mevcut senaryoda ölü bant bırakmaz).
  const N1 = { gx: 5, gy: 8 };
  // sıra ayrımı (üst/alt) — AGV yanaşma yönü ve raf konumu için
  const ortaGy = istasyonlar.reduce((t, s) => t + s.gy, 0) / Math.max(1, istasyonlar.length);
  const altSira = (s) => s.gy > ortaGy;

  // hat akış yönü: aynı sıradaki komşu istasyonlardan türetilir (+1 doğu, -1 batı)
  const akisYon = {};
  for (const f of factoryData.flow || []) {
    const a = f.oncekiIstasyon ? istById[f.oncekiIstasyon] : null;
    const b = f.sonrakiIstasyon ? istById[f.sonrakiIstasyon] : null;
    if (a && b && a.gy === b.gy) {
      const d = Math.sign(b.gx - a.gx) || 1;
      if (!akisYon[a.id]) akisYon[a.id] = d;
      if (!akisYon[b.id]) akisYon[b.id] = d;
    }
  }

  // Bir flow kaydı için bant orta-hattı (dünya px, Manhattan kırıklı çizgi).
  // Aynı sıra: düz yatay. Farklı sıra: istasyondan akış yönünde çık, hattın
  // dışındaki dönüş kolonundan dikey in, hedefe akış yönünün tersinden gir (U dönüşü).
  const KUYRUK = 3 * TILE; // uçtaki stok kuyruğu uzunluğu
  function bantRota(f) {
    const onc = f.oncekiIstasyon ? istById[f.oncekiIstasyon] : null;
    const son = f.sonrakiIstasyon ? istById[f.sonrakiIstasyon] : null;
    if (!onc && son) { // ham madde kuyruğu — hattın giriş yönünden yanaşır
      const d = akisYon[son.id] || 1;
      const y = (son.gy + 1.5) * TILE;
      const giris = (d > 0 ? son.gx : son.gx + 3) * TILE;
      return [{ x: giris - d * KUYRUK, y }, { x: giris, y }];
    }
    if (onc && !son) { // bitmiş ürün kuyruğu — akış yönünde devam eder
      const d = akisYon[onc.id] || 1;
      const y = (onc.gy + 1.5) * TILE;
      const cikis = (d > 0 ? onc.gx + 3 : onc.gx) * TILE;
      return [{ x: cikis, y }, { x: cikis + d * KUYRUK, y }];
    }
    if (onc.gy === son.gy) { // aynı sıra: düz yatay bant
      const d = Math.sign(son.gx - onc.gx) || 1;
      const y = (onc.gy + 1.5) * TILE;
      return [
        { x: (d > 0 ? onc.gx + 3 : onc.gx) * TILE, y },
        { x: (d > 0 ? son.gx : son.gx + 3) * TILE, y },
      ];
    }
    // sıra değişimi: iki köşeli U dönüşü
    const d1 = akisYon[onc.id] || 1;
    const d2 = akisYon[son.id] || -d1;
    const y1 = (onc.gy + 1.5) * TILE;
    const y2 = (son.gy + 1.5) * TILE;
    const cikis = (d1 > 0 ? onc.gx + 3 : onc.gx) * TILE;
    const giris = (d2 > 0 ? son.gx : son.gx + 3) * TILE;
    const kx = d1 > 0
      ? Math.max(cikis, giris) + 1.5 * TILE
      : Math.min(cikis, giris) - 1.5 * TILE;
    return [{ x: cikis, y: y1 }, { x: kx, y: y1 }, { x: kx, y: y2 }, { x: giris, y: y2 }];
  }

  // kırıklı çizgi → yön/uzunluk bilgili segment listesi
  function segsYap(yol) {
    const segs = [];
    let uz = 0;
    for (let i = 0; i < yol.length - 1; i++) {
      const p = yol[i], q = yol[i + 1];
      const len = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      if (len < 1e-6) continue;
      segs.push({ p, q, dx: Math.sign(q.x - p.x), dy: Math.sign(q.y - p.y), len, s0: uz });
      uz += len;
    }
    return { segs, uz };
  }

  const istOrtaX = istasyonlar.length
    ? istasyonlar.reduce((t, s) => t + s.cx, 0) / istasyonlar.length
    : 0;

  // sandık yığını çapası: bandın orta noktası; yatayda bandın altı, dikeyde iç yan
  function yiginYeri(segs, uz) {
    let sg = segs[0];
    for (const s of segs) if (uz / 2 >= s.s0 && uz / 2 <= s.s0 + s.len) { sg = s; break; }
    const d = uz / 2 - sg.s0;
    const x = sg.p.x + sg.dx * d, y = sg.p.y + sg.dy * d;
    if (sg.dy !== 0) { // dikey segment: yığın dünya merkezine bakan yanda
      const ic = x > istOrtaX ? -1 : 1;
      return { x: x + ic * 1.85 * TILE, y: y + 0.55 * TILE };
    }
    return { x, y: y + 1.55 * TILE };
  }

  const bantlar = (factoryData.flow || []).map(f => {
    const { segs, uz } = segsYap(bantRota(f));
    return {
      id: f.id, segs, uz,
      yigin: yiginYeri(segs, uz),
      kaynakIst: f.oncekiIstasyon || null,
      hedefIst: f.sonrakiIstasyon || null,
    };
  });

  // istasyon → giriş buffer'ı (darboğaz üçgeni için)
  const girisBufferi = {};
  for (const b of bantlar) if (b.hedefIst) girisBufferi[b.hedefIst] = b.id;

  // ---------------------------------------------------------- dünya sınırları
  // İçerik bbox'ı sıkı hesaplanır (istasyonlar + etiketleri, bant hatları,
  // yığınlar); N1 iç koridorda olduğundan ayrıca genişletmez (P7).
  let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity;
  for (const s of istasyonlar) {
    minTx = Math.min(minTx, s.gx); maxTx = Math.max(maxTx, s.gx + 3);
    minTy = Math.min(minTy, s.gy); maxTy = Math.max(maxTy, s.gy + 3.55); // + isim etiketi
  }
  for (const b of bantlar) {
    for (const sg of b.segs) {
      for (const p of [sg.p, sg.q]) {
        minTx = Math.min(minTx, p.x / TILE - 0.5); maxTx = Math.max(maxTx, p.x / TILE + 0.5);
        minTy = Math.min(minTy, p.y / TILE - 0.5); maxTy = Math.max(maxTy, p.y / TILE + 0.5);
      }
    }
    minTx = Math.min(minTx, b.yigin.x / TILE - 1.1); maxTx = Math.max(maxTx, b.yigin.x / TILE + 1.1);
    maxTy = Math.max(maxTy, b.yigin.y / TILE + 0.4); // + adet etiketi
  }
  const dunya = {
    x: (minTx - 0.75) * TILE,
    y: (minTy - 1.85) * TILE, // uyarı üçgeni / ilerleme halkası / olay baloncuğu payı
    w: (maxTx - minTx + 1.5) * TILE,
    h: (maxTy - minTy + 2.85) * TILE,
  };

  // ---------------------------------------------------------- statik katman (offscreen)
  // Dünya rect'ini (negatif koordinatlar dahil) örtecek şekilde ötelenmiş çizilir.
  let statik = null;
  const statikOrig = { x: Math.floor(dunya.x), y: Math.floor(dunya.y) };
  (function statikKur() {
    if (!belge || typeof belge.createElement !== 'function') return;
    const c = belge.createElement('canvas');
    c.width = Math.ceil(dunya.w) + 2;
    c.height = Math.ceil(dunya.h) + 2;
    const g = c.getContext('2d');
    if (!g) return;
    g.translate(-statikOrig.x, -statikOrig.y);
    // koyu beton zemin
    g.fillStyle = '#1a1a1a';
    g.fillRect(statikOrig.x, statikOrig.y, c.width, c.height);
    let tohum = 987654321;
    const rnd = () => ((tohum = (tohum * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // yağ lekeleri
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(0,0,0,${(0.05 + rnd() * 0.08).toFixed(3)})`;
      g.beginPath();
      g.ellipse(statikOrig.x + rnd() * c.width, statikOrig.y + rnd() * c.height,
        20 + rnd() * 70, 12 + rnd() * 40, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // beton gürültüsü
    for (let i = 0; i < 2600; i++) {
      const a = rnd();
      g.fillStyle = a > 0.5
        ? `rgba(255,255,255,${(0.015 + rnd() * 0.03).toFixed(3)})`
        : `rgba(0,0,0,${(0.04 + rnd() * 0.05).toFixed(3)})`;
      g.fillRect(statikOrig.x + rnd() * c.width, statikOrig.y + rnd() * c.height, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // ızgara çizgileri (dünya tile'larına hizalı)
    g.strokeStyle = 'rgba(255,255,255,0.028)';
    g.lineWidth = 1;
    const x0 = Math.floor(statikOrig.x / TILE) * TILE;
    const y0 = Math.floor(statikOrig.y / TILE) * TILE;
    for (let x = x0; x <= statikOrig.x + c.width; x += TILE) {
      g.beginPath(); g.moveTo(x + 0.5, statikOrig.y); g.lineTo(x + 0.5, statikOrig.y + c.height); g.stroke();
    }
    for (let y = y0; y <= statikOrig.y + c.height; y += TILE) {
      g.beginPath(); g.moveTo(statikOrig.x, y + 0.5); g.lineTo(statikOrig.x + c.width, y + 0.5); g.stroke();
    }
    // bant zeminleri + istasyon kaideleri
    for (const b of bantlar) spr.bantZemin(g, b);
    for (const s of istasyonlar) spr.istasyonKaide(g, s.px, s.py);
    statik = c;
  })();

  // ---------------------------------------------------------- kamera + girdi
  let cam = { zoom: 1, x: 0, y: 0 };
  let oturdu = false;
  let kullaniciOynadi = false; // elle zoom/pan yapıldıysa resize'da kamerayı bozma
  // HUD'un kapladığı kenar boşlukları (CSS px) — sahne kalan alana sığdırılır
  let insets = { left: 0, top: 0, right: 0, bottom: 0 };

  function gorunumBoyu() {
    // inset:0 canvas = görüntü alanı; clientWidth layout oturmadan 0 dönebilir,
    // o durumda pencere boyutuna düş.
    const g = typeof globalThis.innerWidth === 'number' ? globalThis : null;
    return {
      vw: canvas.clientWidth || (g ? g.innerWidth : 800),
      vh: canvas.clientHeight || (g ? g.innerHeight : 600),
    };
  }

  function sigdir() {
    const { vw, vh } = gorunumBoyu();
    cam = computeFitRect(dunya, {
      x: insets.left,
      y: insets.top,
      w: Math.max(64, vw - insets.left - insets.right),
      h: Math.max(64, vh - insets.top - insets.bottom),
    });
    oturdu = true;
  }

  if (typeof canvas.addEventListener === 'function') {
    let surukle = null;
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      kullaniciOynadi = true;
      const r = canvas.getBoundingClientRect();
      cam = zoomAt(cam, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0012));
    }, { passive: false });
    canvas.addEventListener('mousedown', (e) => { surukle = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('mousemove', (e) => {
      if (!surukle) return;
      kullaniciOynadi = true;
      cam.x -= (e.clientX - surukle.x) / cam.zoom;
      cam.y -= (e.clientY - surukle.y) / cam.zoom;
      surukle = { x: e.clientX, y: e.clientY };
    });
    for (const t of ['mouseup', 'mouseleave']) {
      canvas.addEventListener(t, () => { surukle = null; });
    }
    // çift tık: hatta geri sığdır ve otomatik sığdırmayı yeniden devreye al
    canvas.addEventListener('dblclick', () => { kullaniciOynadi = false; sigdir(); });

    // ---- dokunmatik kamera: tek parmak pan, iki parmak pinch, çift dokunuş sığdır
    // Pinch çarpanı: iki parmak arası mesafenin bir önceki kareye oranı (saf hesap).
    const pinchCarpan = (oncekiMesafe, yeniMesafe) =>
      (oncekiMesafe > 0 ? yeniMesafe / oncekiMesafe : 1);
    // İki dokunuşun canvas'a göre orta noktası (CSS px) ve aralarındaki mesafe.
    function pinchOzet(t1, t2) {
      const r = canvas.getBoundingClientRect();
      return {
        ox: (t1.clientX + t2.clientX) / 2 - r.left,
        oy: (t1.clientY + t2.clientY) / 2 - r.top,
        mesafe: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
      };
    }
    let dokunmaPan = null; // tek parmak sürükleme { x, y }
    let pinch = null;      // iki parmak durumu { ox, oy, mesafe }
    let tapBas = null;     // tap adayı (basılan yer/zaman) { t, x, y }
    let sonTap = null;     // çift dokunuş algısı için önceki tap { t, x, y }

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        dokunmaPan = { x: t.clientX, y: t.clientY };
        tapBas = { t: Date.now(), x: t.clientX, y: t.clientY };
        pinch = null;
      } else if (e.touches.length >= 2) {
        dokunmaPan = null;
        tapBas = null; // ikinci parmak indi: artık tap değil
        pinch = pinchOzet(e.touches[0], e.touches[1]);
      }
    });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault(); // sayfa kaydırmasını/tarayıcı zoom'unu engelle
      if (e.touches.length >= 2) {
        const yeni = pinchOzet(e.touches[0], e.touches[1]);
        if (pinch) {
          kullaniciOynadi = true;
          cam = zoomAt(cam, yeni.ox, yeni.oy, pinchCarpan(pinch.mesafe, yeni.mesafe));
          // orta noktanın kayması da pan: harita parmakların altında kalsın
          cam.x -= (yeni.ox - pinch.ox) / cam.zoom;
          cam.y -= (yeni.oy - pinch.oy) / cam.zoom;
        }
        pinch = yeni;
        dokunmaPan = null;
      } else if (e.touches.length === 1 && dokunmaPan) {
        const t = e.touches[0];
        kullaniciOynadi = true;
        cam.x -= (t.clientX - dokunmaPan.x) / cam.zoom;
        cam.y -= (t.clientY - dokunmaPan.y) / cam.zoom;
        dokunmaPan = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });
    for (const tip of ['touchend', 'touchcancel']) {
      canvas.addEventListener(tip, (e) => {
        if (e.touches.length >= 2) { pinch = pinchOzet(e.touches[0], e.touches[1]); return; }
        pinch = null;
        if (e.touches.length === 1) {
          // pinch'ten tek parmağa dönüş: pan kesintisiz sürsün
          const t = e.touches[0];
          dokunmaPan = { x: t.clientX, y: t.clientY };
          return;
        }
        dokunmaPan = null;
        // çift dokunuş: ~300ms içinde, <30px aralıkla iki kısa tap → yeniden sığdır
        if (tip === 'touchend' && tapBas) {
          const dk = e.changedTouches && e.changedTouches[0];
          const kisaVeSabit = dk && Date.now() - tapBas.t < 300 &&
            Math.hypot(dk.clientX - tapBas.x, dk.clientY - tapBas.y) < 30;
          if (kisaVeSabit) {
            if (sonTap && tapBas.t - sonTap.t < 300 &&
                Math.hypot(tapBas.x - sonTap.x, tapBas.y - sonTap.y) < 30) {
              sonTap = null;
              kullaniciOynadi = false;
              sigdir();
            } else {
              sonTap = { t: tapBas.t, x: tapBas.x, y: tapBas.y };
            }
          } else {
            sonTap = null;
          }
        }
        tapBas = null;
      });
    }
  }

  // ---------------------------------------------------------- durum (yalnız görsel)
  const parcacik = createParticles(100);
  let animT = 0;
  const gorulenOlay = new Set();
  const toastlar = [];
  let ilkKare = true;

  function olayIsle(simState) {
    const olaylar = simState.olaylar || [];
    for (const o of olaylar) {
      const k = `${o.tSn}|${o.tip}|${o.istasyon ?? ''}|${o.mesaj}`;
      if (gorulenOlay.has(k)) continue;
      gorulenOlay.add(k);
      if (ilkKare) continue; // açılışta eski logu baloncuk yapma
      const ist = o.istasyon ? istById[o.istasyon] : null;
      toastlar.push({
        mesaj: o.mesaj, tip: o.tip,
        x: ist ? ist.cx : null,
        y: ist ? ist.py - 28 : null,
        yas: 0, omur: 3,
      });
      if (toastlar.length > 6) toastlar.shift();
    }
    if (gorulenOlay.size > 400) {
      gorulenOlay.clear();
      for (const o of olaylar) gorulenOlay.add(`${o.tSn}|${o.tip}|${o.istasyon ?? ''}|${o.mesaj}`);
    }
    ilkKare = false;
  }

  // AGV yanaşma noktaları U'nun İÇ koridorunda: üst sıra alttan, alt sıra üstten.
  // Böylece milk-run rotası U hattın çevresini içeriden sarar (motor sadece
  // durak adları + ilerleme verir; geometri tamamen burada eşlenir).
  function durakKonum(id) {
    if (id === 'n1') return { x: (N1.gx + 1.75) * TILE, y: (N1.gy - 0.5) * TILE };
    const s = istById[id];
    if (!s) return null;
    return altSira(s)
      ? { x: s.cx, y: (s.gy - 0.75) * TILE }
      : { x: s.cx, y: (s.gy + 3.75) * TILE };
  }

  // İki durak arası görsel yol: Manhattan (önce koridor boyunca yatay, sonra dikey)
  function bacakYolu(p, q) {
    if (Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6) return [p, q];
    return [p, { x: q.x, y: p.y }, q];
  }

  function yolUzunluk(yol) {
    let u = 0;
    for (let i = 0; i < yol.length - 1; i++) {
      u += Math.abs(yol[i + 1].x - yol[i].x) + Math.abs(yol[i + 1].y - yol[i].y);
    }
    return u;
  }

  function yolNoktaAci(yol, s) {
    let kalan = Math.max(0, s);
    for (let i = 0; i < yol.length - 1; i++) {
      const p = yol[i], q = yol[i + 1];
      const len = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      if (kalan <= len || i === yol.length - 2) {
        const t = len > 0 ? Math.min(1, kalan / len) : 0;
        return { x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t), aci: Math.atan2(q.y - p.y, q.x - p.x) };
      }
      kalan -= len;
    }
    return { x: yol[0].x, y: yol[0].y, aci: 0 };
  }

  // AGV'nin tüm milk-run turunun görsel yolu (rota çizimi için)
  function rotaYolu(noktalar) {
    const yol = [];
    for (let i = 0; i < noktalar.length - 1; i++) {
      const seg = bacakYolu(noktalar[i], noktalar[i + 1]);
      if (i === 0) yol.push(seg[0]);
      for (let k = 1; k < seg.length; k++) yol.push(seg[k]);
    }
    return yol;
  }

  function agvPoz(a, noktalar) {
    if (!noktalar.length) return null;
    const i = Math.max(0, Math.min(a.durakIdx || 0, noktalar.length - 1));
    const j = (i + 1) % noktalar.length;
    const p = noktalar[i], q = noktalar[j];
    if (!p || !q) return null;
    if (a.durumda === 'durakta') return { x: p.x, y: p.y, aci: 0 };
    const yol = bacakYolu(p, q);
    const t = Math.max(0, Math.min(1, a.ilerleme || 0));
    return yolNoktaAci(yol, t * yolUzunluk(yol));
  }

  function etiket(txt, cx, cy, renk = '#e8e4dc', boy = 12) {
    ctx.font = `${boy}px ${YAZI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(txt).width + 10;
    spr.yuvarlakDikdortgen(ctx, cx - w / 2, cy - boy / 2 - 3, w, boy + 6, 4);
    ctx.fillStyle = 'rgba(12,11,10,0.72)';
    ctx.fill();
    ctx.fillStyle = renk;
    ctx.fillText(txt, cx, cy + 1);
  }

  // ---------------------------------------------------------- ana çizim
  function draw(simState, realDtSn) {
    const dt = Math.max(0, Math.min(realDtSn || 0, 0.1));
    animT += dt;
    if (!oturdu) sigdir();

    const dpr = dprAl();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      dpr * cam.zoom, 0, 0, dpr * cam.zoom,
      -cam.x * dpr * cam.zoom, -cam.y * dpr * cam.zoom
    );
    ctx.imageSmoothingEnabled = false;

    const ist = simState.istasyonlar || {};
    const buf = simState.bufferlar || {};
    const hiz = Math.min(3, Math.max(0.4, simState.hiz || 1)); // bant görsel hızı (sınırlı)

    // 1) statik zemin (önbellekli)
    if (statik) ctx.drawImage(statik, 0, 0);

    // 2) bantlar: hareketli şerit + akan braketler
    const bantOfset = animT * 42 * hiz;
    for (const b of bantlar) {
      spr.bantSeritler(ctx, b, bantOfset);
      const kaynakSt = b.kaynakIst ? ist[b.kaynakIst] : null;
      const akiyor = kaynakSt ? kaynakSt.durum === 'calisiyor' : (buf[b.id] || 0) > 0;
      if (akiyor) spr.bantParcalari(ctx, b, bantOfset);
    }

    // 3) buffer yığınları (sandık piramidi, log ölçek; sarı→kırmızı) + adet etiketi
    for (const b of bantlar) {
      const adet = buf[b.id] ?? 0;
      const n = crateCountFor(adet);
      const oran = bufferRatio(adet);
      if (n > 0) spr.sandikYigini(ctx, b.yigin.x, b.yigin.y, n, bufferRenk(oran));
      etiket(formatAdet(adet), b.yigin.x, b.yigin.y + 14, oran > 0.85 ? '#ff9a86' : '#e8e4dc', 11);
    }

    // 4) süpermarket + AGV rotaları + araçlar (future)
    const agvler = simState.agvler || [];
    if (simState.senaryo === 'future' || agvler.length > 0) {
      spr.supermarket(ctx, N1.gx, N1.gy);
      for (let i = 0; i < agvler.length; i++) {
        const a = agvler[i];
        const noktalar = (a.durakSirasi || []).map(durakKonum).filter(Boolean);
        spr.rotaCiz(ctx, rotaYolu(noktalar), i, noktalar);
        const poz = agvPoz(a, noktalar);
        if (poz) {
          spr.agvCiz(ctx, poz.x, poz.y, poz.aci, a.yukKasa || 0, a.durumda === 'durakta', animT);
          etiket(a.id || 'AGV', poz.x, poz.y - 30, '#ffd23e', 10);
        }
      }
    }

    // 5) istasyonlar + durum görselleri
    for (const s of istasyonlar) {
      const st = ist[s.id] || { durum: 'bosta', cevrimIlerleme: 0, uretilenAdet: 0, kalanDurusSn: null, hatYaniKasa: null };

      // hat-yanı kasa rafı (sağ kenar, bandın dış yanı: üst sırada üst, alt sırada alt köşe)
      if (typeof st.hatYaniKasa === 'number') {
        const rx = s.px + 3 * TILE + 6;
        const ry = altSira(s) ? s.py + 3 * TILE - 48 : s.py + 2;
        spr.hatYaniRaf(ctx, rx, ry, st.hatYaniKasa);
        etiket(formatKasa(st.hatYaniKasa), rx + 19, ry + 58, '#cfe3ff', 10);
      }

      spr.istasyonCiz(ctx, s, st, animT);

      // isim + kümülatif üretim
      etiket(`${s.ad} · ${formatAdet(st.uretilenAdet || 0)}`, s.cx, s.py + 3 * TILE + 13, '#c9c4ba', 11);

      // çevrim ilerlemesi (çalışırken) / durum rozeti (diğer haller)
      if (st.durum === 'calisiyor') {
        spr.ilerlemeHalka(ctx, s.cx, s.py - 17, 10, st.cevrimIlerleme || 0);
      } else if (st.durum && st.durum !== 'bosta') {
        spr.durumRozet(ctx, s.cx, s.py - 17, st.durum);
      }

      // kalan duruş sayacı
      if (st.kalanDurusSn != null && (st.durum === 'arizali' || st.durum === 'setup')) {
        etiket(formatSure(st.kalanDurusSn), s.cx + 38, s.py - 17,
          st.durum === 'setup' ? '#9cc7f0' : '#ffb08a', 10);
      }

      // arıza parçacıkları (kıvılcım + duman)
      if (st.durum === 'arizali') {
        if (Math.random() < dt * 9) parcacik.kivilcim(s.cx + (Math.random() - 0.5) * 60, s.cy + (Math.random() - 0.5) * 40);
        if (Math.random() < dt * 4) parcacik.duman(s.cx + (Math.random() - 0.5) * 40, s.py + 14);
      }

      // hurda kutusu — sayaç simState'te varsa çiz (sözleşmede yok; ileriye dönük)
      const hurda = st.hurdaAdet ?? st.hurda;
      if (typeof hurda === 'number') {
        spr.hurdaKutu(ctx, s.px - 30, s.py + 3 * TILE - 20);
        etiket(formatAdet(hurda), s.px - 18, s.py + 3 * TILE + 6, '#ff9a86', 10);
      }

      // DARBOĞAZ: giriş buffer'ı taşarken yanıp sönen uyarı üçgeni
      const girisId = girisBufferi[s.id];
      const girisAdet = girisId ? (buf[girisId] || 0) : 0;
      if (s.darbogaz && girisAdet > (factoryData.gunlukTalep || 800)) {
        spr.uyariUcgen(ctx, s.cx, s.py - 48, 15, Math.floor(animT * 3) % 2 === 0);
      }
    }

    // 6) parçacıklar
    parcacik.guncelle(dt);
    parcacik.ciz(ctx);

    // 7) olay baloncukları
    olayIsle(simState);
    for (let i = toastlar.length - 1; i >= 0; i--) {
      toastlar[i].yas += dt;
      if (toastlar[i].yas > toastlar[i].omur) toastlar.splice(i, 1);
    }
    for (const t of toastlar) {
      if (t.x != null) spr.baloncuk(ctx, t);
    }

    // 8) istasyonsuz olaylar: ekran-üstü şerit (dünyadan bağımsız)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let ustY = insets.top + 10; // KPI karolu üst şeridin altından başla, arkasına saklanma
    const ekranOrta = (canvas.width / dpr) / 2;
    for (const t of toastlar) {
      if (t.x == null) {
        spr.baloncuk(ctx, { ...t, x: ekranOrta, y: ustY + 11, sabit: true });
        ustY += 32;
      }
    }
  }

  // ---------------------------------------------------------- API
  function resize() {
    const dpr = dprAl();
    const { vw, vh } = gorunumBoyu();
    canvas.width = Math.max(1, Math.round(vw * dpr));
    canvas.height = Math.max(1, Math.round(vh * dpr));
    // Kullanıcı elle gezinmediği sürece her boyut değişiminde hattı yeniden sığdır —
    // aksi hâlde küçük pencerede yüklenen sahne, pencere büyüyünce sol üstte kalıyordu.
    if (!kullaniciOynadi) sigdir();
  }

  function screenToTile(px, py) {
    return {
      x: Math.floor((cam.x + px / cam.zoom) / TILE),
      y: Math.floor((cam.y + py / cam.zoom) / TILE),
    };
  }

  // HUD katmanının kapladığı kenarları bildir (main.js ölçer);
  // kullanıcı elle gezinmediyse sahne kalan alana yeniden sığdırılır.
  function setViewInsets(yeni) {
    const n = {
      left: Math.max(0, yeni?.left || 0),
      top: Math.max(0, yeni?.top || 0),
      right: Math.max(0, yeni?.right || 0),
      bottom: Math.max(0, yeni?.bottom || 0),
    };
    const degisti = n.left !== insets.left || n.top !== insets.top ||
      n.right !== insets.right || n.bottom !== insets.bottom;
    insets = n;
    if (degisti && !kullaniciOynadi) sigdir();
  }

  // Tanılama (headless ölçüm/ayar için; sözleşme yüzeyine ek, davranış değiştirmez)
  function getDebug() {
    return { cam: { ...cam }, dunya: { ...dunya }, insets: { ...insets } };
  }

  return { draw, resize, screenToTile, setViewInsets, getDebug };
}
