/**
 * Resolves the signaling server URL for the current environment.
 *
 * In production (HTTPS), automatically upgrades:
 *   http:// -> https://
 *   ws://   -> wss://
 *
 * This prevents mixed-content errors that would block the WebSocket connection.
 */
export function getSignalingUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SIGNALING_URL ||
    'http://localhost:4000';

  // In production on HTTPS, upgrade protocol to prevent mixed-content blocks
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    if (raw.startsWith('http://')) {
      return raw.replace('http://', 'https://');
    }
    if (raw.startsWith('ws://')) {
      return raw.replace('ws://', 'wss://');
    }
  }

  return raw;
}
