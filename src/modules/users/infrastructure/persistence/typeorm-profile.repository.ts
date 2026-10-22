import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Profile } from '../../domain/profile';
import type { ProfileRepository } from '../../domain/profile.repository';
import { ProfileMapper } from './profile.mapper';
import { ProfileOrmEntity } from './profile.orm-entity';

@Injectable()
export class TypeOrmProfileRepository implements ProfileRepository {
  constructor(
    @InjectRepository(ProfileOrmEntity)
    private readonly rows: Repository<ProfileOrmEntity>,
  ) {}

  async findById(id: string): Promise<Profile | null> {
    const row = await this.rows.findOneBy({ id });
    return row ? ProfileMapper.toDomain(row) : null;
  }

  async insertIfAbsent(profile: Profile): Promise<boolean> {
    const result = await this.rows
      .createQueryBuilder()
      .insert()
      .values(ProfileMapper.toRow(profile))
      .orIgnore()
      .returning('id')
      .execute();
    // ON CONFLICT DO NOTHING returns no row when the id was already taken.
    return Array.isArray(result.raw) && result.raw.length > 0;
  }

  async save(profile: Profile): Promise<void> {
    await this.rows.upsert(ProfileMapper.toRow(profile), ['id']);
  }
}
