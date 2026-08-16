export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function getIceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [];

  const stun = process.env.NEXT_PUBLIC_STUN_SERVER;
  if (stun) {
    servers.push({ urls: stun });
  } else {
    servers.push({ urls: 'stun:stun.l.google.com:19302' });
  }

  const turnServer = process.env.NEXT_PUBLIC_TURN_SERVER;
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnPass = process.env.NEXT_PUBLIC_TURN_PASSWORD;
  if (turnServer && turnUser && turnPass) {
    servers.push({
      urls: turnServer,
      username: turnUser,
      credential: turnPass,
    });
  }

  return servers;
}
