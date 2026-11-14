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

const view = atom({ plugin: 'pantry-pane', key: 'view' } as const, { kind: 'loading' } as PantryView, { shape: 'view-2' })

type Brief = {
  waiting?: { id: string; title?: string }[]
  answered?: { ref: string }[]
  inFlight?: { planId: string | null; title: string; claim: unknown; sessions: unknown[] }[]
  drift?: unknown[]
  next?: { queue?: unknown[] }
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
let poll: { cancel: () => void } | undefined

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

// A project with a preview proxy serves its own app at the root, so PANTRY's pages sit under
// /__pantry there. Try that first, then the bare path a project without a proxy uses.
async function brief($: EngineInterface, base: string): Promise<{ b: Brief; root: string }> {
  for (const prefix of ['/__pantry', '']) {
    const res = await $.http.fetch(`${base}${prefix}/brief.json`)
    if (res.ok) return { b: JSON.parse(res.text), root: `${base}${prefix}` }
  }
  throw new Error('no brief.json')
}

async function refresh($: EngineInterface): Promise<void> {
    // Read the folder each time: the session can change directory after it starts, and a value kept
    // from session.start would keep asking the hub about a folder the session has left.
    cwd = (await $.session.cwd().catch(() => '')) || cwd
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
          const { b, root } = await brief($, h.url.replace(/\/$/, ''))
          const answered = new Set((b.answered ?? []).map(a => a.ref))
          // Links open the PANTRY app, not a browser: pantry://project/<name>, with ?to= for one page.
          const prefix = new URL(root).pathname.replace(/\/$/, '')
          const app = (path?: string) => `pantry://project/${encodeURIComponent(h.name)}${path ? `?to=${encodeURIComponent(path)}` : ''}`
          const plan = (id: string) => app(`${prefix}/plan/${encodeURIComponent(id)}`)
          const waiting = (b.waiting ?? []).filter(w => !answered.has(w.id)).map(w => ({ title: w.title ?? w.id, href: plan(w.id) }))
          const working = (b.inFlight ?? []).filter(r => r.planId && (r.claim || r.sessions.length)).map(r => ({ title: r.title, href: plan(r.planId as string) }))
          next = { kind: 'online', project: h.name, url: app(`${prefix}/`), needs: waiting.length, waiting, working, ready: b.next?.queue?.length ?? 0, drift: b.drift?.length ?? 0 }
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
    poll?.cancel?.()
    poll = $.clock.every(POLL_MS, () => void refresh($))
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
    // Laid out like PANTRY's sidebar mode, and drawn the GRAIN way: ink on paper, state carried by
    // weight rather than hue. Text keeps the theme's own ink so it holds in light and dark; muted
    // ink is the dim style; a quiet card has a thin square rule, and what needs the owner gets the
    // heavy rule and bold type, as PANTRY's .is-alert cards and chips do in CSS.
    const tile = (label: string, n: number, alert = false) => (
      <Box flexDirection="column" borderStyle={alert && n ? 'bold' : 'single'} paddingX={1} flexGrow={1}>
        <Text bold={alert && n > 0}>{n}</Text>
        <Text dimColor>{label}</Text>
      </Box>
    )
    const card = (item: { title: string; href: string }, alert: boolean) => (
      <Box flexDirection="column" borderStyle={alert ? 'bold' : 'single'} paddingX={1}>
        <Text bold={alert}>{item.title}</Text>
        <Link href={item.href}>Open plan</Link>
      </Box>
    )
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{v.project}</Text>
        <Box flexDirection="row" gap={1}>
          {tile('Needs you', v.needs, true)}
          {tile('Working', v.working.length)}
          {tile('Ready', v.ready)}
          {tile('Drift', v.drift, true)}
        </Box>
        <Text bold>Needs you</Text>
        {v.waiting.length ? v.waiting.slice(0, 8).map(w => card(w, true)) : <Text dimColor>Nothing is waiting on you.</Text>}
        <Text bold>Working now</Text>
        {v.working.length ? v.working.slice(0, 6).map(w => card(w, false)) : <Text dimColor>No session is working a plan.</Text>}
        <Box flexDirection="row" gap={2}>
          <Link href={v.url}>Open in the PANTRY app</Link>
          {again}
        </Box>
      </Box>
    )
  })
}
