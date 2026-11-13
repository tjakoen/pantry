// The PANTRY pane: the current project's command center beside the chat.
//
// The plugin API draws native elements and has no embedded browser, so the pane reads the
// project's /brief.json and draws a sidebar summary, with a link to the full command center in
// sidebar mode (?mode=side). Nothing here names a machine: the hub comes from PANTRY_HUB_URL,
// then ~/.pantry/hub.json, then the default hub port.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PantryView } from '../types'

const PANE = 'pantry'
const DEFAULT_HUB = 'http://localhost:4400'
const POLL_MS = 30_000

const view = atom({ plugin: 'pantry-pane', key: 'view' } as const, { kind: 'loading' } as PantryView, { shape: 'view-1' })

type Brief = {
  waiting?: { id: string; title?: string }[]
  answered?: { ref: string }[]
  inFlight?: { planId: string | null; title: string; claim: unknown; sessions: unknown[] }[]
}

/** The Needs you count, computed the way the command center's tile computes it. */
export function needsYou(b: Brief): string[] {
  const answered = new Set((b.answered ?? []).map(a => a.ref))
  return (b.waiting ?? []).filter(w => !answered.has(w.id)).map(w => w.title ?? w.id)
}

export function sideUrl(url: string): string {
  const u = url.endsWith('/') ? url : url + '/'
  return `${u}?mode=side`
}

let cwd = ''
let stop: (() => void) | undefined

async function hubUrl($: EngineInterface): Promise<string> {
    const env = await $.env.get('PANTRY_HUB_URL')
    if (env) return env.replace(/\/$/, '')
    const home = (await $.env.get('PANTRY_HOME')) ?? `${await $.env.get('HOME')}/.pantry`
    try {
      const hub = JSON.parse(await $.fs.read(`${home}/hub.json`))
      if (typeof hub.url === 'string') return hub.url.replace(/\/$/, '')
      if (typeof hub.port === 'number') return `http://localhost:${hub.port}`
    } catch {}
    return DEFAULT_HUB
  }

async function refresh($: EngineInterface): Promise<void> {
    const hub = await hubUrl($)
    let next: PantryView
    try {
      const res = await $.http.fetch(`${hub}/health?path=${encodeURIComponent(cwd)}`)
      if (res.status === 404) next = { kind: 'unregistered', hub, cwd }
      else if (!res.ok) next = { kind: 'offline', hub }
      else {
        const h = JSON.parse(res.text)
        if (!h.up || !h.url) next = { kind: 'down', hub, project: h.name ?? 'this project' }
        else {
          const b: Brief = JSON.parse((await $.http.fetch(`${h.url.replace(/\/$/, '')}/brief.json`)).text)
          const waiting = needsYou(b)
          const working = (b.inFlight ?? []).filter(r => r.planId && (r.claim || r.sessions.length)).map(r => r.title)
          next = { kind: 'online', project: h.name, url: h.url, needs: waiting.length, waiting, working }
        }
      }
    } catch {
      next = { kind: 'offline', hub }
    }
    await update($, view, () => next)
    await $.ui.status(next.kind === 'online' ? `PANTRY ${next.needs ? `${next.needs} need you` : 'clear'}` : next.kind === 'offline' ? 'PANTRY offline' : undefined)
  }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    cwd = (r as any)?.cwd ?? (e as any).cwd ?? ''
    await $.command.register({ name: 'pantry', description: "Show this project's PANTRY beside the chat" })
    void $.ui.open({ id: PANE, title: 'PANTRY' })
    void refresh($)
    stop?.()
    stop = $.clock.every(POLL_MS, () => void refresh($))
    return r
  })

  on('command.run', { command: 'pantry' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'PANTRY' })
    return { text: 'PANTRY pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link, Button, Code } = $.ui.resolve(e) as any
    const v = await read($, view)
    const again = <Button onPress={() => void refresh($)}>Check again</Button>

    if (v.kind === 'loading') return <Text dimColor>Finding the PANTRY hub…</Text>
    if (v.kind === 'offline')
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>PANTRY is offline</Text>
          <Text dimColor>No hub answered at {v.hub}. Start it in a terminal:</Text>
          <Code language="bash" source="pantry hub ensure" />
          {again}
        </Box>
      )
    if (v.kind === 'unregistered')
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Not a PANTRY project yet</Text>
          <Text dimColor>The hub at {v.hub} serves no project containing this folder. Register it:</Text>
          <Code language="bash" source="pantry register ." />
          {again}
        </Box>
      )
    if (v.kind === 'down')
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{v.project}: PANTRY is starting or down</Text>
          <Text dimColor>The hub at {v.hub} answers, but this project's server does not yet.</Text>
          {again}
        </Box>
      )
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{v.project}</Text>
        <Text color={v.needs ? 'yellow' : undefined}>Needs you: {v.needs}</Text>
        {v.waiting.slice(0, 8).map(w => <Text>• {w}</Text>)}
        <Text dimColor>Working: {v.working.length}</Text>
        {v.working.slice(0, 6).map(w => <Text dimColor>• {w}</Text>)}
        <Link href={sideUrl(v.url)}>Open the command center (sidebar mode)</Link>
        {again}
      </Box>
    )
  })
}
