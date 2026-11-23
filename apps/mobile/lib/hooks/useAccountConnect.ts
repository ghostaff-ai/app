import type { AccountProvider } from '@ghostaff/shared';
import { finishAccountConnect, startAccountConnect } from '@ghostaff/shared/services';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { accountErrorMessage, accountResultMessage } from '../connections';
import { success } from '../haptics';
import { useConnections, useEngine } from './useConnections';

// Connecting an outside account by signing in there (docs/plans/ongoing/
// connectors.md), the one way the app does it: from its page in Conexiones and
// from an agent's card in a chat (connector-in-chat.md). The engine sends the
// browser back to `returnPath` in the app with the provider's code, which we
// hand back to finish the connect signed in; or with how it ended (?result=…).

/** What the person reads once it ends; null when they closed the sign-in. */
export type ConnectNote = { text: string; ok: boolean } | null;

export function useAccountConnect(orgId: string | null) {
  const engine = useEngine();
  const { reload } = useConnections(orgId);
  const [busy, setBusy] = useState<AccountProvider | null>(null);

  const connect = useCallback(
    async (provider: AccountProvider, returnPath: string): Promise<ConnectNote> => {
      if (!engine || !orgId) return null;
      setBusy(provider);
      try {
        const returnTo = Linking.createURL(returnPath);
        const { url } = await startAccountConnect(engine, { orgId, provider, returnTo });
        const res = await WebBrowser.openAuthSessionAsync(url, returnTo);
        let note: ConnectNote = null;
        if (res.type === 'success') {
          const q = Linking.parse(res.url).queryParams ?? {};
          const result =
            typeof q.state === 'string' && typeof q.code === 'string'
              ? await finishAccountConnect(engine, { provider, state: q.state, code: q.code })
              : q.result;
          note = accountResultMessage(typeof result === 'string' ? result : null);
          if (note.ok) success();
        }
        // Every screen showing connections reads them again.
        await reload();
        return note;
      } catch (e) {
        return { text: accountErrorMessage(e), ok: false };
      } finally {
        setBusy(null);
      }
    },
    [engine, orgId, reload],
  );

  return { connect, busy, ready: !!engine && !!orgId };
}
