import { expect } from 'chai'
import RuleEngine from '../../src/core/ruleEngine.js'

describe('RuleEngine', function () {
  it('selects morning rule for weekday 09:00', function () {
    const rules = [
      {
        id: 'front-morning',
        priority: 10,
        conditions: { zone: 'front', weekday: [1,2,3,4,5], timeRanges: [{ start: '08:00', end: '12:00' }] },
        actions: { modePromptId: 'mode.front.morning', openerPromptId: 'opener.front.morning' }
      },
      {
        id: 'front-night-disabled',
        priority: 20,
        conditions: { zone: 'front', timeRanges: [{ start: '22:00', end: '08:00' }] },
        actions: { modePromptId: null }
      }
    ]

    const engine = new RuleEngine({ rules })
    const res = engine.select({ zone: 'front', weekday: 1, minuteOfDay: 9 * 60 })
    expect(res.ruleId).to.equal('front-morning')
    expect(res.actions.modePromptId).to.equal('mode.front.morning')
  })

  it('selects night disabled rule for 23:00', function () {
    const rules = [
      {
        id: 'front-night-disabled',
        priority: 10,
        conditions: { zone: 'front', timeRanges: [{ start: '22:00', end: '08:00' }] },
        actions: { modePromptId: null }
      }
    ]

    const engine = new RuleEngine({ rules })
    const res = engine.select({ zone: 'front', weekday: 1, minuteOfDay: 23 * 60 })
    expect(res.ruleId).to.equal('front-night-disabled')
    expect(res.actions.modePromptId).to.equal(null)
  })
})
