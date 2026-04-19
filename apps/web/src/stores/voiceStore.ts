/**
 * Voice Store — R18
 *
 * Manages WebRTC voice connections.
 * Uses mesh topology: each participant connects directly to every other.
 * The relay handles signaling only (SDP + ICE exchange).
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';
import { useNatStore } from './natStore';



export interface VoiceParticipant {
  publicKey: string;
  username: string;
  muted: boolean;
  speaking: boolean;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  publicKey: string;
}

interface VoiceState {
  /** Current voice channel ID (null if not in a call). */
  currentChannel: string | null;
  /** Participants in the current channel. */
  participants: VoiceParticipant[];
  /** Whether local mic is muted. */
  muted: boolean;
  /** Whether voice is connecting. */
  connecting: boolean;
  /** Error message. */
  error: string;

  join: (channelId: string) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  init: () => () => void;
}

/** Active peer connections keyed by remote publicKey. */
const peerConnections = new Map<string, RTCPeerConnection>();

/** Local media stream. */
let localStream: MediaStream | null = null;

/** Audio context for speaking detection. */
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Create audio element for remote stream. */
function playRemoteStream(stream: MediaStream, publicKey: string): void {
  // Remove existing audio element for this peer
  const existing = document.getElementById(`voice-audio-${publicKey}`);
  if (existing) existing.remove();

  const audio = document.createElement('audio');
  audio.id = `voice-audio-${publicKey}`;
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.style.display = 'none';
  document.body.appendChild(audio);
  audio.play().catch(() => { /* autoplay might be blocked */ });
}

/** Remove audio element for a peer. */
function removeRemoteAudio(publicKey: string): void {
  const el = document.getElementById(`voice-audio-${publicKey}`);
  if (el) el.remove();
}

/** Close all peer connections and stop local stream. */
function closeAll(): void {
  for (const [key, pc] of peerConnections) {
    pc.close();
    removeRemoteAudio(key);
  }
  peerConnections.clear();

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
    analyser = null;
  }
}

/** Create a peer connection for a specific remote user. */
function createPeerConnection(
  remotePublicKey: string,
  channelId: string,
  isInitiator: boolean,
): RTCPeerConnection {
  const { transport, publicKey: myKey } = useNetworkStore.getState();

const iceServers = useNatStore.getState().getIceServers();
const pc = new RTCPeerConnection({ iceServers });

  // Add local tracks
  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  // Handle remote tracks
  pc.ontrack = (event) => {
    if (event.streams[0]) {
      playRemoteStream(event.streams[0], remotePublicKey);
    }
  };

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate && transport?.isConnected) {
      transport.send({
        type: 'VOICE_ICE_CANDIDATE',
        payload: { targetPublicKey: remotePublicKey, channelId, candidate: event.candidate.toJSON() },
        timestamp: Date.now(),
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      console.warn(`[voice] Connection to ${remotePublicKey.slice(0, 8)} ${pc.connectionState}`);
    }
  };

  peerConnections.set(remotePublicKey, pc);

  // If we're the initiator, create and send an offer
  if (isInitiator) {
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        if (pc.localDescription && transport?.isConnected) {
          transport.send({
            type: 'VOICE_SIGNAL',
            payload: {
              targetPublicKey: remotePublicKey,
              channelId,
              signal: { type: pc.localDescription.type as 'offer' | 'answer', sdp: pc.localDescription.sdp },
            },
            timestamp: Date.now(),
          });
        }
      })
      .catch((err) => console.error('[voice] Create offer failed:', err));
  }

  return pc;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  currentChannel: null,
  participants: [],
  muted: false,
  connecting: false,
  error: '',

  join: async (channelId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;

    // Leave current channel if in one
    const current = get().currentChannel;
    if (current) get().leave();

    set({ connecting: true, error: '' });

    try {
      // Get microphone access
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      // Set up speaking detection
      try {
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(localStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
      } catch { /* speaking detection optional */ }

      // Tell relay we're joining
      transport.send({
        type: 'VOICE_JOIN',
        payload: { channelId },
        timestamp: Date.now(),
      });

      set({ currentChannel: channelId, connecting: false, muted: false });
      console.log(`[voice] Joined channel ${channelId.slice(0, 12)}`);
    } catch (err: any) {
      set({ connecting: false, error: err.message || 'Failed to access microphone' });
      console.error('[voice] Mic access failed:', err);
    }
  },

  leave: () => {
    const { transport } = useNetworkStore.getState();
    const channelId = get().currentChannel;
    if (!channelId) return;

    // Tell relay we're leaving
    if (transport?.isConnected) {
      transport.send({
        type: 'VOICE_LEAVE',
        payload: { channelId },
        timestamp: Date.now(),
      });
    }

    closeAll();
    set({ currentChannel: null, participants: [], muted: false, error: '' });
    console.log(`[voice] Left channel`);
  },

  toggleMute: () => {
    const { transport } = useNetworkStore.getState();
    const channelId = get().currentChannel;
    const newMuted = !get().muted;

    // Mute/unmute local tracks
    if (localStream) {
      for (const track of localStream.getAudioTracks()) {
        track.enabled = !newMuted;
      }
    }

    // Notify relay
    if (channelId && transport?.isConnected) {
      transport.send({
        type: 'VOICE_MUTE',
        payload: { channelId, muted: newMuted },
        timestamp: Date.now(),
      });
    }

    set({ muted: newMuted });
  },

  init: () => {
    const myKey = useNetworkStore.getState().publicKey;

    const unsubscribe = useNetworkStore.getState().onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'VOICE_STATE': {
          const p = msg.payload as any;
          if (p.channelId === get().currentChannel) {
            set({
              participants: (p.participants || []).map((pp: any) => ({
                ...pp, speaking: false,
              })),
            });
          }
          break;
        }

        case 'VOICE_USER_JOINED': {
          const p = msg.payload as any;
          if (p.channelId !== get().currentChannel) break;
          if (p.publicKey === myKey) break;

          // New user joined — we (existing member) send them an offer
          console.log(`[voice] ${p.username} joined, creating offer`);
          createPeerConnection(p.publicKey, p.channelId, true);
          break;
        }

        case 'VOICE_USER_LEFT': {
          const p = msg.payload as any;
          if (p.channelId !== get().currentChannel) break;

          // Close peer connection
          const pc = peerConnections.get(p.publicKey);
          if (pc) { pc.close(); peerConnections.delete(p.publicKey); }
          removeRemoteAudio(p.publicKey);

          set((s) => ({
            participants: s.participants.filter((pp) => pp.publicKey !== p.publicKey),
          }));
          break;
        }

        case 'VOICE_SIGNAL_FORWARD': {
          const p = msg.payload as any;
          if (p.channelId !== get().currentChannel) break;

          const signal = p.signal;
          let pc = peerConnections.get(p.fromPublicKey);

          if (signal.type === 'offer') {
            // We received an offer — create connection and send answer
            if (pc) { pc.close(); peerConnections.delete(p.fromPublicKey); }
            pc = createPeerConnection(p.fromPublicKey, p.channelId, false);

            pc.setRemoteDescription(new RTCSessionDescription(signal))
              .then(() => pc!.createAnswer())
              .then((answer) => pc!.setLocalDescription(answer))
              .then(() => {
                const { transport } = useNetworkStore.getState();
                if (pc!.localDescription && transport?.isConnected) {
                  transport.send({
                    type: 'VOICE_SIGNAL',
                    payload: {
                      targetPublicKey: p.fromPublicKey,
                      channelId: p.channelId,
                      signal: { type: pc!.localDescription.type as 'offer' | 'answer', sdp: pc!.localDescription.sdp },
                    },
                    timestamp: Date.now(),
                  });
                }
              })
              .catch((err) => console.error('[voice] Answer failed:', err));
          } else if (signal.type === 'answer' && pc) {
            pc.setRemoteDescription(new RTCSessionDescription(signal))
              .catch((err) => console.error('[voice] Set remote desc failed:', err));
          }
          break;
        }

        case 'VOICE_ICE_CANDIDATE_FORWARD': {
          const p = msg.payload as any;
          if (p.channelId !== get().currentChannel) break;

          const pc = peerConnections.get(p.fromPublicKey);
          if (pc && p.candidate) {
            pc.addIceCandidate(new RTCIceCandidate(p.candidate))
              .catch((err) => console.error('[voice] Add ICE candidate failed:', err));
          }
          break;
        }

        case 'VOICE_MUTE_UPDATE': {
          const p = msg.payload as any;
          if (p.channelId !== get().currentChannel) break;

          set((s) => ({
            participants: s.participants.map((pp) =>
              pp.publicKey === p.publicKey ? { ...pp, muted: p.muted } : pp
            ),
          }));
          break;
        }
      }
    });

    return unsubscribe;
  },
}));

(window as any).__voice = useVoiceStore;
