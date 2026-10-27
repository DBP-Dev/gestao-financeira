import fs from 'node:fs'
import path from 'node:path'

/** O servidor só escuta no próprio computador nesta etapa; não há como mudar por configuração. */
export const HOST = '127.0.0.1'
export const DEFAULT_PORT = 3001

export type ServerEnvironment = 'development' | 'production'

export interface ServerConfig {
  environment: ServerEnvironment
  host: typeof HOST
  port: number
  /** Caminho absoluto do arquivo do banco SQLite. */
  dbPath: string
  /**
   * Se o servidor pode criar o arquivo do banco. Só é verdadeiro para o banco padrão do
   * modo de desenvolvimento; um caminho configurado precisa existir (criado por `db:init`).
   */
  createDatabase: boolean
}

/** Configuração ausente ou inválida: nada é criado e o comando não roda (nunca cai num caminho alternativo). */
export class ConfigError extends Error {}

/**
 * Lê a configuração do servidor.
 *
 * Modo estrito (padrão, `server:start`): exige
 * - GESTAO_ENV: "development" ou "production";
 * - GESTAO_DB_PATH: caminho absoluto de um banco que já existe (criado por `db:init`).
 *
 * Modo de desenvolvimento (`dev: true`, só pelo argumento `--dev` do `server:dev`):
 * GESTAO_ENV pode faltar ou ser "development" (nunca "production"); sem GESTAO_DB_PATH, usa
 * `<repositório>/data/dev.db` (ignorado pelo Git), que pode ser criado. Com GESTAO_DB_PATH,
 * vale a mesma regra do modo estrito.
 *
 * GESTAO_PORT é opcional nos dois modos (padrão 3001).
 */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  repoRoot: string,
  options: { dev?: boolean } = {},
): ServerConfig {
  const environment = options.dev ? parseDevEnvironment(env.GESTAO_ENV) : parseEnvironment(env.GESTAO_ENV)
  const port = parsePort(env.GESTAO_PORT)
  const rawPath = env.GESTAO_DB_PATH

  if (rawPath === undefined && options.dev) {
    const dataDir = path.join(repoRoot, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    return { environment, host: HOST, port, dbPath: path.join(dataDir, 'dev.db'), createDatabase: true }
  }
  if (rawPath === undefined) {
    throw new ConfigError('GESTAO_DB_PATH é obrigatório (use `npm run server:dev` para o banco de desenvolvimento).')
  }
  const dbPath = validateDbPath(rawPath)
  if (!fs.existsSync(dbPath)) {
    throw new ConfigError('O banco de GESTAO_DB_PATH não existe; crie-o antes com `npm run db:init`.')
  }
  return { environment, host: HOST, port, dbPath, createDatabase: false }
}

export interface InitConfig {
  environment: ServerEnvironment
  /** Caminho absoluto do banco a criar; ainda não existe. */
  dbPath: string
}

/**
 * Configuração do `db:init`: sempre explícita. Exige GESTAO_ENV válido e GESTAO_DB_PATH
 * absoluto, com a pasta existente e sem banco (nem arquivos auxiliares) no caminho.
 */
export function loadInitConfig(env: NodeJS.ProcessEnv): InitConfig {
  const environment = parseEnvironment(env.GESTAO_ENV)
  if (env.GESTAO_DB_PATH === undefined) throw new ConfigError('GESTAO_DB_PATH é obrigatório.')
  const dbPath = validateDbPath(env.GESTAO_DB_PATH)
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (fs.existsSync(dbPath + suffix)) {
      throw new ConfigError('Já existe um banco (ou arquivo auxiliar dele) em GESTAO_DB_PATH; nada foi alterado.')
    }
  }
  return { environment, dbPath }
}

function parseEnvironment(value: string | undefined): ServerEnvironment {
  if (value === 'development' || value === 'production') return value
  if (value === undefined) throw new ConfigError('GESTAO_ENV é obrigatório ("development" ou "production").')
  throw new ConfigError('GESTAO_ENV deve ser "development" ou "production".')
}

function parseDevEnvironment(value: string | undefined): ServerEnvironment {
  if (value === undefined || value === 'development') return 'development'
  throw new ConfigError('O modo de desenvolvimento (--dev) só aceita GESTAO_ENV ausente ou "development".')
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT
  if (!/^\d+$/.test(value)) throw new ConfigError('GESTAO_PORT deve ser um número de porta.')
  const port = Number(value)
  if (port < 1 || port > 65535) throw new ConfigError('GESTAO_PORT deve estar entre 1 e 65535.')
  return port
}

function validateDbPath(value: string): string {
  if (value.trim() === '' || !path.isAbsolute(value)) {
    throw new ConfigError('GESTAO_DB_PATH deve ser um caminho absoluto.')
  }
  const dir = path.dirname(value)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new ConfigError('A pasta de GESTAO_DB_PATH não existe.')
  }
  if (fs.existsSync(value) && !fs.statSync(value).isFile()) {
    throw new ConfigError('GESTAO_DB_PATH aponta para algo que não é um arquivo.')
  }
  return value
}
