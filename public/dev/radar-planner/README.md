# Charlie Radar Planner

Coordinate system:
- Units: cm
- Origin: (0,0) at Charlie
- +X right
- +Y up

Radar angles:
- Input azimuth is clockwise degrees
- 0° is at NE (45° from +X axis)

Files:
- overlay.html: main app
- overlay.js: UI/state + camera + rendering
- world-layer.js: draws scene objects
- radar-layer.js: draws FOV/AFOV + overlap bands
- scene-objects.js: world geometry (rectangles)
- patterns.js: SVG patterns
- geometry.js: shared math
