/**
 * replay-oplog — R25 / Phase 3 debug / recovery tool.
 *
 * Usage:
 *   pnpm --filter @muster/relay replay-oplog <communityIdHex>
 *
 * Reads every admin op stored for the community, re-runs the
 * causal-topological materialiser, and prints the resulting admin
 * state snapshot. Idempotent — does not modify persisted state.
 *
 * Exit codes:
 *   0 — success, state printed
 *   1 — bad arguments / community not found / db missing
 */

import { RelayDB } from './database';
import { OpLogDB } from './opLogDB';
import { ManifestDB } from './manifestDB';
import { materialize, type MaterializedState } from './opMaterializer';

function hexToBuf(hex: string): Buffer | null {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) return null;
  return Buffer.from(clean, 'hex');
}

function bufToHex(b: Buffer | Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

function printState(state: MaterializedState): void {
  console.log(`\n── materialised state ─────────────────────────────────`);
  console.log(`  ops applied: ${state.applied}`);
  console.log(`  orphaned:    ${state.orphaned}`);
  console.log(`  manifest:    ${state.manifest ? `v${state.manifest.version}` : '(none)'}`);
  if (state.manifest) {
    console.log(`    owner:        ${bufToHex(state.manifest.owner)}`);
    console.log(`    admin count:  ${state.manifest.admins.length}`);
    console.log(`    channel cnt:  ${state.manifest.channels.length}`);
  }
  console.log(`\n  admins (${state.admins.size}):`);
  for (const [pk, a] of state.admins) {
    console.log(`    ${pk.slice(0, 16)}…  perms=[${a.permissions.join(', ')}]`);
  }
  console.log(`\n  channels (${state.channels.size}):`);
  for (const [cid, ch] of state.channels) {
    console.log(`    ${cid.slice(0, 16)}…  ${ch.name}  (${ch.type}, ${ch.visibility})`);
  }
  console.log(`\n  members: ${state.members.size}   banned: ${state.bans.size}`);
  console.log(`  roles:   ${state.roles.size}   member-role assignments: ${state.memberRoles.size}`);
  console.log();
}

function main(): number {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: replay-oplog <communityIdHex>');
    return 1;
  }
  const communityId = hexToBuf(arg);
  if (!communityId) {
    console.error('bad communityId — expected 32-byte hex');
    return 1;
  }

  const relayDB = new RelayDB();
  const opLogDB = new OpLogDB(relayDB.getDatabase());
  const manifestDB = new ManifestDB(relayDB.getDatabase());

  const total = opLogDB.countForCommunity(communityId);
  console.log(`replay-oplog: community=${bufToHex(communityId).slice(0, 16)}…  ops=${total}`);

  const latestManifest = manifestDB.getLatest(communityId);
  if (latestManifest) {
    console.log(`               manifest latest version = ${latestManifest.version}`);
  } else {
    console.log(`               manifest latest version = (none)`);
  }

  if (total === 0) {
    console.log('\n(no ops — state is empty; nothing to replay)');
    return 0;
  }

  const ops = opLogDB.getAll(communityId);
  const state = materialize(ops);
  printState(state);
  return 0;
}

process.exit(main());
