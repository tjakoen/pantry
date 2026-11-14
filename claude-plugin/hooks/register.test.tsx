import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'pantry-pane',
  component: 'Pane',
  requestId: 'pantry',
  props: { title: 'PANTRY', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const json = (status: number, body: unknown) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(body) } })

function engine(on: any, http: (url: string) => unknown) {
  on('command.register', () => ({ value: { command: 'pantry' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: {} }))
  on('clock.every', () => ({ value: {} }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/someone' : undefined }))
  on('fs.read', () => ({ deny: 'missing' }))
  on('http.fetch', (_: unknown, e: any) => http(e.url))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/demo' }))
}

test('online: the pane shows the tiles, the cards and links into PANTRY', async ($, on) => {
  engine(on, url =>
    url.includes('/health')
      ? json(200, { registered: true, name: 'demo', up: true, url: 'http://localhost:4401/' })
      : json(200, {
          waiting: [{ id: 'a', title: 'Pick a name' }, { id: 'b', title: 'Answered already' }],
          answered: [{ ref: 'b' }],
          inFlight: [{ planId: 'p1', title: 'Build it', claim: {}, sessions: [] }],
        }),
  )
  await $.session.start({ cwd: '/work/demo', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'pantry' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Needs you$/ }))?.text).toBe('Needs you')
  expect((await ui.find({ type: 'Text', text: /Pick a name/ }))?.text).toBe('Pick a name')
  expect((await ui.find({ type: 'Text', text: /Answered already/ }))).toBeUndefined()
  expect((await ui.find({ type: 'Link', text: /Open plan/ }))?.props?.href).toBe('pantry://project/demo?to=%2F__pantry%2Fplan%2Fa')
  expect((await ui.find({ type: 'Link', text: /PANTRY app/ }))?.props?.href).toBe('pantry://project/demo?to=%2F__pantry%2F')
  await ui.unmount()
})

test('offline: a dead hub shows how to start it', async ($, on) => {
  engine(on, () => ({ deny: 'connection refused' }))
  await $.session.start({ cwd: '/work/demo', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'pantry' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /offline/ }))?.text).toBe('PANTRY is offline')
  expect((await ui.find({ type: 'Code' }))?.props?.source).toBe('pantry hub ensure')
  await ui.unmount()
})
