/**
 * Gravação protegida da chave principal dos dados, para que uma aba nunca sobrescreva
 * mudanças feitas em outra aba que ela não leu.
 *
 * Como funciona:
 * - cada aba guarda o texto exato que leu ou gravou por último (`lastKnown`);
 * - toda gravação acontece dentro de uma trava compartilhada entre as abas (Web Locks)
 *   e, já dentro dela, relê o armazenamento e só grava se o texto ainda for `lastKnown`;
 * - se outra aba gravou antes (texto diferente) ou se a leitura falhar, nada é gravado
 *   e a aba para de gravar até ser recarregada.
 *
 * Limites: a trava só coordena abas que usam este mesmo código. Uma aba aberta com uma
 * versão antiga do aplicativo grava sem a trava e sem conferir, e pode sobrescrever dados
 * até ser recarregada (as abas novas percebem a mudança e param de gravar). Sem Web Locks
 * no navegador, não há como gravar com segurança e nada é gravado.
 */

/** Nome da trava compartilhada por todas as abas do aplicativo. */
export const STORAGE_LOCK_NAME = 'gestao-financeira:dados'

/** O mínimo do `localStorage` usado aqui (permite testar sem navegador). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** O mínimo do `navigator.locks` usado aqui. */
export interface LockManagerLike {
  request(name: string, callback: () => unknown): Promise<unknown>
}

export type WriteResult = 'written' | 'conflict' | 'read-failed' | 'write-failed'

/**
 * Relê a chave e só grava `next` se o texto atual ainda for `expected` (null = chave
 * inexistente). Deve ser chamada dentro da trava: ler, comparar e gravar acontecem em
 * sequência, sem pausa entre eles.
 */
export function writeIfUnchanged(
  storage: StorageLike,
  key: string,
  expected: string | null,
  next: string,
): WriteResult {
  let current: string | null
  try {
    current = storage.getItem(key)
  } catch {
    return 'read-failed'
  }
  if (current !== expected) return 'conflict'
  try {
    storage.setItem(key, next)
  } catch {
    return 'write-failed'
  }
  return 'written'
}

/** A trava do navegador, ou null quando não existe (navegador antigo ou contexto inseguro). */
export function getLockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks
  return locks && typeof locks.request === 'function' ? locks : null
}

/**
 * Situação da gravação nesta aba:
 * - 'saved': tudo o que foi pedido está gravado (ou ainda não houve gravação);
 * - 'saving': há uma gravação pedida e ainda não confirmada;
 * - 'write-failed': a última gravação falhou (cota cheia, bloqueio); tenta de novo na próxima;
 * - 'conflict': outra aba gravou dados que esta não leu; nada mais é gravado aqui;
 * - 'read-failed': não foi possível conferir o armazenamento; nada mais é gravado aqui;
 * - 'unsupported': sem Web Locks não há gravação segura; nada é gravado.
 */
export type PersistenceStatus =
  | 'saved'
  | 'saving'
  | 'write-failed'
  | 'conflict'
  | 'read-failed'
  | 'unsupported'

/** Situações em que a aba não grava mais nada até ser recarregada. */
export function isBlockedStatus(status: PersistenceStatus): boolean {
  return status === 'conflict' || status === 'read-failed' || status === 'unsupported'
}

export interface GuardedWriterOptions {
  storage: StorageLike
  key: string
  /** null: sem Web Locks; nada será gravado. */
  locks: LockManagerLike | null
  /** Texto lido da chave na abertura (null = chave inexistente). */
  initialRaw: string | null
  onStatus: (status: PersistenceStatus) => void
}

export interface GuardedWriter {
  /**
   * Pede para gravar. `serialize` é chamado só dentro da trava, com a versão mais recente
   * pedida: pedidos feitos enquanto se espera a trava são juntados no último.
   */
  save(serialize: () => string, token?: object): void
  /**
   * O estado identificado por `token` (passado a `save`) já está gravado: a gravação
   * confirmada incluiu esse pedido ou um posterior. Antes da confirmação, é false.
   */
  isSaved(token: object): boolean
  /**
   * Outra aba mudou a chave (evento `storage`): se o texto for novo, para de gravar.
   * `undefined`: não foi possível ler o valor atual; também para de gravar.
   */
  notifyExternalChange(value: string | null | undefined): void
  getStatus(): PersistenceStatus
}

/** Fila de gravações protegidas de uma aba. */
export function createGuardedWriter(options: GuardedWriterOptions): GuardedWriter {
  const { storage, key, locks, onStatus } = options
  let lastKnown = options.initialRaw
  // Pedido mais recente ainda não gravado; `seq` cresce a cada pedido.
  let pending: { serialize: () => string; seq: number } | null = null
  let requested = 0
  // Número do último pedido confirmado no armazenamento.
  let savedSeq = 0
  const seqOf = new WeakMap<object, number>()
  let waitingForLock = false
  let status: PersistenceStatus = locks ? 'saved' : 'unsupported'

  function setStatus(next: PersistenceStatus) {
    if (status === next) return
    status = next
    onStatus(next)
  }

  /** Dentro da trava: grava os pedidos pendentes, sempre conferindo o estado atual. */
  function flush() {
    while (pending !== null) {
      // Revalida dentro da trava: um evento ou uma gravação anterior pode ter bloqueado
      // enquanto o pedido esperava. Um bloqueio nunca é desfeito aqui.
      if (isBlockedStatus(status)) break
      const request = pending
      pending = null
      const next = request.serialize()
      const result = writeIfUnchanged(storage, key, lastKnown, next)
      if (result === 'written') {
        lastKnown = next
        savedSeq = request.seq
        continue
      }
      if (result === 'write-failed') {
        // O armazenamento não mudou; a próxima alteração tenta de novo, com a mesma base.
        setStatus('write-failed')
        return
      }
      setStatus(result)
      break
    }
    if (isBlockedStatus(status)) {
      pending = null
      return
    }
    setStatus('saved')
  }

  function requestLock() {
    if (!locks) return
    waitingForLock = true
    locks
      .request(STORAGE_LOCK_NAME, () => {
        waitingForLock = false
        flush()
      })
      .catch(() => {
        // A trava não pôde ser obtida: sem gravação segura, não grava.
        waitingForLock = false
        pending = null
        setStatus('read-failed')
      })
  }

  return {
    save(serialize, token) {
      if (isBlockedStatus(status)) return
      requested++
      if (token) seqOf.set(token, requested)
      pending = { serialize, seq: requested }
      setStatus('saving')
      if (!waitingForLock) requestLock()
    },
    isSaved(token) {
      const seq = seqOf.get(token)
      return seq !== undefined && seq <= savedSeq
    },
    notifyExternalChange(value) {
      if (isBlockedStatus(status) || value === lastKnown) return
      pending = null
      setStatus(value === undefined ? 'read-failed' : 'conflict')
    },
    getStatus: () => status,
  }
}
