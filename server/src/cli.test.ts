import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openDatabase } from './db/connection'
import { getSchemaVersion } from './db/migrations'
import { setupTempDirs } from './testing/tempDir'

const tempDir = setupTempDirs()
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Roda um ponto de entrada como processo de verdade, sem nenhuma variável GESTAO_* herdada. */
function runEntry(entry: 'initDb.ts' | 'main.ts', env: NodeJS.ProcessEnv, args: string[] = []) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GESTAO_')))
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(repoRoot, 'server', 'src', entry), ...args], {
      cwd: repoRoot,
      env: { ...clean, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}

describe('comando db:init (processo real)', () => {
  it('cria o banco no caminho explícito e recusa rodar de novo sobre ele', async () => {
    const dir = tempDir()
    const dbPath = path.join(dir, 'gestao.db')
    const created = await runEntry('initDb.ts', { GESTAO_ENV: 'production', GESTAO_DB_PATH: dbPath })
    expect(created).toMatchObject({ code: 0 })
    expect(created.output).toContain('Banco criado (production), esquema na versão 1')
    const db = openDatabase(dbPath)
    expect(getSchemaVersion(db)).toBe(1)
    db.close()

    const before = fs.readFileSync(dbPath)
    const again = await runEntry('initDb.ts', { GESTAO_ENV: 'production', GESTAO_DB_PATH: dbPath })
    expect(again.code).toBe(1)
    expect(again.output).toContain('Já existe um banco')
    expect(fs.readFileSync(dbPath).equals(before)).toBe(true)
  }, 20000)

  it('sem configuração explícita ou com argumentos: recusa antes de criar qualquer arquivo', async () => {
    const dir = tempDir()
    const dbPath = path.join(dir, 'gestao.db')
    const cases = [
      { env: {}, args: [] },
      { env: { GESTAO_DB_PATH: dbPath }, args: [] },
      { env: { GESTAO_ENV: 'production' }, args: [] },
      { env: { GESTAO_ENV: 'production', GESTAO_DB_PATH: dbPath }, args: ['--dev'] },
    ]
    for (const { env, args } of cases) {
      const result = await runEntry('initDb.ts', env, args)
      expect(result.code).toBe(1)
      expect(result.output).toContain('Configuração inválida')
    }
    expect(fs.readdirSync(dir)).toEqual([])
  }, 20000)
})

describe('início do servidor no modo estrito (processo real, sem --dev)', () => {
  it('não assume desenvolvimento nem cria banco: recusa e não cria nada', async () => {
    const dir = tempDir()
    const dataDirExisted = fs.existsSync(path.join(repoRoot, 'data'))
    const cases = [
      { env: {}, args: [], message: 'GESTAO_ENV é obrigatório' },
      { env: { GESTAO_ENV: 'development' }, args: [], message: 'GESTAO_DB_PATH é obrigatório' },
      {
        env: { GESTAO_ENV: 'production', GESTAO_DB_PATH: path.join(dir, 'digitado-errado.db') },
        args: [],
        message: 'db:init',
      },
      { env: { GESTAO_ENV: 'production' }, args: ['--dev'], message: '--dev' },
      { env: { GESTAO_ENV: 'production' }, args: ['--outro'], message: 'Argumento desconhecido' },
    ]
    for (const { env, args, message } of cases) {
      const result = await runEntry('main.ts', env, args)
      expect(result.code).toBe(1)
      expect(result.output).toContain(message)
    }
    expect(fs.readdirSync(dir)).toEqual([])
    expect(fs.existsSync(path.join(repoRoot, 'data'))).toBe(dataDirExisted)
  }, 30000)
})
