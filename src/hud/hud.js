// MetSac A.Ş. — HUD katmanı (DOM, canvas sahnesinin üzerine biner)
// Sözleşme: createHud(container, sim, factoryData) → { update(simState) }
// Sim'e yalnız setSpeed / setScenario / getSpeed / reset ile dokunur; simState'i okur.
// Bağımlılık yok; CSS bu modülden <style> olarak enjekte edilir (index.html'e dokunulmaz).

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

/** Zaten yüzde-değer olan sayıyı biçimler: fmtYuzdeDeger(0.026) → "%0,026" (PCE) */
export function fmtYuzdeDeger(v, basamak = 3) {
  if (!Number.isFinite(v)) return '—';
  return '%' + fmtOndalik(v, basamak);
}

/**
 * Canlı değerin referansa göre yönünün İYİ mi KÖTÜ mü olduğu.
 * DİKKAT: WIP / lead time / birikmiş sipariş gibi metriklerde DÜŞÜŞ iyidir (dususIyi=true).
 * Dönüş: 'iyi' | 'kotu' | 'esit'
 */
export function farkYonu(canli, referans, dususIyi = false) {
  if (!Number.isFinite(canli) || !Number.isFinite(referans)) return 'esit';
  const esik = Math.max(1e-9, Math.abs(referans) * 0.001);
  if (Math.abs(canli - referans) <= esik) return 'esit';
  const dusmus = canli < referans;
  return (dusmus === dususIyi) ? 'iyi' : 'kotu';
}

/** Fiili yön oku: artış '▲', düşüş '▼', eşit '•' (renk farkYonu'ndan gelir, oktan değil). */
export function farkOku(canli, referans) {
  if (!Number.isFinite(canli) || !Number.isFinite(referans)) return '•';
  const esik = Math.max(1e-9, Math.abs(referans) * 0.001);
  if (Math.abs(canli - referans) <= esik) return '•';
  return canli > referans ? '▲' : '▼';
}

/** Senaryoya göre etkin çevrim (sn). Future'da yalnız Kaynak değişir (paralel robot: 40,8). */
export function etkinCevrimSn(istasyon, senaryo, factoryData) {
  if (senaryo === 'future' && istasyon.id === 'kaynak') {
    return factoryData.kpis.future.kaynakEtkinCevrimSn;
  }
  return istasyon.etkinCevrimSn;
}

/** Senaryoya göre kullanılabilirlik. Future'da Kaynak hedefi %92, Bükme SMED sonrası setup 8 dk. */
export function kullanilabilirlik(istasyon, senaryo, factoryData) {
  if (senaryo === 'future' && istasyon.id === 'kaynak') {
    return factoryData.kpis.future.kaynakKullanilabilirlikHedef;
  }
  return istasyon.kullanilabilirlik;
}

const DURUM_ETIKET = {
  calisiyor: 'Çalışıyor', bloke: 'Bloke', ac: 'Aç (besleme yok)',
  arizali: 'Arızalı', setup: 'Hazırlık (setup)', bosta: 'Boşta',
};

/** simState durum kodu → Türkçe etiket */
export function durumEtiketi(durum) {
  return DURUM_ETIKET[durum] || durum || '—';
}

/** Üst şerit saati: gun ondalıklı → "Gün 3 · Vardiya 1" */
export function gunVardiyaMetni(gun, vardiya) {
  return `Gün ${Math.floor(gun) + 1} · Vardiya ${vardiya}`;
}

/** Olay günlüğü zaman damgası: tSn → "G2 01:01" (gün içi iş-saati hh:mm) */
export function logZamanMetni(tSn, gunlukSureSn = 54000) {
  const gun = Math.floor(tSn / gunlukSureSn) + 1;
  const kalan = Math.max(0, tSn - (gun - 1) * gunlukSureSn);
  const ss = Math.floor(kalan / 3600);
  const dd = Math.floor((kalan % 3600) / 60);
  const p2 = (n) => String(n).padStart(2, '0');
  return `G${gun} ${p2(ss)}:${p2(dd)}`;
}

/** Senaryoya göre katma değerli (VA) işlem süresi — nominal çevrim (rapordaki 250 sn'nin bileşenleri). */
export function vaSn(istasyon, senaryo, factoryData) {
  if (senaryo === 'future' && istasyon.id === 'kaynak') {
    return factoryData.kpis.future.kaynakNominalCevrimSn;
  }
  return istasyon.cevrimSn;
}

/**
 * Buffer bekleme süresi (NVA, gün). Motor istasyon-başı bekleme süresi yayınlamaz;
 * bekleme = buffer adedi × takt (66 sn) türetimidir — takt temposunda akan hatta
 * Little Yasası'nın buffer-başı hâli (adet / günlük talep). Rapor stoklarıyla
 * flow[].beklemeGun değerlerini birebir geri verir (ör. 3.272 × 66 / 54.000 ≈ 4,0 gün).
 */
export function nvaGun(adet, taktSn, gunlukSureSn) {
  if (!Number.isFinite(adet) || adet < 0) return 0;
  return adet * taktSn / gunlukSureSn;
}

/**
 * Castle-wall (zaman merdiveni) verisi: flow sırasında NVA basamağı (buffer bekleme,
 * gün) + araya giren istasyonun VA çentiği (işlem, sn). Toplam LT ve PCE etiketleri
 * aynı türetimden hesaplanır: PCE = ΣVA / (LT × günlük süre) × 100.
 */
export function castleWallVerisi(bufferlar, senaryo, factoryData) {
  const adimlar = [];
  let nvaGunToplam = 0, vaSnToplam = 0;
  for (const f of factoryData.flow) {
    const adet = (bufferlar && Number.isFinite(bufferlar[f.id])) ? bufferlar[f.id] : 0;
    const gun = nvaGun(adet, factoryData.taktSn, factoryData.gunlukSureSn);
    nvaGunToplam += gun;
    adimlar.push({ tip: 'nva', id: f.id, ad: f.ad, adet, gun });
    if (f.sonrakiIstasyon) {
      const st = factoryData.stations.find((s) => s.id === f.sonrakiIstasyon);
      const sn = vaSn(st, senaryo, factoryData);
      vaSnToplam += sn;
      adimlar.push({ tip: 'va', id: st.id, ad: st.ad, sn });
    }
  }
  // PCE etiketi motorla (engine.getState) ve dokümanla aynı VA tabanını kullanır:
  // kpis.current.katmaDegerliSn = 250 sn, her iki senaryoda. Çentikler senaryonun
  // gerçek nominal çevrimlerini göstermeye devam eder (future Σ=212,5 — 2. robot).
  const vaTabanSn = factoryData.kpis?.current?.katmaDegerliSn ?? vaSnToplam;
  const toplamLtGun = nvaGunToplam + vaTabanSn / factoryData.gunlukSureSn;
  const pceYuzde = toplamLtGun > 0
    ? vaTabanSn / (toplamLtGun * factoryData.gunlukSureSn) * 100 : 0;
  return { adimlar, nvaGunToplam, vaSnToplam, vaTabanSn, toplamLtGun, pceYuzde };
}

/** Yüzde değişim: (sonra − önce) / |önce| × 100; önce ≈ 0 ise null. */
export function deltaYuzde(once, sonra) {
  if (!Number.isFinite(once) || !Number.isFinite(sonra)) return null;
  if (Math.abs(once) < 1e-9) return null;
  return (sonra - once) / Math.abs(once) * 100;
}

/**
 * Mobil kırılım sorgusu — CSS medya bloğu ile bire bir aynı dize; JS davranış
 * değişiklikleri (çekmece, duvar başlangıç durumu, kenar ölçümü) yalnız bu
 * sorgu matchMedia ile eşleşince etkinleşir. Masaüstü piksel piksel aynı kalır.
 */
export const MOBIL_SORGU = '(max-width: 760px), (max-height: 500px)';

/** Senaryo Δ çipi metni: deltaYuzdeMetni(14315, 4437) → "−%69". Hesaplanamıyorsa null. */
export function deltaYuzdeMetni(once, sonra) {
  const d = deltaYuzde(once, sonra);
  if (d == null) return null;
  const r = Math.round(d);
  if (r === 0) return '%0';
  return (r > 0 ? '+%' : '−%') + fmtTam(Math.abs(r));
}

// ---------------------------------------------------------------------------
// RENK / STİL SABİTLERİ (görsel sabitler serbest — sayılar factory.json'dan)
// ---------------------------------------------------------------------------

const RENK = {
  seri1: '#3987e5',   // WIP sparkline + takt-içi çubuk (mavi, koyu yüzeyde doğrulandı)
  seri2: '#199e70',   // günlük çıktı sparkline (aqua)
  nva: '#c98500',     // castle-wall bekleme basamağı (koyu sarı; #199e70 ile ΔE 41 — validator PASS)
  va: '#199e70',      // castle-wall işlem çentiği (aqua, seri2 ile aynı varlık ailesi)
  iyi: '#0ca30c',
  kotu: '#d03b3b',
  uyari: '#fab219',
  ciddi: '#ec835a',
  murekkepBirincil: '#f2f0e6',
  murekkepIkincil: '#c3c2b7',
  soluk: '#898781',
  cizgi: '#2c2c2a',
  vurgu: '#e8c170',   // Factorio kehribar
  yuzey: '#0a0a0a',   // sahne + yarı saydam panelin etkin koyuluğu
};

const CSS = `
.mh-kok { position:absolute; inset:0; font: 11px/1.45 ui-monospace, "SF Mono", Menlo, monospace;
  color:${RENK.murekkepBirincil}; pointer-events:none; }
.mh-kok > * { pointer-events:auto; }
.mh-panel { background:rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.16);
  border-radius:3px; overflow:hidden; }
.mh-baslik { display:flex; align-items:center; gap:6px; padding:4px 8px; cursor:pointer;
  background:rgba(255,255,255,0.06); color:${RENK.vurgu}; font-weight:700; letter-spacing:1px;
  font-size:10px; text-transform:uppercase; user-select:none; }
.mh-baslik .mh-cengel { margin-left:auto; color:${RENK.soluk}; font-weight:400; }
.mh-panel.mh-kapali .mh-govde { display:none; }
.mh-govde { padding:7px 8px; }

/* --- üst şerit --- */
.mh-ust { position:absolute; top:8px; left:8px; right:8px; display:flex; flex-wrap:wrap;
  align-items:center; gap:8px; padding:5px 10px; }
.mh-saat { color:${RENK.vurgu}; font-weight:700; min-width:150px; }
.mh-grup { display:flex; align-items:center; gap:0; }
.mh-btn { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.18);
  color:${RENK.murekkepBirincil}; font:inherit; padding:2px 8px; cursor:pointer; margin-left:-1px; }
.mh-btn:first-child { margin-left:0; border-radius:2px 0 0 2px; }
.mh-btn:last-child { border-radius:0 2px 2px 0; }
.mh-btn:hover { background:rgba(255,255,255,0.16); }
.mh-btn.mh-aktif { background:${RENK.vurgu}; border-color:${RENK.vurgu}; color:#151009; font-weight:700; }
.mh-btn.mh-tek { border-radius:2px; }
.mh-etiket { color:${RENK.soluk}; font-size:10px; }
.mh-esnek { flex:1; }

/* --- üst şerit KPI karoları --- */
.mh-karolar { display:flex; gap:6px; align-items:stretch; }
.mh-karo { display:flex; flex-direction:column; gap:0; padding:2px 6px; min-width:64px;
  background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); border-radius:2px; }
.mh-karo-ust { display:flex; align-items:baseline; gap:4px; font-size:9px; color:${RENK.soluk};
  letter-spacing:.5px; text-transform:uppercase; white-space:nowrap; }
.mh-karo-deger { display:flex; align-items:baseline; gap:4px; font-size:12px; font-weight:700;
  font-variant-numeric:tabular-nums; white-space:nowrap; color:${RENK.murekkepBirincil}; }
.mh-karo .mh-fark { font-size:9px; }
.mh-karo-spark { display:block; width:100%; height:8px; margin-top:1px; }
.mh-cip { font-size:9px; font-weight:700; padding:0 4px; border-radius:7px;
  background:rgba(255,255,255,0.10); display:none; }
.mh-cip.mh-goster { display:inline-block; }
.mh-cip.mh-iyi { color:${RENK.iyi}; }
.mh-cip.mh-kotu { color:${RENK.kotu}; }
.mh-cip.mh-esit { color:${RENK.soluk}; }

/* --- sol sütun --- */
.mh-sol { position:absolute; top:52px; left:8px; width:272px; display:flex; flex-direction:column;
  gap:8px; max-height:calc(100vh - 64px); overflow-y:auto; scrollbar-width:thin; }
/* Faz 0: paneller flex-shrink ile ezilirse .mh-panel'in overflow:hidden'ı içerik KIRPAR
   (Montaj satırı, "Birikmiş sipariş", hızlı butonlar sessizce kaybolur). Paneller
   küçülmesin; taşma sütunun kendi overflow-y:auto kaydırmasıyla erişilebilir kalsın. */
.mh-sol > * { flex-shrink:0; }

/* --- KPI paneli --- */
.mh-kpi { display:flex; flex-direction:column; gap:7px; }
.mh-kpi-satir { display:grid; grid-template-columns:1fr auto; gap:0 8px; align-items:baseline; }
.mh-kpi-ad { color:${RENK.murekkepIkincil}; }
.mh-kpi-deger { font-size:14px; font-weight:700; text-align:right;
  font-variant-numeric:tabular-nums; color:${RENK.murekkepBirincil}; }
.mh-kpi-alt { grid-column:1 / -1; display:flex; justify-content:space-between; gap:8px;
  font-size:10px; color:${RENK.soluk}; font-variant-numeric:tabular-nums; }
.mh-fark { font-weight:700; }
.mh-fark.mh-iyi { color:${RENK.iyi}; }
.mh-fark.mh-kotu { color:${RENK.kotu}; }
.mh-fark.mh-esit { color:${RENK.soluk}; }

/* --- takt-çevrim çubukları --- */
.mh-takt-satir { display:grid; grid-template-columns:46px 1fr 42px; gap:6px; align-items:center;
  margin-bottom:5px; }
.mh-takt-satir:last-of-type { margin-bottom:2px; }
.mh-takt-ad { color:${RENK.murekkepIkincil}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mh-takt-iz { position:relative; height:12px; background:rgba(255,255,255,0.07); border-radius:2px; }
.mh-takt-cubuk { position:absolute; left:0; top:1px; bottom:1px; border-radius:0 4px 4px 0;
  background:${RENK.seri1}; transition:width .4s ease, background .4s ease; }
.mh-takt-cubuk.mh-asim { background:${RENK.kotu}; }
.mh-takt-cizgi { position:absolute; top:-2px; bottom:-2px; width:1px; background:${RENK.vurgu}; opacity:.9; }
.mh-takt-deger { text-align:right; color:${RENK.murekkepIkincil}; font-variant-numeric:tabular-nums; }
.mh-takt-aciklama { font-size:10px; color:${RENK.soluk}; margin-top:4px; }
.mh-takt-aciklama b { color:${RENK.vurgu}; font-weight:700; }

/* --- istasyon listesi --- */
.mh-ist { border-top:1px solid rgba(255,255,255,0.08); }
.mh-ist:first-child { border-top:none; }
.mh-ist-bas { display:flex; align-items:center; gap:6px; padding:4px 0; cursor:default; }
.mh-ist-ad { font-weight:700; }
.mh-nokta { width:7px; height:7px; border-radius:50%; flex:none; box-shadow:0 0 0 2px ${RENK.yuzey}; }
.mh-ist-durum { margin-left:auto; font-size:10px; color:${RENK.murekkepIkincil}; }
.mh-ist-detay { display:none; padding:2px 0 6px 13px; font-size:10px; color:${RENK.murekkepIkincil}; }
.mh-ist:hover .mh-ist-detay { display:block; }
.mh-ist-detay .mh-anahtar { color:${RENK.soluk}; }
.mh-ist-problem { margin-top:3px; color:${RENK.ciddi}; }
.mh-ist-problem .mh-pid { color:${RENK.vurgu}; font-weight:700; }

/* --- sparkline'lar --- */
.mh-spark-bas { display:flex; justify-content:space-between; align-items:baseline; margin:2px 0 1px; }
.mh-spark-ad { color:${RENK.murekkepIkincil}; font-size:10px; }
.mh-spark-deger { font-weight:700; font-variant-numeric:tabular-nums; }
.mh-spark-tuval { display:block; width:100%; height:44px; }
.mh-spark-dip { font-size:9px; color:${RENK.soluk}; text-align:right; }

/* --- castle-wall zaman merdiveni (alt şerit) --- */
.mh-duvar { position:absolute; left:288px; right:8px; bottom:34px; }
.mh-duvar .mh-govde { position:relative; padding:5px 8px 3px; }
.mh-duvar-tuval { display:block; width:100%; height:86px; cursor:crosshair; }
.mh-duvar-dip { display:flex; gap:14px; align-items:baseline; font-size:10px;
  color:${RENK.murekkepIkincil}; padding-top:2px; font-variant-numeric:tabular-nums; flex-wrap:wrap; }
.mh-duvar-dip b { color:${RENK.murekkepBirincil}; font-size:12px; font-weight:700; }
.mh-duvar-dip .mh-anahtar { color:${RENK.soluk}; }
.mh-duvar-lejant { display:inline-flex; align-items:center; gap:4px; }
.mh-duvar-renk { width:8px; height:8px; border-radius:2px; display:inline-block; }
.mh-duvar-ipucu { position:absolute; display:none; pointer-events:none; z-index:7;
  background:rgba(0,0,0,0.88); border:1px solid rgba(255,255,255,0.25); border-radius:2px;
  padding:3px 7px; font-size:10px; color:${RENK.murekkepBirincil}; white-space:nowrap; }

/* --- olay günlüğü: alt kenara sabit ince şerit + tıklayınca açılan liste --- */
.mh-altlog { position:absolute; left:288px; right:8px; bottom:8px; height:22px;
  display:flex; align-items:center; gap:7px; padding:0 8px; cursor:pointer; user-select:none; }
.mh-altlog-etiket { color:${RENK.vurgu}; font-weight:700; font-size:9px; letter-spacing:1px; flex:none; }
.mh-altlog .mh-log-mesaj { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 auto; }
.mh-altlog-sayac { color:${RENK.soluk}; flex:none; font-size:10px; }
.mh-altlog-acilir { position:absolute; right:8px; bottom:34px; width:420px;
  max-width:calc(100vw - 300px); display:none; z-index:6; }
.mh-altlog-acilir.mh-acik { display:block; }
.mh-altlog-acilir .mh-govde { padding:4px 8px; max-height:170px; overflow-y:auto; scrollbar-width:thin; }
.mh-log-satir { display:flex; gap:7px; padding:2px 0; border-top:1px solid rgba(255,255,255,0.06);
  align-items:baseline; }
.mh-log-satir:first-child { border-top:none; }
.mh-log-zaman { color:${RENK.soluk}; flex:none; font-variant-numeric:tabular-nums; }
.mh-log-tip { flex:none; width:12px; text-align:center; }
.mh-log-mesaj { color:${RENK.murekkepIkincil}; }
.mh-log-bos { color:${RENK.soluk}; padding:3px 0; }
.mh-ed-satir { display:flex; align-items:center; gap:5px; padding:2px 0; font-size:11px; }
.mh-ed-ad { color:${RENK.murekkepIkincil}; flex:1 1 auto; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.mh-ed-canli { color:${RENK.murekkepBirincil}; flex:none; min-width:44px; text-align:right;
  font-variant-numeric:tabular-nums; }
.mh-ed-giris { width:58px; flex:none; background:rgba(255,255,255,0.06);
  border:1px solid rgba(255,255,255,0.18); color:${RENK.murekkepBirincil};
  font:inherit; font-size:11px; padding:1px 4px; border-radius:2px; }
.mh-ed-giris:focus { outline:none; border-color:${RENK.vurgu}; }
.mh-ed-btn { flex:none; padding:1px 7px; }
.mh-ed-hizli { display:flex; gap:4px; padding-top:5px; margin-top:3px;
  border-top:1px solid rgba(255,255,255,0.09); flex-wrap:wrap; }

/* --- dokunmatik: istasyon detayı tıkla-aç (hover'a ek; masaüstünde hover zaten gösterir,
   bu kural medya bloğu dışında kalsa da masaüstü davranışını bozmaz) --- */
.mh-ist.mh-acik .mh-ist-detay { display:block; }

/* --- senaryo butonu uzun/kısa etiket: kısa yalnız mobil kırılımda görünür,
   masaüstü DOM metni (uzun span) bire bir aynı kalır --- */
.mh-sen-kisa { display:none; }

/* --- panel çekmecesi düğmesi: yalnız mobil kırılımda görünür --- */
.mh-cekmece-dugme { display:none; }

/* ============================ MOBİL KIRILIM ============================
   ALTIN KURAL: masaüstü piksel piksel aynı kalır — tüm mobil kurallar bu
   blokta yaşar. Sorgu MOBIL_SORGU sabitiyle bire bir aynıdır (JS matchMedia). */
@media ${MOBIL_SORGU} {
  /* üst şerit kompakt */
  .mh-ust { padding:3px 6px; gap:5px; font-size:10px; }
  .mh-saat { min-width:0; }
  .mh-btn { padding:6px 9px; min-height:28px; } /* dokunma hedefi ≥ ~28px */
  /* KPI karoları: tek satır, yatay kaydırılabilir */
  .mh-karolar { flex:1 1 100%; min-width:0; overflow-x:auto; scrollbar-width:thin;
    padding-bottom:2px; }
  .mh-karo { flex:none; }
  /* senaryo butonlarında kısa etiket */
  .mh-sen-uzun { display:none; }
  .mh-sen-kisa { display:inline; }
  /* sol sütun → alt çekmece: varsayılan gizli, ▤ Paneller düğmesi .mh-cekmece-acik
     ile açar. solKonumla() inline top/max-height yazar; burada !important ile ezilir. */
  .mh-sol { top:auto !important; left:0; right:0; bottom:0; width:auto;
    max-height:46vh !important; display:none; z-index:10; padding:8px;
    background:rgba(8,8,8,0.92); border-top:1px solid rgba(255,255,255,0.2); }
  .mh-kok.mh-cekmece-acik .mh-sol { display:flex; }
  .mh-cekmece-dugme { display:block; position:absolute; left:8px; bottom:8px; z-index:11;
    width:92px; height:28px; padding:0 6px; cursor:pointer;
    background:rgba(0,0,0,0.75); border:1px solid rgba(255,255,255,0.3); border-radius:3px;
    color:${RENK.vurgu}; font:inherit; font-size:10px; font-weight:700; }
  /* alt şeritler tam genişlik; olay şeridi içeriği çekmece düğmesine yer bırakır */
  .mh-duvar { left:8px; }
  .mh-altlog { left:8px; padding-left:104px; }
  .mh-altlog-acilir { max-width:calc(100vw - 16px); }
}
`;

// ---------------------------------------------------------------------------
// createHud
// ---------------------------------------------------------------------------

export function createHud(container, sim, factoryData) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  // Mobil kırılım tespiti (CSS medya bloğuyla aynı sorgu) — masaüstünde daima false.
  const mobilMi = () => !!(win && win.matchMedia && win.matchMedia(MOBIL_SORGU).matches);

  // --- CSS enjeksiyonu (bir kez) ---
  if (!doc.getElementById('mh-stil')) {
    const stil = doc.createElement('style');
    stil.id = 'mh-stil';
    stil.textContent = CSS;
    doc.head.appendChild(stil);
  }

  const el = (etiket, sinif, metin) => {
    const e = doc.createElement(etiket);
    if (sinif) e.className = sinif;
    if (metin != null) e.textContent = metin;
    return e;
  };

  const kok = el('div', 'mh-kok');
  container.appendChild(kok);

  // Daraltılabilir panel iskeleti (basKapali: mobilde bazı paneller katlanmış başlar)
  function panel(baslikMetni, basKapali = false) {
    const p = el('section', 'mh-panel');
    const bas = el('header', 'mh-baslik');
    bas.appendChild(el('span', null, baslikMetni));
    const cengel = el('span', 'mh-cengel', '▾');
    bas.appendChild(cengel);
    const govde = el('div', 'mh-govde');
    p.appendChild(bas); p.appendChild(govde);
    const cengelTazele = () => {
      cengel.textContent = p.classList.contains('mh-kapali') ? '▸' : '▾';
    };
    bas.addEventListener('click', () => {
      p.classList.toggle('mh-kapali');
      cengelTazele();
    });
    if (basKapali) { p.classList.add('mh-kapali'); cengelTazele(); }
    return { p, govde };
  }

  const cur = factoryData.kpis.current;
  const fut = factoryData.kpis.future;
  const taktSn = factoryData.taktSn;
  const gunlukSureSn = factoryData.gunlukSureSn;
  const gunlukTalep = factoryData.gunlukTalep;

  // ===================== 1) ÜST ŞERİT =====================
  const ust = el('div', 'mh-panel mh-ust');
  const saatEl = el('span', 'mh-saat', 'Gün 1 · Vardiya 1');
  ust.appendChild(saatEl);

  ust.appendChild(el('span', 'mh-etiket', 'hız'));
  const hizGrup = el('span', 'mh-grup');
  const hizlar = [
    { v: 0, m: '⏸' },
    { v: 1000, m: '1000×' }, { v: 10000, m: '10000×' }, { v: 100000, m: '100000×' },
  ];
  const hizBtnler = hizlar.map(({ v, m }) => {
    const b = el('button', 'mh-btn', m);
    b.title = v === 0 ? 'Duraklat' : `Sim hızı ${m}`;
    b.addEventListener('click', () => { sim.setSpeed(v); hizIsaretle(); });
    hizGrup.appendChild(b);
    return { v, b };
  });
  ust.appendChild(hizGrup);

  ust.appendChild(el('span', 'mh-etiket', 'senaryo'));
  const senGrup = el('span', 'mh-grup');
  // Uzun/kısa etiket iki ayrı span: masaüstü uzunu, mobil kırılım kısayı gösterir
  // (CSS .mh-sen-uzun/.mh-sen-kisa) — masaüstü görüneni bire bir aynı kalır.
  const senBtnler = [
    { id: 'current', m: 'Mevcut (İtme)', kisa: 'Mevcut' },
    { id: 'future', m: 'Gelecek (Çekme + AGV + Kestirimci Bakım)', kisa: 'Gelecek' },
  ].map(({ id, m, kisa }) => {
    const b = el('button', 'mh-btn');
    b.appendChild(el('span', 'mh-sen-uzun', m));
    b.appendChild(el('span', 'mh-sen-kisa', kisa));
    b.addEventListener('click', () => sim.setScenario(id));
    senGrup.appendChild(b);
    return { id, b };
  });
  ust.appendChild(senGrup);

  // Faz 1b: kompakt KPI karoları — sol paneldeki ayrıntı görünümünün üst şerit özeti.
  // Her karo: ad + Δ çipi (senaryo geçişinde, Faz 2) / değer + referans-fark oku / mini eğilim.
  const karolar = el('span', 'mh-karolar');
  const karoTanimlari = [
    { ad: 'WIP', alan: 'wip', oku: (s) => s.kpi.wipAdet, ref: cur.wipAdet,
      dususIyi: true, fmt: (v) => fmtTam(v), renk: RENK.seri1 },
    { ad: 'Temin', alan: 'lt', oku: (s) => s.kpi.leadTimeGun, ref: cur.leadTimeGun,
      dususIyi: true, fmt: (v) => fmtOndalik(v, 1) + ' g', renk: RENK.seri1 },
    { ad: 'Çıktı', alan: 'cikti', oku: (s) => s.kpi.gunlukCikti, ref: gunlukTalep,
      dususIyi: false, fmt: (v) => fmtTam(v) + '/' + fmtTam(gunlukTalep), renk: RENK.seri2 },
    { ad: 'OEE', alan: 'oee', oku: (s) => s.kpi.kaynakOee, ref: cur.oee,
      dususIyi: false, fmt: (v) => fmtYuzdeOran(v, 1), renk: RENK.seri2 },
  ];
  const karoElemanlari = karoTanimlari.map((t) => {
    const k = el('span', 'mh-karo');
    k.title = `${t.ad} — referans (mevcut durum): ${t.fmt(t.ref)}`;
    const ustSatir = el('span', 'mh-karo-ust');
    ustSatir.appendChild(el('span', null, t.ad));
    const cip = el('span', 'mh-cip');
    ustSatir.appendChild(cip);
    k.appendChild(ustSatir);
    const degerSatir = el('span', 'mh-karo-deger');
    const deger = el('span', null, '—');
    degerSatir.appendChild(deger);
    const fark = el('span', 'mh-fark mh-esit', '•');
    degerSatir.appendChild(fark);
    k.appendChild(degerSatir);
    const spark = el('canvas', 'mh-karo-spark');
    k.appendChild(spark);
    karolar.appendChild(k);
    return { t, deger, fark, cip, spark };
  });
  ust.appendChild(karolar);

  ust.appendChild(el('span', 'mh-esnek'));
  const sifirlaBtn = el('button', 'mh-btn mh-tek', '⟲ Sıfırla');
  sifirlaBtn.addEventListener('click', () => { sim.reset(); gecmisiTemizle(); });
  ust.appendChild(sifirlaBtn);
  kok.appendChild(ust);

  function hizIsaretle() {
    const h = sim.getSpeed();
    for (const { v, b } of hizBtnler) b.classList.toggle('mh-aktif', v === h);
  }

  // ===================== sol sütun =====================
  const sol = el('div', 'mh-sol');
  kok.appendChild(sol);

  // Mobil kırılımda sol sütun alt çekmeceye dönüşür; bu yüzer düğme aç/kapa yapar.
  // Masaüstünde CSS ile gizlidir (display:none) — masaüstü düzeni değişmez.
  const cekmeceBtn = el('button', 'mh-cekmece-dugme', '▤ Paneller');
  cekmeceBtn.title = 'Panelleri aç/kapat';
  cekmeceBtn.addEventListener('click', () => {
    const acik = kok.classList.toggle('mh-cekmece-acik');
    cekmeceBtn.textContent = acik ? '✕ Kapat' : '▤ Paneller';
  });
  kok.appendChild(cekmeceBtn);

  // Üst şerit karolarla yükseldi / dar ekranda iki satıra sardıysa sol sütunun
  // başlangıcını canlı ölç (CSS'teki 52px yalnız ilk kare varsayılanı).
  let solTopPx = 0;
  function solKonumla() {
    const t = 8 + ust.offsetHeight + 6;
    if (t !== solTopPx) {
      solTopPx = t;
      sol.style.top = t + 'px';
      sol.style.maxHeight = `calc(100vh - ${t + 12}px)`;
    }
  }

  // ===================== 2) KPI PANELİ =====================
  const kpiPanel = panel('Üretim — KPI');
  sol.appendChild(kpiPanel.p);
  const kpiKutu = el('div', 'mh-kpi');
  kpiPanel.govde.appendChild(kpiKutu);

  // Tanımlar: referans = kpis.current, hedef = kpis.future (çıktı/sipariş için günlük talep).
  const kpiTanimlari = [
    { ad: 'WIP', oku: (s) => s.kpi.wipAdet, ref: cur.wipAdet, hedef: fut.wipAdet,
      dususIyi: true, fmt: (v) => fmtTam(v) + ' adet' },
    { ad: 'Temin süresi (lead time)', oku: (s) => s.kpi.leadTimeGun, ref: cur.leadTimeGun,
      hedef: fut.leadTimeGun, dususIyi: true, fmt: (v) => fmtOndalik(v, 1) + ' gün' },
    { ad: 'PCE', oku: (s) => s.kpi.pceYuzde, ref: cur.pceYuzde, hedef: fut.pceYuzde,
      dususIyi: false, fmt: (v) => fmtYuzdeDeger(v, 3) },
    { ad: 'Kaynak OEE', oku: (s) => s.kpi.kaynakOee, ref: cur.oee, hedef: fut.oee,
      dususIyi: false, fmt: (v) => fmtYuzdeOran(v, 1) },
    { ad: 'Günlük çıktı', oku: (s) => s.kpi.gunlukCikti, ref: gunlukTalep, hedef: gunlukTalep,
      dususIyi: false, fmt: (v) => fmtTam(v) + ' adet', refAd: 'talep' },
    { ad: 'Birikmiş sipariş', oku: (s) => s.kpi.birikmisSiparis, ref: 0, hedef: 0,
      dususIyi: true, fmt: (v) => fmtTam(v) + ' adet', refAd: 'hedef' },
  ];

  const kpiSatirlar = kpiTanimlari.map((t) => {
    const satir = el('div', 'mh-kpi-satir');
    satir.appendChild(el('span', 'mh-kpi-ad', t.ad));
    const deger = el('span', 'mh-kpi-deger', '—');
    satir.appendChild(deger);
    const alt = el('span', 'mh-kpi-alt');
    const refMetin = (t.refAd === 'hedef')
      ? `hedef ${t.fmt(t.hedef)}`
      : `${t.refAd || 'ref'} ${t.fmt(t.ref)}${t.refAd ? '' : ` → hedef ${t.fmt(t.hedef)}`}`;
    alt.appendChild(el('span', null, refMetin));
    const fark = el('span', 'mh-fark mh-esit', '•');
    alt.appendChild(fark);
    satir.appendChild(alt);
    kpiKutu.appendChild(satir);
    return { t, deger, fark };
  });

  // ===================== 3) TAKT–ÇEVRİM ÇUBUĞU =====================
  const taktPanel = panel('Takt / Etkin Çevrim');
  sol.appendChild(taktPanel.p);
  // Sabit ölçek: iki senaryonun da en kötüsü + takt, %12 pay — çubuklar senaryolar arası karşılaştırılabilir.
  const olcekSn = Math.max(taktSn,
    ...factoryData.stations.map((st) => etkinCevrimSn(st, 'current', factoryData)),
    ...factoryData.stations.map((st) => etkinCevrimSn(st, 'future', factoryData))) * 1.12;
  const taktYuzde = (taktSn / olcekSn) * 100;

  const taktSatirlar = factoryData.stations.map((st) => {
    const satir = el('div', 'mh-takt-satir');
    satir.appendChild(el('span', 'mh-takt-ad', st.ad));
    const iz = el('span', 'mh-takt-iz');
    const cubuk = el('span', 'mh-takt-cubuk');
    iz.appendChild(cubuk);
    const cizgi = el('span', 'mh-takt-cizgi');
    cizgi.style.left = taktYuzde + '%';
    iz.appendChild(cizgi);
    satir.appendChild(iz);
    const deger = el('span', 'mh-takt-deger', '—');
    satir.appendChild(deger);
    taktPanel.govde.appendChild(satir);
    return { st, cubuk, deger };
  });
  const taktNot = el('div', 'mh-takt-aciklama');
  taktNot.innerHTML = `<b>│</b> takt ${fmtTam(taktSn)} sn — çizgiyi aşan istasyon talebe yetişemez`;
  taktPanel.govde.appendChild(taktNot);

  function taktCiz(senaryo) {
    for (const { st, cubuk, deger } of taktSatirlar) {
      const c = etkinCevrimSn(st, senaryo, factoryData);
      cubuk.style.width = Math.min(100, (c / olcekSn) * 100) + '%';
      cubuk.classList.toggle('mh-asim', c > taktSn);
      deger.textContent = fmtOndalik(c, 1);
    }
  }

  // ===================== 4) İSTASYONLAR PANELİ =====================
  const istPanel = panel('İstasyonlar');
  sol.appendChild(istPanel.p);

  const durumRenk = {
    calisiyor: RENK.iyi, bloke: RENK.uyari, ac: RENK.ciddi,
    arizali: RENK.kotu, setup: RENK.seri1, bosta: RENK.soluk,
  };
  const akis = factoryData.flow;

  const istSatirlar = factoryData.stations.map((st) => {
    const kutu = el('div', 'mh-ist');
    const bas = el('div', 'mh-ist-bas');
    const nokta = el('span', 'mh-nokta');
    nokta.style.background = RENK.soluk;
    bas.appendChild(nokta);
    bas.appendChild(el('span', 'mh-ist-ad', st.ad));
    const durumEl = el('span', 'mh-ist-durum', '—');
    bas.appendChild(durumEl);
    // Dokunmatik için tıkla-aç/kapa (masaüstünde hover zaten gösterir; .mh-acik
    // yalnız detayı sabitler, düzeni değiştirmez).
    bas.addEventListener('click', () => kutu.classList.toggle('mh-acik'));
    kutu.appendChild(bas);

    const detay = el('div', 'mh-ist-detay');
    const cevrimEl = el('div');
    const kullEl = el('div');
    const anlikEl = el('div');
    const bufferEl = el('div');
    const kasaEl = el('div');
    detay.appendChild(cevrimEl); detay.appendChild(kullEl);
    detay.appendChild(anlikEl); detay.appendChild(bufferEl); detay.appendChild(kasaEl);

    const problemler = factoryData.problems.filter((p) => p.istasyon === st.id);
    for (const p of problemler) {
      const pe = el('div', 'mh-ist-problem');
      const pid = el('span', 'mh-pid', p.id + ' ');
      pe.appendChild(pid);
      pe.appendChild(doc.createTextNode(`${p.aciklama} — ${p.gosterge}`));
      detay.appendChild(pe);
    }
    kutu.appendChild(detay);
    istPanel.govde.appendChild(kutu);

    const girisAkis = akis.find((f) => f.sonrakiIstasyon === st.id);
    const cikisAkis = akis.find((f) => f.oncekiIstasyon === st.id);
    return { st, nokta, durumEl, cevrimEl, kullEl, anlikEl, bufferEl, kasaEl, girisAkis, cikisAkis };
  });

  function istGuncelle(state) {
    for (const s of istSatirlar) {
      const ist = state.istasyonlar[s.st.id];
      if (!ist) continue;
      s.nokta.style.background = durumRenk[ist.durum] || RENK.soluk;
      s.durumEl.textContent = durumEtiketi(ist.durum);

      const etkin = etkinCevrimSn(s.st, state.senaryo, factoryData);
      const nominal = (state.senaryo === 'future' && s.st.id === 'kaynak')
        ? fut.kaynakNominalCevrimSn : s.st.cevrimSn;
      s.cevrimEl.textContent =
        `Çevrim: nominal ${fmtOndalik(nominal, 1)} sn · etkin ${fmtOndalik(etkin, 1)} sn`;

      const setup = (state.senaryo === 'future' && s.st.id === 'bukme')
        ? fut.bukmeSetupDk : s.st.setupDk;
      s.kullEl.textContent =
        `Kullanılabilirlik: ${fmtYuzdeOran(kullanilabilirlik(s.st, state.senaryo, factoryData), 1)}`
        + (setup != null ? ` · setup ${fmtTam(setup)} dk` : '');

      let anlik = `Anlık: ${durumEtiketi(ist.durum)} · ilerleme ${fmtYuzdeOran(ist.cevrimIlerleme || 0, 0)}`
        + ` · üretilen ${fmtTam(ist.uretilenAdet)}`;
      if (ist.kalanDurusSn != null) anlik += ` · kalan duruş ${fmtTam(Math.ceil(ist.kalanDurusSn / 60))} dk`;
      s.anlikEl.textContent = anlik;

      const g = s.girisAkis ? state.bufferlar[s.girisAkis.id] : null;
      const c = s.cikisAkis ? state.bufferlar[s.cikisAkis.id] : null;
      s.bufferEl.innerHTML = '';
      s.bufferEl.appendChild(el('span', 'mh-anahtar', 'Buffer: '));
      s.bufferEl.appendChild(doc.createTextNode(
        `giriş ${g != null ? fmtTam(g) : '—'} · çıkış ${c != null ? fmtTam(c) : '—'} adet`));

      s.kasaEl.textContent = (ist.hatYaniKasa != null)
        ? `Hat-yanı stok: ${fmtOndalik(ist.hatYaniKasa, 1)} kasa (AGV milk-run)` : '';
      s.kasaEl.style.display = (ist.hatYaniKasa != null) ? '' : 'none';
    }
  }

  // ===================== 5) MİNİ ZAMAN SERİSİ =====================
  const seriPanel = panel('Eğilim — son 30 gün');
  sol.appendChild(seriPanel.p);

  const PENCERE_GUN = 30;
  const ORNEK_ADIM_GUN = 0.1;
  let ornekler = [];        // { gun, wip, cikti, lt, oee }
  let isaretler = [];       // senaryo geçiş anları (gun)
  let sonOrnekGun = -Infinity;
  let cipTaban = null;      // Faz 2: senaryo geçiş anındaki KPI görüntüsü (Δ çipleri buna göre)

  function sparkKur(ad, renk) {
    const bas = el('div', 'mh-spark-bas');
    bas.appendChild(el('span', 'mh-spark-ad', ad));
    const deger = el('span', 'mh-spark-deger', '—');
    deger.style.color = RENK.murekkepBirincil; // metin veri rengini giymez
    bas.appendChild(deger);
    seriPanel.govde.appendChild(bas);
    const tuval = el('canvas', 'mh-spark-tuval');
    seriPanel.govde.appendChild(tuval);
    return { tuval, deger, renk };
  }
  const wipSpark = sparkKur('WIP (adet)', RENK.seri1);
  const ciktiSpark = sparkKur('Günlük çıktı (adet/gün)', RENK.seri2);
  seriPanel.govde.appendChild(el('div', 'mh-spark-dip', '│ senaryo geçişi'));

  function sparkCiz(spark, alan, refDeger) {
    const cv = spark.tuval;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = cv.clientWidth || 250, h = cv.clientHeight || 44;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (ornekler.length === 0) return;

    const son = ornekler[ornekler.length - 1];
    const x1 = Math.max(0, son.gun - PENCERE_GUN);
    const x2 = Math.max(son.gun, x1 + 1);
    let maxY = refDeger || 0;
    for (const o of ornekler) maxY = Math.max(maxY, o[alan]);
    maxY = Math.max(maxY, 1) * 1.1;

    const X = (g) => ((g - x1) / (x2 - x1)) * (w - 8) + 2;
    const Y = (v) => h - 3 - (v / maxY) * (h - 8);

    // taban çizgisi (hairline, düz)
    ctx.strokeStyle = RENK.cizgi; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h - 2.5); ctx.lineTo(w, h - 2.5); ctx.stroke();
    // referans (talep / WIP hedefi) hairline
    if (refDeger) {
      ctx.strokeStyle = RENK.cizgi;
      ctx.beginPath(); ctx.moveTo(0, Y(refDeger)); ctx.lineTo(w, Y(refDeger)); ctx.stroke();
    }
    // senaryo geçiş işaretleri (dikey, soluk)
    ctx.strokeStyle = RENK.soluk;
    for (const g of isaretler) {
      if (g < x1 || g > x2) continue;
      ctx.beginPath(); ctx.moveTo(X(g), 2); ctx.lineTo(X(g), h - 3); ctx.stroke();
    }
    // alan yıkaması (~%10) + 2px çizgi
    const gorunur = ornekler.filter((o) => o.gun >= x1);
    if (gorunur.length === 0) return;
    ctx.beginPath();
    gorunur.forEach((o, i) => { const x = X(o.gun), y = Y(o[alan]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = spark.renk; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineTo(X(gorunur[gorunur.length - 1].gun), h - 3);
    ctx.lineTo(X(gorunur[0].gun), h - 3);
    ctx.closePath();
    ctx.globalAlpha = 0.1; ctx.fillStyle = spark.renk; ctx.fill(); ctx.globalAlpha = 1;
    // uç noktası: yüzey halkası + dolu işaretçi
    const u = gorunur[gorunur.length - 1];
    ctx.beginPath(); ctx.arc(X(u.gun), Y(u[alan]), 5.5, 0, Math.PI * 2);
    ctx.fillStyle = RENK.yuzey; ctx.fill();
    ctx.beginPath(); ctx.arc(X(u.gun), Y(u[alan]), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = spark.renk; ctx.fill();
  }

  // Karo içi mini eğilim: aynı kayan pencere, 1,5px tek çizgi (eksen/etiket yok;
  // sayı ve fark oku karonun kendisinde — çizgi yalnız gidişatın şekli).
  function miniSparkCiz(cv, alan, renk) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = cv.clientWidth || 64, h = cv.clientHeight || 8;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (ornekler.length < 2) return;
    const son = ornekler[ornekler.length - 1];
    const x1 = Math.max(0, son.gun - PENCERE_GUN);
    const x2 = Math.max(son.gun, x1 + 1);
    const gorunur = ornekler.filter((o) => o.gun >= x1);
    if (gorunur.length < 2) return;
    let maxY = 1;
    for (const o of gorunur) maxY = Math.max(maxY, o[alan]);
    const X = (g) => ((g - x1) / (x2 - x1)) * (w - 2) + 1;
    const Y = (v) => h - 1 - (v / (maxY * 1.05)) * (h - 2);
    ctx.beginPath();
    gorunur.forEach((o, i) => { const x = X(o.gun), y = Y(o[alan]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = renk; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
  }

  function gecmisiTemizle() {
    ornekler = []; isaretler = []; sonOrnekGun = -Infinity; cipTaban = null; sonKaroDegerleri = null;
  }

  // ===================== 5b) MALZEME EDİTÖRÜ (sandbox) =====================
  // Buffer'ları canlı düzenle: sorun yarat (yığ/boşalt), sistemin çözüşünü izle.
  const edPanel = panel('Malzeme Editörü');
  sol.appendChild(edPanel.p);
  const edSatirlar = [];
  if (typeof sim.setBuffer === 'function') {
    for (const seg of factoryData.flow) {
      const satir = el('div', 'mh-ed-satir');
      satir.appendChild(el('span', 'mh-ed-ad', seg.ad));
      const canli = el('span', 'mh-ed-canli', '—');
      satir.appendChild(canli);
      const giris = el('input', 'mh-ed-giris');
      giris.type = 'number'; giris.min = '0'; giris.step = '100';
      giris.placeholder = 'adet';
      const uygula = () => {
        if (giris.value === '') return;
        if (sim.setBuffer(seg.id, giris.value)) giris.value = '';
      };
      giris.addEventListener('keydown', (e) => { if (e.key === 'Enter') uygula(); });
      satir.appendChild(giris);
      const btn = el('button', 'mh-btn mh-tek mh-ed-btn', '✓');
      btn.title = `${seg.ad} buffer'ını bu adete ayarla`;
      btn.addEventListener('click', uygula);
      satir.appendChild(btn);
      edPanel.govde.appendChild(satir);
      edSatirlar.push({ id: seg.id, canli });
    }
    // hızlı senaryolar
    const hizli = el('div', 'mh-ed-hizli');
    const baslangicAdet = (seg) => Math.round(seg.beklemeGun * gunlukTalep);
    const hizliButonlar = [
      { m: 'Boşalt', t: 'Tüm buffer\'ları sıfırla (kuraklık senaryosu)', f: () => {
          for (const seg of factoryData.flow) sim.setBuffer(seg.id, 0);
        } },
      { m: 'Rapor değerleri', t: 'Buffer\'ları rapordaki başlangıç stoklarına döndür', f: () => {
          for (const seg of factoryData.flow) sim.setBuffer(seg.id, baslangicAdet(seg));
        } },
      { m: 'Darboğazı boğ', t: 'Bükme–Kaynak arasına 10.000 adet yığ (sel senaryosu)', f: () => {
          sim.setBuffer('bukme_kaynak', 10000);
        } },
    ];
    for (const { m, t, f } of hizliButonlar) {
      const b = el('button', 'mh-btn mh-tek', m);
      b.title = t;
      b.addEventListener('click', f);
      hizli.appendChild(b);
    }
    edPanel.govde.appendChild(hizli);
  } else {
    edPanel.govde.appendChild(el('div', 'mh-log-bos', 'Motor setBuffer desteklemiyor.'));
  }

  function edGuncelle(state) {
    for (const { id, canli } of edSatirlar) {
      const v = state.bufferlar?.[id];
      canli.textContent = v == null ? '—' : fmtTam(v);
    }
  }

  // ===================== 6) OLAY GÜNLÜĞÜ (alt şerit) =====================
  // Faz 1b: izole yüzen kutu yerine alt kenara sabit ince şerit; son olay tek
  // satırda akar, tıklayınca son 8 olay yukarı açılır.
  const TIP_SIMGE = { ariza: '⚠', tamir: '⚒', setup: '⏱', agvYukleme: '▣', senaryoGecis: '⇄', fazlaMesai: '◔', mudahale: '✎' };
  const tipRenk = (tip) =>
    tip === 'ariza' ? RENK.kotu : (tip === 'tamir' ? RENK.iyi : RENK.soluk);

  const altLog = el('div', 'mh-panel mh-altlog');
  altLog.title = 'Olay günlüğü — son 8 olay için tıkla';
  altLog.appendChild(el('span', 'mh-altlog-etiket', 'OLAY'));
  const altLogZaman = el('span', 'mh-log-zaman', '');
  altLog.appendChild(altLogZaman);
  const altLogTip = el('span', 'mh-log-tip', '');
  altLog.appendChild(altLogTip);
  const altLogMesaj = el('span', 'mh-log-mesaj', 'Henüz olay yok.');
  altLog.appendChild(altLogMesaj);
  const altLogSayac = el('span', 'mh-altlog-sayac', '▴');
  altLog.appendChild(altLogSayac);
  kok.appendChild(altLog);

  const logAcilir = el('div', 'mh-panel mh-altlog-acilir');
  const logAcilirGovde = el('div', 'mh-govde');
  logAcilir.appendChild(logAcilirGovde);
  kok.appendChild(logAcilir);
  altLog.addEventListener('click', () => {
    logAcilir.classList.toggle('mh-acik');
    altLogSayac.textContent = logAcilir.classList.contains('mh-acik') ? '▾' : '▴';
  });

  let sonLogImza = '';

  function logGuncelle(state) {
    const olaylar = (state.olaylar || []).slice(-8);
    const imza = olaylar.length + ':' + (olaylar.length ? olaylar[olaylar.length - 1].tSn : 0);
    if (imza === sonLogImza) return;
    sonLogImza = imza;

    // ince şerit: en yeni olay
    if (olaylar.length === 0) {
      altLogZaman.textContent = ''; altLogTip.textContent = '';
      altLogMesaj.textContent = 'Henüz olay yok.';
    } else {
      const son = olaylar[olaylar.length - 1];
      altLogZaman.textContent = logZamanMetni(son.tSn, gunlukSureSn);
      altLogTip.textContent = TIP_SIMGE[son.tip] || '·';
      altLogTip.style.color = tipRenk(son.tip);
      altLogMesaj.textContent = son.mesaj;
    }

    // açılır liste: en yeni üstte
    logAcilirGovde.textContent = '';
    if (olaylar.length === 0) {
      logAcilirGovde.appendChild(el('div', 'mh-log-bos', 'Henüz olay yok.'));
      return;
    }
    for (let i = olaylar.length - 1; i >= 0; i--) {
      const o = olaylar[i];
      const satir = el('div', 'mh-log-satir');
      satir.appendChild(el('span', 'mh-log-zaman', logZamanMetni(o.tSn, gunlukSureSn)));
      const tip = el('span', 'mh-log-tip', TIP_SIMGE[o.tip] || '·');
      tip.style.color = tipRenk(o.tip);
      satir.appendChild(tip);
      satir.appendChild(el('span', 'mh-log-mesaj', o.mesaj));
      logAcilirGovde.appendChild(satir);
    }
  }

  // ===================== 7) CASTLE-WALL ZAMAN MERDİVENİ =====================
  // Rapordaki VSM zaman merdiveninin canlısı: üst basamaklar buffer beklemeleri
  // (NVA, gün), alt çentikler istasyon işlem süreleri (VA, sn). Motor istasyon-başı
  // bekleme yayınlamadığından beklemeler buffer adedi × takt'tan türetilir (nvaGun).
  // Mobil kırılımda dar ekranı boğmasın diye katlanmış başlar (başlıktan açılır).
  const duvarPanel = panel('Zaman Merdiveni — bekleme (NVA) / işlem (VA)', mobilMi());
  duvarPanel.p.classList.add('mh-duvar');
  kok.appendChild(duvarPanel.p);
  const duvarTuval = el('canvas', 'mh-duvar-tuval');
  duvarPanel.govde.appendChild(duvarTuval);

  const duvarDip = el('div', 'mh-duvar-dip');
  const lejant = (renk, ad) => {
    const s = el('span', 'mh-duvar-lejant');
    const r = el('span', 'mh-duvar-renk');
    r.style.background = renk;
    s.appendChild(r); s.appendChild(el('span', 'mh-anahtar', ad));
    return s;
  };
  duvarDip.appendChild(lejant(RENK.nva, 'bekleme (gün)'));
  duvarDip.appendChild(lejant(RENK.va, 'işlem (sn)'));
  const duvarLtEl = el('span');
  const duvarVaEl = el('span');
  const duvarPceEl = el('span');
  duvarDip.appendChild(duvarLtEl); duvarDip.appendChild(duvarVaEl); duvarDip.appendChild(duvarPceEl);
  const duvarHedefEl = el('span', 'mh-anahtar',
    `hedef: LT ${fmtOndalik(fut.leadTimeGun, 1)} gün · PCE ${fmtYuzdeDeger(fut.pceYuzde, 3)}`);
  duvarHedefEl.style.marginLeft = 'auto';
  duvarDip.appendChild(duvarHedefEl);
  duvarPanel.govde.appendChild(duvarDip);

  // hover ipucu (canvas işaretleri için per-mark tooltip)
  const duvarIpucu = el('div', 'mh-duvar-ipucu');
  duvarPanel.govde.appendChild(duvarIpucu);
  let duvarHitler = [];
  duvarTuval.addEventListener('mousemove', (e) => {
    const r = duvarTuval.getBoundingClientRect();
    const x = e.clientX - r.left;
    const hit = duvarHitler.find((h) => x >= h.x1 && x <= h.x2);
    if (!hit) { duvarIpucu.style.display = 'none'; return; }
    duvarIpucu.textContent = hit.metin;
    duvarIpucu.style.display = 'block';
    duvarIpucu.style.left = Math.max(0, Math.min(x + 12, r.width - 240)) + 'px';
    duvarIpucu.style.top = '2px';
  });
  duvarTuval.addEventListener('mouseleave', () => { duvarIpucu.style.display = 'none'; });

  // Sabit ölçek çapası: tam genişlik = mevcut durum LT'si (17,5 gün). Senaryo
  // geçişinde buffer'lar kanban limitine eridikçe merdiven gözle görülür çöker,
  // sağda kazanılan zaman boş kalır.
  const duvarRefLtGun = cur.leadTimeGun;

  function duvarCiz(state) {
    const veri = castleWallVerisi(state.bufferlar, state.senaryo, factoryData);
    const cv = duvarTuval;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = cv.clientWidth || 600, h = cv.clientHeight || 86;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 2, padR = 2, VA_W = 16, GAP = 2; // 2px yüzey boşlukları
    const adimlar = veri.adimlar;
    const vaSayi = adimlar.filter((a) => a.tip === 'va').length;
    const sabitPx = vaSayi * VA_W + (adimlar.length - 1) * GAP;
    const nvaAlanPx = Math.max(40, w - padL - padR - sabitPx);
    const oran = duvarRefLtGun > 0 ? Math.min(1, veri.nvaGunToplam / duvarRefLtGun) : 1;
    const nvaPx = nvaAlanPx * oran;
    const nvaUst = 13;        // NVA basamak üstü (üstte gün etiketi payı)
    const midY = h - 26;      // merdiven tabanı
    const vaAlt = midY + 13;  // VA çentik altı (altta sn etiketi payı)

    duvarHitler = [];
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    let x = padL;
    for (const a of adimlar) {
      let bw;
      if (a.tip === 'nva') {
        bw = veri.nvaGunToplam > 0 ? Math.max(3, nvaPx * (a.gun / veri.nvaGunToplam)) : 3;
        ctx.fillStyle = RENK.nva;
        ctx.fillRect(x, nvaUst, bw, midY - nvaUst);
        if (bw >= 30) { // seçici doğrudan etiket — her kutuya değil, sığana
          ctx.fillStyle = RENK.murekkepIkincil; // metin mürekkep giyer, seri rengini değil
          ctx.fillText(fmtOndalik(a.gun, 1) + ' g', x + bw / 2, nvaUst - 3);
        }
        duvarHitler.push({ x1: x, x2: x + bw,
          metin: `${a.ad} — bekleme ${fmtOndalik(a.gun, 1)} gün (${fmtTam(a.adet)} adet × takt ${fmtTam(taktSn)} sn)` });
      } else {
        bw = VA_W;
        ctx.fillStyle = RENK.va;
        ctx.fillRect(x, midY + 1, bw, vaAlt - midY - 1);
        ctx.fillStyle = RENK.murekkepIkincil;
        ctx.fillText(fmtTam(a.sn), x + bw / 2, vaAlt + 10);
        duvarHitler.push({ x1: x, x2: x + bw,
          metin: `${a.ad} — işlem ${fmtOndalik(a.sn, 1)} sn (katma değerli)` });
      }
      x += bw + GAP;
    }
    // merdiven taban çizgisi (hairline)
    ctx.strokeStyle = RENK.cizgi; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, midY + 0.5); ctx.lineTo(w - padR, midY + 0.5); ctx.stroke();

    duvarLtEl.innerHTML = `<span class="mh-anahtar">Toplam LT ≈ </span><b>${fmtOndalik(veri.toplamLtGun, 1)} gün</b>`;
    duvarVaEl.innerHTML = `<span class="mh-anahtar">VA </span><b>${fmtTam(veri.vaTabanSn)} sn</b>`;
    duvarPceEl.innerHTML = `<span class="mh-anahtar">PCE </span><b>${fmtYuzdeDeger(veri.pceYuzde, 3)}</b>`;
  }

  // ===================== güncelleme döngüsü =====================
  let oncekiSenaryo = null;
  let oncekiZamanSn = 0;
  let sonKaroDegerleri = null; // önceki karenin karo değerleri: Δ çip tabanı geçiş ANINDAN
                               // alınmalı — geçiş sonrası ilk kare pencere-sıfırlama çukurunu okur
  let sonAgirMs = 0;
  let sonSaatMetni = '';

  function update(state) {
    // sıfırlama tespiti (zaman geri sardıysa)
    if (state.zamanSn < oncekiZamanSn - 1) gecmisiTemizle();
    oncekiZamanSn = state.zamanSn;

    // senaryo geçişi → sparkline işareti + Δ çip tabanı + buton/çubuk tazele
    if (oncekiSenaryo !== state.senaryo) {
      if (oncekiSenaryo !== null) {
        isaretler.push(state.gun);
        // geçiş anındaki değerlerin izi: karolarda mevcut→gelecek Δ çipi olarak yaşar
        cipTaban = { _gun: state.gun };
        for (const { t } of karoElemanlari) {
          cipTaban[t.alan] = (sonKaroDegerleri && Number.isFinite(sonKaroDegerleri[t.alan]))
            ? sonKaroDegerleri[t.alan] : t.oku(state);
        }
      }
      for (const { id, b } of senBtnler) b.classList.toggle('mh-aktif', id === state.senaryo);
      taktCiz(state.senaryo);
      oncekiSenaryo = state.senaryo;
    }

    // saat her karede (ucuz, sadece değişince yaz)
    const saat = gunVardiyaMetni(state.gun, state.vardiya);
    if (saat !== sonSaatMetni) { saatEl.textContent = saat; sonSaatMetni = saat; }

    // örnekleme: ~0,1 sim-günde bir
    let yeniOrnek = false;
    if (state.gun - sonOrnekGun >= ORNEK_ADIM_GUN || ornekler.length === 0) {
      ornekler.push({
        gun: state.gun, wip: state.kpi.wipAdet, cikti: state.kpi.gunlukCikti,
        lt: state.kpi.leadTimeGun, oee: state.kpi.kaynakOee,
      });
      sonOrnekGun = state.gun;
      const esik = state.gun - PENCERE_GUN - 1;
      while (ornekler.length && ornekler[0].gun < esik) ornekler.shift();
      while (isaretler.length && isaretler[0] < esik) isaretler.shift();
      yeniOrnek = true;
    }

    // ağır bölüm ~5 Hz
    const simdiMs = Date.now();
    if (simdiMs - sonAgirMs < 200 && !yeniOrnek) return;
    sonAgirMs = simdiMs;

    hizIsaretle();
    solKonumla();

    // üst şerit karoları: değer + referansa göre fark oku (ayrıntı sol panelde)
    // + senaryo geçildiyse canlı Δ çipi (geçiş anındaki değere göre)
    const karoAnlik = {};
    for (const { t, deger, fark, cip } of karoElemanlari) {
      const canli = t.oku(state);
      karoAnlik[t.alan] = canli;
      deger.textContent = t.fmt(canli);
      const yon = farkYonu(canli, t.ref, t.dususIyi);
      fark.className = 'mh-fark mh-' + yon;
      fark.textContent = farkOku(canli, t.ref);
      const m = (cipTaban && Number.isFinite(cipTaban[t.alan]))
        ? deltaYuzdeMetni(cipTaban[t.alan], canli) : null;
      if (m != null) {
        cip.textContent = 'Δ' + m;
        cip.className = 'mh-cip mh-goster mh-' + farkYonu(canli, cipTaban[t.alan], t.dususIyi);
        cip.title = `Senaryo geçiş anına göre değişim (Gün ${Math.floor(cipTaban._gun) + 1}'de ${t.fmt(cipTaban[t.alan])} idi)`;
      } else {
        cip.className = 'mh-cip';
      }
    }
    sonKaroDegerleri = karoAnlik;

    for (const { t, deger, fark } of kpiSatirlar) {
      const canli = t.oku(state);
      deger.textContent = t.fmt(canli);
      const yon = farkYonu(canli, t.ref, t.dususIyi);
      const ok = farkOku(canli, t.ref);
      fark.className = 'mh-fark mh-' + yon;
      fark.textContent = ok === '•' ? '• ref' : `${ok} ${t.fmt(Math.abs(canli - t.ref))}`;
      fark.title = `Referansa göre fark (${t.dususIyi ? 'düşüş iyi' : 'artış iyi'})`;
    }

    istGuncelle(state);
    edGuncelle(state);
    logGuncelle(state);
    duvarCiz(state); // basamak genişlikleri gerçek buffer durumundan nefes alır (~5 Hz)

    if (yeniOrnek) {
      sparkCiz(wipSpark, 'wip', fut.wipAdet);       // hedef 4.500 hairline
      sparkCiz(ciktiSpark, 'cikti', gunlukTalep);   // talep 818 hairline
      wipSpark.deger.textContent = fmtTam(state.kpi.wipAdet);
      ciktiSpark.deger.textContent = fmtTam(state.kpi.gunlukCikti);
      for (const { t, spark } of karoElemanlari) miniSparkCiz(spark, t.alan, t.renk);
    }
  }

  return { update };
}
