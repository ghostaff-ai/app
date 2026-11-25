// What the outbox drain needs from a push provider: one device, one push, one
// verdict. Providers differ in wire format and error vocabulary; the verdict is
// the only thing the caller acts on.

export interface Device {
  token: string;
  platform: 'ios' | 'android';
  apnsEnvironment: 'production' | 'sandbox' | null;
  bundleId: string;
}

export interface Push {
  title: string;
  body: string;
  data: Record<string, string>;
  collapseId: string | null;
}

/**
 * - `delivered`: the provider accepted it.
 * - `dead`: the token will never work again; the caller prunes the device.
 * - `retry`: a transient failure (throttling, outage, network, our own config);
 *   never a reason to prune. Pruning on a blip silently unsubscribes a real
 *   device and its owner has no way to notice.
 */
export type Outcome = 'delivered' | 'dead' | 'retry';

export interface PushTransport {
  send(device: Device, push: Push): Promise<Outcome>;
}

/** One transport per platform. A platform without one is not configured: `retry`, so the push waits for the config. */
export function byPlatform(ios: PushTransport | null, android: PushTransport | null): PushTransport {
  return {
    send: (device, push) => {
      const transport = device.platform === 'ios' ? ios : android;
      return transport ? transport.send(device, push) : Promise.resolve('retry');
    },
  };
}
