// src/devices/deviceError.js
export const deviceError = function deviceError(code, message, detail) {
  const err = new Error(message || String(code || 'DEVICE_ERROR'))
  err.code = String(code || 'DEVICE_ERROR')

  if (detail !== undefined) {
    err.detail = detail
  }

  return err
}
