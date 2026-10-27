import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app'
import { openDatabase } from './db/connection'
import { applyMigrations } from './db/migrations'
import { setupTempDirs } from './testing/tempDir'

const tempDir = setupTempDirs()

function setup() {
  const dir = tempDir()
  const db = openDatabase(path.join(dir, 'app.db'), { create: true })
  applyMigrations(db)
  return { dir, db, app: buildApp({ db }) }
}

describe('rota de saúde e tratamento de erros (buildApp)', () => {
  it('GET /api/health: servidor e banco ok, com a versão do esquema', async () => {
    const { dir, db, app } = setup()
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', database: 'ok', schemaVersion: 1 })
    // Nada de caminhos, nomes de arquivo ou detalhes internos na resposta.
    expect(response.body).not.toContain(dir)
    expect(response.body).not.toMatch(/\.db|gestao-test|sqlite/i)
    await app.close()
    db.close()
  })

  it('banco indisponível: 503 com mensagem genérica, sem detalhes do erro', async () => {
    const { dir, db, app } = setup()
    db.close()
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'error', database: 'unavailable' })
    expect(response.body).not.toContain(dir)
    expect(response.body).not.toMatch(/not open|connection|stack/i)
    await app.close()
  })

  it('erro interno: 500 genérico, sem a mensagem nem a pilha do erro', async () => {
    const { dir, db } = setup()
    const app = buildApp({ db })
    app.get('/api/teste-erro', async () => {
      throw new Error(`falha interna com caminho secreto ${dir}`)
    })
    const response = await app.inject({ method: 'GET', url: '/api/teste-erro' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'Erro interno do servidor.' })
    expect(response.body).not.toContain('caminho secreto')
    expect(response.body).not.toContain(dir)
    await app.close()
    db.close()
  })

  it('erro de requisição (4xx) e rota inexistente: mensagens genéricas', async () => {
    const { db, app } = setup()
    const badJson = await app.inject({
      method: 'POST',
      url: '/api/health',
      headers: { 'content-type': 'application/json' },
      payload: '{ inválido',
    })
    expect(badJson.statusCode).toBeGreaterThanOrEqual(400)
    expect(badJson.statusCode).toBeLessThan(500)
    expect(badJson.json()).toEqual({ error: expect.any(String) })
    const missing = await app.inject({ method: 'GET', url: '/api/nao-existe' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ error: 'Não encontrado.' })
    await app.close()
    db.close()
  })
})
