export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function getIceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [];

  // STUN servers (help discover public IP)
  const stun = process.env.NEXT_PUBLIC_STUN_SERVER;
  if (stun) {
    servers.push({ urls: stun });
  } else {
    servers.push({ urls: 'stun:stun.l.google.com:19302' });
  }

  // Custom TURN server from env (highest priority)
  const turnServer = process.env.NEXT_PUBLIC_TURN_SERVER;
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnPass = process.env.NEXT_PUBLIC_TURN_PASSWORD;
  if (turnServer && turnUser && turnPass) {
    // Add multiple transport variants for the custom TURN server
    servers.push({
      urls: turnServer,
      username: turnUser,
      credential: turnPass,
    });
    // Also add TCP variant if the base is UDP
    if (turnServer.startsWith('turn:') && !turnServer.includes('transport=')) {
      servers.push({
        urls: `${turnServer}?transport=tcp`,
        username: turnUser,
        credential: turnPass,
      });
    }
    // Add TURNS (TLS) variant if not already using turns:
    if (turnServer.startsWith('turn:')) {
      const tlsUrl = turnServer.replace('turn:', 'turns:');
      servers.push({
        urls: tlsUrl.includes('transport=') ? tlsUrl : `${tlsUrl}?transport=tcp`,
        username: turnUser,
        credential: turnPass,
      });
    }
  } else {
    // Free public TURN servers (Open Relay) as fallback
    const username = 'openrelayproject';
    const credential = 'openrelayproject';
    servers.push(
      {
        urls: 'stun:openrelay.metered.ca:80',
      },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username,
        credential,
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username,
        credential,
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username,
        credential,
      },
      {
        urls: 'turns:openrelay.metered.ca:443?transport=tcp',
        username,
        credential,
      },
    );
  }

  return servers;
}
