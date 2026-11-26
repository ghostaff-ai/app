import { DEPARTMENT_NAMES, DEPARTMENTS, type Department, EXTERNAL_KIND_NAMES, type ExternalKind, type ExternalParty } from '@ghostaff/shared';
import { getExternalParty, invalidExternalParty, removeExternalParty, saveExternalParty } from '@ghostaff/shared/services';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { EnvelopeSimple, LinkSimple, Phone, WarningCircle } from '@/components/icons';
import { Button, Chip, ErrorText, Field, ListRow, ListSection, Loading, Notice, RowIcon, ScreenTitle, Segmented } from '@/components/ui';
import { externalRefusal } from '@/lib/externalParties';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { useTabScreenTop } from '@/lib/tabs';

// One party of «Con quién trabajáis» (external-parties.md, decisions 4 to 6):
// an owner adds one (`nuevo`) or changes and removes it; anyone else reads it,
// with a tap to write, call or open its web. Saving reaches the record's
// `externos/` on the next sync.

const KINDS: ExternalKind[] = ['person', 'company', 'service'];

export default function Externo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'nuevo';
  const { active } = useActiveOrg();
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const [party, setParty] = useState<ExternalParty | null | undefined>(isNew ? null : undefined);
  const [kind, setKind] = useState<ExternalKind>('person');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (isNew || !id) return;
    getExternalParty(supabase, id)
      .then((p) => {
        setParty(p);
        if (!p) return;
        setKind(p.kind);
        setName(p.name);
        setRole(p.role);
        setDepartments(p.departments);
        setEmail(p.email ?? '');
        setPhone(p.phone ?? '');
        setWebsite(p.website ?? '');
      })
      .catch(() => setLoadFailed(true));
  }, [id, isNew]);

  if (!active) return null;
  if (loadFailed) return <Notice icon={WarningCircle} title="No hemos podido cargarlo" body="Vuelve a intentarlo en un momento." />;
  if (party === undefined) return <Loading />;
  if (!isNew && !party) return <Notice title="No lo encontramos" body="Puede que alguien lo haya quitado de la lista." />;
  const owner = active.role === 'owner';

  const padding = {
    paddingHorizontal: desktop ? 40 : 20,
    paddingBottom: 64,
    paddingTop: (desktop ? 40 : 12) + top,
    maxWidth: DESKTOP_CONTENT_MAX_WIDTH,
    width: '100%' as const,
    alignSelf: 'center' as const,
  };

  if (!owner && party) return <ReadOnly party={party} style={padding} />;
  if (!owner) return <Notice title="Solo quien es propietario añade a alguien" body="Pídeselo, o díselo a un agente: lo propondrá." />;

  const input = { kind, name, role, departments, email, phone, website };
  const problem = invalidExternalParty(input);
  const ready = !!name.trim() && !!role.trim() && !busy;

  const toggle = (d: Department) => setDepartments((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]));

  const save = async () => {
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveExternalParty(supabase, active.id, party?.id ?? null, input);
      router.back();
    } catch (e) {
      setError(externalRefusal(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!party) return;
    setBusy(true);
    setError(null);
    try {
      await removeExternalParty(supabase, party.id);
      router.back();
    } catch (e) {
      setError(externalRefusal(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerStyle={padding} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <ScreenTitle>{party ? party.name : 'Añadir'}</ScreenTitle>
      <View className="mt-5">
        <Segmented<ExternalKind>
          label="Qué es"
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({ value: k, label: EXTERNAL_KIND_NAMES[k] }))}
        />
      </View>
      <Field
        testID="external-name"
        label="Nombre"
        placeholder={kind === 'person' ? 'Ana López' : kind === 'company' ? 'Gestoría López' : 'Holded'}
        value={name}
        onChangeText={setName}
        maxLength={120}
        autoCapitalize="words"
      />
      <Field
        testID="external-role"
        label="Qué hace para vosotros"
        hint="Lo que tienen que saber los agentes para mandarle trabajo."
        placeholder="Presenta el IVA cada trimestre"
        value={role}
        onChangeText={setRole}
        multiline
        maxLength={300}
      />

      <Text className="mt-5 text-footnote font-medium text-ink">Con qué departamentos</Text>
      <View accessibilityLabel="Con qué departamentos" className="mt-2 flex-row flex-wrap gap-2">
        {DEPARTMENTS.map((d) => (
          <Chip key={d} testID={`external-department-${d}`} multiple label={DEPARTMENT_NAMES[d]} on={departments.includes(d)} onPress={() => toggle(d)} />
        ))}
      </View>

      <Field
        testID="external-email"
        label="Correo"
        placeholder="ana@ejemplo.com"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        maxLength={200}
      />
      <Field testID="external-phone" label="Teléfono" placeholder="600 000 000" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={40} />
      <Field
        testID="external-website"
        label="Web"
        placeholder="ejemplo.com"
        value={website}
        onChangeText={setWebsite}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={300}
      />

      <View className="mt-8">
        <Button testID="external-save" label={party ? 'Guardar cambios' : 'Guardar'} onPress={() => void save()} disabled={!ready} busy={busy} />
      </View>
      <ErrorText>{error}</ErrorText>
      {party ? (
        <View className="mt-3 gap-3">
          {confirming ? (
            <>
              <Button testID="external-remove-confirm" label={`Sí, quitar a ${party.name}`} variant="danger" onPress={() => void remove()} busy={busy} />
              <Button label="Cancelar" variant="plain" onPress={() => setConfirming(false)} />
            </>
          ) : (
            <Button testID="external-remove" label="Quitar de la lista" variant="plain" onPress={() => setConfirming(true)} disabled={busy} />
          )}
        </View>
      ) : null}
      {party ? <Added party={party} /> : null}
    </ScrollView>
  );
}

/** Who added it, and the agent that proposed it: decision 1's «added or confirmed by a person», visible. */
function Added({ party }: { party: ExternalParty }) {
  const when = new Date(party.addedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const who = party.addedByName ? `Lo añadió ${party.addedByName}` : 'Añadido';
  const proposed = party.proposedByName ? `, a propuesta de ${party.proposedByName}` : '';
  return <Text className="mt-8 text-footnote text-muted">{`${who}${proposed}, el ${when}.`}</Text>;
}

/** What a member sees: the same, to read, with a tap to write, call or open the web. */
function ReadOnly({ party, style }: { party: ExternalParty; style: object }) {
  const contact = [
    party.email ? { key: 'email', icon: EnvelopeSimple, title: party.email, url: `mailto:${party.email}` } : null,
    party.phone ? { key: 'phone', icon: Phone, title: party.phone, url: `tel:${party.phone.replace(/\s+/g, '')}` } : null,
    party.website ? { key: 'web', icon: LinkSimple, title: party.website, url: party.website } : null,
  ].filter((x) => x !== null);
  return (
    <ScrollView className="flex-1 bg-surface" contentContainerStyle={style} contentInsetAdjustmentBehavior="automatic">
      <ScreenTitle subtitle={[EXTERNAL_KIND_NAMES[party.kind], ...party.departments.map((d) => DEPARTMENT_NAMES[d])].join(' · ')}>{party.name}</ScreenTitle>
      <Text className="mt-4 text-base leading-[22px] text-ink">{party.role}</Text>
      {contact.length ? (
        <ListSection>
          {contact.map((c) => (
            <ListRow key={c.key} leading={<RowIcon icon={c.icon} />} title={c.title} onPress={() => void Linking.openURL(c.url)} />
          ))}
        </ListSection>
      ) : null}
      <Added party={party} />
    </ScrollView>
  );
}
