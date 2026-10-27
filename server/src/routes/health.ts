import type { FastifyInstance } from 'fastify'
import type { Db } from '../db/connection'
import { getSchemaVersion } from '../db/migrations'

/**
 * GET /api/health: o servidor responde e o banco aceita consultas. Só informa o estado e a
 * versão do esquema; nunca caminhos, nomes de arquivo ou conteúdo do banco.
 */
export function registerHealthRoute(app: FastifyInstance, db: Db) {
  app.get('/api/health', async (request, reply) => {
    try {
      db.prepare('SELECT 1').get()
      return { status: 'ok', database: 'ok', schemaVersion: getSchemaVersion(db) }
    } catch (error) {
      request.log.error({ err: error }, 'Banco indisponível na verificação de saúde')
      return reply.code(503).send({ status: 'error', database: 'unavailable' })
    }
  })
}
