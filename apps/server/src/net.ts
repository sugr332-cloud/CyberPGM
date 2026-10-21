import http from 'node:http';
import os from 'node:os';

/**
 * Checks if an IPv4 address is in a private network range (RFC 1918).
 * Specifically:
 * - 10.0.0.0/8
 * - 172.16.0.0/12
 * - 192.168.0.0/16
 */
export function isPrivateIPv4(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  // 10.0.0.0/8
  if (parts[0] === 10) return true;

  // 172.16.0.0/12 (172.16.0.0 – 172.31.255.255)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;

  return false;
}

export interface ResolveLanIpOptions {
  lanArg?: string;
  envLan?: string;
  customInterfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}

export interface ResolveLanIpResult {
  selectedIp: string | null;
  allPrivateIps: string[];
  message?: string;
}

// 仮想アダプタ（WSL・Hyper-V・VirtualBox・Docker など）。スマホからは届かないので最後に回す
const VIRTUAL_IFACE = /vethernet|wsl|hyper-v|virtualbox|vbox|vmware|vmnet|docker|^br-|virbr|^veth|tailscale|zerotier|^utun|loopback/i;
// 無線のアダプタ。ノート PC を出先の Wi-Fi につないだときはこれを選ぶ（Phase 5h）
const WIRELESS_IFACE = /wi-?fi|wlan|^wl|wireless|ワイヤレス/i;

function ifaceRank(name: string): number {
  if (VIRTUAL_IFACE.test(name)) return 2;
  if (WIRELESS_IFACE.test(name)) return 0;
  return 1;
}

/**
 * Finds all private IPv4 addresses from network interfaces.
 * Wireless adapters come first and virtual adapters last, so [0] is the address phones can reach.
 */
export function findPrivateIPv4List(
  customInterfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): string[] {
  const ifaces = customInterfaces ?? os.networkInterfaces();
  const found: { ip: string; rank: number }[] = [];

  for (const name of Object.keys(ifaces)) {
    const list = ifaces[name];
    if (!list) continue;
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal && isPrivateIPv4(info.address)) {
        if (!found.some((f) => f.ip === info.address)) {
          found.push({ ip: info.address, rank: ifaceRank(name) });
        }
      }
    }
  }

  // Array.prototype.sort is stable, so the OS order is kept within the same rank
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.ip);
}

/**
 * Resolves which LAN IP to use according to phase2 spec §0 and §1.
 * Strict rules:
 * - Only private IPv4 or 127.0.0.1.
 * - 0.0.0.0 or :: is strictly forbidden.
 */
export function resolveLanIp(options: ResolveLanIpOptions = {}): ResolveLanIpResult {
  const privateIps = findPrivateIPv4List(options.customInterfaces);

  // Check explicit CLI or ENV options
  const requested = options.lanArg || options.envLan;
  if (requested) {
    if (!isPrivateIPv4(requested)) {
      throw new Error(
        `Requested LAN IP "${requested}" is not a valid private IPv4 address (10.0.0.0/8, 172.16.0.0/12, or 192.168.0.0/16). 0.0.0.0 or public IPs are forbidden.`,
      );
    }
    return {
      selectedIp: requested,
      allPrivateIps: privateIps,
      message: `Using explicitly specified LAN IP: ${requested}`,
    };
  }

  if (privateIps.length === 0) {
    return {
      selectedIp: null,
      allPrivateIps: [],
      message: 'No private LAN IPv4 address found. Starting on 127.0.0.1 only.',
    };
  }

  if (privateIps.length === 1) {
    return {
      selectedIp: privateIps[0],
      allPrivateIps: privateIps,
    };
  }

  // Multiple private IPs found
  const selectedIp = privateIps[0];
  const listStr = privateIps.map((ip) => `  - ${ip}`).join('\n');
  return {
    selectedIp,
    allPrivateIps: privateIps,
    message: `Multiple private LAN IPv4 addresses found:\n${listStr}\nSelected ${selectedIp}. You can specify another via --lan <IP> or LAN_IP=<IP>.`,
  };
}

export interface DualServerOptions {
  port: number;
  lanIp: string | null;
}

export interface DualServerInstance {
  servers: http.Server[];
  port: number;
  localUrl: string;
  lanUrl: string | null;
  close: () => Promise<void>;
}

/**
 * Starts HTTP listener(s) strictly on 127.0.0.1 and optional single private LAN IP.
 * Explicitly avoids 0.0.0.0 / :: wildcard bindings.
 */
export async function startDualServer(
  listener: http.RequestListener,
  options: DualServerOptions,
): Promise<DualServerInstance> {
  const { port, lanIp } = options;
  const servers: http.Server[] = [];

  // 1. Listen on loopback 127.0.0.1
  const loopbackServer = http.createServer(listener);
  await new Promise<void>((resolve, reject) => {
    loopbackServer.once('error', reject);
    loopbackServer.listen(port, '127.0.0.1', () => {
      loopbackServer.removeListener('error', reject);
      resolve();
    });
  });
  servers.push(loopbackServer);

  const localUrl = `http://127.0.0.1:${port}`;
  let lanUrl: string | null = null;

  // 2. Listen on private LAN IP if available
  if (lanIp) {
    if (!isPrivateIPv4(lanIp)) {
      throw new Error(`Security violation: refusing to listen on non-private IP "${lanIp}".`);
    }

    const lanServer = http.createServer(listener);
    try {
      await new Promise<void>((resolve, reject) => {
        lanServer.once('error', reject);
        lanServer.listen(port, lanIp, () => {
          lanServer.removeListener('error', reject);
          resolve();
        });
      });
      servers.push(lanServer);
      lanUrl = `http://${lanIp}:${port}`;
    } catch (err: unknown) {
      // If OS does not permit dual-bind on identical port for distinct IPs,
      // fallback or report cleanly
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[net] Could not bind to LAN IP ${lanIp}:${port} (${errMsg}).`);
    }
  }

  const close = async () => {
    await Promise.all(
      servers.map(
        (srv) =>
          new Promise<void>((res) => {
            srv.close(() => res());
          }),
      ),
    );
  };

  return {
    servers,
    port,
    localUrl,
    lanUrl,
    close,
  };
}
