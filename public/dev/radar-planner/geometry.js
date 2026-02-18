// public/dev/radar-planner/geometry.js
const normalize = function normalize(a) {
  return ((a % 360) + 360) % 360
}

const worldToSvgY = function worldToSvgY(y) {
  return -y
}

// 0° at NE
const ANGLE_OFFSET_DEG = 45

const polarToXY = function polarToXY(degInternal, r) {
  const rad = (degInternal + ANGLE_OFFSET_DEG) * Math.PI / 180
  return {
    x: r * Math.cos(rad),
    y: r * Math.sin(rad)
  }
}

const angleDiffSigned = function angleDiffSigned(a, b) {
  return normalize(a - b + 180) - 180
}

// User input is clockwise degrees
const toInternal = function toInternal(cwDeg) {
  return normalize(360 - cwDeg)
}

const toDisplay = function toDisplay(internalDeg) {
  return normalize(360 - internalDeg)
}

export {
  normalize,
  worldToSvgY,
  polarToXY,
  angleDiffSigned,
  toInternal,
  toDisplay
}
