#!/usr/bin/env node
/**
 * muster-node CLI — Phase 1
 *
 * Usage:
 *   muster-node start     Start the node daemon
 *   muster-node status    Show if daemon is running (Phase 2: IPC socket)
 *   muster-node --help    Show help
 */

const [,, command = '--help'] = process.argv;

const HELP = `
muster-node — Muster dedicated node management CLI

Commands:
  start     Start the node daemon (runs in foreground)
  status    Show node status  [Phase 2 — not yet implemented]
  peers     List connected peers  [Phase 2]
  stop      Stop a running daemon  [Phase 2]
  --help    Show this help message
  --version Show version

Examples:
  muster-node start
  MUSTER_WS_PORT=4002 muster-node start
`;

switch (command) {
  case 'start': {
    // Delegate to the main daemon
    import('../index.js').catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
    break;
  }
  case '--version':
  case '-v': {
    console.log('muster-node v0.1.0');
    break;
  }
  case 'status':
  case 'peers':
  case 'stop': {
    console.log(`[muster-node] "${command}" is not yet implemented (Phase 2).`);
    console.log('  In Phase 2 the CLI will communicate with a running daemon via a local Unix socket.');
    process.exit(0);
    break;
  }
  default: {
    console.log(HELP);
    process.exit(command === '--help' ? 0 : 1);
  }
}
