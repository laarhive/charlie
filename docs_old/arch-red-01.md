A + B
my idea was to have one driver per device type.
eg buttonEdge should emit a buttonEdge event on the domain bus. 
A buttonEdge instance can be connected to any domain bus.
I think this is acually what we have as signal. 
Now the buttonEdge can have different protocols implemented: gpio, uart, even i2c, or just virt, in which case it has no actual protocol, but remains with command injection only.
should be bidirectional, but not necesarl;y all "drivers" should be bidirectional

A device is would be an instance of a driver. 

Wut we can also make the protocol a factory to shallow the architecture.
Same driver, different protocol, of what we have driver + signal today?
I'm open to discussions.



C) Device state semantics
MB means device is only listed but cannot interract at all. parameters can be changed, but no input output.
Device should have own state degraded, it should publish it's state to the device manager, as the device manager should be be responsible to attempt autorecovery (for example at usb attach) or for informing the device it has to enter state MB or attempt unblock from MB state 


D)
command injection target drivers (since they are all based on virtual driver class)
all buses (already working today)
publish semantic health on main bus, could be useful for device manager to get informed, alarms to be raised.  
I actually suggest the device manager to be connected on the main bus.
if you want we can make a hardware bus for all devices + device manager to communicate if this is simpler, else we wire the devices do the device manager separately and have them on domain buss only.

E)
devices[], controllers[], core{}
basically sensors become devices. so devices, not drivers.  
device “enabled/modes/state” is at device level and state transition can be initiated from device manager.
i don't think we need 

F)
domain routes to controller, and role is for core to decide action to take
