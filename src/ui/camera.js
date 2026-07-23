// Kamera matematiği — saf fonksiyonlar (test edilebilir), olay dinleyicileri renderer'da.

export const TILE = 48;          // 1 tile = 48 dünya pikseli (zoom 1×)
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

export function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Dünya sınırlarını (dünya pikseli) görünüme sığdıran kamera döner.
 * cam = { zoom, x, y } — x/y: ekranın sol-üst köşesinin dünya koordinatı.
 */
export function computeFit(bounds, viewW, viewH, pad = 32) {
  const vw = Math.max(64, viewW || 0);
  const vh = Math.max(64, viewH || 0);
  return computeFitRect(bounds, { x: 0, y: 0, w: vw, h: vh }, pad);
}

/**
 * Dünyayı görünümün bir ALT-dikdörtgenine sığdırır (HUD panelleri sahneye
 * binmesin diye kalan boş alana). rect: CSS pikseli cinsinden {x,y,w,h}.
 */
export function computeFitRect(bounds, rect, pad = 32) {
  const rw = Math.max(64, rect.w || 0);
  const rh = Math.max(64, rect.h || 0);
  const z = clampZoom(Math.min((rw - 2 * pad) / bounds.w, (rh - 2 * pad) / bounds.h));
  return {
    zoom: z,
    x: bounds.x + bounds.w / 2 - (rect.x + rw / 2) / z,
    y: bounds.y + bounds.h / 2 - (rect.y + rh / 2) / z,
  };
}

/** İmleç (px,py CSS pikseli) altındaki dünya noktası sabit kalacak şekilde zoom uygular. */
export function zoomAt(cam, px, py, carpan) {
  const z2 = clampZoom(cam.zoom * carpan);
  const wx = cam.x + px / cam.zoom;
  const wy = cam.y + py / cam.zoom;
  return { zoom: z2, x: wx - px / z2, y: wy - py / z2 };
}

export function screenToWorld(cam, px, py) {
  return { x: cam.x + px / cam.zoom, y: cam.y + py / cam.zoom };
}

/** Ekran pikseli → tam sayı tile koordinatı */
export function screenToTilePure(cam, px, py) {
  const w = screenToWorld(cam, px, py);
  return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
}
