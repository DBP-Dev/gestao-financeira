import Fastify, { type FastifyInstance } from 'fastify'
import type { Db } from './db/connection'
import { registerHealthRoute } from './routes/health'

export interface AppOptions {
  db: Db
  /** Registro das requisições no terminal (desligado nos testes). */
  logger?: boolean
}

/**
 * Monta o servidor HTTP. Erros respondem só com uma mensagem genérica: detalhes, caminhos
 * e pilhas ficam apenas no registro do servidor, nunca na resposta.
 */
export function buildApp({ db, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger: logger ? { level: 'info' } : false })

  app.setErrorHandler((error, request, reply) => {
    const code =
      typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined
    const status = typeof code === 'number' && code >= 400 && code < 500 ? code : 500
    if (status >= 500) request.log.error({ err: error }, 'Erro interno')
    reply.code(status).send({
      error: status >= 500 ? 'Erro interno do servidor.' : 'Requisição inválida.',
    })
  })

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'Não encontrado.' })
  })

  registerHealthRoute(app, db)
  return app
}
