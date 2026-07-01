import type { KumpasApi } from '../../shared/api'

// Exposed by preload's contextBridge.
export const api: KumpasApi = (window as unknown as { kumpas: KumpasApi }).kumpas

export function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}
