// public/dev/radar/utils.js
export const degToRad = function degToRad(deg) {
  return (deg * Math.PI) / 180
}

export const wrapDeg = function wrapDeg(deg) {
  let d = deg % 360
  if (d < -180) d += 360
  if (d > 180) d -= 360
  return d
}

export const clamp01 = function clamp01(x) {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

export const clamp = function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x))
}
