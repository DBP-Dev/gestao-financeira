import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupTempDirs } from '../testing/tempDir'
import { openDatabase } from './connection'
import { initDatabase } from './init'
import { MIGRATIONS } from './migrations/index'
import { getSchemaVersion, type Migration } from './migrations'

const tempDir = setupTempDirs()

describe('criação explícita do banco (initDatabase)', () => {
  it('cria o arquivo, aplica as migrações e fecha a conexão', () => {
    const dir = tempDir()
    const file = path.join(dir, 'gestao.db')
    expect(initDatabase(file)).toEqual({ version: MIGRATIONS.length })
    // Conexão fechada: o SQLite removeu os auxiliares e só o banco ficou.
    expect(fs.readdirSync(dir)).toEqual(['gestao.db'])
    const db = openDatabase(file)
    expect(getSchemaVersion(db)).toBe(MIGRATIONS.length)
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    db.close()
  })

  it('nunca reaproveita nem altera um arquivo existente', () => {
    const file = path.join(tempDir(), 'existente.db')
    fs.writeFileSync(file, 'conteúdo que não pode ser perdido')
    expect(() => initDatabase(file)).toThrow(expect.objectContaining({ code: 'EEXIST' }))
    expect(fs.readFileSync(file, 'utf8')).toBe('conteúdo que não pode ser perdido')
  })

  it('migração com erro: o arquivo criado e os auxiliares são removidos', () => {
    const dir = tempDir()
    const broken: Migration = { version: 1, name: 'quebrada', sql: 'INSERT INTO tabela_inexistente VALUES (1);' }
    expect(() => initDatabase(path.join(dir, 'falha.db'), [broken])).toThrow()
    expect(fs.readdirSync(dir)).toEqual([])
  })
})
