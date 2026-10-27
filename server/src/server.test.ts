import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { HOST } from './config'
import { DatabaseNotFoundError, openDatabase } from './db/connection'
import { initDatabase } from './db/init'
import { getSchemaVersion } from './db/migrations'
import { DatabaseNotInitializedError, startServer } from './server'
import { setupTempDirs } from './testing/tempDir'

const tempDir = setupTempDirs()

describe('inicialização e encerramento do servidor (startServer)', () => {
  it('aplica as migrações, escuta só em 127.0.0.1 e responde por HTTP de verdade', async () => {
    const dbPath = path.join(tempDir(), 'servidor.db')
    initDatabase(dbPath)
    // Porta 0: o sistema escolhe uma livre, para o teste não depender da 3001.
    const running = await startServer({ host: HOST, port: 0, dbPath })
    try {
      const address = new URL(running.address)
      expect(address.hostname).toBe('127.0.0.1')
      const response = await fetch(new URL('/api/health', running.address))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok', database: 'ok', schemaVersion: 1 })
    } finally {
      await running.stop()
    }
  })

  it('encerramento organizado: para de aceitar conexões, fecha o banco e pode ser chamado de novo', async () => {
    const dbPath = path.join(tempDir(), 'encerramento.db')
    initDatabase(dbPath)
    const running = await startServer({ host: HOST, port: 0, dbPath })
    const url = new URL('/api/health', running.address)
    await running.stop()
    expect(running.db.open).toBe(false)
    await expect(fetch(url)).rejects.toThrow()
    await expect(running.stop()).resolves.toBeUndefined()
    // O arquivo continua íntegro e já migrado para a próxima abertura.
    const reopened = openDatabase(dbPath)
    expect(getSchemaVersion(reopened)).toBe(1)
    reopened.close()
  })

  it('falha ao iniciar (porta ocupada): fecha o banco e não deixa nada aberto', async () => {
    const dir = tempDir()
    initDatabase(path.join(dir, 'a.db'))
    initDatabase(path.join(dir, 'b.db'))
    const first = await startServer({ host: HOST, port: 0, dbPath: path.join(dir, 'a.db') })
    const busyPort = Number(new URL(first.address).port)
    try {
      await expect(
        startServer({ host: HOST, port: busyPort, dbPath: path.join(dir, 'b.db') }),
      ).rejects.toThrow()
      // Se a conexão de b.db tivesse ficado aberta no Windows, a pasta não poderia ser apagada
      // no fim do teste; a abertura abaixo também prova que o arquivo ficou consistente.
      const check = openDatabase(path.join(dir, 'b.db'))
      expect(getSchemaVersion(check)).toBe(1)
      check.close()
    } finally {
      await first.stop()
    }
  })

  it('banco inexistente: recusa sem criar nenhum arquivo', async () => {
    const dir = tempDir()
    await expect(startServer({ host: HOST, port: 0, dbPath: path.join(dir, 'nao-existe.db') })).rejects.toThrow(
      DatabaseNotFoundError,
    )
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('arquivo vazio: recusa sem alterar o arquivo, byte a byte, nem deixar auxiliares', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'vazio.db')
    fs.writeFileSync(file, '')
    await expect(startServer({ host: HOST, port: 0, dbPath: file })).rejects.toThrow('modo WAL')
    expect(fs.readFileSync(file)).toEqual(Buffer.alloc(0))
    expect(fs.readdirSync(dir)).toEqual(['vazio.db'])
  })

  it('banco SQLite válido fora do modo WAL (outro programa): recusa sem alterar nada, byte a byte', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'outro-programa.db')
    const other = new Database(file)
    other.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('dado fictício')")
    other.close()
    const before = fs.readFileSync(file)
    expect(before.subarray(18, 20)).toEqual(Buffer.from([1, 1])) // cabeçalho: diário padrão, não WAL
    await expect(startServer({ host: HOST, port: 0, dbPath: file })).rejects.toThrow('modo WAL')
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    expect(fs.readdirSync(dir)).toEqual(['outro-programa.db'])
  })

  it('banco em WAL sem nenhuma migração (não veio do db:init): recusa sem alterar nada, byte a byte', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'sem-esquema.db')
    openDatabase(file, { create: true }).close()
    const before = fs.readFileSync(file)
    await expect(startServer({ host: HOST, port: 0, dbPath: file })).rejects.toThrow(DatabaseNotInitializedError)
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    // A conexão foi fechada: o SQLite removeu os auxiliares que a leitura criou.
    expect(fs.readdirSync(dir)).toEqual(['sem-esquema.db'])
  })

  it('createDatabase (banco padrão do modo de desenvolvimento): cria e migra o banco', async () => {
    const dbPath = path.join(tempDir(), 'dev.db')
    const running = await startServer({ host: HOST, port: 0, dbPath, createDatabase: true })
    try {
      expect(getSchemaVersion(running.db)).toBe(1)
    } finally {
      await running.stop()
    }
  })
})
