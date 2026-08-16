import { SignalingClient } from './signaling';

let activeClient: SignalingClient | null = null;
let activeUrl: string | null = null;
let activePeerId: string | null = null;

export function getSignaling(url: string): SignalingClient {
  if (!activeClient || activeUrl !== url) {
    activeClient?.disconnect();
    activeClient = new SignalingClient(url);
    activeUrl = url;
    activePeerId = null;
  }
  return activeClient;
}

export function setActivePeerId(peerId: string | null) {
  activePeerId = peerId;
}

export function getActivePeerId(): string | null {
  return activePeerId;
}

export function resetSignaling() {
  if (activeClient) {
    activeClient.disconnect();
  }
  activeClient = null;
  activeUrl = null;
  activePeerId = null;
}
