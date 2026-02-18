// public/dev/radar-planner/scene-objects.js
const WORLD_OBJECTS = [
  { id: "hedgeBottom", kind: "rect", cls: "hedge", x1: -30, y1: -610, x2: 30, y2: -30, label: "Hedge" },
  { id: "hedgeTop", kind: "rect", cls: "hedge", x1: -30, y1: 210, x2: 30, y2: 600 },

  { id: "rosesBottom", kind: "rect", cls: "roses", x1: 30, y1: -610, x2: 60, y2: -30, label: "Roses" },
  { id: "rosesTop", kind: "rect", cls: "roses", x1: 30, y1: 210, x2: 60, y2: 600 },

  { id: "sidewalk", kind: "rect", cls: "sidewalk", x1: 60, y1: -700, x2: 270, y2: 800, label: "Sidewalk", labelAt: { x: 165, y: 600 } },
  { id: "pedRoad", kind: "rect", cls: "road", x1: 270, y1: -700, x2: 600, y2: 800, label: "Pedestrian Road", labelAt: { x: 435, y: 600 } },

  { id: "terraceBottom", kind: "rect", cls: "terrace", x1: -530, y1: -610, x2: -30, y2: -30, label: "Terrace" },
  { id: "terraceTop", kind: "rect", cls: "terrace", x1: -530, y1: 210, x2: -30, y2: 600 },

  { id: "walkway", kind: "rect", cls: "walkway", x1: -530, y1: -30, x2: 60, y2: 210, label: "Walkway" },

  { id: "restaurant", kind: "rect", cls: "restaurant", x1: -580, y1: -610, x2: -530, y2: 600, label: "Restaurant" },
  { id: "door", kind: "rect", cls: "door", x1: -550, y1: -30, x2: -530, y2: 110, label: "Door" }
]

const computeSceneBounds = function computeSceneBounds(objects) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  const addPoint = (x, y) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  objects.forEach((o) => {
    if (o.kind === "rect") {
      addPoint(o.x1, o.y1)
      addPoint(o.x2, o.y2)
    }

    if (o.labelAt) addPoint(o.labelAt.x, o.labelAt.y)
  })

  // Always include Charlie at origin.
  addPoint(0, 0)

  if (!Number.isFinite(minX)) {
    return { minX: -100, maxX: 100, minY: -100, maxY: 100 }
  }

  return { minX, maxX, minY, maxY }
}

export { WORLD_OBJECTS, computeSceneBounds }
