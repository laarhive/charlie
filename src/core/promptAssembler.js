export class PromptAssembler {
  /**
   * Assembles the final boot prompt string.
   *
   * @param {object} params
   * @param {string} params.base
   * @param {string} params.mode
   * @param {string} params.opener
   * @param {object} params.meta
   * @returns {string}
   *
   * @example
   * const pa = new PromptAssembler()
   * const prompt = pa.assemble({ base: '...', mode: '...', opener: '...', meta: { zone: 'front' } })
   */
  assemble({ base, mode, opener, meta }) {
    const metaBlock = JSON.stringify(meta, null, 2)

    return [
      base?.trim() ?? '',
      '',
      mode?.trim() ?? '',
      '',
      `META:\n${metaBlock}`,
      '',
      `OPENER:\n${opener?.trim() ?? ''}`
    ].join('\n')
  }
}

export default PromptAssembler
