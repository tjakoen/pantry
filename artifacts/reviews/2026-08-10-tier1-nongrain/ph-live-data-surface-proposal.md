# ph-live web app: data-surface proposal

Read-only survey for PANTRY's guided-tour proxy. Nothing in this file has been
applied to the repo. All paths are relative to `apps/web/src` unless noted.

## Route to walk through first

**`/create-event`** (the Zone C wizard), specifically the **media** step.

Reasons, with evidence:

- It is today's work. `git log` on `main`:
  - `a856d2be feat(zone-c): store the media step against an event draft` (HEAD)
  - `bc873b7a feat(web): reach the Talent Hub, and the portal nav on a phone`
    (same commit also binds the media step's schema/action)
  - `plans/create-event-zone-c.md`: "### It persists now (2026-08-10)"
- It is the only wizard step that is real. Six of seven steps are
  `verified: false` disabled previews (`constants/eventWizard.ts`); `media` is
  the first to leave the preview shell and has an actual server action,
  schema, and persistence contract behind it. A review of a placeholder step
  has nothing to ask; a review of this step has a real state machine.
- It needs no auth and no route guard. `middleware/portal-guard.ts`:
  `PROTECTED_PREFIXES = ['/organiser', '/account', '/talent']` — `/create-event`
  is not in that list, confirmed by its own `page.tsx` (no redirect logic).
- It is built to degrade gracefully with no backend running, by design, not by
  accident. `actions/create-event/save-event-media.ts`:
  > "WHAT CAN STILL COME BACK UNSTORED: a visitor with no session ... a user
  > who belongs to no organization ... or an unreachable API. Each returns a
  > validated result with `persisted: false` and a banner saying why, rather
  > than a green tick over nothing."

  And `api/event-drafts.ts`:
  > "These do not throw. A wizard step that cannot reach the API has to say so
  > in its own banner, not blow up the render, so every failure comes back as
  > a tagged result the caller renders."

  Concretely: `request()` in `api/event-drafts.ts` checks for the
  `auth-token` cookie first and returns `{ ok: false, kind: 'no_session' }`
  before ever calling `fetch`. With no cookie set (the default on a bare local
  run) and no Laravel API up, the page still renders, the form still accepts
  files, client-side validation (MIME/bytes/pixel dimensions via
  `createImageBitmap`) still runs, and submitting shows the amber "checked,
  but nothing is stored: sign in to save media" banner — never a crash, never
  a blank screen.
- Verified against a real local run, per the commit message itself:
  `bc873b7a`: "Verified against the production build on :3000: 19/19 walk
  stops, 0 broken links, portal-drawers and cockpit-viewports green."

Caveat on "no external services": rendering and client-side validation need
none. The one thing that *does* need `NEXT_PUBLIC_BACKEND_API_URL`
(`.env.example`, default `http://localhost:8000`) is the save attempt
completing as `persisted: true` — without the Laravel API up, save always ends
amber ("checked but not stored"), which is still a legitimate, plannable step
for a reviewer to walk ("confirm the banner explains why, not that it's
green").

## Proposed attributes

### `/create-event` — wizard shell (`components/pages/create-event/CreateEventWizard.tsx`)

| # | File:line | Current element | Proposed attribute | Review question it enables |
|---|---|---|---|---|
| 1 | `CreateEventWizard.tsx:58` | `<Typography h4 as="h1" ...>Create event</Typography>` | `data-surface="event-wizard:heading"` | "Am I on the create-event page at all, in a screenshot with no URL bar?" |
| 2 | `CreateEventWizard.tsx:61-63` | `<Typography body2 ...>Step {current + 1} of {steps.length}</Typography>` | `data-surface="event-wizard:step-counter"` | "Does the step counter track the stepper and the active panel, or drift?" |
| 3 | `CreateEventWizard.tsx:105-114` | `<Button type="button" variant="action" onClick={goNext} disabled={Boolean(blockedReason)} ...>{EVENT_WIZARD_ACTIONS.next}...</Button>` | `data-surface="event-wizard:next-button"` | "Does Next correctly disable when the current step is blocked?" (the key action button of the flow) |
| 4 | `CreateEventWizard.tsx:119-123` | `{blockedReason && (<Typography details role="status" ...>{blockedReason}</Typography>)}` | `data-surface="event-wizard:blocked-reason"` | "When a step is blocked, does the stated reason match what's actually wrong?" |

### `/create-event` — step indicator (`components/pages/create-event/WizardStepper.tsx`)

| # | File:line | Current element | Proposed attribute | Review question |
|---|---|---|---|---|
| 5 | `WizardStepper.tsx:33-48` (the `<button>` inside the `.map`, per step) | `<button type="button" onClick={...} aria-current={isActive ? 'step' : undefined} ...>` | `data-surface={`event-wizard-step:${step.id}`}` | "Is the `media` step (id `media`) marked done/active/upcoming correctly as I navigate?" |

**Per-row decision (item 5):** this renders inside `steps.map(...)`, normally a
bad candidate. It is proposed anyway because the loop is over a fixed,
hand-authored list of 7 known ids (`details, venue, media, tiers, addons,
event-page, publish` — `constants/eventWizard.ts:88-164`), not arbitrary
user/API data. The ids are stable across refactors by construction (renaming
one is a deliberate content edit, not a reorder side effect), so
`event-wizard-step:media` is a durable address, unlike an index-based one
would be.

### `/create-event` — media step form (`components/pages/create-event/MediaStepForm.tsx`)

| # | File:line | Current element | Proposed attribute | Review question |
|---|---|---|---|---|
| 6 | `MediaStepForm.tsx:310-312` | `<Button type="submit" variant="action" ... disabled={pending \|\| blocked}>{pending ? 'Checking…' : 'Save media'}</Button>` | `data-surface="media-step:save-button"` | "Does the button read 'Checking…' during the pending state and re-enable after?" |
| 7 | `MediaStepForm.tsx:320-333` | `<div role="status" className={cn('rounded-md border ...', state.status === 'error' ? ... : state.persisted ? 'border-emerald-500/60 ...' : 'border-amber-500/60 ...')}>` (the save-result banner) | `data-surface="media-step:save-status"` | "Is this the right color for the right outcome — green only when `persisted` is really true, amber for 'checked but not stored,' red for a real validation error?" This is the single most reviewable surface in the whole route: three states, and the plan doc records a real regression here (a second save wiping the first save's social links) that this banner is the evidence for. |

Item 7 is the primary recommendation if the whole proposal had to shrink to
one attribute: it is literally the state the linked commits and plan doc are
about ("the banner distinguishes 'saved' from 'checked but not stored'
instead of letting one green tick cover both").

### `/talent-hub` — landing page (`app/(website)/talent-hub/page.tsx`)

Second-priority route: public (not behind `portal-guard.ts`), fully static
(no backend calls — content comes from `constants/talentHub.ts`), and shipped
the same day (`e082ad99`, `bc873b7a`).

| # | File:line | Current element | Proposed attribute | Review question |
|---|---|---|---|---|
| 8 | `page.tsx:40` | `<h1 className="pt-display-80 text-foreground">{TALENT_HERO.headline}</h1>` | `data-surface="talent-hub:hero-heading"` | "Is the hero headline the one copy actually approved (Figma export text), or drifted?" |
| 9 | `page.tsx:42-44` | `<Button variant="filled" size="l" href={TALENT_HERO.ctaPrimary.href}>{TALENT_HERO.ctaPrimary.text}</Button>` | `data-surface="talent-hub:hero-cta-primary"` | "Does the primary CTA point where the plan says it should?" |
| 10 | `page.tsx:89-93` | `<Link href={TALENT_PORTAL_SIGNPOST.href} className="pt-body-30 font-bold text-heading underline">{TALENT_PORTAL_SIGNPOST.text}</Link>` | `data-surface="talent-hub:portal-signpost"` | "Is the one link from the public landing page into the gated `/talent` portal present and pointed correctly?" (`plans/talent-hub-zone-e.md` calls this out by name as the intended signpost, since `/talent` is deliberately absent from primary nav) |

Ten attributes total. That is inside budget; items 1-7 (the wizard/media
step) are the stronger set if a smaller cut is wanted, since they cover a
route with actual branching state, not just static marketing copy.

## Caveats — things that make this harder than it looks

1. **Design-system button wrappers, checked, both pass through cleanly.**
   `components/atoms/shadcn-custom/button.tsx` (used by the wizard) and
   `packages/ui/src/atoms/Button.tsx` (used by the Talent Hub page) both spread
   `...props` onto the rendered `<button>`/`<a>`/`Slot`, and both prop
   interfaces extend `React.ButtonHTMLAttributes<HTMLButtonElement>`, which
   permits arbitrary `data-*`. Confirmed by reading both files; no swallowing
   here. Do not assume this generally, though — recheck for any *other*
   wrapper before adding an attribute through it.

2. **A shared component would carry the attribute onto unrelated routes.**
   `PlaceholderNotice` (`components/pages/marketing/PlaceholderNotice.tsx`) is
   reused across `/create-event` (all 6 unbound wizard steps), `/talent`,
   `/organiser/events/[eventId]`, `/pricing`, and marketing sections. A single
   `data-surface` on that component would resolve to the same value on six-plus
   different screens, which breaks the "stable, name-what-it-is" contract —
   the `id` half of `kind:id` would have to be threaded in as a prop per call
   site (e.g. the `what=` string it already takes) rather than hardcoded in
   the component, or it should be left alone entirely. Not proposed above for
   this reason.

3. **This repo already has its own `data-tour="..."` convention**, built for
   an internal, config-driven guided-tour engine
   (`plans/demo-mode-tour-system.md`, `lib/tour/`). Only three real instances
   exist in the DOM today: `NavigationBar.tsx:52` (`site-logo`),
   `GeneralAppBar.tsx:45` (`events-nav`) and `:66` (`account-nav`) — most
   `data-tour` targets referenced in `config/tours/*.ts` are aspirational and
   do not exist in the markup yet (see the caught bug documented at the top of
   `config/tours/onboarding.ts`). `data-surface` is a different attribute name
   so there is no literal collision, but a reviewer or a future contributor
   could easily conflate the two systems, or a stray copy-paste could put a
   `data-tour` value into a `data-surface` attribute. Worth a one-line note in
   whatever change actually adds these, distinguishing "this is PANTRY's
   review handle" from "this is the in-app tour engine's anchor."

4. **`/create-event`'s wizard stepper is a `.map()` loop** (item 5 above) —
   flagged and justified inline in the table, but it is the one place in this
   proposal that departs from "never address inside a loop." If the reviewer
   disagrees, the fallback is a single `data-surface="event-wizard:stepper"`
   on the `<ol>` container (`WizardStepper.tsx:26`) instead of the seven
   per-step buttons, at the cost of not being able to ask "is step N
   specifically in the right state."

5. **Server components vs client components**: everything proposed above sits
   in a `'use client'` file (`CreateEventWizard.tsx`, `WizardStepper.tsx`,
   `MediaStepForm.tsx` all declare it; `talent-hub/page.tsx` is a server
   component but renders plain static markup with no client-only gating) —
   `data-surface` is a static JSX attribute in every case, so it survives
   SSR/hydration the same way `className` does. No case here where the
   attribute would only exist after a client-side effect runs.

6. **The gallery slots inside the media step are a real per-item loop with no
   stable identity** (`MediaStepForm.tsx:177-194`, `Array.from({ length:
   GALLERY_SPEC.slots })` keyed only by array index `i`) — correctly excluded
   from this proposal. There is nothing to hang a stable id on until a file is
   picked, and even then the identity is "whichever slot a browser dialog
   happened to fill," not a domain concept worth naming.
