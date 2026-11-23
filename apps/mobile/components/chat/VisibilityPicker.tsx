import { CONVERSATION_VISIBILITIES, type ConversationVisibility } from '@ghostaff/shared';
import { ListRow, ListSection } from '@/components/ui';
import { VISIBILITY_NAMES, visibilityHint } from '@/lib/chat';

// Who reads and writes a conversation (chat-permissions.md): «Solo yo», «El
// equipo puede leer», «El equipo puede escribir», one of three, each with what
// it means. «El equipo» is whoever the agent's own access lets in.

export function VisibilityPicker({
  value,
  agentName,
  onChange,
  header = 'Quién la ve',
  footer,
}: {
  value: ConversationVisibility;
  agentName: string;
  onChange: (v: ConversationVisibility) => void;
  header?: string;
  footer?: string;
}) {
  return (
    <ListSection header={header} footer={footer}>
      {CONVERSATION_VISIBILITIES.map((v) => (
        <ListRow
          key={v}
          testID={`visibility-${v}`}
          title={VISIBILITY_NAMES[v]}
          subtitle={visibilityHint(v, agentName)}
          checked={v === value}
          onPress={() => onChange(v)}
        />
      ))}
    </ListSection>
  );
}
