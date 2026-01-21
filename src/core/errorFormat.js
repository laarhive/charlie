// src/core/errorFormat.js
export const formatError = function formatError(err) {
  if (!err) {
    return { message: 'Unknown error', stack: null }
  }

  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack || null,
      cause: err.cause ? formatError(err.cause) : null,
    }
  }

  return {
    name: typeof err,
    message: String(err),
    stack: null,
    cause: null,
  }
}

export default formatError
