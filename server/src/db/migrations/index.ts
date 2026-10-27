import type { Migration } from '../migrations'
import { migration0001 } from './0001_inicial'

/** Todas as migrações, em ordem. Novas entram no fim; as existentes nunca mudam. */
export const MIGRATIONS: readonly Migration[] = [migration0001]
