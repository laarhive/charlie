<!-- docs/hw/jst-connector-pinout.md -->
# Charlie HAT – JST Connector Pinout Convention

**Standard Orientation**

- Front view (mating side)
- Latch facing up
- Pins numbered **left → right**
- **Pin 1 is always on the left**
- Power is placed on Pin 1 whenever possible
- All connectors use identical orientation on PCB (no mirroring)

---

# I2C Connectors (4× JST-XH 1×4)

**Connector:** `J_I2C1..4`

| Pin | Signal |
|------|--------|
| 1 | +3V3 |
| 2 | GND |
| 3 | SDA |
| 4 | SCL |

**Design rule:**
- Power first
- Ground next
- Signals grouped
- Safe and consistent wiring

---

# WS2812 External Connector (J_WS, 1×3)

| Pin | Signal |
|-----|--------|
| 1 | +5V |
| 2 | GND |
| 3 | DATA_IN |

---

**Design rule:**
- Power first
- Dual ground for stability
- Data not adjacent to power pin

---

# GPIO13 Connector (J_GPIO13, 1×5)

| Pin | Signal |
|------|--------|
| 1 | +3V3 |
| 2 | GND |
| 3 | GPIO13 (raw 3.3V) |
| 4 | GPIO13_5V (shifted output) |
| 5 | +5V |

---

# GPIO18 Connector (J_GPIO18, 1×5)

| Pin | Signal                     |
|------|----------------------------|
| 1 | +3V3                       |
| 2 | GND                        |
| 3 | GPIO18 (raw 3.3V)          |
| 4 | GPIO18_5V (shifted output) |
| 5 | +5V                        |

---

# RUN Connector (J_RUN, 1×2)

| Pin | Signal |
|------|--------|
| 1 | GND |
| 2 | RUN_IN |

---

# PCB Placement Rules

- All JST connectors face the same direction
- Never rotate/mirror one connector differently
- Verify Pad 1 marker matches schematic Pin 1

---

# Electrical Summary

- Pin 1 = primary power or main signal
- Pin 2 = ground whenever possible
- Orientation identical across board
- No mixed conventions

---

