import { Children, createContext, isValidElement, useContext, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { CaretRight, Icon, type IconComponent, MagnifyingGlass, XCircle } from '@/components/icons';
import { selection } from '@/lib/haptics';
import { usePalette } from '@/lib/theme';

// The few building blocks every screen uses (app-design.md, «The look» and
// «Components»). Grow this before adding a one-off style to a screen.
//
// - Type: a screen's title in Rubik (`ScreenTitle`), sentence-case section
//   headers in small muted text (`ListSection`), body in the phone's own face.
// - Buttons in three weights: `primary` for the one thing the screen is for,
//   `secondary` for the others, `plain` for a way out. `danger` only to
//   confirm a removal.
// - Lists are inset groups of rows (`ListSection` + `ListRow`); cards are kept
//   for what you act on (decisions, agents).

export function Centered({ children }: { children: ReactNode }) {
  return <View className="flex-1 items-center justify-center bg-surface px-8">{children}</View>;
}

export function Loading() {
  return (
    <Centered>
      <ActivityIndicator />
    </Centered>
  );
}

/** Nothing here yet, or something went wrong: what it is, and the next step. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: IconComponent;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const c = usePalette();
  return (
    <View className="items-center px-4 py-10">
      {icon ? (
        <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-sunk">
          <Icon icon={icon} size={26} color={c.muted} />
        </View>
      ) : null}
      <Text className="text-center font-display-medium text-title3 text-ink">{title}</Text>
      {body ? <Text className="mt-1.5 max-w-[320px] text-center text-base leading-[22px] text-muted">{body}</Text> : null}
      {action ? <View className="mt-6 min-w-[200px]">{action}</View> : null}
    </View>
  );
}

/** A whole screen's worth of `EmptyState`. */
export function Notice(props: { icon?: IconComponent; title: string; body?: string; action?: ReactNode }) {
  return (
    <Centered>
      <EmptyState {...props} />
    </Centered>
  );
}

/** A tab screen's title, with what sits beside it (the mic). */
export function ScreenTitle({ children, right, subtitle }: { children: ReactNode; right?: ReactNode; subtitle?: string }) {
  return (
    <View className="mb-2">
      <View className="min-h-11 flex-row items-center justify-between">
        <Text accessibilityRole="header" className="flex-1 font-display text-title text-ink">
          {children}
        </Text>
        {right}
      </View>
      {subtitle ? <Text className="mt-1 text-base text-muted">{subtitle}</Text> : null}
    </View>
  );
}

type Variant = 'primary' | 'secondary' | 'plain' | 'danger';

const LOOK: Record<Variant, { box: string; text: string }> = {
  primary: { box: 'bg-accent', text: 'text-on-accent' },
  secondary: { box: 'bg-sunk', text: 'text-ink' },
  plain: { box: '', text: 'text-ink' },
  danger: { box: 'bg-no', text: 'text-white' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  icon,
  disabled,
  busy,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  /** `large` fills its row; `small` sits inline, beside a title or in a row. */
  size?: 'large' | 'small';
  icon?: IconComponent;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const off = disabled || busy;
  const c = usePalette();
  const look = LOOK[variant];
  const ink = variant === 'primary' ? c.onAccent : variant === 'danger' ? '#FFFFFF' : c.ink;
  const large = size === 'large';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      hitSlop={large ? undefined : 6}
      className={`flex-row items-center justify-center rounded-full ${large ? 'min-h-[52px] px-6' : 'min-h-9 self-start px-4'} ${look.box} ${off ? 'opacity-40' : 'active:opacity-70'}`}
    >
      {busy ? (
        <ActivityIndicator size="small" color={ink} />
      ) : icon ? (
        <Icon icon={icon} size={large ? 20 : 16} color={ink} weight="regular" />
      ) : null}
      <Text className={`${large ? 'text-[17px]' : 'text-[15px]'} font-semibold ${look.text} ${busy || icon ? 'ml-2' : ''}`}>{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text className="mt-3 text-footnote text-no">{children}</Text>;
}

/** A labelled text box. `hint` sits under the label. */
export function Field({
  label,
  hint,
  multiline,
  onFocus,
  onBlur,
  ...input
}: { label: string; hint?: string } & TextInputProps) {
  const c = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View className="mt-5">
      <Text className="text-footnote font-medium text-ink">{label}</Text>
      {hint ? <Text className="mt-0.5 text-footnote text-muted">{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        className={`mt-2 rounded-xl border bg-card px-4 py-3 text-base text-ink ${focused ? 'border-ink' : 'border-line'} ${multiline ? 'min-h-24' : 'min-h-12'}`}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : undefined}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...input}
      />
    </View>
  );
}

/** A search box: the magnifier, the text, and a way to clear it. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  label = 'Buscar',
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  label?: string;
}) {
  const c = usePalette();
  return (
    <View className="h-11 flex-row items-center rounded-xl bg-sunk pl-3 pr-2">
      <Icon icon={MagnifyingGlass} size={18} color={c.muted} weight="regular" />
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        className="ml-2 h-11 flex-1 text-base text-ink"
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Borrar la búsqueda" hitSlop={8} onPress={() => onChangeText('')}>
          <Icon icon={XCircle} size={18} color={c.muted} weight="fill" />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One pill of a set of choices. */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={() => {
        selection();
        onPress();
      }}
      className={`rounded-full px-4 py-2 ${on ? 'bg-accent' : 'bg-sunk active:opacity-70'}`}
    >
      <Text className={`text-[15px] ${on ? 'font-semibold text-on-accent' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}

/** One choice of several; tap again to clear. */
export function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <View className="mt-5">
      <Text className="text-footnote font-medium text-ink">{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} className="mt-2 flex-row flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={o} label={o} on={o === value} onPress={() => onChange(o === value ? null : o)} />
        ))}
      </View>
    </View>
  );
}

/** The orange count of what waits for you (decision 29). */
export function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View className="h-5 min-w-5 items-center justify-center rounded-full bg-waiting px-1.5">
      <Text className="text-caption font-semibold text-white">{count}</Text>
    </View>
  );
}

/** A few options side by side, one chosen: the phone's segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: readonly { value: T; label: string; badge?: number; accessibilityLabel?: string }[];
  value: T;
  onChange: (v: T) => void;
  /** What the whole control is about, read out with it. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className={`flex-row self-start rounded-full bg-sunk p-0.5 ${disabled ? 'opacity-50' : ''}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.accessibilityLabel ?? o.label}
            accessibilityState={{ checked: on, disabled: !!disabled }}
            onPress={
              disabled || on
                ? undefined
                : () => {
                    selection();
                    onChange(o.value);
                  }
            }
            hitSlop={4}
            style={on ? styles.raised : undefined}
            className={`flex-row items-center rounded-full px-3.5 py-1.5 ${on ? 'bg-raised' : ''}`}
          >
            <Text className={`text-[14px] ${on ? 'font-semibold text-ink' : 'text-muted'}`}>{o.label}</Text>
            {o.badge ? (
              <View className="ml-1.5">
                <Badge count={o.badge} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** What each level on an agent is called in the app. */
export const LEVEL_NAMES = { none: 'Nada', read: 'Ver', talk: 'Hablar' } as const;
type Level = keyof typeof LEVEL_NAMES;
const LEVEL_OPTIONS = (['none', 'read', 'talk'] as const).map((l) => ({ value: l, label: LEVEL_NAMES[l] }));

/** Nada · Ver · Hablar, one of three, for one person on one agent. */
export function LevelPicker({
  value,
  onChange,
  label,
  disabled,
}: {
  value: Level;
  onChange: (v: Level) => void;
  /** Read out with each segment, e.g. «Ana, Finanzas». */
  label: string;
  disabled?: boolean;
}) {
  return (
    <Segmented
      label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={LEVEL_OPTIONS.map((o) => ({ ...o, accessibilityLabel: `${o.label}, ${label}` }))}
    />
  );
}

// Inset grouped lists: a section header, rows on one rounded surface with a
// hairline between them (from the text, as the phone draws it), a footnote.

const RowPlace = createContext({ first: true });

export function ListSection({
  header,
  footer,
  children,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View className="mt-7">
      {header ? (
        typeof header === 'string' ? (
          <Text accessibilityRole="header" className="mb-2 px-4 text-footnote font-medium text-muted">
            {header}
          </Text>
        ) : (
          header
        )
      ) : null}
      <View className="overflow-hidden rounded-2xl bg-card">
        {rows.map((row, i) => (
          <RowPlace.Provider key={row.key ?? i} value={{ first: i === 0 }}>
            {row}
          </RowPlace.Provider>
        ))}
      </View>
      {footer ? <Text className="mt-2 px-4 text-footnote text-muted">{footer}</Text> : null}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  leading,
  value,
  trailing,
  chevron,
  onPress,
  tone = 'default',
  emphasis,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string | null;
  /** An icon, a logo or a ghost, left of the text. */
  leading?: ReactNode;
  /** A short value on the right, in muted text. */
  value?: string;
  trailing?: ReactNode;
  /** It opens something: the phone's chevron. */
  chevron?: boolean;
  onPress?: () => void;
  tone?: 'default' | 'danger';
  /** Something new in it: the title in semibold. */
  emphasis?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const { first } = useContext(RowPlace);
  const c = usePalette();
  const body = (
    <>
      {leading ? <View className="mr-3 items-center justify-center py-2.5">{leading}</View> : null}
      <View
        className="min-h-[52px] flex-1 flex-row items-center self-stretch pr-4"
        style={first ? undefined : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }}
      >
        <View className="flex-1 py-3">
          <Text className={`text-base ${tone === 'danger' ? 'text-no' : 'text-ink'} ${emphasis ? 'font-semibold' : ''}`} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text className="mt-0.5 text-footnote text-muted" numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {value ? (
          <Text className="ml-3 text-base text-muted" numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {trailing ? <View className="ml-3">{trailing}</View> : null}
        {chevron ? (
          <View className="ml-2">
            <Icon icon={CaretRight} size={15} color={c.muted} weight="bold" />
          </View>
        ) : null}
      </View>
    </>
  );
  const row = 'flex-row items-center pl-4';
  if (!onPress)
    return (
      <View testID={testID} className={row}>
        {body}
      </View>
    );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : title)}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      className={`${row} active:bg-sunk`}
    >
      {body}
    </Pressable>
  );
}

/** An icon on a soft tile, the leading of a settings row. */
export function RowIcon({ icon, tone = 'default' }: { icon: IconComponent; tone?: 'default' | 'danger' }) {
  const c = usePalette();
  return (
    <View className="h-8 w-8 items-center justify-center rounded-lg bg-sunk">
      <Icon icon={icon} size={19} color={tone === 'danger' ? c.no : c.ink} weight="regular" />
    </View>
  );
}

/** A big tappable card for one of a few ways forward: an icon, a title and a line under it. */
export function Choice({
  title,
  body,
  icon,
  onPress,
}: {
  title: string;
  body: string;
  icon?: IconComponent;
  onPress: () => void;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      className="mb-3 flex-row items-center rounded-2xl bg-card p-4 active:opacity-80"
    >
      {icon ? (
        <View className="mr-4 h-11 w-11 items-center justify-center rounded-xl bg-sunk">
          <Icon icon={icon} size={24} />
        </View>
      ) : null}
      <View className="flex-1">
        <Text className="font-display-medium text-[17px] text-ink">{title}</Text>
        <Text className="mt-0.5 text-footnote text-muted">{body}</Text>
      </View>
      <View className="ml-3">
        <Icon icon={CaretRight} size={15} color={c.muted} weight="bold" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The chosen segment lifts off its track, as the phone's own control does.
  raised: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
});
