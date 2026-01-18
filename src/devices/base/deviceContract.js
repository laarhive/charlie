// src/devices/base/deviceContract.js

/**
 * Device Contract (documentation-only module).
 *
 * This file defines the expected shape of devices used by DeviceManager.
 * The contract is enforced by convention (tests), not by inheritance.
 *
 * Conventions:
 * - A device kind MAY extend BaseDevice, but is not required to.
 * - A device kind MUST implement the methods documented below.
 * - A device kind MUST accept a generic injection payload (string or JSON).
 *
 * @typedef {'active'|'manualBlocked'} ConfiguredState
 * @typedef {'active'|'degraded'|'manualBlocked'|'unknown'} RuntimeState
 *
 * @typedef {object} DeviceSnapshot
 * @property {string} id
 * @property {string} publishAs
 * @property {string|null} domain
 * @property {string|null} kind
 * @property {ConfiguredState} configuredState
 * @property {RuntimeState} runtimeState
 * @property {boolean} blocked
 * @property {string|null} lastError
 *
 * @typedef {object} DeviceConstructorArgs
 * @property {any} logger
 * @property {any} clock
 * @property {object} buses
 * @property {object} device The config.devices entry for this device instance
 * @property {any} protocolFactory Factory passed to devices so they can create protocols internally
 */

/**
 * Device interface.
 *
 * @interface Device
 */

/**
 * Start the device.
 *
 * Called during activation when:
 * - device.state === 'active'
 * - mode is included in device.modes
 *
 * If start throws, DeviceManager marks the device as degraded.
 *
 * @function start
 * @memberof Device
 *
 * @example
 * device.start()
 */

/**
 * Stop and release resources.
 *
 * Must be idempotent.
 *
 * @function dispose
 * @memberof Device
 *
 * @example
 * device.dispose()
 */

/**
 * Block the device.
 *
 * Meaning:
 * - stop producing outputs and stop interacting with hardware
 * - keep the instance present (listed)
 *
 * DeviceManager uses this for manual blocking.
 *
 * Must be idempotent.
 *
 * @function block
 * @memberof Device
 *
 * @param {string} [reason]
 *
 * @example
 * device.block('manual')
 */

/**
 * Unblock the device.
 *
 * Device-specific recovery happens here.
 * Typical actions:
 * - recreate protocols
 * - restart timers/monitors
 * - resume publishing
 *
 * If unblock throws, DeviceManager marks the device as degraded.
 *
 * @function unblock
 * @memberof Device
 *
 * @example
 * device.unblock()
 */

/**
 * Inject a command/payload into the device.
 *
 * Payload is generic:
 * - string
 * - object (already parsed JSON)
 *
 * Device kind decides how to interpret it.
 *
 * @function inject
 * @memberof Device
 *
 * @param {string|object} payload
 *
 * @example
 * device.inject('press 200')
 * device.inject({ type: 'press', ms: 200 })
 */

/**
 * Return a snapshot of device status.
 *
 * Recommended fields:
 * - id, publishAs, kind, domain
 * - configuredState, runtimeState
 * - blocked
 * - lastError
 *
 * @function getSnapshot
 * @memberof Device
 *
 * @returns {DeviceSnapshot}
 *
 * @example
 * const snap = device.getSnapshot()
 */
export default {}
