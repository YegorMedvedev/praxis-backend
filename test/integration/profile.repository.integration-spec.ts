import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { ConsentVersions } from '../../src/modules/users/domain/consent';
import { Profile } from '../../src/modules/users/domain/profile';
import { ProfileName } from '../../src/modules/users/domain/profile-name';
import { ProfileOrmEntity } from '../../src/modules/users/infrastructure/persistence/profile.orm-entity';
import { TypeOrmProfileRepository } from '../../src/modules/users/infrastructure/persistence/typeorm-profile.repository';
import { CreateUsersProfiles1760000000000 } from '../../src/platform/database/migrations/1760000000000-CreateUsersProfiles';

const policy = {
  isKnownTermsVersion: () => true,
  isKnownPrivacyVersion: () => true,
};

function newProfile(
  id: string,
  name = 'Elena',
  at = '2026-01-01T10:00:00.123Z',
) {
  return Profile.create({
    id,
    name: ProfileName.parse(name),
    consent: ConsentVersions.parse(
      { terms_version: 'T1', privacy_version: 'P1' },
      policy,
    ),
    now: new Date(at),
  });
}

describe('Profile repository and users migration (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let repository: TypeOrmProfileRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    dataSource = await new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [ProfileOrmEntity],
      migrations: [CreateUsersProfiles1760000000000],
      synchronize: false,
    }).initialize();
    await dataSource.runMigrations();
    repository = new TypeOrmProfileRepository(
      dataSource.getRepository(ProfileOrmEntity),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await container?.stop();
  });

  it('creates users.profiles without any foreign key', async () => {
    const columns = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'users' AND table_name = 'profiles'
       ORDER BY column_name`,
    );
    expect(columns.map((c: { column_name: string }) => c.column_name)).toEqual([
      'consent_accepted_at',
      'created_at',
      'id',
      'name',
      'privacy_version',
      'terms_version',
      'updated_at',
    ]);
    const foreignKeys = await dataSource.query(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE table_schema = 'users' AND constraint_type = 'FOREIGN KEY'`,
    );
    expect(foreignKeys).toEqual([]);
  });

  it('returns null for an unknown id', async () => {
    await expect(repository.findById('missing')).resolves.toBeNull();
  });

  it('round-trips a profile', async () => {
    const profile = newProfile('uid-a');
    await repository.save(profile);

    const loaded = await repository.findById('uid-a');

    expect(loaded?.name.value).toBe('Elena');
    expect(loaded?.consent.versions.termsVersion).toBe('T1');
    expect(loaded?.consent.acceptedAt).toEqual(profile.consent.acceptedAt);
    expect(loaded?.createdAt).toEqual(profile.createdAt);
    expect(loaded?.updatedAt).toEqual(profile.updatedAt);
  });

  it('saving again replaces the row instead of failing', async () => {
    await repository.save(newProfile('uid-b'));
    const original = (await repository.findById('uid-b')) as Profile;

    await repository.save(
      original.replace({
        name: ProfileName.parse('Elena B'),
        now: new Date('2026-02-01T00:00:00Z'),
      }),
    );

    const loaded = (await repository.findById('uid-b')) as Profile;
    expect(loaded.name.value).toBe('Elena B');
    expect(loaded.createdAt).toEqual(original.createdAt);
    expect(loaded.updatedAt).toEqual(new Date('2026-02-01T00:00:00Z'));
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM users.profiles WHERE id = 'uid-b'`,
    );
    expect(count).toBe(1);
  });

  it('insertIfAbsent inserts once and never overwrites', async () => {
    const first = newProfile('uid-c', 'Elena', '2026-01-01T10:00:00Z');
    const second = newProfile('uid-c', 'Other Name', '2026-03-01T10:00:00Z');

    await expect(repository.insertIfAbsent(first)).resolves.toBe(true);
    await expect(repository.insertIfAbsent(second)).resolves.toBe(false);

    const loaded = (await repository.findById('uid-c')) as Profile;
    expect(loaded.name.value).toBe('Elena');
    expect(loaded.createdAt).toEqual(first.createdAt);
  });

  it('lets exactly one of two concurrent first inserts win', async () => {
    const results = await Promise.all([
      repository.insertIfAbsent(
        newProfile('uid-d', 'Elena', '2026-01-01T10:00:00Z'),
      ),
      repository.insertIfAbsent(
        newProfile('uid-d', 'Elena', '2026-01-01T10:00:05Z'),
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM users.profiles WHERE id = 'uid-d'`,
    );
    expect(count).toBe(1);
  });

  it('enforces the name length in the database as well', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO users.profiles VALUES ('x','A','t','p',now(),now(),now())`,
      ),
    ).rejects.toThrow();
  });

  it('can be reverted', async () => {
    await dataSource.undoLastMigration();
    const tables = await dataSource.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'users'`,
    );
    expect(tables).toEqual([]);
    await dataSource.runMigrations();
  });
});
