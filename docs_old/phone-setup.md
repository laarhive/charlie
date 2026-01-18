# Phone Setup (Android + Tasker)

## Phone role
The phone is the “voice box”:
- runs ChatGPT Voice
- captures mic input
- plays speaker output
- is orchestrated by Tasker

## Kiosk mode (optional)
Kiosk mode can prevent accidental exits and keep the UI controlled. Options depend on your Android device and preferences. (Implementation details to be added when kiosk solution is chosen.)

## Tasker responsibilities
- Receive start/stop triggers from the Pi (HTTP recommended)
- Open ChatGPT app
- Inject prompt text (base + mode + context)
- Start ChatGPT Voice
- Optionally post back callbacks to the Pi:
  - conversation started
  - conversation ended
  - optional turn counts / idle signals

## Recommended callbacks (future)
- POST /api/conv/started
- POST /api/conv/ended
- POST /api/conv/turn
- POST /api/conv/idle

The Pi uses these for:
- conversation duration metrics
- turn counts
- detecting idle sessions and restarting if presence remains
