import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { setupTempDirs } from '../testing/tempDir'
import { openDatabase, type Db } from './connection'
import {
  MigrationError,
  applyMigrations,
  getSchemaVersion,
  migrationChecksum,
  type Migration,
} from './migrations'
import { MIGRATIONS } from './migrations/index'

const tempDir = setupTempDirs()

const tables = (db: Db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .pluck()
    .all() as string[]
const migrationRows = (db: Db) => db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()

const second: Migration = {
  version: 2,
  name: 'segunda',
  sql: 'CREATE TABLE exemplo (id INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT;',
}

describe('migrações do esquema (applyMigrations)', () => {
  it('banco novo: aplica as migrações reais e registra cada uma', () => {
    const db = openDatabase(path.join(tempDir(), 'novo.db'), { create: true })
    expect(getSchemaVersion(db)).toBe(0)
    expect(applyMigrations(db)).toEqual({ applied: [1], version: MIGRATIONS.length })
    expect(getSchemaVersion(db)).toBe(1)
    expect(tables(db)).toEqual(['app_meta', 'schema_migrations'])
    expect(migrationRows(db)).toEqual([
      expect.objectContaining({ version: 1, name: 'inicial', checksum: migrationChecksum(MIGRATIONS[0]) }),
    ])
    db.close()
  })

  it('rodar de novo, e mais uma vez após reabrir, não reaplica nem duplica nada', () => {
    const file = path.join(tempDir(), 'repetido.db')
    const db = openDatabase(file, { create: true })
    applyMigrations(db)
    const before = migrationRows(db)
    expect(applyMigrations(db)).toEqual({ applied: [], version: 1 })
    db.close()
    const reopened = openDatabase(file)
    expect(applyMigrations(reopened)).toEqual({ applied: [], version: 1 })
    expect(migrationRows(reopened)).toEqual(before)
    expect(tables(reopened)).toEqual(['app_meta', 'schema_migrations'])
    reopened.close()
  })

  it('migração nova é aplicada sozinha, depois das já existentes', () => {
    const db = openDatabase(path.join(tempDir(), 'incremental.db'), { create: true })
    applyMigrations(db, MIGRATIONS)
    expect(applyMigrations(db, [...MIGRATIONS, second])).toEqual({ applied: [2], version: 2 })
    expect(tables(db)).toContain('exemplo')
    expect(applyMigrations(db, [...MIGRATIONS, second])).toEqual({ applied: [], version: 2 })
    db.close()
  })

  it('migração com erro é desfeita por inteiro, sem registro nem tabela pela metade', () => {
    const db = openDatabase(path.join(tempDir(), 'falha.db'), { create: true })
    applyMigrations(db)
    const broken: Migration = {
      version: 2,
      name: 'quebrada',
      sql: 'CREATE TABLE parcial (id INTEGER PRIMARY KEY) STRICT; INSERT INTO tabela_inexistente VALUES (1);',
    }
    expect(() => applyMigrations(db, [...MIGRATIONS, broken])).toThrow()
    expect(tables(db)).not.toContain('parcial')
    expect(getSchemaVersion(db)).toBe(1)
    db.close()
  })

  it('recusa migração já aplicada que mudou, sem alterar o banco', () => {
    const db = openDatabase(path.join(tempDir(), 'alterada.db'), { create: true })
    applyMigrations(db, [...MIGRATIONS, second])
    const changed = { ...second, sql: second.sql.replace('v TEXT', 'w TEXT') }
    expect(() => applyMigrations(db, [...MIGRATIONS, changed])).toThrow(MigrationError)
    const renamed = { ...second, name: 'outro-nome' }
    expect(() => applyMigrations(db, [...MIGRATIONS, renamed])).toThrow(MigrationError)
    expect(getSchemaVersion(db)).toBe(2)
    db.close()
  })

  it('recusa banco mais novo que o código e lista fora de ordem', () => {
    const db = openDatabase(path.join(tempDir(), 'versoes.db'), { create: true })
    applyMigrations(db, [...MIGRATIONS, second])
    expect(() => applyMigrations(db, MIGRATIONS)).toThrow(MigrationError)
    const gap: Migration = { ...second, version: 3 }
    const fresh = openDatabase(path.join(tempDir(), 'lacuna.db'), { create: true })
    expect(() => applyMigrations(fresh, [...MIGRATIONS, gap])).toThrow(MigrationError)
    // A lista inválida é recusada antes de qualquer gravação.
    expect(getSchemaVersion(fresh)).toBe(0)
    fresh.close()
    db.close()
  })
})

describe('migrações com concorrência (BEGIN IMMEDIATE)', () => {
  it('enquanto uma conexão migra, outra não consegue ler o estado nem aplicar nada', () => {
    const file = path.join(tempDir(), 'disputa.db')
    const first = openDatabase(file, { create: true })
    const second = openDatabase(file)
    // Sem espera na segunda conexão: dentro do mesmo processo, esperar travaria o teste.
    second.pragma('busy_timeout = 0')
    let attempt: unknown
    // Função SQL chamada no meio da migração da primeira conexão, com a transação aberta.
    first.function('tentativa_concorrente', () => {
      try {
        applyMigrations(second)
        attempt = 'aplicou'
      } catch (error) {
        attempt = error
      }
      return 0
    })
    const racing: Migration = {
      version: 1,
      name: 'disputada',
      sql: 'CREATE TABLE disputada (id INTEGER PRIMARY KEY) STRICT; SELECT tentativa_concorrente();',
    }

    expect(applyMigrations(first, [racing])).toEqual({ applied: [1], version: 1 })
    expect(attempt).toMatchObject({ code: 'SQLITE_BUSY' })
    // A segunda conexão, depois que a primeira terminou, vê tudo aplicado e não refaz nada.
    expect(applyMigrations(second, [racing])).toEqual({ applied: [], version: 1 })
    expect(migrationRows(second)).toHaveLength(1)
    second.close()
    first.close()
  })

  it('vários processos migrando o mesmo banco ao mesmo tempo: uma aplicação só, nenhum erro', async () => {
    const file = path.join(tempDir(), 'processos.db')
    // Banco já criado em modo WAL, como o db:init deixa. (Vários processos abrindo ao mesmo tempo
    // um arquivo ainda no modo de diário padrão disputam a troca para WAL e podem receber
    // "database is locked"; por isso a criação é um passo único e explícito.)
    openDatabase(file, { create: true }).close()
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const worker = path.join(repoRoot, 'server', 'src', 'testing', 'migrateWorker.ts')
    const startAt = Date.now() + 2500
    const run = () =>
      new Promise<{ ok: boolean; applied?: number[]; version?: number; error?: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', worker, file, String(startAt)], {
          cwd: repoRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let out = ''
        let err = ''
        child.stdout.on('data', (chunk) => (out += chunk))
        child.stderr.on('data', (chunk) => (err += chunk))
        child.on('error', reject)
        child.on('close', (code) => {
          if (code !== 0) reject(new Error(`processo terminou com código ${code}: ${err}`))
          else resolve(JSON.parse(out))
        })
      })

    const results = await Promise.all([run(), run(), run(), run()])
    expect(results.every((result) => result.ok)).toBe(true)
    const appliedLists = results.map((result) => result.applied ?? [])
    // As duas migrações foram aplicadas uma única vez no total, por algum dos processos.
    expect(appliedLists.flat().sort()).toEqual([1, 2])
    expect(results.every((result) => result.version === 2)).toBe(true)

    const db = openDatabase(file)
    expect(migrationRows(db)).toHaveLength(2)
    expect(db.prepare('SELECT COUNT(*) FROM lenta').pluck().get()).toBe(300000)
    db.close()
  }, 30000)
})
