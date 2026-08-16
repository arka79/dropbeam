import type { FileMetadata } from '../webrtc/signaling';

export type ProtocolMessage =
  | { type: 'HELLO'; version: number; peerId: string }
  | { type: 'FILE_LIST'; files: FileMetadata[]; chunkSize: number }
  | { type: 'FILE_REQUEST'; fileId: string; resumeFrom?: number[] }
  | { type: 'CHUNK_OFFER'; fileId: string; chunkIndex: number; size: number }
  | { type: 'CHUNK_ACK'; fileId: string; chunkIndex: number }
  | { type: 'CHUNK_FAIL'; fileId: string; chunkIndex: number; reason: string }
  | { type: 'PAUSE'; fileId: string }
  | { type: 'RESUME'; fileId: string }
  | { type: 'TRANSFER_COMPLETE'; fileId: string }
  | { type: 'HASH'; fileId: string; sha256: string }
  | { type: 'HASH_RESULT'; fileId: string; ok: boolean; computed: string }
  | { type: 'PEER_HELLO'; peerId: string; role: 'host' | 'peer' }
  | { type: 'ERROR'; code: string; message: string }
  | { type: 'PING'; ts: number }
  | { type: 'PONG'; ts: number }
  | { type: 'GOODBYE'; reason: string };

export const PROTOCOL_VERSION = 1;

export function encode(msg: ProtocolMessage): string {
  return JSON.stringify(msg);
}

export function parse(data: string): ProtocolMessage | null {
  try {
    return JSON.parse(data) as ProtocolMessage;
  } catch {
    return null;
  }
}
