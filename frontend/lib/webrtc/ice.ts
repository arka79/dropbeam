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
    servers.push({
      urls: turnServer,
      username: turnUser,
      credential: turnPass,
    });
  } else {
    // Free public TURN servers (Open Relay / metered.ca)
    // These act as fallback for cross-network connections
    // behind symmetric NATs or restrictive firewalls.
    servers.push(
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    );
  }

  return servers;
}
