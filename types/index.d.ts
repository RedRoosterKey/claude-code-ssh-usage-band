export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Ram = { totalKb: number; availableKb: number }

declare module 'claude-code' {
  interface PluginState {
    'ssh-usage-band': { limits: Limit[]; now: number; host: string; ram: Ram | null; readAt: number }
  }
}
