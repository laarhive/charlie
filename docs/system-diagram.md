## System diagram

```mermaid
flowchart TB
  %% =========================
  %% Project CHARLIE - System
  %% =========================

  subgraph ENV[Environment]
    Street[Real-world environment\n(passers-by, noise, weather)]
  end

  subgraph RPI[Raspberry Pi (Debian) - Charlie Runtime]
    App[Node.js app (Charlie daemon)\nstate machine + rules + orchestration]
    WS[WebSocket RPC (/ws)\ncontrol + observability]
    REST[REST API (/api/*)\nstatus + config]
    TaskerSim[Tasker sim endpoints (/tasker/*)\noptional for development]

    subgraph BUSES[Event buses]
      PresenceBus[presence bus]
      VibrationBus[vibration bus]
      ButtonBus[button bus]
      TaskerBus[tasker bus]
      MainBus[main bus]
    end

    subgraph DOMAIN[Domain layer]
      PresenceCtrl[Presence controller\n(debounce + normalization)]
      VibrationCtrl[Vibration controller\n(cooldown + normalization)]
      ButtonCtrl[Button controller\n(edge → press semantics)]
    end

    subgraph DRIVERS[Drivers]
      Ld2410[Ld2410 driver]
      Sw420[Sw420 driver]
      GpioBtn[Gpio button driver]
    end

    subgraph SIGNALS[Signals]
      VirtSig[VirtualBinarySignal\n(virt mode)]
      GpioSig[GPIO Binary Signal\n(pigpio / gpiod)]
    end
  end

  subgraph AI[AI Client (Android + Tasker)]
    Phone[Android phone\nChatGPT Voice / voice UI]
    Tasker[Tasker automation\nHTTP bridge + callbacks]
    Audio[Mic + Speaker]
  end

  subgraph NET[Connectivity]
    LAN[Local network]
    WG[WireGuard tunnel\n(optional/secure remote)]
  end

  subgraph OPS[Ops / Control]
    CLI[Remote CLI\n(--cmd cli)]
    WebUI[Future Web UI\n(config + live view)]
  end

  %% =========================
  %% Sensors and environment
  %% =========================
  Street -->|presence / motion| Ld2410
  Street -->|vibration / touch| Sw420
  Street -->|button press| GpioBtn

  %% =========================
  %% Signal sources
  %% =========================
  VirtSig --> Ld2410
  VirtSig --> Sw420
  VirtSig --> GpioBtn

  GpioSig --> Ld2410
  GpioSig --> Sw420
  GpioSig --> GpioBtn

  %% =========================
  %% Driver → domain buses
  %% =========================
  Ld2410 -->|raw domain events| PresenceBus
  Sw420 -->|raw domain events| VibrationBus
  GpioBtn -->|raw domain events| ButtonBus

  %% =========================
  %% Domain controllers → main bus
  %% =========================
  PresenceBus --> PresenceCtrl -->|semantic events| MainBus
  VibrationBus --> VibrationCtrl -->|semantic events| MainBus
  ButtonBus --> ButtonCtrl -->|semantic events| MainBus

  %% =========================
  %% Core consumes main bus
  %% =========================
  MainBus --> App

  %% =========================
  %% Tasker integration path
  %% =========================
  App -->|conversation actions| TaskerBus
  TaskerBus -->|HTTP requests| Tasker
  Tasker -->|callbacks / status| TaskerBus

  Tasker --> Phone --> Audio

  %% =========================
  %% APIs
  %% =========================
  App --> WS
  App --> REST
  TaskerSim --> TaskerBus

  %% =========================
  %% Control / clients
  %% =========================
  CLI -->|WS RPC| WS
  WebUI -->|WS RPC + taps| WS

  %% =========================
  %% Networking
  %% =========================
  CLI --- LAN
  WebUI --- LAN
  Tasker --- LAN

  LAN --- RPI
  LAN --- AI

  WG --- RPI
  WG --- AI
  WG --- OPS
```
