export type PantryView =
  | { kind: 'loading' }
  | { kind: 'offline'; hub: string }
  | { kind: 'unregistered'; hub: string; cwd: string }
  | { kind: 'down'; hub: string; project: string }
  | { kind: 'online'; project: string; url: string; needs: number; waiting: string[]; working: string[] }

declare module 'claude-code' {
  interface PluginState {
    'pantry-pane': { view: PantryView }
  }
}
