import { describe, expect, it } from 'vitest';
import { isPublicAddress, publicLookup } from '../src/publicFetch';

describe('isPublicAddress', () => {
  it('refuses private, loopback, link-local, shared and reserved addresses', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.5.4',
      '192.168.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '::ffff:127.0.0.1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it('accepts public IPv4 and IPv6 addresses', () => {
    for (const ip of ['8.8.8.8', '142.250.184.16', '2a00:1450:4003:80b::2010', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

type Answer = { address: string; family: number }[];

function lookupWith(answer: Answer) {
  return (host: string): Promise<Answer> => Promise.resolve(host ? answer : []);
}

function run(lookup: ReturnType<typeof publicLookup>, host: string) {
  return new Promise<{ err: Error | null; address?: unknown }>((resolve) => {
    lookup(host, { all: true }, (err, address) => resolve({ err, address }));
  });
}

describe('publicLookup', () => {
  it('refuses a public name that resolves to a private address', async () => {
    const { err } = await run(publicLookup(lookupWith([{ address: '10.0.0.5', family: 4 }])), 'videos.example.com');
    expect(err?.message).toMatch(/not public/);
  });

  it('refuses when any of several addresses is private', async () => {
    const answer = [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    const { err } = await run(publicLookup(lookupWith(answer)), 'videos.example.com');
    expect(err).toBeInstanceOf(Error);
  });

  it('passes the resolved public addresses on to the connection', async () => {
    const answer = [{ address: '8.8.8.8', family: 4 }];
    const { err, address } = await run(publicLookup(lookupWith(answer)), 'videos.example.com');
    expect(err).toBeNull();
    expect(address).toEqual(answer);
  });

  it('answers a single address when the connection asks for one', async () => {
    const lookup = publicLookup(lookupWith([{ address: '8.8.8.8', family: 4 }]));
    const got = await new Promise<unknown[]>((resolve) => {
      lookup('videos.example.com', {}, (...args) => resolve(args));
    });
    expect(got).toEqual([null, '8.8.8.8', 4]);
  });
});
