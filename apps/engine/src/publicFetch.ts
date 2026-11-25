// A fetch that only reaches the public internet, for URLs a model hands the
// engine (TikTok's video: tiktok.ts). Checking the name is not enough: a public
// name can resolve to 10.0.0.5 or the metadata server. So the check runs on the
// addresses themselves, at the moment each connection opens (redirects
// included), which also leaves no gap between checking and connecting for a
// name whose answer changes (DNS rebinding). An address written as an IP
// never reaches a lookup (the socket connects to it directly), so the
// connector itself refuses one that is not public.

import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

// Not on the public internet: RFC 6890's special-purpose ranges, both families.
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  // IPv4-compatible (deprecated, [::7f00:1] is 127.0.0.1), with :: and ::1 inside it.
  ['::', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/**
 * True only for an address on the public internet. An IPv4-mapped IPv6 address
 * (::ffff:0:0/96), dotted or in hex as a URL writes it ([::ffff:7f00:1]), is
 * judged as the IPv4 it carries. Not in the block list: Node's BlockList
 * matches IPv4 against it, which would refuse every IPv4.
 */
export function isPublicAddress(ip: string): boolean {
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPublicAddress(mapped[1] as string);
  const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const [hi, lo] = [Number.parseInt(hex[1] as string, 16), Number.parseInt(hex[2] as string, 16)];
    return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family === 6) return !blocked.check(ip, 'ipv6');
  return false;
}

const notPublic = (host: string): NodeJS.ErrnoException => {
  const err: NodeJS.ErrnoException = new Error(`${host} is not public`);
  err.code = 'ENOTPUBLIC';
  return err;
};

type Resolved = { address: string; family: number }[];
type Resolve = (host: string) => Promise<Resolved>;

const resolveAll: Resolve = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * A `lookup` for a socket that refuses a host as soon as any of its addresses
 * is not public, and otherwise hands on what it resolved, in the shape asked.
 */
export function publicLookup(resolve: Resolve = resolveAll): LookupFunction {
  return (host, options, callback) => {
    resolve(host).then(
      (addresses) => {
        const bad = addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address));
        if (bad) {
          callback(notPublic(host), '');
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]?.address ?? '', addresses[0]?.family);
      },
      (err: NodeJS.ErrnoException) => callback(err, ''),
    );
  };
}

const connectByName = buildConnector({ lookup: publicLookup() });

/** Opens a connection only to a public address: a name through `publicLookup`, an IP checked here. */
const connectPublic: buildConnector.connector = (options, callback) => {
  const host = options.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0 && !isPublicAddress(host)) {
    callback(notPublic(host), null);
    return;
  }
  connectByName(options, callback);
};

const publicAgent = new Agent({ connect: connectPublic });

/** fetch, but every connection it opens must land on a public address. */
export const fetchPublic: typeof fetch = (input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: publicAgent }) as unknown as Promise<Response>;
