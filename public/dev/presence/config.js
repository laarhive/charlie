// public/dev/presence/config.js
export const getDefaultUiConfig = function getDefaultUiConfig() {
  return {
    wsPath: '/ws?presenceInternal&presence&main',

    layout: {
      /* Keep aligned with your config/controllers/presence.json5 */
      radarAzimuthDeg: [0, 75, 285],

      /* Tube diameter: set to 100 if that’s your real ring */
      tubeDiameterMm: 100,

      radarFovDeg: 120,
      rMaxMm: 3000,
    },

    draw: {
      scalePxPerMm: 0.20,
      showGrid: true,
      showFov: true,
      showMeasurements: true,
      showTracks: true,
      velocityArrowScale: 8, /* px per (mm/s) after rounding; tune later */
    },
  }
}

/* Optional: later, fetch /api/config and override */
export const tryLoadServerConfig = async function tryLoadServerConfig() {
  try {
    const res = await fetch('/api/config')
    if (!res.ok) return null
    const data = await res.json()
    return data
  } catch (e) {
    return null
  }
}
