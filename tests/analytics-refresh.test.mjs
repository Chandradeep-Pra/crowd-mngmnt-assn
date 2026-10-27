import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '../src/api/client.ts'
import { createAnalyticsRefresh } from '../src/realtime/analytics-refresh.ts'

function setup(t, extra = {}) {
  let time = 0, calls = 0
  const tasks = new Set(), errors = []
  const controller = createAnalyticsRefresh({ now: () => time,
    schedule: (callback, delay) => { const task = { callback, at: time + delay }; tasks.add(task); return () => tasks.delete(task) },
    refresh: async () => { calls++ }, isBusy: () => false, onError: error => errors.push(error), ...extra })
  t.after(controller.stop)
  const advance = async ms => {
    time += ms
    // Drain tasks due at this instant and promise continuations, without real sleeps.
    for (let i = 0; i < 12; i++) {
      for (const task of [...tasks]) if (task.at <= time) { tasks.delete(task); task.callback() }
      await Promise.resolve()
    }
  }
  return { controller, advance, errors, calls: () => calls, tasks }
}

test('a burst coalesces into one read after 15s; idle time does not poll', async t => {
  const env = setup(t); env.controller.setEnabled(true)
  for (let i = 0; i < 100; i++) env.controller.notify()
  await env.advance(14_999); assert.equal(env.calls(), 0)
  await env.advance(1); assert.equal(env.calls(), 1)
  await env.advance(60_000); assert.equal(env.calls(), 1)
  assert.equal(env.tasks.size, 0)
})

test('no overlap; activity during an in-flight read produces one follow-up', async t => {
  let calls = 0, finish
  const env = setup(t, { refresh: () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  env.controller.setEnabled(true); env.controller.notify(); await env.advance(15_000)
  env.controller.notify(); env.controller.notify(); await env.advance(30_000)
  assert.equal(calls, 1)
  finish(); await env.advance(0); assert.equal(calls, 2)
  finish(); await env.advance(60_000); assert.equal(calls, 2)
})

test('disabled tabs retain activity, resume once and stop cancels scheduled work', async t => {
  const env = setup(t)
  env.controller.notify(); await env.advance(30_000); assert.equal(env.calls(), 0)
  env.controller.setEnabled(true); env.controller.setEnabled(false)
  assert.equal(env.tasks.size, 0)
  env.controller.setEnabled(true); await env.advance(0); assert.equal(env.calls(), 1)
  env.controller.notify(); env.controller.stop(); await env.advance(60_000)
  assert.equal(env.calls(), 1)
})

test('other site reads delay refresh instead of overlapping them', async t => {
  let busy = true
  const env = setup(t, { isBusy: () => busy })
  env.controller.setEnabled(true); env.controller.notify(); await env.advance(15_000)
  assert.equal(env.calls(), 0)
  busy = false; await env.advance(999); assert.equal(env.calls(), 0)
  await env.advance(1); assert.equal(env.calls(), 1)
})

test('errors back off to 30/60s and success resets the minimum to 15s', async t => {
  let calls = 0
  const env = setup(t, { refresh: async () => { if (++calls < 3) throw new Error('synthetic failure') } })
  env.controller.setEnabled(true); env.controller.notify(); await env.advance(15_000)
  env.controller.notify(); await env.advance(29_999); assert.equal(calls, 1)
  await env.advance(1); assert.equal(calls, 2)
  env.controller.notify(); await env.advance(59_999); assert.equal(calls, 2)
  await env.advance(1); assert.equal(calls, 3)
  env.controller.notify(); await env.advance(14_999); assert.equal(calls, 3)
  await env.advance(1); assert.equal(calls, 4)
  assert.equal(env.errors.length, 2)
})

test('Retry-After takes precedence and missing deadlines pause automatic reads', async t => {
  let calls = 0
  const env = setup(t, { refresh: async () => { calls++; throw new ApiError('rate-limit', 'Wait', { retryAt: calls === 1 ? 120_000 : null }) } })
  env.controller.setEnabled(true); env.controller.notify(); await env.advance(15_000)
  env.controller.notify(); await env.advance(104_999); assert.equal(calls, 1)
  await env.advance(1); assert.equal(calls, 2)
  env.controller.notify(); await env.advance(600_000); assert.equal(calls, 2)
})

test('long deadlines do not overflow browser timers or trigger reads early', async t => {
  let calls = 0
  const deadline = 3_000_000_000
  const env = setup(t, { refresh: async () => { calls++; return { retryAt: deadline } } })
  env.controller.setEnabled(true); env.controller.notify(); await env.advance(15_000)
  env.controller.notify(); assert.equal([...env.tasks][0].at, 15_000 + 2_147_483_647)
  await env.advance(2_147_483_647); assert.equal(calls, 1)
  await env.advance(deadline - 15_000 - 2_147_483_647); assert.equal(calls, 2)
})

test('late rejection after stop does not report an error or schedule another read', async t => {
  let reject
  const env = setup(t, { refresh: () => new Promise((_resolve, fail) => { reject = fail }) })
  env.controller.setEnabled(true); env.controller.notify(); await env.advance(15_000)
  env.controller.stop(); reject(new Error('late')); await env.advance(60_000)
  assert.equal(env.errors.length, 0); assert.equal(env.tasks.size, 0)
})
