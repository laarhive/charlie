<!-- docs/hw/rpi4-hat-wiring.md -->
# Charlie HAT – Complete Wiring Diagram & Electrical Specification

This document defines the internal wiring of the Raspberry Pi 4 HAT.

---

# 1. Power Architecture

## Power Sources (from Raspberry Pi 4)

Via HAT header (already routed to board rails):

- +3V3
- GND
- +5V

No onboard regulators.

---

## Power Rails (Perfboard)

Continuous copper strips:
- +3V3 rail
- GND rail
- +5V rail

---

## Required Decoupling

### 74AHCT125
- 100 nF ceramic
- Between VCC and GND
- Placed physically close to IC pins

### RP2040 Zero Module
- 100 nF ceramic
- Between +5V and GND
- Near module pins

### WS2812 Bulk Capacitor
- 470–1000 µF electrolytic
- Between +5V and GND
- Near LED power entry

---

# 2. J_SIG1 – Raspberry Pi Signal Interface

J_SIG1 provides the following signals from RPi4:

| PIN | Signal | Net Name  |
|-----|--------|-----------|
| 1   | SDA    | SDA       |
| 2   | SCL    | SCL       |
| 3   | TXD    | TXD       |
| 4   | RXD    | RXD       |
| 7   | GPIO18 | GPIO18    |
| 10  | GPIO23 | LOOP_LINE |
| 11  | GPIO24 | LOOP_LINE |
| 21  | GPIO18 | GPIO18    |

These nets distribute across the board.

---

# 3. RP2040 Zero Module (U2)

## Power

5V  → +5V  
GND → GND

3V3 pin not externally driven.

---

## UART to Raspberry Pi

GP4 → TXD  
GP5 → RXD

Direct 3.3V logic.

---

## WS2812 Control

GP27 → U1A.A (74AHCT125 Gate A)

No direct connection to LED.

---

## RUN Control

GP0 → R_RUN_BASE1 (4.7 kΩ) → Q_RUN1 base  
Q_RUN1 base → R_RUN_BASE_PD1 (100 kΩ) → GND

See RUN section below.

---

# 4. 74AHCT125 (U1)

Powered at +5V.

---

## Gate A – RUN LED Driver

OE → GND  
A  → RUN_IN  
Y  → RUN_LED_DRV

LED wiring:

+5V → R_RUN (1 kΩ) → D_RUN → RUN_LED_DRV

Behavior:

RUN low → LED ON  
RUN high → LED OFF

---

## Gate B – GPIO13 Level Shift

OE → GND  
A  → GPIO18  
Y  → GPIO18_5V

---

## Gate C – WS2812 Level Shift

OE → GND  
A  → GP27  
Y  → R_WS1 (330 Ω) → DATA_IN

This drives:

- Onboard WS2812 DIN
- J_WS1 Pin 3

Provides clean 5V data signal.

---

## Gate D – GPIO18 Level Shift

OE → GND  
A  → GPIO13  
Y  → GPIO13_5V

---

# 5. RUN Circuit

## Q_RUN1 (PN2222)

Emitter → GND  
Collector → RUN_IN  
Base → R_RUN_BASE1 (4.7 kΩ) → GP0  
Base → R_RUN_BASE_PD1 (100 kΩ) → GND

---

## RUN_IN Net Connections

RUN_IN connects to:

- J_RESET1 Pin 2
- J_RUN1 Pin 2 (parallel connector to RPi4 motherboard)
- SW1 (push button to GND)
- U1C input (RUN LED monitor)
- Q_RUN1 collector

RPi4 provides internal pull-up.

---

## Reset Logic

GP0 HIGH → Q_RUN1 ON → RUN_IN pulled LOW → Reset  
GP0 LOW or INPUT → Q_RUN1 OFF → RUN released

Recommended firmware:

Normal state → GP0 = INPUT  
Reset → GP0 = OUTPUT HIGH (100–200 ms)  
Release → GP0 = INPUT

---

# 6. RUN Connectors

## J_RESET1 (1×2)

| Pin | Signal |
|------|--------|
| 1 | GND |
| 2 | RUN_IN |

## J_RUN1 (1×2)

Wired in parallel with J_RESET1.

| Pin | Signal |
|------|--------|
| 1 | GND |
| 2 | RUN_IN |

---

## SW1

Between RUN_IN and GND.

---

# 7. WS2812 Section

## Onboard WS2812

VDD → +5V  
GND → GND  
DIN → DATA_IN

---

## External LED Connector (J_WS, 1×3)

| Pin | Signal |
|-----|--------|
| 1 | +5V |
| 2 | GND |
| 3 | DATA_IN |

Parallel mode:

- Onboard LED and external strip receive identical data.
- External strip chaining continues from its own DOUT.

---

# 8. GPIO Connectors

## J_GPIO13

| Pin | Signal |
|------|--------|
| 1 | +3V3 |
| 2 | GND |
| 3 | GPIO13 |
| 4 | GPIO13_5V |
| 5 | +5V |

## J_GPIO18

| Pin | Signal |
|------|--------|
| 1 | +3V3 |
| 2 | GND |
| 3 | GPIO18 |
| 4 | GPIO18_5V |
| 5 | +5V |

---

# 9. I2C Connectors (J_I2C1..4)

| Pin | Signal |
|------|--------|
| 1 | +3V3 |
| 2 | GND |
| 3 | SDA |
| 4 | SCL |

Direct connection to J_SIG1 SDA/SCL.

---

# 10. LOOP Indicator Circuit

LOOP_LINE connects between:

GPIO23 ↔ GPIO24 (via J_SIG1)

Indicator LED:

LOOP_LINE → R_LOOP (1 kΩ) → D_LOOP → GND

LED lights when LOOP_LINE is HIGH.

---

# 11. Component Values

R_WS1 = 330 Ω  
R_RUN = 1 kΩ  
R_LOOP = 1 kΩ  
R_RUN_BASE1 = 4.7 kΩ  
R_RUN_BASE_PD1 = 100 kΩ

Decoupling capacitors = 100 nF  
LED bulk capacitor = 470–1000 µF

---

# 12. Safety Properties

- No 5V fed into RP2040 pins
- WS2812 data properly level shifted to 5V
- RUN driven via open-collector transistor
- Default RUN state is safe (no unintended reset)
- Decoupling implemented
- Power domains separated
- JST connectors follow documented convention

---

# 13. Final Electrical Topology

RPi4 (via J_SIG1)  
→ Provides +5V, +3V3, SDA, SCL, TXD, RXD, GPIO13, GPIO18, LOOP_LINE

RP2040 (3.3V domain)  
→ UART to RPi  
→ Drives WS2812 via AHCT level shift  
→ Controls RUN via PN2222

74AHCT125 (5V domain)  
→ Level shifts GPIO13 and GPIO18  
→ Drives RUN status LED  
→ Level shifts WS2812 data

---
