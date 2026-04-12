/**
 * Voice Protocol Messages — R18
 *
 * WebRTC signaling messages exchanged via WebSocket.
 * The relay acts as signaling server only — media flows P2P.
 *
 * ADD to packages/protocol/src/ and re-export from index.ts:
 *   export * from './voice-messages.js';
 */

// =================================================================
// Client → Relay
// =================================================================

/** Join a voice channel. */
export interface VoiceJoinMsg {
  type: 'VOICE_JOIN';
  payload: { channelId: string };
  timestamp: number;
}

/** Leave the current voice channel. */
export interface VoiceLeaveMsg {
  type: 'VOICE_LEAVE';
  payload: { channelId: string };
  timestamp: number;
}

/** Send WebRTC SDP offer/answer to a specific peer. */
export interface VoiceSignalMsg {
  type: 'VOICE_SIGNAL';
  payload: {
    targetPublicKey: string;
    channelId: string;
    signal: {
      type: 'offer' | 'answer';
      sdp: string;
    };
  };
  timestamp: number;
}

/** Send ICE candidate to a specific peer. */
export interface VoiceIceCandidateMsg {
  type: 'VOICE_ICE_CANDIDATE';
  payload: {
    targetPublicKey: string;
    channelId: string;
    candidate: Record<string, unknown>;
  };
  timestamp: number;
}

/** Toggle mute state. */
export interface VoiceMuteMsg {
  type: 'VOICE_MUTE';
  payload: { channelId: string; muted: boolean };
  timestamp: number;
}

// =================================================================
// Relay → Client
// =================================================================

/** Current state of a voice channel (who's in it). */
export interface VoiceStateMsg {
  type: 'VOICE_STATE';
  payload: {
    channelId: string;
    participants: Array<{
      publicKey: string;
      username: string;
      muted: boolean;
    }>;
  };
  timestamp: number;
}

/** A new user joined the voice channel. */
export interface VoiceUserJoinedMsg {
  type: 'VOICE_USER_JOINED';
  payload: {
    channelId: string;
    publicKey: string;
    username: string;
  };
  timestamp: number;
}

/** A user left the voice channel. */
export interface VoiceUserLeftMsg {
  type: 'VOICE_USER_LEFT';
  payload: {
    channelId: string;
    publicKey: string;
  };
  timestamp: number;
}

/** Forwarded SDP signal from another peer. */
export interface VoiceSignalForwardMsg {
  type: 'VOICE_SIGNAL_FORWARD';
  payload: {
    fromPublicKey: string;
    channelId: string;
    signal: {
      type: 'offer' | 'answer';
      sdp: string;
    };
  };
  timestamp: number;
}

/** Forwarded ICE candidate from another peer. */
export interface VoiceIceCandidateForwardMsg {
  type: 'VOICE_ICE_CANDIDATE_FORWARD';
  payload: {
    fromPublicKey: string;
    channelId: string;
    candidate: Record<string, unknown>;
  };
  timestamp: number;
}

/** A user's mute state changed. */
export interface VoiceMuteUpdateMsg {
  type: 'VOICE_MUTE_UPDATE';
  payload: {
    channelId: string;
    publicKey: string;
    muted: boolean;
  };
  timestamp: number;
}
