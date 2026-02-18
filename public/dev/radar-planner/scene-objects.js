// public/dev/radar-planner/scene-objects.js
const WORLD_OBJECTS = [
  // Hedge
  { id: "hedgeBottom", kind: "rect", cls: "hedge", x1: -30, y1: -610, x2: 30, y2: -30, label: "Hedge" },
  { id: "hedgeTop", kind: "rect", cls: "hedge", x1: -30, y1: 210, x2: 30, y2: 600 },

  // Roses
  { id: "rosesBottom", kind: "rect", cls: "roses", x1: 30, y1: -610, x2: 60, y2: -30, label: "Roses" },
  { id: "rosesTop", kind: "rect", cls: "roses", x1: 30, y1: 210, x2: 60, y2: 600 },

  // Sidewalk + road (labels forced at y=600 in world-layer)
  { id: "sidewalk", kind: "rect", cls: "sidewalk", x1: 60, y1: -700, x2: 270, y2: 800, label: "Sidewalk", labelAt: { x: 165, y: 600 } },
  { id: "pedRoad", kind: "rect", cls: "road", x1: 270, y1: -700, x2: 600, y2: 800, label: "Pedestrian Road", labelAt: { x: 435, y: 600 } },

  // Terrace
  { id: "terraceBottom", kind: "rect", cls: "terrace", x1: -530, y1: -610, x2: -30, y2: -30, label: "Terrace" },
  { id: "terraceTop", kind: "rect", cls: "terrace", x1: -530, y1: 210, x2: -30, y2: 600 },

  // Walkway
  { id: "walkway", kind: "rect", cls: "walkway", x1: -530, y1: -30, x2: 60, y2: 210, label: "Walkway" },

  // Restaurant wall + door
  { id: "restaurant", kind: "rect", cls: "restaurant", x1: -580, y1: -610, x2: -530, y2: 600, label: "Restaurant" },
  { id: "door", kind: "rect", cls: "door", x1: -550, y1: -30, x2: -530, y2: 110, label: "Door" }
]

export { WORLD_OBJECTS }
