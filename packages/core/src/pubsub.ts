/**
 * @muster/core — GossipSub publish / subscribe helpers (libp2p v3.x)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MusterNode } from './node.js';
import type { MusterMessage } from '@muster/protocol';
import type { KeyPair } from '@muster/crypto';
import { createEnvelope, openEnvelope } from '@muster/crypto';
import { serialise, deserialise } from '@muster/protocol';

export type MessageHandler = (
  message: MusterMessage,
  senderPublicKeyHex: string,
) => void;

function getPubsub(node: MusterNode): any {
  return (node.services as any)['pubsub'];
}

export function subscribe(
  node: MusterNode,
  topic: string,
  handler: MessageHandler,
): () => void {
  const pubsub = getPubsub(node);
  pubsub.subscribe(topic);

  const listener = async (event: any): Promise<void> => {
    const rawData: Uint8Array = event?.detail?.data ?? event?.data;
    if (!(rawData instanceof Uint8Array)) return;

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(new TextDecoder().decode(rawData)) as Record<string, unknown>;
    } catch {
      return;
    }

    let payloadBytes: Uint8Array;
  try {
      payloadBytes = await openEnvelope(envelope as any);
    } catch {
      return;
    }

    let message: MusterMessage;
    try {
      message = deserialise(payloadBytes);
    } catch {
      return;
    }

    handler(message, String(envelope['signerPublicKeyHex'] ?? ''));
  };

  pubsub.addEventListener(topic, listener);

  return () => {
    pubsub.unsubscribe(topic);
    pubsub.removeEventListener(topic, listener);
  };
}

export async function publish(
  node: MusterNode,
  topic: string,
  message: MusterMessage,
  keypair: KeyPair,
): Promise<void> {
  const payloadBytes = serialise(message);
  const envelope = await createEnvelope(payloadBytes, keypair.privateKey, keypair.publicKey);
  const envelopeBytes = new TextEncoder().encode(JSON.stringify(envelope));
  await getPubsub(node).publish(topic, envelopeBytes);
}

export function getTopicPeers(node: MusterNode, topic: string): string[] {
  return (getPubsub(node).getSubscribers(topic) as any[]).map(String);
}