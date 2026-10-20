import { describe, it, expect } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import {
  isPrivateIPv4,
  findPrivateIPv4List,
  resolveLanIp,
  startDualServer,
} from '../src/net.js';

describe('net module (phase 2 §0 and §1)', () => {
  describe('isPrivateIPv4', () => {
    it('accepts RFC 1918 private IPv4 ranges', () => {
      expect(isPrivateIPv4('10.0.0.1')).toBe(true);
      expect(isPrivateIPv4('10.254.1.20')).toBe(true);
      expect(isPrivateIPv4('172.16.0.1')).toBe(true);
      expect(isPrivateIPv4('172.31.255.254')).toBe(true);
      expect(isPrivateIPv4('192.168.1.100')).toBe(true);
      expect(isPrivateIPv4('192.168.0.1')).toBe(true);
    });

    it('rejects loopback, wildcards, and public IPs', () => {
      expect(isPrivateIPv4('127.0.0.1')).toBe(false);
      expect(isPrivateIPv4('0.0.0.0')).toBe(false);
      expect(isPrivateIPv4('::')).toBe(false);
      expect(isPrivateIPv4('8.8.8.8')).toBe(false);
      expect(isPrivateIPv4('172.15.0.1')).toBe(false);
      expect(isPrivateIPv4('172.32.0.1')).toBe(false);
      expect(isPrivateIPv4('192.169.1.1')).toBe(false);
      expect(isPrivateIPv4('')).toBe(false);
      expect(isPrivateIPv4('not-an-ip')).toBe(false);
    });
  });

  describe('findPrivateIPv4List and resolveLanIp', () => {
    it('extracts private IPs from custom interfaces', () => {
      const mockIfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
        lo: [
          {
            address: '127.0.0.1',
            netmask: '255.0.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '127.0.0.1/8',
          },
        ],
        eth0: [
          {
            address: '192.168.11.50',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:11:22:33:44:55',
            internal: false,
            cidr: '192.168.11.50/24',
          },
        ],
        docker0: [
          {
            address: '172.17.0.1',
            netmask: '255.255.0.0',
            family: 'IPv4',
            mac: '00:11:22:33:44:66',
            internal: false,
            cidr: '172.17.0.1/16',
          },
        ],
      };

      const ips = findPrivateIPv4List(mockIfaces);
      expect(ips).toContain('192.168.11.50');
      expect(ips).toContain('172.17.0.1');
      expect(ips).not.toContain('127.0.0.1');

      const res = resolveLanIp({ customInterfaces: mockIfaces });
      expect(res.selectedIp).toBeDefined();
      expect(res.allPrivateIps.length).toBe(2);
    });

    it('falls back to 127.0.0.1 if no private IPv4 is available', () => {
      const mockIfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
        lo: [
          {
            address: '127.0.0.1',
            netmask: '255.0.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '127.0.0.1/8',
          },
        ],
      };
      const res = resolveLanIp({ customInterfaces: mockIfaces });
      expect(res.selectedIp).toBeNull();
      expect(res.allPrivateIps).toEqual([]);
      expect(res.message).toContain('127.0.0.1');
    });

    it('rejects forbidden 0.0.0.0 or public IP passed explicitly', () => {
      expect(() => resolveLanIp({ lanArg: '0.0.0.0' })).toThrow(/Security violation|forbidden/i);
      expect(() => resolveLanIp({ envLan: '8.8.8.8' })).toThrow(/Security violation|forbidden/i);
    });

    it('accepts valid private IP passed explicitly', () => {
      const res = resolveLanIp({ lanArg: '192.168.1.100' });
      expect(res.selectedIp).toBe('192.168.1.100');
    });
  });

  describe('startDualServer', () => {
    it('starts on 127.0.0.1 cleanly and responds to HTTP requests', async () => {
      const server = await startDualServer(
        (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        },
        { port: 19876, lanIp: null },
      );

      expect(server.localUrl).toBe('http://127.0.0.1:19876');
      expect(server.lanUrl).toBeNull();

      const res = await new Promise<{ statusCode?: number; data: string }>((resolve, reject) => {
        http.get('http://127.0.0.1:19876', (r) => {
          let data = '';
          r.on('data', (chunk) => (data += chunk));
          r.on('end', () => resolve({ statusCode: r.statusCode, data }));
        }).on('error', reject);
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.data)).toEqual({ ok: true });

      await server.close();
    });

    it('refuses to bind if non-private LAN IP is given', async () => {
      await expect(
        startDualServer((req, res) => res.end(''), { port: 19877, lanIp: '0.0.0.0' }),
      ).rejects.toThrow(/Security violation/i);
    });
  });
});
