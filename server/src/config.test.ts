import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, DEFAULT_PORT, HOST, loadConfig, loadInitConfig } from './config'
import { setupTempDirs } from './testing/tempDir'

const tempDir = setupTempDirs()

/** Banco que já existe numa pasta temporária (o conteúdo não importa para a configuração). */
function existingDb() {
  const file = path.join(tempDir(), 'existente.db')
  fs.writeFileSync(file, '')
  return file
}

describe('configuração do servidor no modo estrito (padrão, server:start)', () => {
  it('com GESTAO_ENV e um banco existente: usa o caminho como está, sem criar nada', () => {
    const repo = tempDir()
    const dbPath = existingDb()
    expect(loadConfig({ GESTAO_ENV: 'production', GESTAO_DB_PATH: dbPath, GESTAO_PORT: '4000' }, repo)).toEqual({
      environment: 'production',
      host: HOST,
      port: 4000,
      dbPath,
      createDatabase: false,
    })
    expect(loadConfig({ GESTAO_ENV: 'development', GESTAO_DB_PATH: dbPath }, repo)).toMatchObject({
      environment: 'development',
      port: DEFAULT_PORT,
      createDatabase: false,
    })
    expect(fs.readdirSync(repo)).toEqual([])
  })

  it('sem GESTAO_ENV não assume desenvolvimento: é erro, mesmo com caminho válido', () => {
    const repo = tempDir()
    expect(() => loadConfig({}, repo)).toThrow(ConfigError)
    expect(() => loadConfig({ GESTAO_DB_PATH: existingDb() }, repo)).toThrow('GESTAO_ENV é obrigatório')
    expect(fs.readdirSync(repo)).toEqual([])
  })

  it('sem GESTAO_DB_PATH é erro em qualquer ambiente, sem cair no banco de desenvolvimento', () => {
    const repo = tempDir()
    for (const environment of ['production', 'development']) {
      expect(() => loadConfig({ GESTAO_ENV: environment }, repo)).toThrow('GESTAO_DB_PATH é obrigatório')
    }
    expect(fs.existsSync(path.join(repo, 'data'))).toBe(false)
  })

  it('banco inexistente no caminho configurado é erro e nada é criado', () => {
    const dir = tempDir()
    const dbPath = path.join(dir, 'digitado-errado.db')
    expect(() => loadConfig({ GESTAO_ENV: 'production', GESTAO_DB_PATH: dbPath }, tempDir())).toThrow('db:init')
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('GESTAO_DB_PATH inválido é erro, sem caminho alternativo', () => {
    const repo = tempDir()
    const missingDir = path.join(tempDir(), 'nao-existe', 'gestao.db')
    const folder = tempDir()
    for (const value of ['', 'relativo/gestao.db', missingDir, folder]) {
      expect(() => loadConfig({ GESTAO_ENV: 'production', GESTAO_DB_PATH: value }, repo)).toThrow(ConfigError)
    }
    expect(fs.existsSync(path.join(repo, 'data'))).toBe(false)
  })

  it('ambiente e porta inválidos são erro', () => {
    const repo = tempDir()
    const dbPath = existingDb()
    expect(() => loadConfig({ GESTAO_ENV: 'teste', GESTAO_DB_PATH: dbPath }, repo)).toThrow(ConfigError)
    for (const port of ['0', '65536', 'abc', '30.5']) {
      expect(() => loadConfig({ GESTAO_ENV: 'production', GESTAO_DB_PATH: dbPath, GESTAO_PORT: port }, repo)).toThrow(
        ConfigError,
      )
    }
  })

  it('o endereço nunca muda por configuração', () => {
    const env = { GESTAO_ENV: 'production', GESTAO_DB_PATH: existingDb(), GESTAO_HOST: '0.0.0.0', HOST: '0.0.0.0' }
    expect(loadConfig(env, tempDir()).host).toBe(HOST)
    expect(loadConfig({ GESTAO_HOST: '0.0.0.0' }, tempDir(), { dev: true }).host).toBe(HOST)
  })
})

describe('configuração do servidor no modo de desenvolvimento explícito (--dev, server:dev)', () => {
  it('sem GESTAO_DB_PATH: <repositório>/data/dev.db, que pode ser criado; porta 3001', () => {
    const repo = tempDir()
    expect(loadConfig({}, repo, { dev: true })).toEqual({
      environment: 'development',
      host: HOST,
      port: DEFAULT_PORT,
      dbPath: path.join(repo, 'data', 'dev.db'),
      createDatabase: true,
    })
    expect(fs.existsSync(path.join(repo, 'data'))).toBe(true)
    // A pasta é criada, o banco não: quem cria o arquivo é a conexão, ao iniciar o servidor.
    expect(fs.existsSync(path.join(repo, 'data', 'dev.db'))).toBe(false)
  })

  it('com GESTAO_DB_PATH: o banco precisa existir, como no modo estrito', () => {
    const repo = tempDir()
    const dbPath = existingDb()
    expect(loadConfig({ GESTAO_DB_PATH: dbPath }, repo, { dev: true })).toMatchObject({ dbPath, createDatabase: false })
    expect(() => loadConfig({ GESTAO_DB_PATH: path.join(tempDir(), 'nao.db') }, repo, { dev: true })).toThrow('db:init')
    expect(fs.existsSync(path.join(repo, 'data'))).toBe(false)
  })

  it('não combina com produção nem com ambiente inválido', () => {
    const repo = tempDir()
    expect(() => loadConfig({ GESTAO_ENV: 'production' }, repo, { dev: true })).toThrow('--dev')
    expect(() => loadConfig({ GESTAO_ENV: 'teste' }, repo, { dev: true })).toThrow(ConfigError)
    expect(fs.existsSync(path.join(repo, 'data'))).toBe(false)
  })
})

describe('configuração do db:init (loadInitConfig)', () => {
  it('exige GESTAO_ENV e GESTAO_DB_PATH explícitos', () => {
    const dbPath = path.join(tempDir(), 'novo.db')
    expect(loadInitConfig({ GESTAO_ENV: 'production', GESTAO_DB_PATH: dbPath })).toEqual({
      environment: 'production',
      dbPath,
    })
    expect(() => loadInitConfig({ GESTAO_DB_PATH: dbPath })).toThrow('GESTAO_ENV é obrigatório')
    expect(() => loadInitConfig({ GESTAO_ENV: 'teste', GESTAO_DB_PATH: dbPath })).toThrow(ConfigError)
    expect(() => loadInitConfig({ GESTAO_ENV: 'production' })).toThrow('GESTAO_DB_PATH é obrigatório')
    expect(fs.existsSync(dbPath)).toBe(false)
  })

  it('recusa caminho inválido e caminho em que já existe banco ou arquivo auxiliar', () => {
    const dir = tempDir()
    const env = (value: string) => ({ GESTAO_ENV: 'development', GESTAO_DB_PATH: value })
    for (const value of ['', 'relativo.db', path.join(dir, 'nao-existe', 'x.db'), dir]) {
      expect(() => loadInitConfig(env(value))).toThrow(ConfigError)
    }
    expect(() => loadInitConfig(env(existingDb()))).toThrow('Já existe')
    const orphan = path.join(dir, 'sobra.db')
    fs.writeFileSync(`${orphan}-wal`, '')
    expect(() => loadInitConfig(env(orphan))).toThrow('Já existe')
  })
})
