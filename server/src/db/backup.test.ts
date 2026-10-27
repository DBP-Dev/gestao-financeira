import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { setupTempDirs } from '../testing/tempDir'
import { backupDatabase } from './backup'
import { openDatabase } from './connection'
import { applyMigrations, getSchemaVersion } from './migrations'

const tempDir = setupTempDirs()

describe('backup com a conexão aberta (backupDatabase)', () => {
  it('gera um arquivo que abre, responde a consultas e tem exatamente os dados esperados', async () => {
    const dir = tempDir()
    const db = openDatabase(path.join(dir, 'origem.db'), { create: true })
    applyMigrations(db)
    db.exec('CREATE TABLE contas (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, centavos INTEGER NOT NULL) STRICT')
    const insert = db.prepare('INSERT INTO contas (nome, centavos) VALUES (?, ?)')
    db.transaction(() => {
      insert.run('Luz de teste', 10001)
      insert.run('Água de teste', 5000)
    })()
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('marcador', 'antes do backup')").run()

    const target = path.join(dir, 'copia.db')
    await backupDatabase(db, target)
    // A conexão de origem continua aberta e utilizável durante e depois do backup.
    expect(db.open).toBe(true)
    insert.run('Depois do backup', 1)

    // Só a origem e a cópia final ficam na pasta: nenhum temporário nem auxiliar da cópia.
    expect(sourceFiles(dir)).toEqual(['copia.db'])
    const copy = new Database(target, { readonly: true, fileMustExist: true })
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(copy.prepare('SELECT nome, centavos FROM contas ORDER BY id').all()).toEqual([
      { nome: 'Luz de teste', centavos: 10001 },
      { nome: 'Água de teste', centavos: 5000 },
    ])
    expect(copy.prepare("SELECT value FROM app_meta WHERE key = 'marcador'").pluck().get()).toBe(
      'antes do backup',
    )
    expect(getSchemaVersion(copy)).toBe(1)
    copy.close()
    db.close()
  })

  it('não sobrescreve um arquivo existente nem aceita caminho relativo', async () => {
    const dir = tempDir()
    const db = openDatabase(path.join(dir, 'origem.db'), { create: true })
    const existing = path.join(dir, 'existente.db')
    fs.writeFileSync(existing, 'conteúdo que não pode ser perdido')
    await expect(backupDatabase(db, existing)).rejects.toThrow('já existe')
    expect(fs.readFileSync(existing, 'utf8')).toBe('conteúdo que não pode ser perdido')
    await expect(backupDatabase(db, 'relativo.db')).rejects.toThrow('absoluto')
    db.close()
  })

  it('falha simulada no meio da cópia: nenhum destino nem temporário fica para trás', async () => {
    const dir = tempDir()
    const db = filledDatabase(dir)
    const target = path.join(dir, 'interrompido.db')
    let calls = 0
    await expect(
      backupDatabase(db, target, {
        progress: () => {
          calls++
          if (calls === 2) throw new Error('falha simulada durante a cópia')
          return 10
        },
      }),
    ).rejects.toThrow('falha simulada durante a cópia')
    expect(calls).toBe(2)
    expect(sourceFiles(dir)).toEqual([])
    // A origem segue íntegra e utilizável.
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    db.close()
  })

  it('destino criado por outro durante a cópia: não é sobrescrito e o temporário é removido', async () => {
    const dir = tempDir()
    const db = filledDatabase(dir)
    const target = path.join(dir, 'disputado.db')
    let created = false
    await expect(
      backupDatabase(db, target, {
        progress: () => {
          if (!created) fs.writeFileSync(target, 'arquivo de outra origem')
          created = true
          return 10
        },
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(fs.readFileSync(target, 'utf8')).toBe('arquivo de outra origem')
    expect(sourceFiles(dir)).toEqual(['disputado.db'])
    db.close()
  })

  it('cópia que não passa na conferência não recebe o nome definitivo e o temporário é removido', async () => {
    const dir = tempDir()
    const db = filledDatabase(dir)
    const target = path.join(dir, 'conferida.db')
    // Simula uma cópia corrompida: a conferência de integridade da cópia não devolve "ok".
    const original = Database.prototype.pragma
    const spy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
      this: Database.Database,
      source: string,
      options?: Database.PragmaOptions,
    ) {
      if (source === 'integrity_check') return '*** in database main *** página corrompida (simulada)'
      return original.call(this, source, options)
    })
    try {
      await expect(backupDatabase(db, target)).rejects.toThrow('integridade')
    } finally {
      spy.mockRestore()
    }
    expect(sourceFiles(dir)).toEqual([])
    db.close()
  })

  it('pasta do destino inexistente é recusada antes de criar qualquer arquivo', async () => {
    const dir = tempDir()
    const db = filledDatabase(dir)
    await expect(backupDatabase(db, path.join(dir, 'nao-existe', 'copia.db'))).rejects.toThrow('pasta')
    expect(sourceFiles(dir)).toEqual([])
    db.close()
  })
})

/** Banco de origem com o esquema e algumas linhas fictícias. */
function filledDatabase(dir: string) {
  const db = openDatabase(path.join(dir, 'origem.db'), { create: true })
  applyMigrations(db)
  db.exec('CREATE TABLE linhas (id INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
  const insert = db.prepare('INSERT INTO linhas (v) VALUES (?)')
  db.transaction(() => {
    for (let i = 0; i < 5000; i++) insert.run(`linha fictícia ${i}`)
  })()
  return db
}

/** Arquivos da pasta que não são a origem (nem seus auxiliares). */
function sourceFiles(dir: string) {
  return fs.readdirSync(dir).filter((name) => !name.startsWith('origem.db'))
}
