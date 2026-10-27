import { ConfigError, loadInitConfig } from './config'
import { initDatabase } from './db/init'

/**
 * Ponto de entrada do `npm run db:init`: cria o banco pela primeira vez. Exige GESTAO_ENV e
 * GESTAO_DB_PATH explícitos e recusa um caminho em que já exista banco.
 */
try {
  if (process.argv.length > 2) throw new ConfigError('O db:init não aceita argumentos; use GESTAO_ENV e GESTAO_DB_PATH.')
  const config = loadInitConfig(process.env)
  const { version } = initDatabase(config.dbPath)
  console.log(`Banco criado (${config.environment}), esquema na versão ${version}: ${config.dbPath}`)
} catch (error) {
  console.error(
    error instanceof ConfigError ? `Configuração inválida: ${error.message}` : 'Falha ao criar o banco.',
  )
  if (!(error instanceof ConfigError)) console.error(error)
  process.exitCode = 1
}
