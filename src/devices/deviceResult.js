// src/devices/deviceResult.js
export const ok = function ok(detail = {}) {
  return { ok: true, ...detail }
}

export const err = function err(code, message, detail) {
  const res = { ok: false, error: code }

  if (message) {
    res.message = String(message)
  }

  if (detail !== undefined) {
    res.detail = detail
  }

  return res
}
