import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  DataSource,
  EntityManager,
  ObjectLiteral,
  Repository,
} from 'typeorm';

/**
 * The transaction a unit of work is running in, carried through async calls.
 *
 * Modules cannot hand each other a database transaction through their public
 * APIs without leaking the ORM. Instead, a unit of work opens a transaction
 * with `runInTransaction`, and every TypeORM repository that wraps its
 * repository in `activeRepository` joins it automatically; outside a
 * transaction the repository behaves exactly as before.
 */
const storage = new AsyncLocalStorage<EntityManager>();

/** Runs `work` in one transaction; a nested call joins the outer one. */
export function runInTransaction<T>(
  dataSource: DataSource,
  work: () => Promise<T>,
): Promise<T> {
  if (storage.getStore()) return work();
  return dataSource.transaction((manager) => storage.run(manager, work));
}

/** The repository bound to the active transaction, or `repository` itself. */
export function activeRepository<T extends ObjectLiteral>(
  repository: Repository<T>,
): Repository<T> {
  const manager = storage.getStore();
  return manager ? manager.getRepository(repository.target) : repository;
}

/** The active transaction's manager, or `fallback` outside a transaction. */
export function activeManager(fallback: EntityManager): EntityManager {
  return storage.getStore() ?? fallback;
}
