import path from 'path'

const SUPPRESSION_WINDOW_MS = 15_000
const suppressed = new Map<string, number>()

export function suppressLocalWrite(localPath: string): void {
  suppressed.set(normalize(localPath), Date.now() + SUPPRESSION_WINDOW_MS)
}

export function consumeSuppressedLocalWrite(localPath: string): boolean {
  const key = normalize(localPath)
  const expiresAt = suppressed.get(key)
  if (!expiresAt) return false

  suppressed.delete(key)
  return expiresAt > Date.now()
}

function normalize(localPath: string): string {
  return path.resolve(localPath).toLowerCase()
}
