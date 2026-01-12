import { expect } from 'chai'
import StateMachine from '../../src/core/stateMachine.js'

describe('StateMachine', function () {
  it('starts in IDLE/none', function () {
    const sm = new StateMachine()
    const s = sm.getSnapshot()
    expect(s.state).to.equal('IDLE')
    expect(s.activeZone).to.equal('none')
  })

  it('can set state and active zone', function () {
    const sm = new StateMachine()
    sm.setActiveZone('front')
    sm.setState('ARMING')

    const s = sm.getSnapshot()
    expect(s.state).to.equal('ARMING')
    expect(s.activeZone).to.equal('front')
  })
})
