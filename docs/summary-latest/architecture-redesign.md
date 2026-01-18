






below is my proposal:

before we do any changes, pls review, ask question for clarification (do not assume), give suggestion.
When we start updating we do it in a structure way step by step. We have a working system, we need some changes in architecture, but we don't reinvent the wheel, we don't start from scratch, we do iterative updates, even if we change much of the structure.
the pre-release is still a pre-prototype release, so we do not care about braking changes.

we can start discussing by area and once agreed we start updating:
---------
# Architecture. We keep the system components:
*
* Charlie Core: Sensing, logic, state machine, orchestration, WebSocket API
* Charlie AI: Speech recognition, AI interaction, voice output
* Charlie UI: for now none, we will expand later with Websocket UI (Webix) server hosted on Charlie core, or maybe later even a mobile app
* Connectivity layer (Local network or WireGuard - but not sure if this should be part of charlie core)
* Charlie Cloud -maybe there would be a need for cloud or external computer for backup, config, but right now, but  right now i don't see a need

We should be able to decouple and replace all system components independently

## Charlie AI Architecture:
* Hw + OS: Pixel 8 Android phone with Tasker
* AI Clinet Chat gtp

## Charlie Core Architecture:
We keep everything the same with a small modification wrt drivers and driver handling (I will explain in next paragraf)
Hardware / Virtual signals
↓
Drivers (hardware/virtual)
↓
Domain buses (presence / vibration / button)
↓
Domain controllers (debounce, cooldown, normalization)
↓
Main bus (semantic events)
↓
CharlieCore (state machine + rules)
↓
Tasker bus (semantic events)
↓
Conversation adapter (Tasker / future clients)

Additionally, we have the:
* args parser and everything related to how we initialize and start the application
* config manager
* cli controller and cli components
  (maybe I'm missing something here)

Directory structure should mimic the architecture to clearly separate the concerns.
Documentation should also mimic the architecture and should clearly define interfaces (for example events on buses).
Whe we work on a domain controller we should only need to know inputs and outputs on the buses, and of cotext it's context configuration
We need to define bus events clearly with possible values and examples. Such documentatioon should be written in the code preferably as jsdoc, so to make sure we minimize the risk of having the doc out of sync

### Drivers
Here I want to change a bit.

A driver can be either linked to a piece of hardware (gpio input, usb/uart/ i2c device) or be purely virtual driver.
A hw driver is at base a virtual driver with an additional protocol and it's implementation to read and write data to the hardware.
A driver (being it a virtual driver or hw driver):
* can have 3 states:
  - active (A): driver is working and can read/write data
  - manually blocked (MB): driver is listed, but can't read/write data or interact with it's contolers. We can still set (by cli for example, certain states or parameters)
  - degraded (or auto-blocked) (AB or DG/D -let's agree on the name): driver is working but in a degraded state (e.g. hw usb device is unplugged). depending on each driver implementation it may not be able to read/write data properly.

We have a driver manager that handles all the drivers, e.g. initialize at startup, manually block or unblock a specific driver
Driver manager should also initiate unblock of a degraded/auto-blocked drive, under certain conditions (e.g. a usb divece is plugged in).
At unblock a driver can report back active or degraded.

At app start, driver manager should attempt to initialize (unblock) all drivers included in specifc "--mode" that are not MB.
unblocking will put the driver in state AB or A.
As discussed any driver is a virtual driver as well (but with an additional protocol and it's implementation to read and write data to the hardware).
A driver should support a command to inject an output sequence, but the command parameters would be different from driver to driver.
For example a button may have implemented command "toogle <ms>" that will toggle the output pin for a certain amount of time., which would instruct the driver to send 2 edge events.
or for a presence radar, a command to send a sequence of events (x.y) coordinates based on a json or another format.
the driver should supprt the command injection regardless if the driver is also a hw driver, or if it's degraded (good for troubleshooting when hw is missing.
a driver can also be purly virtual (no hw) and it will support command injection only.
command injetion params should be json format. I'm not sure yet if comamnd injection should be done through device manager or directly into the driver. There could be several components that would be able to inject command, for example cli, or testing suites (mocha).


### Configuration file

in it's configuration the driver would have
* an id
* we can keep PublishAs
* mode - profile where it is visible
* state - active or MB
* the driver kind (buttonEdge, vibration01, vibrationG, led01, ledRGB, presence01, presenceXY, )
* protocol implementation (e.g. virt, gpio, i2c)
* domain - (not sure if we should reuse role - maybe too confusing name) - the controller where it is connected (presence, vibration, button, etc.)
* role (or it's role on the charlie core) - here for example the button domain controler may publish on the main buss event "press_seq s-s-l-s" with "role" (we don't necesarly want to pass the device to the charlie core) we can even have the same event e.g. "press_seq s-s-l-s" with the same role comming from a different button (a reed sensor vs push button). Core should not care who initiated the command. another exampole, "presence" could come from an presence01 senzor or presenxeXY sensor.
* parameters - here we may need to asses if it's good to combine driver protocol parameters (e.g. gpio line), with domain controller parameters (e.g. debounce)

or perhaps we should have different configurations for each driver, each domain controller and core

### Command injection and testing

It should be possible to change state and parameters for a driver from cli or testing suites. we can even have a generic format like driver set --key_subkey_subsubkey=true --another_key
All drivers and controllers should support event/command injection.
Buses should support event injection.

we should be able to design tests (of a driver, controller) by injecting events/commands and checking the output.


### Directory structure
I want the directory structure to mimic the architecture sas much as possible. We don't have to edit files all over the place when we update code for one thing.

### Documentation
Implementation details such as event structure (in and out) could be written in the source code as jsdoc.
Doc should mimic the architecture and should clearly define interfaces.

Documentation should be clear and concise, technical oriented, without buzz words.

#### README file

Should focus on:
* What Charlie does
* Project overview - Purpose
* High-level architecture - System components
  - reference to Charlie Core architecture
  - reference to Charlie AI architecture
* how to install and run the applications
  - reference to Charlie Core
  - reference to Charlie AI
* how to setup test/dev environment
  - reference to another instruction how to setup dev environment

* Links to documentation for each component (TBD))
* Furure plans

#### how to install and run Charlie Core
focus on:
* list requirements, i.e. rpi4 or laptop
* hardware components (sensors, etc)
* installation instructions

  - link to how to setup rpi4 hardware and software/OS, which should include
    - focus on hardware setup (including gpio, loop for watchdog)
    - os setup including modules, systemd services
    - remote dev setup (git, webstorm, ssh, pi resync from github - TDB 95% of the doc is already available )
  - link to how to setup laptop hardware and software/OS
    - explain usb devices may work on test machine laptop
    - os setup including modules, systemd services (TDB)
    - remote dev setup (git, webstorm, ssh)
  - link to developement workflows
* usage: how to start charlie core in different modes, command line parameters
* CLI usage - reference to another instruction how to use cli
* checklist

#### how to install and run AI
* TBD

#### Charlie Core architecture
* explain domains, buses, events,
* machine state
* drivers
 ------- 
  

  





