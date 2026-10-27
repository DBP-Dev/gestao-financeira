import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase, type Db } from './connection'
import { getSchemaVersion } from './migrations'

/** Arquivos auxiliares que o SQLite pode criar ao lado de um banco. */
const SIDE_FILES = ['', '-wal', '-shm', '-journal']

/**
 * Copia o banco para `destination` com a conexão aberta, pela API de backup do SQLite
 * (consistente mesmo com gravações acontecendo). Nunca sobrescreve um arquivo existente.
 *
 * A cópia é gravada num arquivo temporário exclusivo na mesma pasta do destino
 * (`.<nome>.<id>.tmp`) e só ganha o nome definitivo depois de conferida: abre, passa no
 * `integrity_check` e tem a mesma versão de esquema da origem. O nome definitivo é dado por
 * link físico, que falha se o destino já existir, e o temporário é apagado em seguida.
 * Qualquer falha remove o temporário. Se o processo morrer no meio, sobra no máximo um
 * `.tmp`, nunca um arquivo incompleto com o nome definitivo.
 *
 * `progress` repassa o acompanhamento da API de backup (usado nos testes para simular falha
 * durante a cópia).
 */
export async function backupDatabase(
  db: Db,
  destination: string,
  options: Partial<Database.BackupOptions> = {},
): Promise<void> {
  if (!path.isAbsolute(destination)) throw new Error('O destino do backup deve ser um caminho absoluto.')
  const dir = path.dirname(destination)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('A pasta do destino do backup não existe.')
  }
  if (fs.existsSync(destination)) throw new Error('O destino do backup já existe.')

  const temp = path.join(dir, `.${path.basename(destination)}.${randomUUID()}.tmp`)
  // Criação exclusiva: falha se, por acaso, o nome já existir.
  fs.closeSync(fs.openSync(temp, 'wx'))
  try {
    await db.backup(temp, options.progress ? { progress: options.progress } : undefined)
    verifyBackup(temp, getSchemaVersion(db))
    fs.linkSync(temp, destination)
  } finally {
    for (const suffix of SIDE_FILES) fs.rmSync(temp + suffix, { force: true })
  }
}

/** Confere a cópia antes de ela receber o nome definitivo. */
function verifyBackup(file: string, expectedVersion: number): void {
  // Leitura e gravação (sem alterar nada): ao fechar, o SQLite remove os -wal/-shm que criou.
  const copy = openDatabase(file)
  try {
    const integrity = copy.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error('A cópia do backup não passou na verificação de integridade.')
    if (getSchemaVersion(copy) !== expectedVersion) {
      throw new Error('A cópia do backup não tem a mesma versão de esquema da origem.')
    }
  } finally {
    copy.close()
  }
}
