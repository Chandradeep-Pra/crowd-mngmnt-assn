import assert from 'node:assert/strict'
import test from 'node:test'
import { createRealtimeFeed } from '../src/realtime/feed.ts'
import { alertEventSchema } from '../src/realtime/contracts.ts'

function setup(t, extra = {}) {
  const handlers = new Map(), tasks = new Set()
  const calls = []
  let options, unauthorized = 0
  const socket = { auth: null, on: (name,callback) => handlers.set(name,callback), removeAllListeners: () => handlers.clear(), connect: () => calls.push('connect'), disconnect: () => calls.push('disconnect') }
  const feed = createRealtimeFeed({ origin: 'https://example.invalid', siteId: 'site-a', getToken: () => 'synthetic-token', onUnauthorized: () => unauthorized++, createSocket: (_origin,opts) => { options=opts; socket.auth=opts.auth; return socket }, schedule: callback => { tasks.add(callback); return () => tasks.delete(callback) }, ...extra })
  t.after(feed.stop)
  const flush = () => { for (const task of [...tasks]) { tasks.delete(task); task() } }
  return { feed, handlers, calls, socket, flush, options: () => options, unauthorized: () => unauthorized }
}
const live = (ts, siteId='site-a') => ({ ts, siteId, siteOccupancy: 12, zoneId: 'zone-a', zoneOccupancy: 5, genderCount: { male: 7, female: 5 } })
const alert = (eventId, ts=100) => ({ eventId, ts, siteId: 'site-a', direction: 'entry', personName: 'Example visitor' })

test('connect uses browser auth payload, bounded reconnection and never emits subscriptions', t => {
  const env = setup(t)
  env.feed.start(); env.feed.start()
  let auth
  env.options().auth(value => { auth=value })
  assert.deepEqual(auth, { token: 'synthetic-token' })
  assert.equal(env.options().reconnectionAttempts, 5)
  assert.equal(env.options().transports[0], 'websocket')
  assert.deepEqual(env.calls, ['connect'])
  assert.doesNotMatch(JSON.stringify(env.feed.getSnapshot()), /synthetic-token/)
})
test('site isolation, malformed events and out-of-order occupancy cannot overwrite current state', t => {
  const env = setup(t); env.feed.start(); env.handlers.get('connect')()
  env.handlers.get('live_occupancy')(live(100, 'site-b'))
  env.handlers.get('live_occupancy')({ ...live(100), siteOccupancy: -1 })
  env.flush(); assert.equal(env.feed.getSnapshot().live, null)
  env.handlers.get('live_occupancy')(live(200))
  env.handlers.get('live_occupancy')({ ...live(100), siteOccupancy: 99, zoneOccupancy: 99 })
  env.flush()
  assert.equal(env.feed.getSnapshot().live.siteOccupancy, 12)
  assert.equal(env.feed.getSnapshot().zones['zone-a'].count, 5)
})
test('alerts retain missing person IDs, deduplicate and cap memory while filtering other sites', t => {
  const env = setup(t); env.feed.start(); env.handlers.get('connect')()
  assert.ok(alertEventSchema.safeParse(alert('a')).success)
  env.handlers.get('alert')(alert('a'))
  env.handlers.get('alert')(alert('a'))
  env.handlers.get('alert')({ ...alert('b'), siteId: 'site-b' })
  env.flush(); assert.equal(env.feed.getSnapshot().alerts.length, 1)
  assert.equal(env.feed.getSnapshot().alerts[0].personId, undefined)
  for(let i=0;i<600;i++) env.handlers.get('alert')(alert(`event-${i}`, i))
  env.flush(); assert.equal(env.feed.getSnapshot().alerts.length, 50)
  assert.equal(env.feed.getSnapshot().alerts[0].ts, 599)
})
test('disconnect invalidates displayed live counts, reconnect awaits fresh data and old callbacks are ignored after stop', t => {
  const env=setup(t); env.feed.start(); env.handlers.get('connect')()
  env.handlers.get('live_occupancy')(live(100)); env.flush()
  env.handlers.get('disconnect')()
  assert.equal(env.feed.getSnapshot().live, null)
  assert.deepEqual(env.feed.getSnapshot().zones, {})
  env.handlers.get('connect')(); assert.equal(env.feed.getSnapshot().live, null)
  const late=env.handlers.get('live_occupancy')
  env.feed.stop(); late(live(200)); env.flush()
  assert.equal(env.feed.getSnapshot().status, 'idle')
  assert.equal(env.feed.getSnapshot().live, null)
  assert.deepEqual(env.socket.auth, {})
})
test('authentication errors expose only safe text, scrub auth and end the matching session', t => {
  const env=setup(t); env.feed.start()
  env.handlers.get('connect_error')(new Error('Authentication error PRIVATE_TOKEN'))
  assert.equal(env.unauthorized(),1)
  assert.deepEqual(env.socket.auth,{})
  assert.doesNotMatch(JSON.stringify(env.feed.getSnapshot()), /PRIVATE_TOKEN/)
  assert.equal(env.handlers.size,0)
})

test('analytics revision changes only for accepted site activity and unique movement', t => {
  const env = setup(t); env.feed.start(); env.handlers.get('connect')()
  env.handlers.get('live_occupancy')(live(100, 'site-b'))
  env.handlers.get('alert')({ ...alert('other'), siteId: 'site-b' })
  env.flush(); assert.equal(env.feed.getSnapshot().revision, 0)
  env.handlers.get('live_occupancy')(live(100)); env.flush()
  assert.equal(env.feed.getSnapshot().revision, 1)
  env.handlers.get('live_occupancy')(live(100))
  env.handlers.get('live_occupancy')(live(50))
  env.flush(); assert.equal(env.feed.getSnapshot().revision, 1)
  env.handlers.get('alert')(alert('one')); env.handlers.get('alert')(alert('one'))
  env.flush(); assert.equal(env.feed.getSnapshot().revision, 2)
  env.handlers.get('live_occupancy')(live(200)); env.flush()
  assert.equal(env.feed.getSnapshot().revision, 3)
})

test('movement arrival time is client metadata and duplicate events cannot restart it', t => {
  const env = setup(t); env.feed.start(); env.handlers.get('connect')()
  env.handlers.get('alert')({ ...alert('arrival'), receivedAt: 1 }); env.flush()
  const arrival = env.feed.getSnapshot().alerts[0].receivedAt
  assert.ok(arrival > 1)
  env.handlers.get('alert')({ ...alert('arrival'), receivedAt: Date.now() + 60_000 }); env.flush()
  assert.equal(env.feed.getSnapshot().alerts[0].receivedAt, arrival)
})
