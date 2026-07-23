// MetSac A.Ş. — Factorio-tarzı değer akışı simülasyonu
// Entegrasyon noktası: üç katmanı (sim, ui, hud) burada bağlarız.
// SÖZLEŞME — katman geliştiricileri bu imzalara uyar:
//   sim  : createSim(factoryData)            → { tick(dtSn), getState(), setScenario(id), setSpeed(x), getSpeed(), reset() }
//   ui   : createRenderer(canvas, factoryData) → { draw(simState, realDtSn), resize(), screenToTile(px,py) }
//   hud  : createHud(container, sim, factoryData) → { update(simState) }
// simState: saf serileştirilebilir nesne (istasyon durumları, buffer'lar, AGV, anlık KPI'lar).

import { createSim } from './sim/engine.js';
import { createRenderer } from './ui/renderer.js';
import { createHud, MOBIL_SORGU } from './hud/hud.js';
import { createStory } from './story/story.js';
import { createWalkthrough } from './story/walkthrough.js';

async function main() {
  const resp = await fetch('data/factory.json');
  if (!resp.ok) throw new Error(`factory.json yüklenemedi: ${resp.status}`);
  const factoryData = await resp.json();

  const canvas = document.getElementById('sahne');
  const hudEl = document.getElementById('hud');

  const sim = createSim(factoryData);
  const renderer = createRenderer(canvas, factoryData);
  const hud = createHud(hudEl, sim, factoryData);

  window.addEventListener('resize', () => renderer.resize());
  renderer.resize();

  document.getElementById('yukleniyor')?.remove();

  // Tanıtım turu: açılınca sim duraklar, kapanınca ÖNCEKİ hıza döner (⏸ modunda
  // açıldıysa önceki hız 0'dır — 0'a döner, 60'a zorlanmaz). Kendiliğinden açılmaz;
  // ilk-ziyaret akışı aşağıda brifing'in onBitti'sine bağlanır.
  let turOncesiHiz = 0;
  const tur = createWalkthrough(hudEl, factoryData, {
    onAc: () => { turOncesiHiz = sim.getSpeed(); sim.setSpeed(0); },
    onKapat: () => sim.setSpeed(turOncesiHiz),
  });

  // Açılış brifingi: HER sayfa açılışında (F5 dahil) baştan oynar; açıkken sim
  // duraklatılır, kapanınca en düşük kademede (1000×) başlar ve tur bir kez
  // otomatik açılır (1000× önce kurulur ki tur kapanışı 1000×'a dönsün). Sayfa içinde
  // ☰ Brifing ile elle açılan sonraki brifingler turu yeniden tetiklemez.
  sim.setSpeed(1000);
  let acilisZinciri = true;
  const story = createStory(hudEl, factoryData, {
    onSenaryoSec: (s) => sim.setScenario(s),
    onBitti: () => {
      sim.setSpeed(1000);
      if (acilisZinciri) { acilisZinciri = false; tur.ac(); }
    },
  });
  if (!story.acikMi()) story.ac(); // "izlendi" bayrağına bakılmaz: her açılışta göster
  sim.setSpeed(0);

  // Brifing + Tur düğmeleri ve altında rapor bağlantısı — üst şeridin flex akışında
  // dikey bir grup (mutlak konum Sıfırla ile çakışıyordu, akışta çakışma olmaz).
  const sagGrup = document.createElement('div');
  sagGrup.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:3px';

  const dugmeSatiri = document.createElement('div');
  dugmeSatiri.style.cssText = 'display:flex;gap:6px';
  const brifingBtn = document.createElement('button');
  brifingBtn.textContent = '☰ Brifing';
  brifingBtn.className = 'mh-btn mh-tek';
  brifingBtn.style.color = '#e8c170';
  brifingBtn.addEventListener('click', () => { sim.setSpeed(0); story.ac(); });
  dugmeSatiri.appendChild(brifingBtn);
  const turBtn = document.createElement('button');
  turBtn.textContent = '🧭 Tur';
  turBtn.className = 'mh-btn mh-tek';
  turBtn.style.color = '#e8c170';
  turBtn.addEventListener('click', () => tur.ac());
  dugmeSatiri.appendChild(turBtn);
  sagGrup.appendChild(dugmeSatiri);

  (hudEl.querySelector('.mh-ust') || hudEl).appendChild(sagGrup);

  // HUD'un kapladığı kenarları ölç → sahne kalan boş alana sığdırılsın
  // (sol sütun + üst şerit; panel daralt/genişlet ve pencere değişimlerini izler).
  // Mobil kırılımda (hud.js'teki CSS medya bloğuyla aynı sorgu) sol sütun alt
  // çekmecedir: sol kenar 0 olmalı (yoksa sol.right ≈ ekran genişliği olur ve
  // sahne yok olur); çekmece açıksa sahne çekmecenin üst kenarının üstünde kalır.
  const mobilSorgu = window.matchMedia(MOBIL_SORGU);
  function hudKenarlariniBildir() {
    const sol = hudEl.querySelector('.mh-sol');
    const ust = hudEl.querySelector('.mh-ust');
    // alt kenar: castle-wall paneli (varsa) yoksa olay şeridi — sahne üstünde kalsın
    const alt = hudEl.querySelector('.mh-duvar') || hudEl.querySelector('.mh-altlog');
    const mobil = mobilSorgu.matches;
    let bottom = alt ? Math.max(0, window.innerHeight - alt.getBoundingClientRect().top) : 0;
    if (mobil && sol) {
      const solRect = sol.getBoundingClientRect();
      // çekmece kapalıyken display:none → rect 0×0; yalnız açıkken hesaba katılır
      if (solRect.height > 0) bottom = Math.max(bottom, window.innerHeight - solRect.top);
    }
    renderer.setViewInsets({
      left: (!mobil && sol) ? sol.getBoundingClientRect().right : 0,
      top: ust ? ust.getBoundingClientRect().bottom : 0,
      bottom,
    });
  }

  // Oyun döngüsü: sim sabit 1 sn çözünürlükte içeride ilerler;
  // biz ona hız çarpanıyla ölçeklenmiş gerçek-zaman deltası veririz.
  let sonZaman = performance.now();
  let sonKenarMs = 0;
  function kare(simdi) {
    const realDtSn = Math.min((simdi - sonZaman) / 1000, 0.1); // sekme arka planda kalınca sıçramayı kes
    sonZaman = simdi;

    sim.tick(realDtSn * sim.getSpeed());
    const durum = sim.getState();
    renderer.draw(durum, realDtSn);
    hud.update(durum);

    // kenar ölçümü ~4 Hz yeter (panel aç/kapa, pencere değişimi)
    if (simdi - sonKenarMs > 250) { sonKenarMs = simdi; hudKenarlariniBildir(); }

    requestAnimationFrame(kare);
  }
  requestAnimationFrame(kare);

  // Konsoldan kurcalamak için:
  window.metsac = { sim, renderer, hud, factoryData };
}

main().catch(err => {
  console.error(err);
  const y = document.getElementById('yukleniyor');
  if (y) { y.textContent = 'HATA: ' + err.message; y.style.color = '#ff6b6b'; }
});
