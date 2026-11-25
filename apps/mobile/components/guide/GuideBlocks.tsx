import { type CatalogueConnector, CONNECTORS, type GuideAnswer, type GuideBlock, type GuideCheckValues, type GuideField, type GuideImage, type GuideStep } from '@ghostaff/shared';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { AnnotatedShot } from '@/components/guide/AnnotatedShot';
import { Icon, LockSimple } from '@/components/icons';
import { Button, ErrorText, Field } from '@/components/ui';
import { FIELD_LABELS, stepAction } from '@/lib/guide';
import type { Shot } from '@/lib/guidePhoto';
import type { FieldError, GuideBusy } from '@/lib/hooks/useGuide';
import { selection } from '@/lib/haptics';
import { usePalette } from '@/lib/theme';

// The middle of a guide's screen (guided-access.md): one step, drawn from the
// closed catalogue of blocks, one component per block. The model picks the
// blocks and their words; how each looks is ours. A secret can only be typed
// in a `secret` block, which keeps it masked and in the screen's state.

export type BlocksProps = {
  step: GuideStep;
  values: GuideCheckValues;
  onValue: (field: GuideField, value: string) => void;
  fieldError: FieldError | null;
  /** The last photo this device sent, for `annotated_shot`. */
  shot: Shot | null;
  busy: GuideBusy;
  onAnswer: (a: GuideAnswer) => void;
  onCheck: () => void;
  /** What the check needs that no block of this step asks for (typed on a step this device no longer has). */
  missing: readonly GuideField[];
  connector: { canConnect: boolean; run: (id: string) => Promise<string | null> };
};

function TitleBlock({ text }: { text: string }) {
  return (
    <Text accessibilityRole="header" className="mt-4 font-display text-title2 text-ink">
      {text}
    </Text>
  );
}

function BulletsBlock({ items }: { items: string[] }) {
  return (
    <View className="mt-3 gap-2">
      {items.map((item, i) => (
        <View key={i} className="flex-row">
          <Text className="w-4 text-base leading-6 text-muted">·</Text>
          <Text className="flex-1 text-base leading-6 text-ink">{item}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The reference drawings a choice may show, drawn here: the model only picks one by name.
 * They picture another app's screen (a dark menu on a light page), so their colours don't follow the theme.
 */
const SCREEN = { page: '#FFFFFF', bar: '#23282D', line: '#DCDCE3', edge: '#C9C9D2' };

function Drawing({ image }: { image?: GuideImage }) {
  if (!image || image === 'none') return null;
  const side = image === 'sidebar-left';
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      className="h-10 w-14 overflow-hidden rounded-md"
      style={{ flexDirection: side ? 'row' : 'column', backgroundColor: SCREEN.page, borderWidth: 1, borderColor: SCREEN.edge }}
    >
      <View style={[{ backgroundColor: SCREEN.bar }, side ? { width: 12 } : { height: 9 }]} />
      <View className="flex-1 gap-1 p-1.5">
        <View className="h-1 w-3/4 rounded-full" style={{ backgroundColor: SCREEN.line }} />
        <View className="h-1 w-1/2 rounded-full" style={{ backgroundColor: SCREEN.line }} />
      </View>
    </View>
  );
}

function ChoiceBlock({ block, onAnswer, off }: { block: Extract<GuideBlock, { type: 'choice' }>; onAnswer: BlocksProps['onAnswer']; off: boolean }) {
  return (
    <View className="mt-4">
      <Text className="text-base font-semibold text-ink">{block.question}</Text>
      <View className="mt-2 gap-2">
        {block.options.map((o) => (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ disabled: off }}
            disabled={off}
            onPress={() => onAnswer({ type: 'choice', option: o.id })}
            className="min-h-[52px] flex-row items-center gap-3 rounded-xl border border-line bg-card px-4 py-2.5 active:opacity-70"
          >
            <Drawing image={o.image} />
            <Text className="flex-1 text-base text-ink">{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function CopyValueBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(value);
    } catch {
      return; // the value stays selectable to copy by hand
    }
    selection();
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <View className="mt-4">
      <Text className="text-footnote font-medium text-ink">{label}</Text>
      <View className="mt-2 flex-row items-center gap-2 rounded-xl bg-sunk py-1 pl-4 pr-1">
        <Text selectable className="flex-1 py-2 text-base text-ink">
          {value}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copiar ${label}`}
          onPress={() => void copy()}
          className="min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-3 active:opacity-60"
        >
          <Text accessibilityLiveRegion="polite" className="text-footnote font-semibold text-ink">
            {copied ? 'Copiado' : 'Copiar'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A plain text field (the web's address, the user): it may travel in an answer and goes in the check. */
function TextField({ field, label, value, onValue, error }: { field: GuideField; label: string; value: string; onValue: BlocksProps['onValue']; error?: string }) {
  return (
    <>
      <Field
        label={label}
        value={value}
        onChangeText={(v) => onValue(field, v)}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        keyboardType={field === 'base_url' ? 'url' : 'default'}
        placeholder={field === 'base_url' ? 'tuweb.com…' : undefined}
      />
      <ErrorText>{error}</ErrorText>
    </>
  );
}

/** A secret: masked, never suggested or remembered by the phone, kept only in the screen until the check. */
function SecretField({ field, label, value, onValue, error }: { field: GuideField; label: string; value: string; onValue: BlocksProps['onValue']; error?: string }) {
  return (
    <>
      <Field
        label={label}
        value={value}
        onChangeText={(v) => onValue(field, v)}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        // A browser ignores «off» on a password field and fills in the person's own password: «new-password» stops it.
        autoComplete={Platform.OS === 'web' ? 'new-password' : 'off'}
        textContentType="none"
        importantForAutofill="no"
        spellCheck={false}
      />
      <ErrorText>{error}</ErrorText>
    </>
  );
}

function ScopeBlock({ text }: { text: string }) {
  const c = usePalette();
  return (
    <View className="mt-4 flex-row items-start gap-2">
      <Icon icon={LockSimple} size={18} color={c.muted} />
      <Text className="flex-1 text-footnote text-muted">{text}</Text>
    </View>
  );
}

function ConnectorBlock({ id, connector }: { id: string; connector: BlocksProps['connector'] }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const app = (CONNECTORS as readonly CatalogueConnector[]).find((c) => c.id === id);
  if (!app) return null;
  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const problem = await connector.run(id);
      setNote(problem ? { text: problem, ok: false } : { text: 'Conectada. Vuelve a la conversación para que siga.', ok: true });
    } catch {
      setNote({ text: 'No se ha podido. Inténtalo otra vez.', ok: false });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="mt-4 rounded-xl border border-line bg-card p-4">
      <View className="flex-row items-center gap-3">
        <ConnectorLogo id={app.id} name={app.name} size={32} />
        <Text className="flex-1 text-base text-ink">{app.name} tiene su propio botón en Ghostaff.</Text>
      </View>
      {connector.canConnect ? (
        <View className="mt-3">
          <Button label={`Conectar ${app.name}`} busy={busy} onPress={() => void run()} />
        </View>
      ) : (
        <Text className="mt-2 text-footnote text-muted">Lo conecta quien es propietario de la empresa.</Text>
      )}
      {note ? (
        <Text accessibilityLiveRegion="polite" className={`mt-2 text-footnote ${note.ok ? 'text-ok' : 'text-no'}`}>
          {note.text}
        </Text>
      ) : null}
    </View>
  );
}

export function GuideBlocks(p: BlocksProps) {
  const [empty, setEmpty] = useState(false);
  const off = p.busy !== null;
  const action = stepAction(p.step);
  const errorFor = (f: GuideField) => (p.fieldError?.field === f ? p.fieldError.message : undefined);
  const firstField = p.step.blocks.find((b): b is Extract<GuideBlock, { type: 'field' }> => b.type === 'field');
  const typed = firstField ? (p.values[firstField.field] ?? '').trim() : '';
  // A complaint about a field that isn't on this screen goes next to the button.
  const shownFields = new Set<GuideField>([...p.step.blocks.flatMap((b) => (b.type === 'field' || b.type === 'secret' ? [b.field] : [])), ...p.missing]);
  const looseError = p.fieldError && (!p.fieldError.field || !shownFields.has(p.fieldError.field)) ? p.fieldError.message : null;

  const block = (b: GuideBlock, i: number) => {
    switch (b.type) {
      case 'title':
        return <TitleBlock key={i} text={b.text} />;
      case 'bullets':
        return <BulletsBlock key={i} items={b.items} />;
      case 'choice':
        return <ChoiceBlock key={i} block={b} onAnswer={p.onAnswer} off={off} />;
      case 'annotated_shot':
        return <AnnotatedShot key={i} shot={p.shot} mark={b.mark} caption={b.caption} />;
      case 'copy_value':
        return <CopyValueBlock key={i} label={b.label} value={b.value} />;
      case 'field':
        return <TextField key={i} field={b.field} label={b.label} value={p.values[b.field] ?? ''} onValue={p.onValue} error={errorFor(b.field)} />;
      case 'secret':
        return <SecretField key={i} field={b.field} label={b.label} value={p.values[b.field] ?? ''} onValue={p.onValue} error={errorFor(b.field)} />;
      case 'confirm':
        return (
          <View key={i} className="mt-6 gap-2">
            <Button label="Ya está" disabled={off} onPress={() => p.onAnswer({ type: 'confirm', ok: true })} />
            <Button label="No me sale" variant="secondary" disabled={off} onPress={() => p.onAnswer({ type: 'confirm', ok: false })} />
          </View>
        );
      case 'check':
        return (
          <View key={i} className="mt-6">
            {p.missing.map((f) =>
              f === 'password' || f === 'token' || f === 'key' ? (
                <SecretField key={f} field={f} label={FIELD_LABELS[f]} value={p.values[f] ?? ''} onValue={p.onValue} error={errorFor(f)} />
              ) : (
                <TextField key={f} field={f} label={FIELD_LABELS[f]} value={p.values[f] ?? ''} onValue={p.onValue} error={errorFor(f)} />
              ),
            )}
            <View className={p.missing.length ? 'mt-6' : undefined}>
              <Button label={p.busy === 'check' ? 'Comprobando…' : 'Comprobar'} busy={p.busy === 'check'} disabled={off} onPress={p.onCheck} />
            </View>
            {looseError ? (
              <Text accessibilityLiveRegion="polite" className="mt-3 text-footnote text-no">
                {looseError}
              </Text>
            ) : null}
          </View>
        );
      case 'scope':
        return <ScopeBlock key={i} text={b.text} />;
      case 'use_connector':
        return <ConnectorBlock key={i} id={b.connector} connector={p.connector} />;
    }
  };

  return (
    <View>
      {p.step.blocks.map(block)}
      {action === 'text' || action === 'next' ? (
        <View className="mt-6">
          <Button
            label="Seguir"
            disabled={off}
            onPress={() => {
              if (action === 'text' && firstField && !typed) return setEmpty(true);
              setEmpty(false);
              p.onAnswer(action === 'text' && firstField ? { type: 'text', field: firstField.field, value: typed } : { type: 'confirm', ok: true });
            }}
          />
          {empty && !typed ? (
            <Text accessibilityLiveRegion="polite" className="mt-3 text-footnote text-no">
              Escríbelo arriba antes de seguir.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
