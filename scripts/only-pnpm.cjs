// Blocks npm and yarn installs; pnpm is the only supported package manager.
const agent = process.env.npm_config_user_agent ?? '';

if (!agent.startsWith('pnpm/')) {
  console.error('This repository uses pnpm only. Run `pnpm install`.');
  process.exit(1);
}
