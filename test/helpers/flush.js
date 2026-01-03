// test/helpers/flush.js
export const flush = async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

export default flush
