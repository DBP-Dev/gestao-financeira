import { describe, expect, it } from 'vitest'
import {
  STORAGE_LOCK_NAME,
  createGuardedWriter,
  writeIfUnchanged,
  type LockManagerLike,
  type PersistenceStatus,
} from './storageSync'

const KEY = 'dados'

/** Armazenamento em memória, com falhas controladas (simula o localStorage). */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  const storage = {
    failRead: false,
    failWrite: false,
    writes: 0,
    getItem(key: string): string | null {
      if (storage.failRead) throw new Error('leitura bloqueada')
      return map.has(key) ? (map.get(key) as string) : null
    },
    setItem(key: string, value: string) {
      if (storage.failWrite) throw new Error('cota cheia')
      storage.writes++
      map.set(key, value)
    },
    /** Gravação feita por "outra aba", sem passar pelo gravador. */
    externalWrite(value: string) {
      map.set(KEY, value)
    },
    value: () => (map.has(KEY) ? map.get(KEY) : null),
  }
  return storage
}

/** Trava exclusiva em ordem de chegada, como o Web Locks, compartilhável entre "abas". */
function fakeLocks(): LockManagerLike & { names: string[] } {
  let tail: Promise<unknown> = Promise.resolve()
  const names: string[] = []
  return {
    names,
    request(name, callback) {
      names.push(name)
      const run = tail.then(() => callback())
      tail = run.catch(() => undefined)
      return run
    },
  }
}

/** Ocupa a trava até `release` ser chamado (outra aba gravando). */
function hold(locks: LockManagerLike) {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  void locks.request(STORAGE_LOCK_NAME, () => held)
  return release
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function writer(
  storage: ReturnType<typeof fakeStorage>,
  locks: LockManagerLike | null,
  initialRaw: string | null,
) {
  const statuses: PersistenceStatus[] = []
  const guarded = createGuardedWriter({
    storage,
    key: KEY,
    locks,
    initialRaw,
    onStatus: (status) => statuses.push(status),
  })
  return { guarded, statuses }
}

describe('writeIfUnchanged', () => {
  it('grava quando o texto atual é o esperado', () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    expect(writeIfUnchanged(storage, KEY, 'v1', 'v2')).toBe('written')
    expect(storage.value()).toBe('v2')
  })

  it('não grava quando outra aba mudou, criou ou apagou a chave', () => {
    const changed = fakeStorage({ [KEY]: 'outra' })
    expect(writeIfUnchanged(changed, KEY, 'v1', 'v2')).toBe('conflict')
    expect(changed.value()).toBe('outra')
    const created = fakeStorage({ [KEY]: 'outra' })
    expect(writeIfUnchanged(created, KEY, null, 'v2')).toBe('conflict')
    const removed = fakeStorage()
    expect(writeIfUnchanged(removed, KEY, 'v1', 'v2')).toBe('conflict')
    expect(removed.value()).toBeNull()
    // Chave inexistente e esperada como inexistente: primeiro uso.
    expect(writeIfUnchanged(fakeStorage(), KEY, null, 'v1')).toBe('written')
  })

  it('não grava se a leitura falhar e informa falha de gravação', () => {
    const unreadable = fakeStorage({ [KEY]: 'v1' })
    unreadable.failRead = true
    expect(writeIfUnchanged(unreadable, KEY, 'v1', 'v2')).toBe('read-failed')
    expect(unreadable.writes).toBe(0)
    const full = fakeStorage({ [KEY]: 'v1' })
    full.failWrite = true
    expect(writeIfUnchanged(full, KEY, 'v1', 'v2')).toBe('write-failed')
    expect(full.value()).toBe('v1')
  })
})

describe('createGuardedWriter', () => {
  it('sem Web Locks não grava nada', async () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    const { guarded } = writer(storage, null, 'v1')
    expect(guarded.getStatus()).toBe('unsupported')
    guarded.save(() => 'v2')
    await settle()
    expect(storage.writes).toBe(0)
    expect(guarded.getStatus()).toBe('unsupported')
  })

  it('grava dentro da trava e usa o texto gravado como nova base', async () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    const locks = fakeLocks()
    const { guarded, statuses } = writer(storage, locks, 'v1')
    let serialized = 0
    guarded.save(() => {
      serialized++
      return 'v2'
    })
    // Só serializa dentro da trava, e a alteração não conta como gravada antes disso.
    expect(serialized).toBe(0)
    expect(guarded.getStatus()).toBe('saving')
    await settle()
    expect(storage.value()).toBe('v2')
    guarded.save(() => 'v3')
    await settle()
    expect(storage.value()).toBe('v3')
    expect(storage.writes).toBe(2)
    expect(statuses).toEqual(['saving', 'saved', 'saving', 'saved'])
    expect(locks.names.every((name) => name === STORAGE_LOCK_NAME)).toBe(true)
  })

  it('outra aba gravou antes: não sobrescreve e para de gravar', async () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    const { guarded } = writer(storage, fakeLocks(), 'v1')
    storage.externalWrite('da outra aba')
    guarded.save(() => 'v2')
    await settle()
    expect(storage.value()).toBe('da outra aba')
    expect(guarded.getStatus()).toBe('conflict')
    guarded.save(() => 'v3')
    await settle()
    expect(storage.value()).toBe('da outra aba')
    expect(storage.writes).toBe(0)
  })

  it('falha de leitura bloqueia; falha de gravação tenta de novo na próxima', async () => {
    const unreadable = fakeStorage({ [KEY]: 'v1' })
    const blocked = writer(unreadable, fakeLocks(), 'v1').guarded
    unreadable.failRead = true
    blocked.save(() => 'v2')
    await settle()
    expect(blocked.getStatus()).toBe('read-failed')
    unreadable.failRead = false
    blocked.save(() => 'v3')
    await settle()
    expect(unreadable.writes).toBe(0)

    const full = fakeStorage({ [KEY]: 'v1' })
    const retrying = writer(full, fakeLocks(), 'v1').guarded
    full.failWrite = true
    retrying.save(() => 'v2')
    await settle()
    expect(retrying.getStatus()).toBe('write-failed')
    full.failWrite = false
    retrying.save(() => 'v3')
    await settle()
    expect(full.value()).toBe('v3')
    expect(retrying.getStatus()).toBe('saved')
  })

  it('pedidos feitos enquanto espera a trava viram uma única gravação, a mais recente', async () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    const locks = fakeLocks()
    const { guarded } = writer(storage, locks, 'v1')
    const release = hold(locks)
    guarded.save(() => 'v2')
    guarded.save(() => 'v3')
    await settle()
    expect(storage.writes).toBe(0)
    release()
    await settle()
    expect(storage.writes).toBe(1)
    expect(storage.value()).toBe('v3')
  })

  it('pedido na fila é revalidado dentro da trava (evento e conteúdo)', async () => {
    // Evento de outra aba chega enquanto o pedido espera a trava.
    const byEvent = fakeStorage({ [KEY]: 'v1' })
    const locksA = fakeLocks()
    const a = writer(byEvent, locksA, 'v1').guarded
    const releaseA = hold(locksA)
    a.save(() => 'v2')
    byEvent.externalWrite('da outra aba')
    a.notifyExternalChange('da outra aba')
    releaseA()
    await settle()
    expect(byEvent.value()).toBe('da outra aba')
    expect(a.getStatus()).toBe('conflict')

    // Sem evento: a outra aba grava enquanto segura a trava; ao entrar, o texto mudou.
    const byContent = fakeStorage({ [KEY]: 'v1' })
    const locksB = fakeLocks()
    const b = writer(byContent, locksB, 'v1').guarded
    const releaseB = hold(locksB)
    b.save(() => 'v2')
    byContent.externalWrite('da outra aba')
    releaseB()
    await settle()
    expect(byContent.value()).toBe('da outra aba')
    expect(b.getStatus()).toBe('conflict')
    expect(byContent.writes).toBe(0)
  })

  it('duas abas com a mesma base: só a primeira grava, a outra entra em conflito', async () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    const locks = fakeLocks()
    const tabA = writer(storage, locks, 'v1').guarded
    const tabB = writer(storage, locks, 'v1').guarded
    tabA.save(() => 'da aba A')
    tabB.save(() => 'da aba B')
    await settle()
    expect(storage.writes).toBe(1)
    expect(storage.value()).toBe('da aba A')
    expect(tabA.getStatus()).toBe('saved')
    expect(tabB.getStatus()).toBe('conflict')
  })

  it('evento com o mesmo texto não bloqueia; texto ilegível bloqueia', () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    const same = writer(storage, fakeLocks(), 'v1').guarded
    same.notifyExternalChange('v1')
    expect(same.getStatus()).toBe('saved')
    same.notifyExternalChange(undefined)
    expect(same.getStatus()).toBe('read-failed')
  })

  it('isSaved só confirma depois da gravação; pedidos juntados contam como salvos', async () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    const locks = fakeLocks()
    const { guarded } = writer(storage, locks, 'v1')
    const first = {}
    const second = {}
    const release = hold(locks)
    guarded.save(() => 'v2', first)
    guarded.save(() => 'v3', second)
    await settle()
    expect(guarded.isSaved(first)).toBe(false)
    expect(guarded.isSaved(second)).toBe(false)
    release()
    await settle()
    // A gravação de v3 inclui o estado anterior: os dois estão salvos.
    expect(guarded.isSaved(first)).toBe(true)
    expect(guarded.isSaved(second)).toBe(true)
    expect(guarded.isSaved({})).toBe(false)
  })

  it('isSaved continua falso em conflito e em falha de gravação, até gravar de fato', async () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    const failing = writer(storage, fakeLocks(), 'v1').guarded
    const lost = {}
    storage.failWrite = true
    failing.save(() => 'v2', lost)
    await settle()
    expect(failing.isSaved(lost)).toBe(false)
    storage.failWrite = false
    const next = {}
    failing.save(() => 'v3', next)
    await settle()
    expect(failing.isSaved(lost)).toBe(true)
    expect(failing.isSaved(next)).toBe(true)

    const other = fakeStorage({ [KEY]: 'v1' })
    const stale = writer(other, fakeLocks(), 'v1').guarded
    other.externalWrite('da outra aba')
    const blocked = {}
    stale.save(() => 'v2', blocked)
    await settle()
    expect(stale.isSaved(blocked)).toBe(false)
  })

  it('trava recusada pelo navegador: não grava', async () => {
    const storage = fakeStorage({ [KEY]: 'v1' })
    const failing: LockManagerLike = { request: () => Promise.reject(new Error('sem trava')) }
    const { guarded } = writer(storage, failing, 'v1')
    guarded.save(() => 'v2')
    await settle()
    expect(storage.writes).toBe(0)
    expect(guarded.getStatus()).toBe('read-failed')
  })
})
