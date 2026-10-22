import { Consent, ConsentVersions } from '../../domain/consent';
import { Profile } from '../../domain/profile';
import { ProfileName } from '../../domain/profile-name';
import { ProfileOrmEntity } from './profile.orm-entity';

export const ProfileMapper = {
  toDomain(row: ProfileOrmEntity): Profile {
    return Profile.restore({
      id: row.id,
      name: ProfileName.restore(row.name),
      consent: new Consent(
        ConsentVersions.restore(row.termsVersion, row.privacyVersion),
        row.consentAcceptedAt,
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },

  toRow(profile: Profile): ProfileOrmEntity {
    const row = new ProfileOrmEntity();
    row.id = profile.id;
    row.name = profile.name.value;
    row.termsVersion = profile.consent.versions.termsVersion;
    row.privacyVersion = profile.consent.versions.privacyVersion;
    row.consentAcceptedAt = profile.consent.acceptedAt;
    row.createdAt = profile.createdAt;
    row.updatedAt = profile.updatedAt;
    return row;
  },
};
