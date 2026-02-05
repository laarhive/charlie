// public/debug/presence/ld2450.js
export const parseLd2450Detections = function parseLd2450Detections(frame) {
  const slots = Array.isArray(frame?.targets) ? frame.targets : []

  // IMPORTANT: valid:false means empty slot, not an error frame
  return slots
    .filter((t) => t && t.valid === true)
    .map((t) => ({
      localId: t.id,
      xMm: Number(t.xMm) || 0,
      yMm: Number(t.yMm) || 0,
      speedMmS: Number.isFinite(Number(t.speedCms)) ? Number(t.speedCms) * 10 : 0,
      resolutionMm: Number(t.resolutionMm) || 0,
    }))
}
