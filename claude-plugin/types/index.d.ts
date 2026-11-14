export type PantryItem = { title: string; detail?: string; href?: string; prompt?: string; alert?: boolean; project?: string; steps?: string[] }

export type PantryView =
  | { kind: 'loading' }
  | { kind: 'offline'; hub: string }
  | { kind: 'unregistered'; hub: string; cwd: string }
  | { kind: 'down'; hub: string; project: string }
  | { kind: 'online'; repo?: string; agents: string[]; updated: string; hub: string; project: string; url: string; needs: number; current?: PantryItem; waiting: PantryItem[]; working: PantryItem[]; upNext: PantryItem[]; drift: PantryItem[] }

declare module 'claude-code' {
  interface PluginState {
    'pantry-pane': { view: Shaped<PantryView> }
  }
}
