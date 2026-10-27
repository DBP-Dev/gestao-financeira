import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'

/**
 * Pastas temporárias descartáveis para os testes, fora do repositório e de qualquer dado
 * real. São apagadas depois de cada teste; feche as conexões antes do fim do teste.
 */
export function setupTempDirs() {
  const created: string[] = []
  afterEach(() => {
    for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })
  return () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestao-test-'))
    created.push(dir)
    return dir
  }
}
