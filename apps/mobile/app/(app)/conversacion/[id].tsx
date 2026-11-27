import { type Href, Redirect, useLocalSearchParams } from 'expo-router';
import { Loading, Notice } from '@/components/ui';
import { useThreadRoute } from '@/lib/hooks/useChat';

// A link to a thread by its id (a push or an OK card from before one chat per
// agent, group-chat-per-agent.md): every thread is now an agent's chat or
// General (general-chat.md), so it opens that.

export default function Conversacion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const route = useThreadRoute(id ?? null);
  if (route === undefined) return <Loading />;
  if (!route) return <Notice title="No encontramos esta conversación" body="Puede que ya no puedas ver a este agente." />;
  return <Redirect href={route as Href} />;
}
