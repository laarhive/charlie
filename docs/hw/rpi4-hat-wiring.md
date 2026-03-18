<!-- docs/hw/rpi4-hat-wiring.md -->
# Charlie HAT – Wiring Diagram & Electrical Specification

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
- 2 × 470 µF electrolytic (10 V)
- Between +5V and GND
- Near LED power entry

---

# 2. J_SIG1 – Raspberry Pi Signal Interface

J_SIG1 provides the following signals from RPi4:

| PIN | Signal | Net Name |
|-----|--------|----------|
| 1   | SDA    | SDA |
| 2   | SCL    | SCL |
| 3   | TXD    | TXD |
| 4   | RXD    | RXD |
| 20  | GPIO12 | GPIO12 |
| 21  | GPIO13 | GPIO13 |
| 24  | GPIO20 | LOOP_LINE |
| 25  | GPIO21 | LOOP_LINE |

---

# 3. RP2040 Zero Module (U2)

## Power

5V  → +5V  
GND → GND

3V3 pin not externally driven.

---

## UART to Raspberry Pi

GP4 → TXD  
GP3 → RXD

---

## WS2812 Control

GP0 → U1B.A  
U1B.Y → R_WS1 (330 Ω) → DATA_IN

---

## Button Input

J_BUTTON1 Pin1 → GND  
J_BUTTON1 Pin2 → R_BUTTON1 (330 Ω) → GP12

R_BUTTON_PU1 (10 kΩ) → GP12 → +3V3

GP12 configured as INPUT.

---

## RUN Control

GP29 → R_BASE1 (4.7 kΩ) → Q_RUN1 base  
Q_RUN1 base → R_BASE_PD1 (100 kΩ) → GND

---

# 4. 74AHCT125 (U1)

Powered at +5V.

---

## Gate A – GPIO13 Level Shift

OE → GND  
A  → GPIO13  
Y  → GPIO13_5V → J_GPIO13 Pin4

---

## Gate B – WS2812 Level Shift

OE → GND  
A  → GP0  
Y  → R_WS1 (330 Ω) → DATA_IN

---

## Gate C – GPIO12 Level Shift

OE → GND  
A  → GPIO12  
Y  → GPIO12_5V → J_GPIO12 Pin4

---

## Gate D – UNUSED

All pins left unconnected.

---

# 5. RUN Circuit

## Q_RUN1 (BC338)

Emitter → GND  
Collector → RUN_IN

Base → R_BASE1 (4.7 kΩ) → GP29  
Base → R_BASE_PD1 (100 kΩ) → GND

---

## RUN_IN Net Connections

RUN_IN connects to:

- J_RUN1 Pin 2 (to Raspberry Pi RUN pin)
- SW1 (push button to GND)
- Q_RUN1 collector

RPi4 provides internal pull-up.

---

## Reset Logic

GP29 HIGH → transistor ON → RUN_IN LOW → Reset  
GP29 LOW or INPUT → transistor OFF → RUN released

---

# 6. RUN Indicator LED

+3V3 → R_RUN1 (4.7 kΩ) → D_RUN1 → RUN_IN

RUN high → LED OFF  
RUN low → LED ON

---

# 7. RUN Connectors

## J_RUN1 (1×2)

| Pin | Signal |
|-----|--------|
| 1 | GND |
| 2 | RUN_IN |

---

## SW1

RUN_IN → GND

---

# 8. WS2812 Section

## Onboard WS2812

VDD → +5V  
GND → GND  
DIN → DATA_IN

---

## External LED Connector (J_WS1, 1×3)

| Pin | Signal |
|-----|--------|
| 1 | +5V |
| 2 | GND |
| 3 | DATA_IN |

---

# 9. GPIO Connectors

## J_GPIO12

| Pin | Signal |
|-----|--------|
| 1 | +3V3 |
| 2 | GND |
| 3 | GPIO12 |
| 4 | GPIO12_5V |
| 5 | +5V |

---

## J_GPIO13

| Pin | Signal |
|-----|--------|
| 1 | +3V3 |
| 2 | GND |
| 3 | GPIO13 |
| 4 | GPIO13_5V |
| 5 | +5V |

---

# 10. I2C Connectors (J_I2C1..3)

| Pin | Signal |
|-----|--------|
| 1 | +3V3 |
| 2 | GND |
| 3 | SDA |
| 4 | SCL |

---

# 11. LOOP Indicator Circuit

LOOP_LINE → R_LOOP1 (1 kΩ) → D_LOOP1 → GND

---

# 12. Component Values

R_WS1 = 330 Ω  
R_RUN1 = 4.7 kΩ  
R_LOOP1 = 1 kΩ  
R_BASE1 = 4.7 kΩ  
R_BASE_PD1 = 100 kΩ  
R_BUTTON1 = 330 Ω  
R_BUTTON_PI1 = 10 kΩ

Capacitors:
- 100 nF decoupling
- 2 × 470 µF bulk

---

# 13. Safety Notes

- No 5V enters RP2040 GPIOs
- RUN line open-collector driven
- WS2812 properly level shifted
- External button protected via series resistor
- External button uses defined pull-up (R_BUTTON_PI1)
- All connectors follow consistent pin convention

---
