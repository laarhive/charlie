<!-- docs/architecture/charlie-ai.md -->
# Charlie AI architecture

Charlie AI is the voice and AI interaction component.

## Hardware and OS
- Android phone (Pixel 8)
- Tasker automation

## Responsibilities
- Capture speech (speech recognition)
- Run the ChatGPT Voice client
- Output audio (speaker)
- Execute Tasker workflows based on requests from Charlie Core
- Optionally send callbacks/telemetry to Charlie Core

## Interface with Charlie Core
Charlie Core does not run AI inference.

Charlie Core requests actions such as:
- start a conversation with a selected prompt/mode
- stop a conversation
- (later) report conversation events back (started/ended/turn/idle)

The transport can be LAN or WireGuard. The adapter on Core hides transport details from the rest of the system.
```
