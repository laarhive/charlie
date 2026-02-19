// public/dev/radar-planner/scene-state.js
const DEFAULTS = {
  radarRadiusCm: 500,
  afovDeg: 100,
  azimuthCwDeg: [0, 85, 275],
  zoom: 1,
  dimWorld: true,

  showGrid: true,
  showTicks: true,

  showEngagement: true,
  charlieFacingDeg: 34,

  mountRadarsToCharlie: false,

  // Physical: 55mm tube radius
  tubeRadiusCm: 5.5,

  // In the real world, True North is at this CW angle in your planner world frame
  // (0° = up in planner). You requested 218°.
  trueNorthCwDeg: 218
}

export { DEFAULTS }
