// public/dev/radar-planner/geometry.js

const normalize = function normalize(deg) {
  let a = Number(deg)
  if (!Number.isFinite(a)) a = 0
  a = a % 360
  if (a < 0) a += 360
  return a
}

// World (planner) coordinates: +Y is up on the planner.
// SVG: +Y is down, so we invert world Y into SVG Y.
const worldToSvgY = function worldToSvgY(y) {
  return -Number(y)
}

// Convert display CW-from-North (0=up, 90=right) to internal math angle
// internal: 0=+X (right), 90=+Y (up), increases CCW
const toInternal = function toInternal(cwDeg) {
  return normalize(90 - normalize(cwDeg))
}

const toDisplay = function toDisplay(internalDeg) {
  return normalize(90 - normalize(internalDeg))
}

const polarToXY = function polarToXY(angleInternalDeg, r) {
  const a = (Number(angleInternalDeg) * Math.PI) / 180
  const rr = Number(r)

  return {
    x: rr * Math.cos(a),
    y: rr * Math.sin(a)
  }
}

// Signed smallest difference (b - a) in degrees in internal space
const angleDiffSigned = function angleDiffSigned(aInternal, bInternal) {
  let d = normalize(bInternal - aInternal)
  if (d > 180) d -= 360
  return d
}

export {
  normalize,
  worldToSvgY,
  toInternal,
  toDisplay,
  polarToXY,
  angleDiffSigned
}
