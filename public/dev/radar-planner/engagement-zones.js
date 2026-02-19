// public/dev/radar-planner/engagement-zones.js
const ENGAGEMENT_DEFAULTS = {
  charlieFacingDeg: 34,

  // Distances are in cm (your planner scene units are cm).
  // Ellipses are oriented by `headingDeg` (world math degrees: 0°=+X (right), 90°=+Y (up)).
  //
  // Each zone has 3 rings: monitor, arm, speak.
  // Each ring is an ellipse { aCm, bCm } where:
  // - aCm = major axis radius (forward/back along heading)
  // - bCm = minor axis radius (sideways)
  zones: [
    {
      id: "downSidewalk",
      label: "Down sidewalk (Charlie front)",
      headingFromCharlie: "front",
      rings: {
        monitor: { aCm: 420, bCm: 240 },
        arm: { aCm: 280, bCm: 170 },
        speak: { aCm: 240, bCm: 140 }
      }
    },
    {
      id: "upSidewalk",
      label: "Up sidewalk (Charlie back)",
      headingFromCharlie: "back",
      rings: {
        monitor: { aCm: 300, bCm: 200 },
        arm: { aCm: 280, bCm: 170 },
        speak: { aCm: 120, bCm: 95 }
      }
    },
    {
      id: "exitWalkway",
      label: "Restaurant exit (walkway)",
      // Walkway in your scene is left->right across x. That is world +X direction (0°).
      // If you want this relative to Charlie instead, set headingFromCharlie to "right" etc.
      headingDegAbs: 0,
      rings: {
        monitor: { aCm: 360, bCm: 220 },
        arm: { aCm: 280, bCm: 170 },
        speak: { aCm: 200, bCm: 130 }
      }
    }
  ]
}

export { ENGAGEMENT_DEFAULTS }
