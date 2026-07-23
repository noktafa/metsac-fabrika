// Saf yardımcılar — DOM'suz, node ile test edilebilir.

/** 14315 → "14.315" (Türkçe binlik ayracı) */
export function formatAdet(n) {
  const yuvarlak = Math.round(Math.abs(Number(n) || 0));
  const isaret = n < 0 ? '-' : '';
  return isaret + String(yuvarlak).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 6 → "6,0" (kasa sayıları, tek ondalık, Türkçe virgül) */
export function formatKasa(n) {
  return (Number(n) || 0).toFixed(1).replace('.', ',');
}

/** 754 sn → "12:34" (kalan duruş sayacı) */
export function formatSure(sn) {
  const t = Math.max(0, Math.round(Number(sn) || 0));
  const dk = Math.floor(t / 60);
  return dk + ':' + String(t % 60).padStart(2, '0');
}

/**
 * Buffer adedi → yığında çizilecek görsel sandık sayısı (log ölçek).
 * 14.315 adet ≈ 14 sandık, 100 adet ≈ 6, 1 adet ≈ 1 → "dağ" hissi korunur,
 * ekran taşmaz.
 */
export function crateCountFor(adet) {
  const a = Number(adet) || 0;
  if (a < 1) return 0;
  return Math.max(1, Math.min(20, Math.round(Math.log10(1 + a) * 3.4)));
}

/** 0..1 doluluk oranı (log ölçek; ~15.000 adette 1'e doyar) */
export function bufferRatio(adet) {
  const a = Number(adet) || 0;
  if (a <= 0) return 0;
  return Math.min(1, Math.log10(1 + a) / Math.log10(15001));
}

const SARI = [232, 193, 112];
const KIRMIZI = [224, 60, 40];

/** doluluk oranı (0..1) → sarıdan kırmızıya CSS rengi */
export function bufferRenk(oran) {
  const t = Math.max(0, Math.min(1, Number(oran) || 0));
  const r = Math.round(SARI[0] + (KIRMIZI[0] - SARI[0]) * t);
  const g = Math.round(SARI[1] + (KIRMIZI[1] - SARI[1]) * t);
  const b = Math.round(SARI[2] + (KIRMIZI[2] - SARI[2]) * t);
  return `rgb(${r},${g},${b})`;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
