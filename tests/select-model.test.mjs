import test from 'node:test'
import assert from 'node:assert/strict'
import { closedSelect, selectPlacement, selectTransition } from '../src/components/ui/select-model.ts'

const options = [
  { value: 'dubai', label: 'Dubai Mall' },
  { value: 'offline', label: 'Do not select', disabled: true },
  { value: 'sf', label: 'San Francisco International Airport' },
  { value: 'station', label: 'San Jose Station' },
  { value: 'tokyo', label: 'Tokyo Station' },
]
const key = (state, key, now = 1000, extra = {}) => selectTransition(options, state, 'sf', { type: 'key', key, now, ...extra })

test('keyboard navigation previews enabled options, Escape cancels and Enter commits', () => {
  let result = key(closedSelect, 'Enter')
  assert.equal(result.state.active, 2)
  assert.equal(result.commit, undefined)
  result = key(result.state, 'ArrowUp')
  assert.equal(result.state.active, 0, 'disabled options are skipped')
  const cancelled = key(result.state, 'Escape')
  assert.equal(cancelled.state.open, false)
  assert.equal(cancelled.commit, undefined)
  assert.equal(cancelled.handled, true)
  result = key(key(closedSelect, 'Enter').state, 'ArrowDown')
  assert.equal(key(result.state, 'Enter').commit, 'station')
})

test('Home/End, bounded arrows, Page keys and Tab support long dropdowns without trapping focus', () => {
  const first = key(closedSelect, 'Home').state, last = key(closedSelect, 'End').state
  assert.equal(first.active, 0)
  assert.equal(key(first, 'ArrowUp').state.active, 0)
  assert.equal(last.active, 4)
  assert.equal(key(last, 'ArrowDown').state.active, 4)
  assert.equal(key(first, 'PageDown').state.active, 4)
  assert.equal(key(last, 'PageUp').state.active, 0)
  const tabbed = key(last, 'Tab')
  assert.equal(tabbed.commit, 'tokyo')
  assert.equal(tabbed.state.open, false)
  assert.equal(tabbed.handled, false, 'Tab must retain native focus traversal')
})

test('typeahead matches a phrase, cycles repeated initials and resets after a pause', () => {
  assert.equal(key(closedSelect, 'z').state.active, 2, 'Unmatched typing retains the selected item')
  let result = key(closedSelect, 's')
  assert.equal(result.state.active, 3, 'typing starts searching after the selected item')
  result = key(result.state, 's', 1100)
  assert.equal(result.state.active, 2, 'repeat initial cycles matching options')
  result = key(result.state, 'a', 1200)
  // A new sequence after a pause can match the full label including spaces.
  result = key(result.state, 't', 2000)
  assert.equal(result.state.active, 4)
  result = key(result.state, 'o', 2100)
  assert.equal(result.state.active, 4)
  assert.equal(result.commit, undefined)
  assert.equal(key(result.state, ' ').commit, 'tokyo')
})

test('pointer selection/dismissal and disabled/empty lists cannot accidentally commit', () => {
  const opened = key(closedSelect, 'Enter').state
  assert.equal(selectTransition(options, opened, 'sf', { type: 'choose', index: 0 }).commit, 'dubai')
  assert.equal(selectTransition(options, opened, 'sf', { type: 'choose', index: 1 }).commit, undefined)
  assert.equal(selectTransition(options, opened, 'sf', { type: 'dismiss' }).commit, undefined)
  assert.equal(selectTransition(options, opened, 'sf', { type: 'toggle' }).state.open, false)
  assert.equal(selectTransition([], opened, 'sf', { type: 'toggle' }).state.open, false)
  assert.equal(key(opened, 'x', 1000, { ctrlKey: true }).handled, false)
})

test('menus fit narrow screens, flip above near the bottom and cap long lists', () => {
  const narrow = selectPlacement({ left: 250, top: 60, bottom: 104, width: 150 }, { width: 320, height: 800 })
  assert.equal(narrow.width, 220)
  assert.equal(narrow.left + narrow.width, 308)
  assert.equal(narrow.top, 112)
  assert.equal(narrow.maxHeight, 304)
  const above = selectPlacement({ left: 20, top: 700, bottom: 744, width: 250 }, { width: 1024, height: 768 })
  assert.equal(above.side, 'top')
  assert.equal(above.bottom, 76)
  assert.equal(above.top, undefined)
  const tiny = selectPlacement({ left: 0, top: 44, bottom: 88, width: 300 }, { width: 200, height: 320 })
  assert.equal(tiny.width, 176)
  assert.equal(tiny.left, 12)
  assert.ok(tiny.top + tiny.maxHeight <= 308)
})
