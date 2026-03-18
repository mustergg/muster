/**
 * @muster/core — GossipSub publish / subscribe helpers
 *
 * Wraps the libp2p pubsub service with typed Muster message handling.
 * All messages are signed before publishing and verified on receipt.
 */

import type { MusterNode } from './node.js';
import type { MusterMessage } from '@muster/protocol';
import type { KeyPair } from '@muster/crypto';
import { createEnvelope, openEnvelope } from '@muster/crypto';
import { serialise, deserialise } from '@muster/protocol';

/** Callback invoked when a verified message arrives on a subscribed topic */
export type MessageHandler = (
  message: MusterMessage,
  senderPublicKeyHex: string,
) => void;

/**
 * Subscribe to a GossipSub topic and receive verified Muster messages.
 *
 * Messages with invalid signatures are silently dropped.
 *
 * @param node     - The running libp2p node
 * @param topic    - Full topic string (use helpers from config.ts)
 * @param handler  - Called for each valid incoming message
 * @returns Unsubscribe function — call it to stop listening
 *
 * @example
 * const unsub = subscribe(node, communityChannelTopic(cId, chId), (msg, sender) => {
 *   console.log(sender, ':', (msg as TextMessage).content);
 * });
 * // Later:
 * unsub();
 */
export function subscribe(
  node: MusterNode,
  topic: string,
  handler: MessageHandler,
): () => void {
  // Subscribe to the topic so GossipSub routes messages to us
  node.services['pubsub'].subscribe(topic);

  const listener = async (event: CustomEvent): Promise<void> => {
    const rawData: Uint8Array = event.detail?.data;
    if (!(rawData instanceof Uint8Array)) return;

    let envelope: Record<string, unknown>;
    try {
      const json = new TextDecoder().decode(rawData);
      envelope = JSON.parse(json) as Record<string, unknown>;
    } catch {
      return; // Malformed JSON — discard
    }

    // Verify signature and extract payload
    let payloadBytes: Uint8Array;
    try {
      payloadBytes = await openEnvelope(envelope as Parameters<typeof openEnvelope>[0]);
    } catch {
      // Invalid signature — discard silently
      return;
    }

    let message: MusterMessage;
    try {
      message = deserialise(payloadBytes);
    } catch {
      return; // Malformed message — discard
    }

    const senderPublicKeyHex = (envelope as { signerPublicKeyHex: string })
      .signerPublicKeyHex;

    handler(message, senderPublicKeyHex);
  };

  node.services['pubsub'].addEventListener(topic, listener as EventListener);

  // Return an unsubscribe function
  return () => {
    node.services['pubsub'].unsubscribe(topic);
    node.services['pubsub'].removeEventListener(topic, listener as EventListener);
  };
}

/**
 * Publish a Muster message to a GossipSub topic.
 *
 * The message is serialised, signed, and wrapped in an envelope before sending.
 *
 * @param node    - The running libp2p node
 * @param topic   - Full topic string
 * @param message - The message to send
 * @param keypair - The sender's keypair (used for signing)
 */
export async function publish(
  node: MusterNode,
  topic: string,
  message: MusterMessage,
  keypair: KeyPair,
): Promise<void> {
  const payloadBytes = serialise(message);
  const envelope = await createEnvelope(
    payloadBytes,
    keypair.privateKey,
    keypair.publicKey,
  );
  const envelopeBytes = new TextEncoder().encode(JSON.stringify(envelope));
  await node.services['pubsub'].publish(topic, envelopeBytes);
}

/**
 * Get the current list of peer IDs subscribed to a topic.
 * Useful for knowing who is in a channel right now.
 */
export function getTopicPeers(node: MusterNode, topic: string): string[] {
  return node.services['pubsub']
    .getSubscribers(topic)
    .map((peerId) => peerId.toString());
}
