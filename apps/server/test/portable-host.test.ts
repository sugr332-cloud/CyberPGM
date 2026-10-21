import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import { findPrivateIPv4List } from '../src/net.js';
import { sessionManager } from '../src/session.js';

// Phase 5h: ノート PC を出先の Wi-Fi でホストにする
const v4 = (address: string): os.NetworkInterfaceInfo[] => [
  { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:01', internal: false, cidr: `${address}/24` },
];

describe('portable host (Phase 5h)', () => {
  afterEach(() => sessionManager.setLanBaseUrl(null));

  it('puts Wi-Fi first and virtual adapters last (Windows names)', () => {
    const ips = findPrivateIPv4List({
      'vEthernet (WSL)': v4('172.20.16.1'),
      'VirtualBox Host-Only Network': v4('192.168.56.1'),
      'イーサネット': v4('10.0.0.5'),
      'Wi-Fi': v4('192.168.10.23'),
    });
    expect(ips).toEqual(['192.168.10.23', '10.0.0.5', '172.20.16.1', '192.168.56.1']);
  });

  it('builds the join URL from the LAN address even when the GM opened localhost', () => {
    expect(sessionManager.getJoinBaseUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    sessionManager.setLanBaseUrl('http://192.168.10.23:8787');
    expect(sessionManager.getJoinBaseUrl('http://127.0.0.1:8787')).toBe('http://192.168.10.23:8787');
  });
});
