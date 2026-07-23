// MetSac A.Ş. — değer akışı simülasyon motoru (saf JS, ES module)
// DOM/canvas bilmez; yalnız durum üretir. Tüm parametreler data/factory.json'dan gelir
// (createSim(factoryData)); motora sayı gömülen istisnalar yorumlarla işaretlidir.
//
// Mimari: sabit 1 sn'lik adım; tick(dtSn) kesirleri biriktirir, tam saniyeleri işler.
// Push (current): MRP günlük iş emri (818 iyi adet/gün; salım ve ara hedefler hurda
// telafili brüt adettir) + kaynak fazla mesaisi; pull (future): kanban süpermarket
// limitleri + AGV milk-run. OEE kayan 1 günlük pencereyle ölçülür.

// ---- deterministik RNG (mulberry32) ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSim(factoryData) {
  const fd = factoryData;
  const GUN = fd.gunlukSureSn;          // 54.000 sn
  const TALEP = fd.gunlukTalep;         // 818 adet/gün
  const MTTR_SN = fd.maintenance.mevcut.mttrSaat * 3600; // tamir süresi (sabit; ortalaması MTTR olsun diye üstel yerine sabit seçildi — kalibrasyon varyansını düşürür)

  // Parti değişimi varsayımı: dokümanda parti büyüklüğü verilmez; ~450 adet
  // (≈ yarım günlük talep) kabul edildi — Bükme her ~450 parçada bir setup yapar.
  // (_kaynak: görev tanımı; factory.json'da alan yok)
  const PARTI_ADET = 450;
  // "Yangın söndürme": bukme_kaynak stoğu 6 günlük talebi aşarsa MRP hammadde salımı donar.
  // (_kaynak: görev tanımı; klasik MRP push davranışı)
  const ASIRI_STOK_ADET = 6 * TALEP;
  // Future kalite 0,98 — kpis.future._kaynak: "OEE sonra = 0,92 × 0,92 × 0,98";
  // JSON'da ayrık sayısal alan bulunmadığından buraya yazıldı.
  const KALITE_FUT = 0.98;
  // Future performans, JSON'dan türetilir: oeeML = availML × perf × kalite → perf ≈ 0,92
  const PERF_FUT = fd.kpis.future.oeeMLPrototip /
    (fd.kpis.future.kaynakKullanilabilirlikMLPrototip * KALITE_FUT);
  // Kaynak MTBF'leri: dokümanda plansız duruş TOPLAM sürenin yüzdesidir (%16 / %4,97).
  // Planlı bakım (%4) ayrıca modellendiğinden, arıza sayacı yalnız çalışma saniyelerinde
  // ilerlerken bu toplam-bazlı payı tutturmak için MTBF çalışma-bazına ölçeklenir:
  // MTBF = MTTR × (1 − planlı − plansız) / plansız  (mevcut: 7.200 × 0,80/0,16 = 36.000 sn = 10,0 sa;
  // json mtbfSaat 10,5 aynı MTTR=2 sa türetiminin bakım-çakışmasız hâlidir).
  const P_PLANLI = fd.maintenance.mevcut.planliDurusYuzde / 100;
  function mtbfToplamPaydan(pPlansiz) {
    return MTTR_SN * (1 - P_PLANLI - pPlansiz) / pPlansiz;
  }
  const MTBF_CUR_SN = mtbfToplamPaydan(fd.maintenance.mevcut.plansizDurusYuzde / 100);
  const MTBF_FUT_SN = mtbfToplamPaydan(fd.maintenance.etki.plansizDurusYeniYuzde / 100);
  // Kaynak planlı bakımı (%4): her gün başında blok halinde ('setup' durumu, mesaj: planlı bakım)
  const BAKIM_GUN_SN = Math.round(fd.maintenance.mevcut.planliDurusYuzde / 100 * GUN);

  const beklemeTop = fd.flow.reduce((s, f) => s + f.beklemeGun, 0); // 17,5 gün

  // Kanban süpermarket limitleri: hedef WIP (kpis.future.wipAdet ≈ 4.500),
  // flow[].beklemeGun oranlarıyla buffer'lara dağıtılır.
  const KANBAN_LIMIT = {};
  for (const f of fd.flow) {
    KANBAN_LIMIT[f.id] = Math.round(fd.kpis.future.wipAdet * f.beklemeGun / beklemeTop);
  }

  // Diğer istasyonların MTBF'i: Kaynak'la aynı MTTR=2 sa mantığı —
  // kullanılabilirlik a için MTBF = MTTR × a / (1−a) (duruşun tamamı plansız kabul edilir).
  function mtbfSnFor(a) { return MTTR_SN * a / (1 - a); }

  // OEE kayan penceresi: 900 sn'lik dilimler, kapsam = tam 1 sim-gün + dolan dilim.
  // Dilim sayısı D_N + 1: rotasyonda pencere "N−1 tam + 1 dolan" kapsadığından 60 dilimle
  // gün sonunda pencere 53.100 sn'ye düşüyor ve günün başındaki planlı bakım dilimi
  // sistematik olarak dışarıda kalıyordu (OEE ~+1,4 puan şişiyordu). 61 dilim bunu düzeltir.
  const D_SN = 900, D_N = Math.round(GUN / D_SN) + 1;

  // ---- değişken durum ----
  let seed = 1;
  let rng = mulberry32(seed);
  let hiz = 1;
  let sonKaynakOee = 0; // pencere dolana dek korunan son kararlı OEE
  let senaryo = 'current';
  let zamanSn = 0;
  let tickAcc = 0;
  let buf = {};
  let stations = [];
  let stMap = {};
  let agvler = [];
  let olaylar = [];
  let birikmis = 0;
  let sevkAcc = 0, salimAcc = 0;
  let planHedef = 0;   // kümülatif MRP iş emri hedefi (İYİ adet — müşteri talebi bazlı)
  let salimCarpan = 1; // hurda telafisi: salım = TALEP / (hat boyu kümülatif kalite)
  let dilimler = [], dIdx = 0;
  let topl = { sn: 0, durus: 0, disi: 0, adet: 0, iyi: 0, cikti: 0 };

  function expSample(meanSn) { return -Math.log(1 - rng()) * meanSn; }

  function olayEkle(tip, istasyon, mesaj) {
    olaylar.push({ tSn: zamanSn, tip, istasyon, mesaj });
    if (olaylar.length > 20) olaylar.shift();
  }

  function pencereSifirla() {
    dilimler = Array.from({ length: D_N }, () => ({ sn: 0, durus: 0, disi: 0, adet: 0, iyi: 0, cikti: 0 }));
    dIdx = 0;
    topl = { sn: 0, durus: 0, disi: 0, adet: 0, iyi: 0, cikti: 0 };
  }

  function applyScenario() {
    const fut = senaryo === 'future';
    for (const st of stations) {
      const c = st.cfg;
      if (c.id === 'kaynak') {
        if (fut) {
          st.nominal = fd.kpis.future.kaynakNominalCevrimSn;      // 37,5 sn (2. robot)
          st.perf = PERF_FUT;                                     // ≈ 0,92
          st.kalite = KALITE_FUT;                                 // 0,98
          st.mtbfSn = MTBF_FUT_SN;                                // ML prototip: plansız %4,97
        } else {
          st.nominal = c.cevrimSn;                                // 75 sn
          st.perf = c.performans;                                 // 0,90 (mikro duruş: çevrim 1/0,90 uzar)
          st.kalite = c.kalite;                                   // 0,95 (%5 hurda)
          st.mtbfSn = MTBF_CUR_SN;                                // ≈ 10,0 sa (bkz. üstteki ölçekleme)
        }
        st.bakimGunSn = BAKIM_GUN_SN;                             // planlı %4 her iki senaryoda
      } else {
        st.nominal = c.cevrimSn;
        st.perf = 1;
        st.kalite = 1;
        st.mtbfSn = mtbfSnFor(c.kullanilabilirlik);
        st.bakimGunSn = 0;
      }
      st.efektif = st.nominal / st.perf;
      // Bükme setup: her ~PARTI_ADET parçada bir; SMED sonrası 8 dk (_kaynak: kpis.future.bukmeSetupDk)
      st.setupSn = c.setupDk != null
        ? (fut ? fd.kpis.future.bukmeSetupDk : c.setupDk) * 60
        : 0;
      // MTBF değişmiş olabilir → sonraki arıza yeniden örneklenir
      st.calismaSnAriza = 0;
      st.sonrakiArizaSn = expSample(st.mtbfSn);
      st.hatYaniKasa = fut ? (fd.agv.hatYaniStokKasa[c.id] ?? null) : null;
      st.kasaAcc = 0;
    }
    // Hurda telafisi: plan hedefi iyi-adet bazlı (818/gün) kalır; salım ve istasyonların
    // ara hedefleri brüt adede çevrilir. Bir istasyonun iyi-çıktı gereksinimi, KENDİSİNDEN
    // SONRAKİ istasyonların kümülatif kalitesiyle şişirilir (uretilenAdet zaten iyi adet
    // saydığından kendi kalitesi hariç); hammadde salımı tüm hattın kümülatif kalitesine
    // bölünür. Mevcut durumda tek fireli istasyon Kaynak (0,95) → salım ≈ 818/0,95 ≈ 861/gün,
    // Kesme/Bükme hedefi 861/gün, Kaynak/Boya/Montaj hedefi 818 iyi/gün.
    let kumKalite = 1;
    for (let i = stations.length - 1; i >= 0; i--) {
      stations[i].planCarpan = 1 / kumKalite;
      kumKalite *= stations[i].kalite;
    }
    salimCarpan = 1 / kumKalite;
    if (fut) {
      agvler = fd.agv.rotalar.map(r => {
        const bacak = r.duraklar.length - 1;
        const bacakSn = Math.round(r.periyotDk * 60 / bacak);
        const bekleSn = Math.max(20, Math.round(bacakSn * 0.15)); // durakta yükleme payı (~%15)
        return {
          cfgRota: r, id: r.agv, duraklar: r.duraklar,
          durakIdx: 0, faz: 'durakta', sayac: 0,
          yukKasa: r.turBasiYukKasa, yolSn: bacakSn - bekleSn, bekleSn
        };
      });
    } else {
      agvler = [];
    }
    // Senaryo geçişinde ölçüm penceresi temiz başlar (eski rejim yeni KPI'yı kirletmesin)
    pencereSifirla();
  }

  function resetInternal() {
    rng = mulberry32(seed);
    zamanSn = 0; tickAcc = 0;
    birikmis = 0; sevkAcc = 0; salimAcc = 0; planHedef = TALEP;
    olaylar = [];
    sonKaynakOee = 0;
    buf = {};
    for (const f of fd.flow) buf[f.id] = Math.round(f.beklemeGun * TALEP); // toplam ≈ 14.315
    stations = fd.stations.map(c => ({
      cfg: c,
      giris: fd.flow.find(f => f.sonrakiIstasyon === c.id).id,
      cikis: fd.flow.find(f => f.oncekiIstasyon === c.id).id,
      durum: 'bosta', parcaVar: false, bekleyen: false,
      kalanCevrimSn: 0, kalanDurusSn: 0, durusTipi: null, kalanBakimSn: 0,
      uretilenAdet: 0, hurdaAdet: 0, partiSayac: 0,
      calismaSnAriza: 0, sonrakiArizaSn: 0,
      nominal: 0, perf: 1, kalite: 1, efektif: 0, mtbfSn: 0, bakimGunSn: 0,
      setupSn: 0, hatYaniKasa: null, kasaAcc: 0, planCarpan: 1
    }));
    stMap = {};
    for (const st of stations) stMap[st.cfg.id] = st;
    senaryo = 'current';
    applyScenario();
  }

  // Tamamlanan parçayı sonraki buffer'a itmeyi dener (kanban limiti future'da bağlar)
  function pushCikti(st) {
    if (senaryo === 'future' && buf[st.cikis] >= KANBAN_LIMIT[st.cikis]) return false;
    buf[st.cikis]++;
    return true;
  }

  function stepStation(st, cur) {
    // 1) arıza / setup duruşu
    if (st.kalanDurusSn > 0) {
      st.durum = st.durusTipi;
      st.kalanDurusSn--;
      if (st.kalanDurusSn === 0 && st.durusTipi === 'arizali') {
        olayEkle('tamir', st.cfg.id, `${st.cfg.ad} tamir edildi`);
      }
      return;
    }
    // 2) planlı bakım (yalnız Kaynak; gün başında atanır) — 'setup' durumuyla gösterilir
    if (st.kalanBakimSn > 0) { st.durum = 'setup'; st.kalanBakimSn--; return; }
    // 3) bekleyen (bloke) çıktı
    if (st.bekleyen) {
      if (pushCikti(st)) st.bekleyen = false;
      else { st.durum = 'bloke'; return; }
    }
    // 4) parça çek
    if (!st.parcaVar) {
      // MRP (push): kümülatif iş emri tamamsa istasyon durur — plana göre üretim;
      // dünden kalan açık ertesi gün(ler) kapasiteyle telafi edilir. planCarpan,
      // iyi-adet planını istasyonun brüt gereksinimine çevirir (hurda telafisi).
      if (senaryo === 'current' && st.uretilenAdet >= planHedef * st.planCarpan) { st.durum = 'bosta'; return; }
      // Kanban (pull): süpermarket doluysa üretme (bloke)
      if (senaryo === 'future' && buf[st.cikis] >= KANBAN_LIMIT[st.cikis]) { st.durum = 'bloke'; return; }
      if (buf[st.giris] <= 0) { st.durum = 'ac'; return; }
      // Hat-yanı kasa bitti → açlık (AGV tazeleyene dek)
      if (st.hatYaniKasa !== null && st.hatYaniKasa <= 0) { st.durum = 'ac'; return; }
      // Bükme parti değişimi: her PARTI_ADET parçada bir setup
      if (st.setupSn > 0 && st.partiSayac >= PARTI_ADET) {
        st.partiSayac = 0;
        st.kalanDurusSn = st.setupSn;
        st.durusTipi = 'setup';
        st.durum = 'setup';
        olayEkle('setup', st.cfg.id, `${st.cfg.ad} kalıp değişimi (${Math.round(st.setupSn / 60)} dk)`);
        return;
      }
      buf[st.giris]--;
      st.parcaVar = true;
      st.kalanCevrimSn += st.efektif; // kesir borcu devreder → ortalama hız tam doğru
      st.partiSayac++;
    }
    // 5) arıza kontrolü (çalışılan saniye bazlı üstel arıza aralığı)
    st.calismaSnAriza++;
    if (st.calismaSnAriza >= st.sonrakiArizaSn) {
      st.calismaSnAriza = 0;
      st.sonrakiArizaSn = expSample(st.mtbfSn);
      st.kalanDurusSn = Math.round(MTTR_SN);
      st.durusTipi = 'arizali';
      st.durum = 'arizali';
      olayEkle('ariza', st.cfg.id, `${st.cfg.ad} arızalandı (tamir ~${fd.maintenance.mevcut.mttrSaat} sa)`);
      return;
    }
    // 6) işle
    st.durum = 'calisiyor';
    st.kalanCevrimSn -= 1;
    if (st.hatYaniKasa !== null) { // hat-yanı kasa tüketimi
      st.kasaAcc += st.cfg.kasaTalepDk / 60;
      if (st.kasaAcc >= 1) { st.kasaAcc -= 1; st.hatYaniKasa = Math.max(0, st.hatYaniKasa - 1); }
    }
    if (st.kalanCevrimSn <= 0) {
      st.parcaVar = false;
      const iyi = st.kalite >= 1 || rng() < st.kalite;
      if (st.cfg.id === 'kaynak') { // OEE penceresi (vardiya içi üretim)
        cur.adet++; topl.adet++;
        if (iyi) { cur.iyi++; topl.iyi++; }
      }
      if (iyi) {
        st.uretilenAdet++;
        if (st.cfg.id === 'montaj') { cur.cikti++; topl.cikti++; }
        if (!pushCikti(st)) st.bekleyen = true;
      } else {
        st.hurdaAdet++; // hurda: buffer'a girmez
      }
    }
  }

  function stepAgv(a) {
    a.sayac++;
    if (a.faz === 'durakta') {
      if (a.sayac >= a.bekleSn) { a.faz = 'yolda'; a.sayac = 0; }
      return;
    }
    if (a.sayac >= a.yolSn) {
      a.sayac = 0; a.faz = 'durakta';
      // rotanın son durağı = ilk durağı (n1); indeks sarar
      a.durakIdx = (a.durakIdx + 1) % (a.duraklar.length - 1);
      const d = a.duraklar[a.durakIdx];
      if (d === 'n1') {
        a.yukKasa = a.cfgRota.turBasiYukKasa; // süpermarkette dolum
        olayEkle('agvYukleme', null, `${a.id} süpermarkette yüklendi (${a.yukKasa} kasa)`);
      } else {
        const st = stMap[d];
        if (st && st.hatYaniKasa !== null) {
          const hedef = fd.agv.hatYaniStokKasa[d] ?? 0;
          const ver = Math.min(Math.max(0, hedef - st.hatYaniKasa), a.yukKasa);
          st.hatYaniKasa += ver;
          a.yukKasa -= ver;
        }
      }
    }
  }

  function yeniGun() {
    const kaynak = stMap.kaynak;
    planHedef = TALEP * (zamanSn / GUN + 1); // kümülatif MRP iş emri
    // Fazla mesai (yalnız push): kaynağın plana göre kümülatif açığı vardiya dışı
    // kapatılır — MRP'nin talebi zorla dengeleme "acısı"; OEE penceresine sayılmaz.
    // Hurda telafisiyle etkileşim: Kaynak'ın planı iyi-adet bazlıdır (planCarpan=1,
    // ardındaki Boya/Montaj firesizdir); blok zaten çekişi kaynak.kalite'ye bölerek
    // brütleştirdiğinden (aşağıdaki cek) telafiyle tutarlıdır — çift sayım yok.
    if (senaryo === 'current' && zamanSn > 0) {
      const acik = TALEP * (zamanSn / GUN) - kaynak.uretilenAdet;
      if (acik > 0 && buf.bukme_kaynak > 0) {
        const cek = Math.min(buf.bukme_kaynak, Math.ceil(acik / kaynak.kalite));
        const iyi = Math.min(acik, Math.round(cek * kaynak.kalite)); // toplu işlem: deterministik hurda
        buf.bukme_kaynak -= cek;
        buf.kaynak_boya += iyi;
        kaynak.uretilenAdet += iyi;
        kaynak.hurdaAdet += cek - iyi;
        // 'fazlaMesai' tipi CONTRACT enum'una eklenmiş uzantıdır (UI bilinmeyen tipi yok sayabilir)
        olayEkle('fazlaMesai', 'kaynak', `Fazla mesai: Kaynak açığı ${iyi} adet vardiya dışı kapatıldı`);
      }
    }
    kaynak.kalanBakimSn = kaynak.bakimGunSn; // günlük planlı bakım bloğu
  }

  function step() {
    if (zamanSn % GUN === 0) yeniGun();
    // hammadde salımı: MRP planı 818 iyi/gün × hurda telafisi (≈861/gün brüt);
    // aşırı stokta donar (push) / süpermarket limiti (pull)
    const donuk = senaryo === 'current'
      ? buf.bukme_kaynak > ASIRI_STOK_ADET
      : buf.hammadde >= KANBAN_LIMIT.hammadde;
    if (!donuk) {
      salimAcc += TALEP * salimCarpan / GUN;
      while (salimAcc >= 1) { salimAcc -= 1; buf.hammadde++; }
    }
    const cur = dilimler[dIdx];
    for (const st of stations) stepStation(st, cur);
    for (const a of agvler) stepAgv(a);
    // müşteri çekişi: 818/gün düzenli sevkiyat; stok yoksa birikmiş sipariş
    sevkAcc += TALEP / GUN;
    while (sevkAcc >= 1) {
      sevkAcc -= 1;
      if (buf.bitmis_urun > 0) buf.bitmis_urun--;
      else birikmis++;
    }
    while (birikmis > 0 && buf.bitmis_urun > 0) { birikmis--; buf.bitmis_urun--; } // telafi sevkiyatı
    // OEE penceresi (kaynak): arıza+bakım = duruş; bloke/aç/boşta = plan dışı (eligible'dan düşülür)
    const kd = stMap.kaynak.durum;
    if (kd === 'arizali' || kd === 'setup') { cur.durus++; topl.durus++; }
    else if (kd !== 'calisiyor') { cur.disi++; topl.disi++; }
    cur.sn++; topl.sn++;
    if (cur.sn >= D_SN) {
      dIdx = (dIdx + 1) % D_N;
      const e = dilimler[dIdx];
      topl.sn -= e.sn; topl.durus -= e.durus; topl.disi -= e.disi;
      topl.adet -= e.adet; topl.iyi -= e.iyi; topl.cikti -= e.cikti;
      e.sn = 0; e.durus = 0; e.disi = 0; e.adet = 0; e.iyi = 0; e.cikti = 0;
    }
    zamanSn++;
  }

  function getState() {
    const kaynak = stMap.kaynak;
    const sn = Math.max(1, topl.sn);
    const eligible = Math.max(1, sn - topl.disi);         // planlanan süre (bloke/aç/boşta hariç)
    const calisma = Math.max(0, eligible - topl.durus);
    // Pencere sıfırlandıktan hemen sonra (senaryo geçişi) örneklem çok küçükken P çarpanı
    // sınırsız büyüyüp OEE'yi %3.750 gibi gösterebiliyordu: en az bir tam dilim (900 sn)
    // dolana dek son kararlı değer korunur; OEE tanım gereği 1'e kırpılır.
    let kaynakOee = sonKaynakOee;
    if (topl.adet > 0 && calisma > 0 && topl.sn >= D_SN) {
      const A = calisma / eligible;
      const P = kaynak.nominal * topl.adet / calisma;
      const Q = topl.iyi / topl.adet;
      kaynakOee = Math.min(1, A * P * Q); // = nominal × iyi / eligible
      sonKaynakOee = kaynakOee;
    }
    const gunlukCikti = topl.cikti * GUN / sn;
    let wip = 0;
    for (const f of fd.flow) wip += buf[f.id];
    const leadTimeGun = gunlukCikti > 0 ? wip / gunlukCikti : 0;
    // katma değerli süre: kaynak dokümanın 250 sn tabanı (kpis.current.katmaDegerliSn) —
    // senaryo_ve_sayilar.md her iki senaryonun PCE'sini de 250 sn ile türetir
    // (future %0,084 = 250 / (5,5 × 54.000)); Σnominal (212,5 sn) KULLANILMAZ.
    const katma = fd.kpis.current.katmaDegerliSn;
    const pceYuzde = leadTimeGun > 0 ? katma / (leadTimeGun * GUN) * 100 : 0;

    const istasyonlar = {};
    for (const st of stations) {
      const durusKalan = st.kalanDurusSn > 0 ? st.kalanDurusSn
        : (st.kalanBakimSn > 0 ? st.kalanBakimSn : null);
      istasyonlar[st.cfg.id] = {
        durum: st.durum,
        cevrimIlerleme: st.parcaVar
          ? Math.min(1, Math.max(0, 1 - st.kalanCevrimSn / st.efektif))
          : 0,
        uretilenAdet: st.uretilenAdet,
        kalanDurusSn: durusKalan,
        hatYaniKasa: st.hatYaniKasa
      };
    }

    return {
      zamanSn,
      gun: zamanSn / GUN,
      vardiya: (zamanSn % GUN) < GUN / 2 ? 1 : 2,
      hiz,
      senaryo,
      istasyonlar,
      bufferlar: { ...buf },
      agvler: agvler.map(a => ({
        id: a.id,
        durakSirasi: a.duraklar.slice(),
        durakIdx: a.durakIdx,
        ilerleme: a.faz === 'yolda' ? Math.min(1, a.sayac / a.yolSn) : 0,
        yukKasa: a.yukKasa,
        durumda: a.faz
      })),
      kpi: {
        wipAdet: wip,
        leadTimeGun,
        pceYuzde,
        kaynakOee,
        gunlukCikti,
        ciktiTaktSn: gunlukCikti > 0 ? GUN / gunlukCikti : 0,
        birikmisSiparis: birikmis
      },
      olaylar: olaylar.slice()
    };
  }

  resetInternal();

  return {
    tick(dtSn) {
      if (!(dtSn > 0)) return;
      tickAcc += dtSn;
      let n = Math.floor(tickAcc);
      tickAcc -= n;
      while (n-- > 0) step();
    },
    getState,
    setScenario(id) {
      if (id !== 'current' && id !== 'future') return;
      if (id === senaryo) return;
      senaryo = id;
      applyScenario(); // buffer'lara dokunulmaz: fazla stok kanban limitine doğal erir
      olayEkle('senaryoGecis', null,
        id === 'future'
          ? 'Gelecek durum: kanban + süpermarket + AGV milk-run + 2. kaynak robotu + ML bakım'
          : 'Mevcut durum: MRP itme düzeni');
    },
    setSpeed(x) { if (x >= 0 && Number.isFinite(x)) hiz = x; }, // 0 = duraklat (brifing + ⏸)
    getSpeed() { return hiz; },
    // Sandbox: bir buffer'ın adetini anlık değiştir (sorun yarat → sistemin çözüşünü izle).
    // Kanban limiti bilerek uygulanmaz: fazlalık pull düzeninde doğal erimeli.
    setBuffer(id, adet) {
      if (!(id in buf)) return false;
      const n = Math.floor(Number(adet));
      if (!Number.isFinite(n) || n < 0) return false;
      buf[id] = n;
      olayEkle('mudahale', null, `Müdahale: ${id} → ${n} adet`);
      return true;
    },
    reset() { resetInternal(); },
    _setSeed(n) { seed = n >>> 0; resetInternal(); }
  };
}
