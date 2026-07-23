// MetSac A.Ş. — Tanıtım turu (walkthrough): arayüz bölgelerini sırayla spotlight
// ile vurgulayıp ne işe yaradığını ve nasıl kullanılacağını anlatan overlay katmanı.
// Sözleşme: createWalkthrough(container, factoryData, { onAc, onKapat })
//   → { ac(adimIdx=0), kapat(), acikMi(), izlendiMi() }
// - onAc(): tur her açılışta bir kez — sim'i duraklatmak ana oturumun (main.js) işi.
// - onKapat(): tur her kapanışta bir kez — önceki hızı geri yüklemek ana oturumun işi.
// - Brifing'in aksine kendiliğinden AÇILMAZ: ilk-ziyaret akışını main.js kurar
//   (brifing kapanınca izlendiMi() bakılır). Bayrak: localStorage('ms-tur-izlendi').
// - Yalnız overlay: mevcut düzene/stile dokunmaz; görsel dil HUD/brifing ile aynı
//   (koyu yarı saydam panel, ince kenarlık, kehribar vurgu, monospace).
// Bağımlılık yok; CSS bu modülden <style id="mt-stil"> olarak enjekte edilir.
// Tüm fabrika sayıları factoryData'dan (data/factory.json) gelir — sayı gömülmez.

import { fmtTam, fmtOndalik, fmtYuzdeOran } from './story.js';

// ---------------------------------------------------------------------------
// SAF YARDIMCILAR (DOM'suz — node --test ile test edilir)
// ---------------------------------------------------------------------------

export const TUR_IZLENDI_ANAHTAR = 'ms-tur-izlendi';

/** Depo (localStorage benzeri) üzerinde "tur izlendi" bayrağı okunur. */
export function turIzlendiMi(depo) {
  try { return !!(depo && depo.getItem(TUR_IZLENDI_ANAHTAR)); } catch { return false; }
}

/** Bayrağı yazar (depo erişilemezse sessizce geçer). */
export function turIzlendiIsaretle(depo) {
  try { if (depo) depo.setItem(TUR_IZLENDI_ANAHTAR, '1'); } catch { /* özel mod vb. */ }
}

/** Adım sayacı metni (0-tabanlı indeks): sayacMetni(1, 7) → "2/7" */
export function sayacMetni(idx, toplam) {
  return `${idx + 1}/${toplam}`;
}

/**
 * Senaryo geçişinin oturma süresi (sim-gün): fazla WIP kanban limitine günlük
 * talep temposunda erir → (WIP_mevcut − WIP_hedef) / günlük talep ≈ 12 gün.
 */
export function gecisSuresiGun(fd) {
  const fark = fd.kpis.current.wipAdet - fd.kpis.future.wipAdet;
  if (!Number.isFinite(fark) || !(fd.gunlukTalep > 0)) return NaN;
  return Math.round(fark / fd.gunlukTalep);
}

/**
 * Spotlight dikdörtgeni: hedefin çevresine pay ekler, görünüme kırpar.
 * hedef: {left,top,right,bottom} (getBoundingClientRect uyumlu), gorunum: {width,height}.
 */
export function spotDikdortgen(hedef, gorunum, pay = 6) {
  const left = Math.max(0, hedef.left - pay);
  const top = Math.max(0, hedef.top - pay);
  const right = Math.min(gorunum.width, hedef.right + pay);
  const bottom = Math.min(gorunum.height, hedef.bottom + pay);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Sahnenin HUD panellerinden arta kalan (inset-dışı) bölgesi.
 * kenar: {left,top,bottom} px (main.js'in setViewInsets ölçüsüyle aynı mantık).
 */
export function sahneDikdortgeni(kenar, gorunum, pay = 10) {
  const left = (kenar.left || 0) + pay;
  const top = (kenar.top || 0) + pay;
  const right = Math.max(left + 40, gorunum.width - pay);
  const bottom = Math.max(top + 40, gorunum.height - (kenar.bottom || 0) - pay);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * Hedef rect spotlight için kullanılabilir mi? Eleman yoksa ya da görünmezse
 * (ör. mobilde kapalı çekmece: display:none → rect 0×0) kullanılamaz — tur
 * bu durumda "eleman yok" tam-ekran fallback'ine düşer.
 */
export function hedefRectGecerliMi(r) {
  return !!r && r.width > 0 && r.height > 0;
}

/**
 * Açıklama kartının konumu: hedefe çakışmadan alt → üst → sağ → sol sırasıyla
 * dener; hiçbiri çakışmasız sığmazsa ilk adayı görünüme kırpıp döner.
 * hedef: {left,top,right,bottom}, kart: {width,height}, gorunum: {width,height}.
 */
export function kartKonumu(hedef, kart, gorunum, bosluk = 12, kenarPay = 8) {
  const adaylar = [
    { left: hedef.left, top: hedef.bottom + bosluk },               // alt
    { left: hedef.left, top: hedef.top - kart.height - bosluk },    // üst
    { left: hedef.right + bosluk, top: hedef.top },                 // sağ
    { left: hedef.left - kart.width - bosluk, top: hedef.top },     // sol
  ];
  const sigdir = (p) => ({
    left: Math.max(kenarPay, Math.min(p.left, gorunum.width - kart.width - kenarPay)),
    top: Math.max(kenarPay, Math.min(p.top, gorunum.height - kart.height - kenarPay)),
  });
  const cakisiyor = (p) =>
    p.left < hedef.right && p.left + kart.width > hedef.left
    && p.top < hedef.bottom && p.top + kart.height > hedef.top;
  for (const aday of adaylar) {
    const p = sigdir(aday);
    if (!cakisiyor(p)) return p;
  }
  return sigdir(adaylar[0]);
}

/**
 * 7 adımlık turun veri modeli — sayılar factoryData'dan türetilir.
 * hedef: { secici, sira } (doc.querySelectorAll(secici)[sira]) ya da { sahne:true }.
 */
export function adimlariOlustur(fd) {
  const cur = fd.kpis.current;
  const kaynak = fd.stations.find((s) => s.id === 'kaynak');
  const zincir = fd.stations.map((s) => s.ad).join(' → ');

  return [
    {
      id: 'ust-serit',
      hedef: { secici: '.mh-ust', sira: 0 },
      baslik: '「Üst şerit — saat ve hız」',
      metin: 'Solda simülasyon saati: gün ve vardiya. Yanındaki düğmelerle zamanı '
        + 'yönetirsin: ⏸ duraklatır, 1000× sakin izleme temposudur, 100000× en hızlısıdır. '
        + '⟲ Sıfırla her şeyi başa alır.',
    },
    {
      id: 'senaryo',
      hedef: { secici: '.mh-ust .mh-grup', sira: 1 },
      baslik: '「Senaryo anahtarı」',
      metin: '「Mevcut (İtme)」 bugünkü MRP düzenini, 「Gelecek」 kanban + AGV milk-run '
        + '+ kestirimci bakım dönüşümünü çalıştırır. Geçişte stoklar bir anda değişmez: '
        + `fazla WIP kanban limitine doğal erir — iyileşme yaklaşık ${fmtTam(gecisSuresiGun(fd))} `
        + 'sim-günde oturur. Hızı artırıp geçişi izle.',
    },
    {
      id: 'kpi-karolar',
      hedef: { secici: '.mh-karolar', sira: 0 },
      baslik: '「KPI karoları」',
      metin: `Dört canlı gösterge: WIP (referans ${fmtTam(cur.wipAdet)}), temin süresi, `
        + `günlük çıktı ve Kaynak OEE (referans ${fmtYuzdeOran(cur.oee, 1)}). `
        + 'Ok (▲▼) mevcut-durum referansına göre yönü, senaryo geçişinden sonra beliren '
        + 'Δ çipi geçiş anına göre yüzde değişimi gösterir. Ayrıntılar sol paneldedir.',
    },
    {
      id: 'sahne',
      hedef: { sahne: true },
      baslik: '「Sahne — U-hat」',
      metin: `Beş istasyon (${zincir}) U-hat üzerinde çalışır; istasyon rengi durumunu `
        + 'söyler: yeşil çalışıyor, kırmızı arızalı, sarı bloke. Parçalar konveyörde akar; '
        + 'gelecek senaryoda AGV\'ler iç koridorda milk-run turu atar. Fare tekerleğiyle '
        + 'yakınlaş, basılı tutup sürükleyerek kaydır.',
    },
    {
      id: 'sol-panel',
      hedef: { secici: '.mh-sol', sira: 0 },
      baslik: '「Sol panel — detay ve sandbox」',
      metin: 'Yukarıdan aşağıya: KPI ayrıntıları, takt–çevrim çubukları '
        + `(${fmtTam(fd.taktSn)} sn çizgisini aşan ${kaynak.ad} darboğazdır), istasyon listesi `
        + '(satırın üzerine gel: çevrim, kullanılabilirlik, P-sorunları) ve Malzeme Editörü: '
        + 'buffer\'lara elle adet yazıp sorun yarat, sistemin çözüşünü izle. '
        + 'Panel başlığına tıklayarak daralt/genişlet.',
    },
    {
      id: 'zaman-merdiveni',
      hedef: { secici: '.mh-duvar', sira: 0 },
      baslik: '「Zaman merdiveni (castle-wall)」',
      metin: 'Üst basamaklar bekleme (NVA, gün), alt çentikler işlem (VA, sn). '
        + `Toplam temin süresi ve PCE buradan okunur: ${fmtOndalik(cur.leadTimeGun, 1)} günün `
        + `yalnızca ${fmtTam(cur.katmaDegerliSn)} saniyesi katma değerli. İmleci basamakların `
        + 'üzerinde gezdir — her basamak kendi ipucunu gösterir.',
    },
    {
      id: 'olay-seridi',
      hedef: { secici: '.mh-altlog', sira: 0 },
      baslik: '「Olay şeridi」',
      metin: 'En son olay burada tek satırda akar: arıza ⚠, tamir ⚒, hazırlık ⏱, '
        + 'senaryo geçişi ⇄, müdahale ✎. Şeride tıklayınca son 8 olay listelenir. '
        + 'Tur bitti — iyi vardiyalar!',
    },
  ];
}

// ---------------------------------------------------------------------------
// GÖRSEL SABİTLER (brifing/HUD ile aynı dil — sayılar factory.json'dan)
// ---------------------------------------------------------------------------

const RENK = {
  murekkepBirincil: '#f2f0e6',
  murekkepIkincil: '#c3c2b7',
  soluk: '#898781',
  vurgu: '#e8c170',   // Factorio kehribar
  yuzey: '#0d0d0b',
};

const CSS = `
.mt-ortu { position:absolute; inset:0; z-index:55;
  font:12px/1.6 ui-monospace, "SF Mono", Menlo, monospace; color:${RENK.murekkepBirincil}; }
.mt-spot { position:absolute; border:1px solid rgba(232,193,112,0.9); border-radius:3px;
  box-shadow:0 0 0 200vmax rgba(4,4,3,0.72), inset 0 0 14px rgba(232,193,112,0.18);
  transition:left .25s ease, top .25s ease, width .25s ease, height .25s ease;
  pointer-events:none; }
.mt-kart { position:absolute; width:340px; max-width:calc(100vw - 24px);
  display:flex; flex-direction:column; background:${RENK.yuzey};
  border:1px solid rgba(232,193,112,0.4); border-radius:4px;
  box-shadow:0 0 0 3px rgba(0,0,0,0.55), 0 16px 48px rgba(0,0,0,0.7);
  transition:left .25s ease, top .25s ease; }
.mt-ust { display:flex; align-items:center; gap:8px; padding:5px 10px;
  background:rgba(255,255,255,0.05); border-bottom:1px solid rgba(255,255,255,0.12);
  font-size:10px; letter-spacing:2px; text-transform:uppercase; color:${RENK.soluk}; }
.mt-kapat { margin-left:auto; background:none; border:1px solid rgba(255,255,255,0.18);
  border-radius:2px; color:${RENK.murekkepIkincil}; font:inherit; letter-spacing:1px;
  padding:1px 7px; cursor:pointer; }
.mt-kapat:hover { background:rgba(255,255,255,0.1); color:${RENK.murekkepBirincil}; }
.mt-govde { padding:10px 14px 8px; max-height:min(300px, calc(100vh - 140px));
  overflow-y:auto; scrollbar-width:thin; }
.mt-baslik { font-size:14px; font-weight:700; letter-spacing:0.5px; color:${RENK.vurgu};
  margin:0 0 6px; }
.mt-metin { margin:0; color:${RENK.murekkepIkincil}; }
.mt-alt { display:flex; align-items:flex-end; gap:8px; padding:8px 10px;
  border-top:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.03); }
.mt-nav { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2);
  border-radius:2px; color:${RENK.murekkepBirincil}; font:inherit; padding:3px 11px;
  cursor:pointer; }
.mt-nav:hover:not(:disabled) { background:rgba(255,255,255,0.16); }
.mt-nav:disabled { opacity:0.35; cursor:default; }
.mt-nav.mt-bitir { background:${RENK.vurgu}; border-color:${RENK.vurgu}; color:#151009;
  font-weight:700; }
.mt-nav.mt-bitir:hover { filter:brightness(1.08); }
.mt-sayac { margin-left:auto; font-size:9px; color:${RENK.soluk};
  font-variant-numeric:tabular-nums; letter-spacing:1px; }
`;

// ---------------------------------------------------------------------------
// createWalkthrough
// ---------------------------------------------------------------------------

export function createWalkthrough(container, factoryData, { onAc, onKapat } = {}) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;

  if (!doc.getElementById('mt-stil')) {
    const stil = doc.createElement('style');
    stil.id = 'mt-stil';
    stil.textContent = CSS;
    doc.head.appendChild(stil);
  }

  const el = (etiket, sinif, metin) => {
    const e = doc.createElement(etiket);
    if (sinif) e.className = sinif;
    if (metin != null) e.textContent = metin;
    return e;
  };

  function depo() {
    try { return win ? win.localStorage : null; } catch { return null; }
  }

  const adimlar = adimlariOlustur(factoryData);

  let ortu = null;              // overlay kökü (açıkken)
  let spot = null, kart = null, baslikEl = null, metinEl = null;
  let geriBtn = null, ileriBtn = null, sayacEl = null;
  let adimIdx = 0;

  function gorunum() {
    return { width: win.innerWidth, height: win.innerHeight };
  }

  // Hedef bölgenin ekran dikdörtgeni; sahne adımı HUD inset'lerinden türetilir.
  function hedefRect(hedef) {
    const g = gorunum();
    if (hedef.sahne) {
      const sol = doc.querySelector('.mh-sol');
      const ust = doc.querySelector('.mh-ust');
      const alt = doc.querySelector('.mh-duvar') || doc.querySelector('.mh-altlog');
      return sahneDikdortgeni({
        left: sol ? sol.getBoundingClientRect().right : 0,
        top: ust ? ust.getBoundingClientRect().bottom : 0,
        bottom: alt ? Math.max(0, g.height - alt.getBoundingClientRect().top) : 0,
      }, g);
    }
    const e = doc.querySelectorAll(hedef.secici)[hedef.sira || 0];
    const r = e && e.getBoundingClientRect();
    // eleman yok YA DA görünmez (mobilde kapalı çekmece: 0×0) → tam-ekran fallback
    if (!hedefRectGecerliMi(r)) return { left: 8, top: 8, right: g.width - 8, bottom: g.height - 8 };
    return r;
  }

  function adimGoster(idx) {
    adimIdx = Math.max(0, Math.min(adimlar.length - 1, idx));
    const adim = adimlar[adimIdx];
    baslikEl.textContent = adim.baslik;
    metinEl.textContent = adim.metin;
    sayacEl.textContent = sayacMetni(adimIdx, adimlar.length);
    geriBtn.disabled = adimIdx === 0;
    const son = adimIdx === adimlar.length - 1;
    ileriBtn.textContent = son ? 'Bitir ✓' : 'İleri ›';
    ileriBtn.classList.toggle('mt-bitir', son);
    konumla();
  }

  // Spotlight + kart konumu (adım değişimi ve pencere boyutu değişiminde)
  function konumla() {
    if (!ortu) return;
    const g = gorunum();
    const hedef = hedefRect(adimlar[adimIdx].hedef);
    const s = spotDikdortgen(hedef, g);
    spot.style.left = s.left + 'px';
    spot.style.top = s.top + 'px';
    spot.style.width = s.width + 'px';
    spot.style.height = s.height + 'px';
    // kart boyutu içerik yerleştikten sonra ölçülür (offsetWidth layout tetikler)
    const k = kartKonumu(
      { left: s.left, top: s.top, right: s.left + s.width, bottom: s.top + s.height },
      { width: kart.offsetWidth, height: kart.offsetHeight }, g);
    kart.style.left = k.left + 'px';
    kart.style.top = k.top + 'px';
  }

  function tusla(e) {
    if (!ortu) return;
    if (e.key === 'Escape') { e.preventDefault(); kapat(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); ileri(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); adimGoster(adimIdx - 1); }
  }

  function ileri() {
    if (adimIdx >= adimlar.length - 1) kapat();
    else adimGoster(adimIdx + 1);
  }

  // --- API ---
  function ac(baslangicIdx = 0) {
    if (ortu) { adimGoster(baslangicIdx); return; }

    ortu = el('div', 'mt-ortu');
    spot = el('div', 'mt-spot');
    ortu.appendChild(spot);

    kart = el('div', 'mt-kart');
    kart.setAttribute('role', 'dialog');
    kart.setAttribute('aria-modal', 'true');
    kart.setAttribute('aria-label', 'Tanıtım turu');

    const ust = el('div', 'mt-ust');
    ust.appendChild(el('span', null, '▸ Tanıtım Turu'));
    const kapatBtn = el('button', 'mt-kapat', 'Kapat [Esc]');
    kapatBtn.addEventListener('click', () => kapat());
    ust.appendChild(kapatBtn);
    kart.appendChild(ust);

    const govde = el('div', 'mt-govde');
    baslikEl = el('h2', 'mt-baslik');
    metinEl = el('p', 'mt-metin');
    govde.appendChild(baslikEl);
    govde.appendChild(metinEl);
    kart.appendChild(govde);

    const alt = el('div', 'mt-alt');
    geriBtn = el('button', 'mt-nav', '‹ Geri');
    geriBtn.addEventListener('click', () => adimGoster(adimIdx - 1));
    alt.appendChild(geriBtn);
    ileriBtn = el('button', 'mt-nav', 'İleri ›');
    ileriBtn.addEventListener('click', ileri);
    alt.appendChild(ileriBtn);
    sayacEl = el('span', 'mt-sayac');
    alt.appendChild(sayacEl);
    kart.appendChild(alt);

    ortu.appendChild(kart);
    container.appendChild(ortu);
    doc.addEventListener('keydown', tusla, true);
    win.addEventListener('resize', konumla);

    if (typeof onAc === 'function') onAc();
    adimGoster(baslangicIdx);
  }

  function kapat() {
    if (!ortu) return;
    doc.removeEventListener('keydown', tusla, true);
    win.removeEventListener('resize', konumla);
    ortu.remove();
    ortu = null; spot = null; kart = null; baslikEl = null; metinEl = null;
    geriBtn = null; ileriBtn = null; sayacEl = null;
    turIzlendiIsaretle(depo());
    if (typeof onKapat === 'function') onKapat();
  }

  function acikMi() { return !!ortu; }

  return { ac, kapat, acikMi, izlendiMi: () => turIzlendiMi(depo()) };
}
