```text
src/
  app/
    appRunner.js
    args.js
    configLoader.js
    context.js

  core/
    eventBus.js
    busTap.js
    eventTypes.js
    clock.js
    timeScheduler.js
    charlieCore.js

  domains/
    button/
      edgeButtonController.js
    presence/
      ...
    vibration/
      ...
    domainEventTypes.js

  devices/
    deviceManager.js
    kinds/
      buttonEdge/
        buttonEdgeDevice.js
        buttonEdgeCommands.js
      presenceLd2410/
        ...
    protocols/
      gpio/
        gpioBinaryInputPortGpiod.js
      virt/
        virtualBinaryInputPort.js
      uart/
        // later
      i2c/
        // later

  adapters/
    conversation/
      taskerConversationAdapter.js

  cli/
    ...

  sim/
    ...
```

Notes:
* devices/ is the “hardware layer” in the new architecture.
* kinds/* are your driver implementations (per kind).
* protocols/* are your ports/protocol backends (gpio/virt/etc).
* Controllers move from src/domain → src/domains (plural) grouped by domain.
