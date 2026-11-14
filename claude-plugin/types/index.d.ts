export type PantryItem = { title: string; href: string }

export type PantryView =
  | { kind: 'loading' }
  | { kind: 'offline'; hub: string }
  | { kind: 'unregistered'; hub: string; cwd: string }
  | { kind: 'down'; hub: string; project: string }
  | { kind: 'online'; project: string; url: string; needs: number; waiting: PantryItem[]; working: PantryItem[]; ready: number; drift: number }

declare module 'claude-code' {
  interface PluginState {
    'pantry-pane': { view: Shaped<PantryView> }
  }
}
