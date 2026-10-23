/**
 * Architecture gate (`pnpm test:arch`). Rule numbers match AGENTS.md.
 * Cycles between modules and layers are checked with
 * `.dependency-cruiser.cycles.cjs` on collapsed folders.
 */
const THIRD_PARTY = [
  'npm',
  'npm-dev',
  'npm-optional',
  'npm-peer',
  'npm-bundled',
  'npm-no-pkg',
  'npm-unknown',
  'unknown',
];

const MODULE = '^src/modules/([^/]+)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: '1-domain-no-third-party',
      severity: 'error',
      comment: 'domain/ imports no third-party package.',
      from: { path: `${MODULE}domain/` },
      to: { dependencyTypes: THIRD_PARTY },
    },
    {
      name: '1-domain-only-shared-and-own-domain',
      severity: 'error',
      comment: 'domain/ imports only shared/ and its own module domain.',
      from: { path: `${MODULE}domain/` },
      to: {
        path: '^src/',
        pathNot: ['^src/shared/', '^src/modules/$1/domain/'],
      },
    },
    {
      name: '2-application-no-framework',
      severity: 'error',
      comment: 'application/ imports no framework or third-party package.',
      from: { path: `${MODULE}application/` },
      to: { dependencyTypes: THIRD_PARTY },
    },
    {
      name: '3-application-points-inward',
      severity: 'error',
      comment:
        'application/ reaches only shared/ and its own domain/application. ' +
        'Other modules are reached through a domain port.',
      from: { path: `${MODULE}application/` },
      to: {
        path: '^src/',
        pathNot: ['^src/shared/', '^src/modules/$1/(domain|application)/'],
      },
    },
    {
      name: '3-inner-layers-never-reach-outer',
      severity: 'error',
      comment:
        'domain/application never import infrastructure, presentation or platform.',
      from: { path: `${MODULE}(domain|application)/` },
      to: {
        path: [
          '^src/modules/[^/]+/(infrastructure|presentation)/',
          '^src/platform/',
        ],
      },
    },
    {
      name: '4-presentation-no-infrastructure',
      severity: 'error',
      comment: 'Controllers depend on use cases, never on infrastructure/.',
      from: { path: `${MODULE}presentation/` },
      to: { path: '^src/modules/$1/infrastructure/' },
    },
    {
      name: '4-infrastructure-no-presentation',
      severity: 'error',
      from: { path: `${MODULE}infrastructure/` },
      to: { path: '^src/modules/$1/presentation/' },
    },
    {
      name: '5-cross-module-only-via-public-api',
      severity: 'error',
      comment:
        'Other modules are imported through <module>.public-api.ts only.',
      from: { path: '^src/', pathNot: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/',
        pathNot: '[.]public-api[.]ts$',
      },
    },
    {
      name: '5-cross-module-only-via-public-api-between-modules',
      severity: 'error',
      from: { path: MODULE },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: ['^src/modules/$1/', '[.]public-api[.]ts$'],
      },
    },
    {
      name: '6-typeorm-only-in-infrastructure-and-database',
      severity: 'error',
      comment:
        'typeorm appears only in */infrastructure/ and platform/database/.',
      from: {
        path: '^src/',
        pathNot: [
          '^src/modules/[^/]+/infrastructure/',
          '^src/platform/database/',
        ],
      },
      to: { path: 'node_modules/(@nestjs/)?typeorm(/|$)' },
    },
    {
      name: '9-openai-only-in-chat-simulation-infrastructure',
      severity: 'error',
      comment:
        'The openai SDK is imported only under src/modules/chat-simulation/infrastructure/.',
      from: {
        path: '^src/',
        pathNot: '^src/modules/chat-simulation/infrastructure/',
      },
      to: { path: 'node_modules/openai(/|$)' },
    },
    {
      name: '7-no-circular',
      severity: 'error',
      comment: 'No cycles between files.',
      from: {},
      to: { circular: true },
    },
    {
      name: '8-shared-is-pure',
      severity: 'error',
      comment:
        'shared/ has no third-party imports and depends on nothing else in src/.',
      from: { path: '^src/shared/' },
      to: { dependencyTypes: THIRD_PARTY },
    },
    {
      name: '8-shared-imports-only-shared',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/', pathNot: '^src/shared/' },
    },
    {
      name: 'platform-never-imports-modules',
      severity: 'error',
      comment:
        'platform/ is glue below modules; modules/ depend on it, not the reverse.',
      from: { path: '^src/platform/' },
      to: { path: '^src/modules/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '[.]spec[.]ts$' },
  },
};
