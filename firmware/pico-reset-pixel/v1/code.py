# Button_Ver05_Fast.py - neopixel_write OPTIMIZAT (FIX slice error)
# CircuitPython 10.0.3 pe RP2040

import time
import board
import digitalio
import adafruit_ticks
import usb_cdc
from adafruit_debouncer import Debouncer, Button
import neopixel_write

# =======================================
# CONFIGURARI HARDWARE
# =======================================

# PushButton pe GP0
pin = digitalio.DigitalInOut(board.GP0)
pin.direction = digitalio.Direction.INPUT
pin.pull = digitalio.Pull.UP
debouncer = Debouncer(pin)
button = Button(pin, long_duration_ms=1000)

# NeoPixel GP28 GRB (extern) - RAPID
np_pin = digitalio.DigitalInOut(board.GP28)
np_pin.direction = digitalio.Direction.OUTPUT
np_buf = bytearray([0, 0, 0])  # GRB order!

# NeoPixel GP16 RGB (onboard) - RAPID
st_pin = digitalio.DigitalInOut(board.GP16)
st_pin.direction = digitalio.Direction.OUTPUT
st_buf = bytearray([0, 0, 0])  # RGB order!

# Hard Reset GP15
pinreset = digitalio.DigitalInOut(board.GP15)
pinreset.direction = digitalio.Direction.OUTPUT
pinreset.value = True
hard_reset_activ = None
RESET_ACTIV = 2000

rgb_persistent = (0, 10, 0)  # RGB initial

# Init RAPID
np_buf[0] = 10
np_buf[1] = 10
np_buf[2] = 10
neopixel_write.neopixel_write(np_pin, np_buf)

time.sleep(1)

st_buf[0] = 30  # R onboard
neopixel_write.neopixel_write(st_pin, st_buf)

serial_ps = usb_cdc.data
input_buffer = ""

while True:
    debouncer.update()
    button.update()

    # NeoPixel GP28 RAPID: RGB persistent sau roșu override
    if debouncer.value:  # Eliberat
        np_buf[0] = rgb_persistent[0]  # G
        np_buf[1] = rgb_persistent[1]  # R
        np_buf[2] = rgb_persistent[2]  # B
    else:  # Apăsat roșu RGB
        np_buf[0] = 255
        np_buf[1] = 0
        np_buf[2] = 0
    neopixel_write.neopixel_write(np_pin, np_buf)

    # SHORT PRESS
    if button.short_count > 0:
        pass

    # LONG PRESS RESET
    if button.long_press:
        rgb_persistent = (0, 0, 0)
        np_buf[0] = 0
        np_buf[1] = 0
        np_buf[2] = 0
        neopixel_write.neopixel_write(np_pin, np_buf)

        pinreset.value = False
        st_buf[0] = 0
        st_buf[1] = 200
        st_buf[2] = 0
        neopixel_write.neopixel_write(st_pin, st_buf)
        hard_reset_activ = adafruit_ticks.ticks_ms()

    # Timer reset
    if hard_reset_activ is not None:
        elapsed = adafruit_ticks.ticks_diff(adafruit_ticks.ticks_ms(), hard_reset_activ)
        if elapsed > RESET_ACTIV:
            pinreset.value = True
            st_buf[0] = 30
            st_buf[1] = 0  # Verde slab
            st_buf[2] = 0
            neopixel_write.neopixel_write(st_pin, st_buf)
            hard_reset_activ = None

    # USB_CDC.DATA RGB comenzi
    if serial_ps and serial_ps.in_waiting > 0:
        char = serial_ps.read(serial_ps.in_waiting).decode("utf-8")
        input_buffer += char
        if "\n" in input_buffer or "\r" in input_buffer:
            comanda = input_buffer.strip()
            if "," in comanda:
                try:
                    r, g, b = [max(0, min(int(v.strip()), 255)) for v in comanda.split(",")]
                    print(f"R:{r} G:{g} B:{b}")
                    rgb_persistent = (r, g, b)

                    if debouncer.value:
                        np_buf[0] = rgb_persistent[0]
                        np_buf[1] = rgb_persistent[1]
                        np_buf[2] = rgb_persistent[2]
                        neopixel_write.neopixel_write(np_pin, np_buf)
                except Exception as e:
                    print("Data read error:", e)
            input_buffer = ""

    time.sleep(0.001)
