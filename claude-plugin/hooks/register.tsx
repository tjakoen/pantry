// The PANTRY pane: the current project's command center beside the chat.
//
// The plugin API draws native elements and has no embedded browser, so the pane reads the
// project's /brief.json and draws a sidebar summary, with a link to the full command center in
// sidebar mode (?mode=side). Nothing here names a machine: the hub comes from PANTRY_HUB_URL,
// then ~/.pantry/hub.json, then the default hub port.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PantryItem, PantryItem as Item, PantryView } from '../types'

const PANE = 'pantry'
const DEFAULT_HUB = 'http://localhost:4400'
const POLL_MS = 30_000

const view = atom({ plugin: 'pantry-pane', key: 'view' } as const, { kind: 'loading' } as PantryView, { shape: 'view-3' })

type BriefAction = { label: string; kind: string; value: string }
type Brief = {
  waiting?: { id: string; title?: string; detail?: string; actions?: BriefAction[] }[]
  answered?: { ref: string }[]
  inFlight?: { planId: string | null; title: string; status?: string; touches?: string[]; claim: { tool?: string; sessionId?: string; state?: string } | null; sessions: { id: string; lastSeenAt?: string }[]; actions?: BriefAction[] }[]
  drift?: { id: string; severity?: string; label: string; detail?: string; actions?: BriefAction[] }[]
  next?: { queue?: { id: string; title: string; actions?: BriefAction[] }[] }
}

/** The agent prompt a brief item carries, the one the command center's copy button copies. */
function promptOf(actions: BriefAction[] | undefined): string | undefined {
  return actions?.find(a => a.kind === 'copy' && /prompt/i.test(a.label))?.value ?? actions?.find(a => a.kind === 'copy')?.value
}

/** How long ago, said the short way: 4m, 2h, 3d. */
function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
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
let known = ''
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

// A pane cannot follow a pantry:// link, so it asks the hub, which opens the desktop app on the page
// the same way `pantry open` does, falling back to the browser when no app is installed.
async function launch($: EngineInterface, hub: string, project: string, page: string): Promise<void> {
  await $.http.fetch(`${hub}/launch?project=${encodeURIComponent(project)}&to=${encodeURIComponent(page)}`, { method: 'POST' }).catch(() => undefined)
}

/** A plan's progress, read from its checklist: done boxes over all boxes, or nothing without one. */
async function stepsOf($: EngineInterface, root: string, id: string): Promise<string[]> {
  try {
    return (await $.fs.read(`${root}/plans/${id}.md`)).split('\n').filter(l => /^\s*- \[[ xX]\]/.test(l)).map(l => l.replace(/^\s*- \[([ xX])\]\s*/, (_, c) => (c === ' ' ? '○ ' : '✓ ')))
  } catch { return [] }
}

async function progress($: EngineInterface, root: string, id: string): Promise<string | undefined> {
  try {
    const md = await $.fs.read(`${root}/plans/${id}.md`)
    const all = md.match(/^\s*- \[[ xX]\]/gm)?.length ?? 0
    const done = md.match(/^\s*- \[[xX]\]/gm)?.length ?? 0
    return all ? `${done} of ${all} steps done` : undefined
  } catch { return undefined }
}

const isLive = (r: NonNullable<Brief['inFlight']>[number]) => r.planId && r.status !== 'done' && r.claim && r.claim.state !== 'done' && r.claim.state !== 'released'

/** This session's live claim in any other registered project, with that project named on it. */
async function findClaim($: EngineInterface, hub: string, me: string, skip: string): Promise<PantryItem | undefined> {
  const home = (await $.env.get('PANTRY_HOME')) ?? `${await $.env.get('HOME')}/.pantry`
  let projects: { name: string; path: string }[] = []
  try { projects = JSON.parse(await $.fs.read(`${home}/projects.json`)).projects ?? [] } catch { return undefined }
  for (const p of projects) {
    if (p.name === skip) continue
    try {
      const h = JSON.parse((await $.http.fetch(`${hub}/health?path=${encodeURIComponent(p.path)}`)).text)
      if (!h.up || !h.url) continue
      const { b, root } = await brief($, h.url.replace(/\/$/, ''))
      const r = (b.inFlight ?? []).find(r => isLive(r) && r.claim?.sessionId?.slice(0, 8) === me)
      if (!r) continue
      const prefix = new URL(root).pathname.replace(/\/$/, '')
      const steps = await progress($, p.path, r.planId as string)
      return { title: r.title, steps: await stepsOf($, p.path, r.planId as string), detail: [`in ${p.name}`, r.status ?? 'doing', steps].filter(Boolean).join(' · '), href: `${prefix}/plans/plan/${encodeURIComponent(r.planId as string)}`, project: p.name }
    } catch {}
  }
  return undefined
}

async function refresh($: EngineInterface, from?: string): Promise<void> {
    // Read the folder each time: the session can change directory after it starts, and a value kept
    // from session.start would keep asking the hub about a folder the session has left.
    cwd = from ?? ((await $.session.cwd().catch(() => '')) || cwd)
    const hub = await hubUrl($)
    let next: PantryView
    try {
      const res = await $.http.fetch(`${hub}/health?path=${encodeURIComponent(cwd)}`)
      // A folder outside every project (a scratch dir, a mod folder) keeps the last project shown
      // rather than blanking the pane; a session that never had one asks to register.
      if (res.status === 404 && known && known !== cwd) return refresh($, known)
      if (res.status === 404) next = { kind: 'unregistered', hub, cwd }
      else if (!res.ok) next = { kind: 'offline', hub }
      else {
        const h = JSON.parse(res.text)
        known = cwd
        if (!h.up || !h.url) next = { kind: 'down', hub, project: h.name ?? 'this project' }
        else {
          const { b, root } = await brief($, h.url.replace(/\/$/, ''))
          const answered = new Set((b.answered ?? []).map(a => a.ref))
          // Items carry a page path; the buttons ask the hub to open the PANTRY app on it (see launch).
          const prefix = new URL(root).pathname.replace(/\/$/, '')
          const plan = (id: string) => `${prefix}/plans/plan/${encodeURIComponent(id)}`
          const waiting = (b.waiting ?? []).filter(w => !answered.has(w.id)).map(w => ({ title: w.title ?? w.id, detail: w.detail, href: plan(w.id), prompt: promptOf(w.actions) }))
          // Done plans stay in inFlight for the record; only an open plan with a live claim is working.
          const live = (b.inFlight ?? []).filter(isLive)
          const me = ((await $.session.id().catch(() => '')) || '').slice(0, 8)
          const mine = me ? live.find(r => r.claim?.sessionId && me.startsWith(r.claim.sessionId.slice(0, 8))) : undefined
          // The session's plan can sit in another project than the folder it is in (work in a sibling
          // repo, say), so when this project holds no claim of ours, ask the other projects.
          const elsewhere = mine || !me ? undefined : await findClaim($, hub, me, h.name)
          const steps = mine && h.path ? await progress($, h.path, mine.planId as string) : undefined
          const current = elsewhere ?? (mine && { steps: h.path ? await stepsOf($, h.path, mine.planId as string) : [], title: mine.title, detail: [mine.status ?? 'doing', steps, mine.touches?.length ? `${mine.touches.length} file${mine.touches.length === 1 ? '' : 's'} touched` : 'nothing touched yet'].join(' · '), href: plan(mine.planId as string) })
          const working = live.filter(r => r !== mine).map(r => {
            const seen = r.sessions.map(x => x.lastSeenAt).filter(Boolean).sort().at(-1)
            const who = r.claim?.tool ? `${r.claim.tool} holds it` : 'no claim'
            return { title: r.title, detail: [who, seen && `seen ${ago(seen)}`].filter(Boolean).join(' · '), href: plan(r.planId as string) }
          })
          const upNext = (b.next?.queue ?? []).slice(0, 3).map(q => ({ title: q.title, href: plan(q.id), prompt: q.id }))
          const drift = (b.drift ?? []).map(d => ({ title: d.label, detail: d.detail, alert: d.severity === 'error', prompt: promptOf(d.actions) ?? `PANTRY's doctor reports ${d.label}: ${d.detail ?? ''}. Fix it.` }))
          // This session's child agents, live from the engine rather than the hub.
          const agents = (await $.agent.list().catch(() => [])).filter(a => a.status === 'running').map(a => a.description || a.type)
          // The repository's web page, from the session's git remote, in https form.
          const remote = (await $.session.repo().catch(() => null))?.remote ?? ''
          const repo = remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '') || undefined
          next = { kind: 'online', repo, agents, updated: new Date().toTimeString().slice(0, 5), hub, project: h.name, current: current || undefined, url: `${prefix}/`, needs: waiting.length, waiting, working, upNext, drift }
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
    // Laid out like PANTRY's sidebar mode and drawn the GRAIN way: ink on paper, state carried by
    // weight rather than hue. Every card can be acted on from here: Open brings the desktop app
    // forward on its page, and the Claude buttons hand the item's own agent prompt to this session.
    const ask = (text: string) => void $.prompt.submit({ text, asUser: true })
    const open = (page: string, project = v.project) => void launch($, v.hub, project, page)
    // PANTRY exists so the owner sees what waits on them without leaving the work. The pane leads with
    // that: the plan this session is on, then the calls only the owner can make, then what is ready to
    // start. Everything else is one line that opens the app. Titles are text; every control is a real
    // button, so what can be pressed never has to be guessed. State is weight, never hue.
    const actions = (it: Item, verb?: string) => (
      <Box flexDirection="row" gap={1}>
        {it.href ? <Button variant="secondary" onPress={() => open(it.href as string, it.project)}>Open</Button> : null}
        {verb && it.prompt ? <Button variant="secondary" onPress={() => ask(it.prompt as string)}>{verb}</Button> : null}
      </Box>
    )
    // Three ways to start a ready plan. The pane cannot open a session itself, so each button asks
    // this one to: claim it here, hand it to a new session, or run it in a child agent.
    const starts = (q: Item) => {
      const id = q.prompt as string
      const claim = `the PANTRY plan ${id} ("${q.title}"): claim it with pantry_claim, set its status to doing, and work it to done`
      return (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button variant="secondary" onPress={() => ask(`Start ${claim}.`)}>Here</Button>
          <Button variant="secondary" onPress={() => ask(`Start a new session for ${claim}. Write it a complete brief.`)}>New session</Button>
          <Button variant="secondary" onPress={() => ask(`Run ${claim} in a child agent, and report back here when it finishes.`)}>Child agent</Button>
          <Button variant="secondary" onPress={() => open(q.href as string)}>Open</Button>
        </Box>
      )
    }
    const item = (it: Item, key: string, verb?: string, strong?: boolean) => (
      <Box key={key} flexDirection="column" gap={1} paddingY={1}>
        <Box flexDirection="column">
          <Text bold={strong}>{it.title}</Text>
          {it.detail ? <Text dimColor>{it.detail}</Text> : null}
        </Box>
        {actions(it, verb)}
      </Box>
    )
    const heading = (text: string, n?: number) => <Text bold>{text}{n ? <Text dimColor>{`  ${n}`}</Text> : null}</Text>
    return (
      <Box flexDirection="column" gap={2} paddingX={1}>
        <Box flexDirection="column">
          <Text bold>{v.project}</Text>
          <Text dimColor>{v.needs ? `${v.needs} call${v.needs === 1 ? '' : 's'} waiting on you` : 'Nothing is waiting on you'}</Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button variant="primary" onPress={() => open(v.url)}>Open PANTRY</Button>
          {v.repo ? <Link href={v.repo}>Repo ↗</Link> : null}
          <Button variant="secondary" onPress={() => void refresh($)}>Refresh</Button>
        </Box>
        <Text dimColor>{`Updated ${v.updated}, refreshes every ${POLL_MS / 1000}s`}</Text>

        <Box flexDirection="column" gap={1} borderStyle="single" paddingX={1} paddingY={1}>
          <Text dimColor>This session is on</Text>
          {v.current
            ? <><Text bold>{v.current.title}</Text><Text dimColor>{v.current.detail}</Text><Box flexDirection="column">{(v.current.steps ?? []).map((t, n) => <Text key={`s${n}`} dimColor={t.startsWith('✓')}>{t}</Text>)}</Box>{actions(v.current)}</>
            : <><Text>No plan claimed</Text><Text dimColor>Work here lands on no plan in PANTRY.</Text></>}
          {(v.agents ?? []).length ? (
            <Box flexDirection="column">
              <Text dimColor>{`${(v.agents ?? []).length} child agent${(v.agents ?? []).length === 1 ? '' : 's'} running`}</Text>
              {(v.agents ?? []).map((a, n) => <Text key={`a${n}`}>{`· ${a}`}</Text>)}
            </Box>
          ) : <Text dimColor>No child agents running</Text>}
        </Box>

        {v.waiting.length ? (
          <Box flexDirection="column" borderStyle="bold" paddingX={1}>
            {heading('Waiting on you', v.waiting.length)}
            {v.waiting.map((w, n) => item(w, `w${n}`, 'Ask Claude', true))}
          </Box>
        ) : null}

        {v.upNext.length ? (
          <Box flexDirection="column" paddingX={1}>
            {heading('Ready to start', v.upNext.length)}
            {v.upNext.map((q, n) => (
              <Box key={`q${n}`} flexDirection="column" gap={1} paddingY={1}>
                <Text>{q.title}</Text>
                {starts(q)}
              </Box>
            ))}
          </Box>
        ) : null}

        {v.working.length ? (
          <Box flexDirection="column" paddingX={1}>
            {heading('Other sessions', v.working.length)}
            {v.working.map((w, n) => item(w, `o${n}`))}
          </Box>
        ) : null}

        {v.drift.length ? (
          <Box flexDirection="column" paddingX={1}>
            {heading('Drift', v.drift.length)}
            <Text dimColor>Checks the doctor runs on the repo that are failing.</Text>
            {v.drift.map((d, n) => item(d, `d${n}`, 'Fix it', d.alert))}
          </Box>
        ) : null}

      </Box>
    )
  })
}
