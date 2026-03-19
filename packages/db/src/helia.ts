// @ts-nocheck
/**
 * @muster/db — Helia (lightweight IPFS) node factory
 *
 * Creates a Helia node that provides the block storage layer for OrbitDB.
 * Uses different storage backends depending on the environment:
 *   - Browser: in-memory (MemoryBlockstore)
 *   - Node.js: filesystem (FsBlockstore) for persistence across restarts
 */

import { createHelia } from 'helia';
import { MemoryBlockstore } from 'blockstore-core';
import { MemoryDatastore } from 'datastore-core';

/**
 * Configuration for the Helia node.
 */
export interface HeliaConfig {
  /**
   * Path for filesystem storage (Node.js only).
   * If not provided, in-memory storage is used.
   */
  storagePath?: string;
}

/**
 * Create a Helia node for use with OrbitDB.
 *
 * In the browser: uses MemoryBlockstore (data is lost on page refresh —
 * OrbitDB will re-sync from the network on reconnect).
 *
 * In Node.js with storagePath: uses FsBlockstore for persistent storage
 * (main nodes retain all data across restarts).
 *
 * @param config - Optional configuration
 * @returns A started Helia node
 */
export async function createHeliaNode(config: HeliaConfig = {}): Promise<any> {
  const isBrowser = typeof window !== 'undefined';

  if (!isBrowser && config.storagePath) {
    // Node.js with persistent filesystem storage
    const { FsBlockstore } = await import('blockstore-fs');
    const { FsDatastore } = await import('datastore-fs');
    const { join } = await import('path');

    const blockstore = new FsBlockstore(join(config.storagePath, 'blocks'));
    const datastore  = new FsDatastore(join(config.storagePath, 'data'));

    return createHelia({ blockstore, datastore });
  }

  // Browser or Node.js without storage path — use memory
  return createHelia({
    blockstore: new MemoryBlockstore(),
    datastore:  new MemoryDatastore(),
  });
}
