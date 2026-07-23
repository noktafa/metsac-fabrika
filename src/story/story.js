// MetSac A.Ş. — Açılış hikâyesi / mission briefing katmanı (tam ekran overlay)
// Sözleşme: createStory(container, factoryData, { onBitti, onSenaryoSec })
//   → { ac(sayfaIdx=0), kapat(), acikMi(), izlendiMi() }
// - onBitti(): overlay her kapanışta (atla, Esc, senaryo seçimi, kapat()) bir kez çağrılır.
// - onSenaryoSec('current'|'future'): yalnız son sayfadaki seçim butonlarında çağrılır
//   (onBitti'den ÖNCE), böylece ana oturum senaryoyu kurup sonra kapanışı işleyebilir.
// - İlk ziyarette createStory overlay'i kendisi açar; localStorage('ms-story-izlendi')
//   işaretliyse otomatik açılmaz — ama ac() ile her zaman yeniden açılabilir.
// Bağımlılık yok; CSS bu modülden <style id="ms-stil"> olarak enjekte edilir.
// Tüm sayılar factoryData'dan (data/factory.json) gelir — bu dosyaya sayı gömülmez.

// ---------------------------------------------------------------------------
// SAF YARDIMCILAR (DOM'suz — node --test ile test edilir)
// ---------------------------------------------------------------------------

const _fmtTam = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const _fmtOndalikCache = new Map();

/** Tam sayı, Türkçe binlik ayraç: 14315 → "14.315" */
export function fmtTam(v) {
  if (!Number.isFinite(v)) return '—';
  return _fmtTam.format(Math.round(v));
}

/** Ondalıklı sayı, Türkçe biçim: fmtOndalik(93.8, 1) → "93,8" */
export function fmtOndalik(v, basamak = 1) {
  if (!Number.isFinite(v)) return '—';
  let nf = _fmtOndalikCache.get(basamak);
  if (!nf) {
    nf = new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: basamak, maximumFractionDigits: basamak,
    });
    _fmtOndalikCache.set(basamak, nf);
  }
  return nf.format(v);
}

/** 0..1 oranı yüzdeye çevirir: fmtYuzdeOran(0.684) → "%68,4" */
export function fmtYuzdeOran(oran, basamak = 1) {
  if (!Number.isFinite(oran)) return '—';
  return '%' + fmtOndalik(oran * 100, basamak);
}

/** Zaten yüzde-değer olan sayıyı biçimler: fmtYuzdeDeger(0.026, 3) → "%0,026" (PCE) */
export function fmtYuzdeDeger(v, basamak = 3) {
  if (!Number.isFinite(v)) return '—';
  return '%' + fmtOndalik(v, basamak);
}

/** AGV milk-run hat-yanı stok azalışı (%): en-az-trafik ucu → diz noktası. 56,4→22,8 ⇒ 60 */
export function stokAzalisYuzde(agv) {
  const once = agv?.pareto?.enAzTrafik?.stokKasa;
  const sonra = agv?.pareto?.diz?.stokKasa;
  if (!Number.isFinite(once) || !Number.isFinite(sonra) || once <= 0) return NaN;
  return Math.round(((once - sonra) / once) * 100);
}

/** İstasyon id → akış şeması ikonu (görsel sabit — serbest) */
export function istasyonIkonu(id) {
  const IKON = { kesme: '✂', bukme: '∠', kaynak: '⚡', boya: '▨', montaj: '⚙' };
  return IKON[id] || '■';
}

export const IZLENDI_ANAHTAR = 'ms-story-izlendi';

/** Depo (localStorage benzeri) üzerinde "brifing izlendi" bayrağı okunur. */
export function izlendiMi(depo) {
  try { return !!(depo && depo.getItem(IZLENDI_ANAHTAR)); } catch { return false; }
}

/** Bayrağı yazar (depo erişilemezse sessizce geçer). */
export function izlendiIsaretle(depo) {
  try { if (depo) depo.setItem(IZLENDI_ANAHTAR, '1'); } catch { /* özel mod vb. */ }
}

/**
 * 5 sayfalık brifingin veri modeli — tamamı factoryData'dan türetilir.
 * Render katmanı bu modeli aptalca DOM'a çevirir; sayılar burada biçimlenir.
 */
export function sayfalariOlustur(fd) {
  const cur = fd.kpis.current;
  const fut = fd.kpis.future;
  const kaynak = fd.stations.find((s) => s.id === 'kaynak');
  const bukme = fd.stations.find((s) => s.id === 'bukme');
  const bakim = fd.maintenance;

  const akis = fd.stations.map((s) => ({
    id: s.id, ad: s.ad, ikon: istasyonIkonu(s.id), darbogaz: !!s.darbogaz,
  }));

  return [
    // ---- 1 ----------------------------------------------------------------
    {
      id: 'tesis',
      baslik: '「MetSac A.Ş.」',
      paragraflar: [
        'Beyaz eşya yan sanayisine sac-metal taşıyıcı braket üreten bir tesis. '
        + 'Parça, ana müşterinin buzdolabı ve çamaşır makinesi gövdesine giriyor. '
        + 'Üretim beş istasyonlu tek bir akıştan geçiyor:',
      ],
      akis: akis.map((a) => ({ ...a, vurgu: false })),
      vurgular: [
        { etiket: 'Aylık talep', deger: `${fmtTam(fd.aylikTalep)} adet` },
        { etiket: 'Takt süresi', deger: `${fmtTam(fd.taktSn)} sn` },
      ],
      dipCumle: `Talebe yetişmek için hattan her ${fmtTam(fd.taktSn)} saniyede bir braket çıkmalı.`,
    },
    // ---- 2 ----------------------------------------------------------------
    {
      id: 'sorun',
      baslik: '「Sorun: Hat tıkanıyor」',
      paragraflar: [],
      akis: akis.map((a) => ({ ...a, vurgu: a.darbogaz })),
      teshis: `Kaynak: etkin çevrim ${fmtOndalik(kaynak.etkinCevrimSn, 1)} sn > takt `
        + `${fmtTam(fd.taktSn)} sn → kapasite açığı %${fmtTam(kaynak.kapasiteAcigiYuzde)}. `
        + 'Darboğaz hattın tamamını kendi temposuna mahkûm ediyor.',
      problemler: fd.problems.map((p) => ({
        id: p.id, aciklama: p.aciklama, gosterge: p.gosterge,
      })),
    },
    // ---- 3 ----------------------------------------------------------------
    {
      id: 'bedel',
      baslik: '「Bedeli」',
      paragraflar: [],
      kartlar: [
        { buyuk: fmtTam(cur.wipAdet), birim: 'adet', etiket: 'Ara stok (WIP)' },
        { buyuk: fmtOndalik(cur.leadTimeGun, 1), birim: 'gün', etiket: 'Temin süresi' },
        { buyuk: fmtYuzdeOran(cur.oee, 1), birim: '', etiket: 'Kaynak OEE' },
        { buyuk: fmtYuzdeDeger(cur.pceYuzde, 3), birim: '', etiket: 'Süreç çevrim verimliliği (PCE)' },
      ],
      alinti: `Bir parça ${fmtOndalik(cur.leadTimeGun, 1)} günün yalnızca `
        + `${fmtTam(cur.katmaDegerliSn)} saniyesinde işleniyor — kalan zamanın tamamı bekleme.`,
    },
    // ---- 4 ----------------------------------------------------------------
    {
      id: 'plan',
      baslik: '「Plan: Önce yalın, sonra Endüstri 4.0」',
      paragraflar: [],
      katmanlar: [
        {
          ad: 'Katman 1 — Yalın',
          maddeler: [
            `SMED: Bükme'de kalıp değişimi ${fmtTam(bukme.setupDk)} → ${fmtTam(fut.bukmeSetupDk)} dk`,
            'Kanban + süpermarket: itme yerine çekme — temin süresi '
              + `${fmtOndalik(cur.leadTimeGun, 1)} → ${fmtOndalik(fut.leadTimeGun, 1)} gün`,
          ],
        },
        {
          ad: 'Katman 2 — Endüstri 4.0',
          maddeler: [
            `AGV milk-run: ${fmtTam(fd.agv.aracSayisi)} araç, vardiyada `
              + `${fmtTam(fd.agv.pareto.diz.tur)} tur — hat-yanı stok %${fmtTam(stokAzalisYuzde(fd.agv))} azalır`,
            `Yapay zekâ kestirimci bakım: arızaların ${fmtYuzdeOran(bakim.etki.recall, 0)}'i `
              + 'önceden yakalanır → Kaynak kullanılabilirliği '
              + `${fmtYuzdeOran(bakim.mevcut.kullanilabilirlik, 0)} → ${fmtYuzdeOran(bakim.etki.kullanilabilirlikYeni, 1)}`,
          ],
        },
      ],
      hedef: `Hedef: WIP → ${fmtTam(fut.wipAdet)} adet · temin ${fmtOndalik(fut.leadTimeGun, 1)} gün `
        + `· OEE ${fmtYuzdeOran(fut.oee, 1)}`,
    },
    // ---- 5 ----------------------------------------------------------------
    {
      id: 'izle',
      baslik: '「Şimdi izle」',
      paragraflar: [
        'Fabrikayı bugünkü hâliyle izlemeye başla; hazır olduğunda üst şeritteki '
        + 'anahtardan geleceğe geç.',
      ],
      butonlar: [
        { senaryo: 'current', metin: 'Mevcut durumu izle', varsayilan: true },
        { senaryo: 'future', metin: 'Doğrudan geleceği gör', varsayilan: false },
      ],
      dipnot: fd.meta && fd.meta.not ? fd.meta.not : '',
    },
  ];
}

// ---------------------------------------------------------------------------
// GÖRSEL SABİTLER (renkler HUD katmanıyla aynı dil — sayılar factory.json'dan)
// ---------------------------------------------------------------------------

const RENK = {
  murekkepBirincil: '#f2f0e6',
  murekkepIkincil: '#c3c2b7',
  soluk: '#898781',
  vurgu: '#e8c170',   // Factorio kehribar
  kotu: '#d03b3b',
  iyi: '#0ca30c',
  yuzey: '#0d0d0b',
};

const CSS = `
.ms-ortu { position:absolute; inset:0; z-index:60; display:flex; align-items:center;
  justify-content:center; background:rgba(4,4,3,0.93);
  font:12px/1.6 ui-monospace, "SF Mono", Menlo, monospace; color:${RENK.murekkepBirincil}; }
.ms-panel { width:min(700px, calc(100vw - 32px)); max-height:calc(100vh - 48px);
  display:flex; flex-direction:column; background:${RENK.yuzey};
  border:1px solid rgba(232,193,112,0.4); border-radius:4px;
  box-shadow:0 0 0 4px rgba(0,0,0,0.55), 0 24px 64px rgba(0,0,0,0.75); }

.ms-ust { display:flex; align-items:center; gap:8px; padding:6px 12px;
  background:rgba(255,255,255,0.05); border-bottom:1px solid rgba(255,255,255,0.12);
  font-size:10px; letter-spacing:2px; text-transform:uppercase; color:${RENK.soluk}; }
.ms-ust .ms-sayfa-no { margin-left:auto; letter-spacing:1px; font-variant-numeric:tabular-nums; }
.ms-atla { background:none; border:1px solid rgba(255,255,255,0.18); border-radius:2px;
  color:${RENK.murekkepIkincil}; font:inherit; letter-spacing:1px; padding:2px 8px; cursor:pointer; }
.ms-atla:hover { background:rgba(255,255,255,0.1); color:${RENK.murekkepBirincil}; }

.ms-govde { padding:18px 22px 14px; overflow-y:auto; scrollbar-width:thin; }
.ms-baslik { font-size:19px; font-weight:700; letter-spacing:1px; color:${RENK.vurgu};
  margin:0 0 12px; min-height:1.35em; }
.ms-yazi::after { content:'▌'; color:${RENK.vurgu}; animation:ms-yanip 0.9s steps(1) infinite; }
@keyframes ms-yanip { 50% { opacity:0; } }
@media (prefers-reduced-motion: reduce) { .ms-yazi::after { animation:none; } }
.ms-p { margin:0 0 12px; color:${RENK.murekkepIkincil}; }

/* --- akış şeması --- */
.ms-akis { display:flex; align-items:stretch; gap:4px; flex-wrap:wrap; margin:6px 0 14px; }
.ms-kutu { flex:1; min-width:74px; display:flex; flex-direction:column; align-items:center;
  gap:3px; padding:8px 4px; border:1px solid rgba(255,255,255,0.2); border-radius:3px;
  background:rgba(255,255,255,0.04); }
.ms-kutu .ms-ikon { font-size:16px; line-height:1; }
.ms-kutu .ms-ad { font-size:10px; letter-spacing:1px; text-transform:uppercase;
  color:${RENK.murekkepIkincil}; }
.ms-kutu.ms-darbogaz { border-color:${RENK.kotu}; background:rgba(208,59,59,0.14);
  box-shadow:0 0 10px rgba(208,59,59,0.35); }
.ms-kutu.ms-darbogaz .ms-ad, .ms-kutu.ms-darbogaz .ms-ikon { color:${RENK.kotu}; }
.ms-ok { align-self:center; color:${RENK.soluk}; padding:0 1px; }

/* --- vurgular / diagnostik --- */
.ms-vurgular { display:flex; gap:10px; flex-wrap:wrap; margin:2px 0 10px; }
.ms-vurgu { flex:1; min-width:180px; border:1px solid rgba(255,255,255,0.14); border-radius:3px;
  padding:7px 10px; background:rgba(255,255,255,0.03); }
.ms-vurgu .ms-etiket { font-size:10px; letter-spacing:1px; text-transform:uppercase;
  color:${RENK.soluk}; }
.ms-vurgu .ms-deger { font-size:16px; font-weight:700; color:${RENK.murekkepBirincil};
  font-variant-numeric:tabular-nums; }
.ms-dip-cumle { color:${RENK.vurgu}; margin:0; }
.ms-teshis { border-left:3px solid ${RENK.kotu}; padding:6px 10px; margin:0 0 12px;
  background:rgba(208,59,59,0.08); color:${RENK.murekkepBirincil}; }

/* --- problem kartları --- */
.ms-problemler { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));
  gap:6px; }
.ms-problem { border:1px solid rgba(255,255,255,0.14); border-radius:3px; padding:6px 8px;
  background:rgba(255,255,255,0.03); font-size:11px; }
.ms-problem .ms-pid { color:${RENK.vurgu}; font-weight:700; margin-right:5px; }
.ms-problem .ms-gosterge { display:block; color:${RENK.soluk}; font-size:10px; margin-top:2px; }

/* --- büyük rakam kartları --- */
.ms-kartlar { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));
  gap:8px; margin:4px 0 14px; }
.ms-kart { border:1px solid rgba(255,255,255,0.16); border-radius:3px; text-align:center;
  padding:12px 6px 9px; background:rgba(255,255,255,0.03); }
.ms-kart .ms-buyuk { font-size:24px; font-weight:700; color:${RENK.murekkepBirincil};
  font-variant-numeric:tabular-nums; line-height:1.1; }
.ms-kart .ms-birim { font-size:11px; color:${RENK.murekkepIkincil}; margin-left:3px; }
.ms-kart .ms-etiket { display:block; margin-top:5px; font-size:10px; letter-spacing:1px;
  text-transform:uppercase; color:${RENK.soluk}; }
.ms-alinti { border-left:3px solid ${RENK.vurgu}; padding:6px 10px; margin:0;
  color:${RENK.murekkepIkincil}; font-style:italic; }

/* --- plan katmanları --- */
.ms-katman { border:1px solid rgba(255,255,255,0.14); border-radius:3px; margin-bottom:8px; }
.ms-katman-bas { padding:5px 10px; background:rgba(255,255,255,0.05); color:${RENK.vurgu};
  font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; }
.ms-katman ul { margin:0; padding:7px 10px 8px 24px; color:${RENK.murekkepIkincil}; }
.ms-katman li { margin:2px 0; }
.ms-hedef { border-left:3px solid ${RENK.iyi}; padding:6px 10px; margin:12px 0 0;
  background:rgba(12,163,12,0.08); color:${RENK.murekkepBirincil}; font-weight:700;
  font-variant-numeric:tabular-nums; }

/* --- son sayfa --- */
.ms-secimler { display:flex; gap:10px; flex-wrap:wrap; margin:14px 0 4px; }
.ms-secim { flex:1; min-width:190px; font:inherit; padding:10px 12px; cursor:pointer;
  border-radius:3px; border:1px solid rgba(255,255,255,0.25);
  background:rgba(255,255,255,0.06); color:${RENK.murekkepBirincil}; letter-spacing:0.5px; }
.ms-secim:hover { background:rgba(255,255,255,0.14); }
.ms-secim.ms-varsayilan { background:${RENK.vurgu}; border-color:${RENK.vurgu};
  color:#151009; font-weight:700; }
.ms-secim.ms-varsayilan:hover { filter:brightness(1.08); }
.ms-dipnot { margin-top:14px; font-size:9px; color:${RENK.soluk}; }

/* --- alt gezinme --- */
.ms-alt { display:flex; align-items:center; gap:10px; padding:9px 12px;
  border-top:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.03); }
.ms-nav { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2);
  border-radius:2px; color:${RENK.murekkepBirincil}; font:inherit; padding:4px 12px;
  cursor:pointer; }
.ms-nav:hover:not(:disabled) { background:rgba(255,255,255,0.16); }
.ms-nav:disabled { opacity:0.35; cursor:default; }
.ms-nav.ms-gizli { visibility:hidden; }
.ms-noktalar { display:flex; gap:7px; margin:0 auto; }
.ms-nokta { width:8px; height:8px; border-radius:50%; border:1px solid ${RENK.soluk};
  background:transparent; padding:0; cursor:pointer; }
.ms-nokta.ms-aktif { background:${RENK.vurgu}; border-color:${RENK.vurgu}; }
.ms-ipucu { font-size:9px; color:${RENK.soluk}; }
`;

// ---------------------------------------------------------------------------
// createStory
// ---------------------------------------------------------------------------

export function createStory(container, factoryData, { onBitti, onSenaryoSec } = {}) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;

  // CSS enjeksiyonu (bir kez)
  if (!doc.getElementById('ms-stil')) {
    const stil = doc.createElement('style');
    stil.id = 'ms-stil';
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

  const sayfalar = sayfalariOlustur(factoryData);

  let ortu = null;             // overlay kök elementi (açıkken)
  let govde = null, baslikEl = null, sayfaNoEl = null;
  let geriBtn = null, ileriBtn = null, noktaBtnler = [];
  let sayfaIdx = 0;
  let bittiTetiklendi = false;
  let yaziZamanlayici = null;

  // --- daktilo efekti (prefers-reduced-motion'a saygılı) ---
  function daktilo(hedefEl, metin) {
    if (yaziZamanlayici) { clearInterval(yaziZamanlayici); yaziZamanlayici = null; }
    hedefEl.classList.remove('ms-yazi');
    const azHareket = !!(win && win.matchMedia
      && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (azHareket || !win) { hedefEl.textContent = metin; return; }
    hedefEl.textContent = '';
    hedefEl.classList.add('ms-yazi');
    let i = 0;
    yaziZamanlayici = win.setInterval(() => {
      i += 1;
      hedefEl.textContent = metin.slice(0, i);
      if (i >= metin.length) {
        win.clearInterval(yaziZamanlayici);
        yaziZamanlayici = null;
        hedefEl.classList.remove('ms-yazi');
      }
    }, 26);
  }

  // --- sayfa gövdesi kurucuları ---
  function akisSemasi(akis) {
    const kap = el('div', 'ms-akis');
    akis.forEach((a, i) => {
      if (i > 0) kap.appendChild(el('span', 'ms-ok', '→'));
      const kutu = el('div', 'ms-kutu' + (a.vurgu ? ' ms-darbogaz' : ''));
      kutu.appendChild(el('span', 'ms-ikon', a.ikon));
      kutu.appendChild(el('span', 'ms-ad', a.ad));
      kap.appendChild(kutu);
    });
    return kap;
  }

  function sayfaGovdesiKur(sayfa) {
    const parca = doc.createDocumentFragment();
    for (const p of sayfa.paragraflar || []) parca.appendChild(el('p', 'ms-p', p));

    if (sayfa.akis) parca.appendChild(akisSemasi(sayfa.akis));

    if (sayfa.vurgular) {
      const kap = el('div', 'ms-vurgular');
      for (const v of sayfa.vurgular) {
        const kutu = el('div', 'ms-vurgu');
        kutu.appendChild(el('span', 'ms-etiket', v.etiket));
        kutu.appendChild(el('div', 'ms-deger', v.deger));
        kap.appendChild(kutu);
      }
      parca.appendChild(kap);
    }
    if (sayfa.dipCumle) parca.appendChild(el('p', 'ms-dip-cumle', sayfa.dipCumle));

    if (sayfa.teshis) parca.appendChild(el('p', 'ms-teshis', sayfa.teshis));
    if (sayfa.problemler) {
      const kap = el('div', 'ms-problemler');
      for (const p of sayfa.problemler) {
        const kart = el('div', 'ms-problem');
        kart.appendChild(el('span', 'ms-pid', p.id));
        kart.appendChild(doc.createTextNode(p.aciklama));
        kart.appendChild(el('span', 'ms-gosterge', p.gosterge));
        kap.appendChild(kart);
      }
      parca.appendChild(kap);
    }

    if (sayfa.kartlar) {
      const kap = el('div', 'ms-kartlar');
      for (const k of sayfa.kartlar) {
        const kart = el('div', 'ms-kart');
        const b = el('span', 'ms-buyuk', k.buyuk);
        kart.appendChild(b);
        if (k.birim) b.appendChild(el('span', 'ms-birim', k.birim));
        kart.appendChild(el('span', 'ms-etiket', k.etiket));
        kap.appendChild(kart);
      }
      parca.appendChild(kap);
    }
    if (sayfa.alinti) parca.appendChild(el('p', 'ms-alinti', sayfa.alinti));

    if (sayfa.katmanlar) {
      for (const kat of sayfa.katmanlar) {
        const kap = el('div', 'ms-katman');
        kap.appendChild(el('div', 'ms-katman-bas', kat.ad));
        const ul = el('ul');
        for (const m of kat.maddeler) ul.appendChild(el('li', null, m));
        kap.appendChild(ul);
        parca.appendChild(kap);
      }
    }
    if (sayfa.hedef) parca.appendChild(el('p', 'ms-hedef', sayfa.hedef));

    if (sayfa.butonlar) {
      const kap = el('div', 'ms-secimler');
      for (const b of sayfa.butonlar) {
        const btn = el('button', 'ms-secim' + (b.varsayilan ? ' ms-varsayilan' : ''),
          `「${b.metin}」`);
        btn.addEventListener('click', () => {
          if (typeof onSenaryoSec === 'function') onSenaryoSec(b.senaryo);
          kapat();
        });
        kap.appendChild(btn);
      }
      parca.appendChild(kap);
    }
    if (sayfa.dipnot) parca.appendChild(el('p', 'ms-dipnot', sayfa.dipnot));

    return parca;
  }

  function sayfaGoster(idx) {
    sayfaIdx = Math.max(0, Math.min(sayfalar.length - 1, idx));
    const sayfa = sayfalar[sayfaIdx];
    govde.textContent = '';
    govde.appendChild(baslikEl);
    daktilo(baslikEl, sayfa.baslik);
    govde.appendChild(sayfaGovdesiKur(sayfa));
    govde.scrollTop = 0;

    sayfaNoEl.textContent = `${sayfaIdx + 1} / ${sayfalar.length}`;
    geriBtn.disabled = sayfaIdx === 0;
    ileriBtn.classList.toggle('ms-gizli', sayfaIdx === sayfalar.length - 1);
    noktaBtnler.forEach((n, i) => n.classList.toggle('ms-aktif', i === sayfaIdx));
  }

  // --- klavye: ←/→ sayfa, Esc = atla ---
  function tusla(e) {
    if (!ortu) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); sayfaGoster(sayfaIdx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); sayfaGoster(sayfaIdx - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); kapat(); }
  }

  // --- API ---
  function ac(baslangicIdx = 0) {
    if (ortu) { sayfaGoster(baslangicIdx); return; }
    bittiTetiklendi = false;

    ortu = el('div', 'ms-ortu');
    const panel = el('div', 'ms-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Görev brifingi');

    const ust = el('div', 'ms-ust');
    ust.appendChild(el('span', null, '▸ Görev Brifingi'));
    sayfaNoEl = el('span', 'ms-sayfa-no');
    ust.appendChild(sayfaNoEl);
    const atlaBtn = el('button', 'ms-atla', 'Brifingi Atla [Esc]');
    atlaBtn.addEventListener('click', () => kapat());
    ust.appendChild(atlaBtn);
    panel.appendChild(ust);

    govde = el('div', 'ms-govde');
    baslikEl = el('h1', 'ms-baslik');
    govde.appendChild(baslikEl);
    panel.appendChild(govde);

    const alt = el('div', 'ms-alt');
    geriBtn = el('button', 'ms-nav', '‹ Geri');
    geriBtn.addEventListener('click', () => sayfaGoster(sayfaIdx - 1));
    alt.appendChild(geriBtn);
    const noktalar = el('div', 'ms-noktalar');
    noktaBtnler = sayfalar.map((s, i) => {
      const n = el('button', 'ms-nokta');
      n.title = s.baslik;
      n.addEventListener('click', () => sayfaGoster(i));
      noktalar.appendChild(n);
      return n;
    });
    alt.appendChild(noktalar);
    alt.appendChild(el('span', 'ms-ipucu', '←/→ sayfa · Esc atla'));
    ileriBtn = el('button', 'ms-nav', 'İleri ›');
    ileriBtn.addEventListener('click', () => sayfaGoster(sayfaIdx + 1));
    alt.appendChild(ileriBtn);
    panel.appendChild(alt);

    ortu.appendChild(panel);
    container.appendChild(ortu);
    doc.addEventListener('keydown', tusla, true);
    sayfaGoster(baslangicIdx);
  }

  function kapat() {
    if (!ortu) return;
    if (yaziZamanlayici) { clearInterval(yaziZamanlayici); yaziZamanlayici = null; }
    doc.removeEventListener('keydown', tusla, true);
    ortu.remove();
    ortu = null; govde = null; baslikEl = null; sayfaNoEl = null;
    geriBtn = null; ileriBtn = null; noktaBtnler = [];
    izlendiIsaretle(depo());
    if (!bittiTetiklendi) {
      bittiTetiklendi = true;
      if (typeof onBitti === 'function') onBitti();
    }
  }

  function acikMi() { return !!ortu; }

  // İlk ziyaret: kendiliğinden aç (ikinci ziyarette localStorage bayrağı engeller).
  if (!izlendiMi(depo())) ac(0);

  return { ac, kapat, acikMi, izlendiMi: () => izlendiMi(depo()) };
}
