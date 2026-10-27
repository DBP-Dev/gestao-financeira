import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupTempDirs } from '../testing/tempDir'
import { DatabaseNotFoundError, openDatabase } from './connection'

const tempDir = setupTempDirs()

afterEach(() => {
  vi.restoreAllMocks()
})

/** Faz `PRAGMA <name>` (a leitura do valor) devolver `value`, como se o ajuste não tivesse valido. */
function fakePragmaRead(name: string, value: unknown) {
  const original = Database.prototype.pragma
  vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
    this: Database.Database,
    source: string,
    options?: Database.PragmaOptions,
  ) {
    if (source === name) return value
    return original.call(this, source, options)
  })
}

describe('conexão com o SQLite (openDatabase)', () => {
  it('abre, liga WAL, chaves estrangeiras e espera de gravação, e fecha', () => {
    const db = openDatabase(path.join(tempDir(), 'conexao.db'), { create: true })
    expect(db.open).toBe(true)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    db.close()
    expect(db.open).toBe(false)
  })

  it('transação concluída fica gravada para outra conexão', () => {
    const file = path.join(tempDir(), 'transacao.db')
    const db = openDatabase(file, { create: true })
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
    db.transaction(() => {
      db.prepare('INSERT INTO t (v) VALUES (?)').run('a')
      db.prepare('INSERT INTO t (v) VALUES (?)').run('b')
    })()
    const other = openDatabase(file)
    expect(other.prepare('SELECT v FROM t ORDER BY id').pluck().all()).toEqual(['a', 'b'])
    other.close()
    db.close()
  })

  it('transação com falha é desfeita: nada do que ela gravou permanece, nem após reabrir', () => {
    const file = path.join(tempDir(), 'rollback.db')
    const db = openDatabase(file, { create: true })
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
    db.prepare('INSERT INTO t (v) VALUES (?)').run('antes')
    const failing = db.transaction(() => {
      db.prepare('INSERT INTO t (v) VALUES (?)').run('dentro 1')
      db.prepare('UPDATE t SET v = ? WHERE v = ?').run('alterado', 'antes')
      db.prepare('INSERT INTO t (v) VALUES (?)').run('dentro 2')
      throw new Error('falha proposital')
    })
    expect(() => failing()).toThrow('falha proposital')
    expect(db.inTransaction).toBe(false)
    expect(db.prepare('SELECT v FROM t ORDER BY id').pluck().all()).toEqual(['antes'])
    db.close()
    // Reabrindo o arquivo: a falha não deixou nada persistido.
    const reopened = openDatabase(file)
    expect(reopened.prepare('SELECT v FROM t ORDER BY id').pluck().all()).toEqual(['antes'])
    reopened.close()
  })

  it('arquivo que não é banco: a abertura falha e nada fica aberto', () => {
    const dir = tempDir()
    const file = path.join(dir, 'nao-e-banco.db')
    fs.writeFileSync(file, 'isto não é um banco SQLite, só texto comum para o teste')
    expect(() => openDatabase(file)).toThrow()
  })

  it('sem create, arquivo ausente é recusado e nenhum arquivo é criado', () => {
    const dir = tempDir()
    const file = path.join(dir, 'digitado-errado.db')
    expect(() => openDatabase(file)).toThrow(DatabaseNotFoundError)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it.each([
    ['foreign_keys', 0],
    ['busy_timeout', 0],
    ['journal_mode', 'delete'],
  ])('%s sem o valor esperado depois de configurado: falha e fecha a conexão', (name, value) => {
    const file = path.join(tempDir(), 'pragma.db')
    fakePragmaRead(name, value)
    expect(() => openDatabase(file, { create: true })).toThrow()
    vi.restoreAllMocks()
    // No Windows, um arquivo com conexão aberta não pode ser apagado: apagar prova que fechou.
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true })
    expect(fs.existsSync(file)).toBe(false)
  })
})
