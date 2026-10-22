/** Which Terms / Privacy Policy versions are currently recognised. */
export interface ConsentVersionPolicy {
  isKnownTermsVersion(version: string): boolean;
  isKnownPrivacyVersion(version: string): boolean;
}
