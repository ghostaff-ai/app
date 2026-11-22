import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { ListSection } from '@/components/ui';

/** A section of connection rows: one grouped list on a phone, a grid of three cards on a desktop. */
export function Group({ desktop, header, footer, children }: { desktop: boolean; header: string; footer?: string; children: ReactElement[] }) {
  if (!desktop)
    return (
      <ListSection header={header} footer={footer}>
        {children}
      </ListSection>
    );
  return (
    <View className="mt-7">
      <Text accessibilityRole="header" className="mb-2 px-4 text-footnote font-medium text-muted">
        {header}
      </Text>
      <View className="-mx-1.5 flex-row flex-wrap">
        {children.map((row) => (
          <View key={row.key} style={{ width: '33.333%' }} className="p-1.5">
            <View className="overflow-hidden rounded-2xl bg-card">{row}</View>
          </View>
        ))}
      </View>
      {footer ? <Text className="mt-2 px-4 text-footnote text-muted">{footer}</Text> : null}
    </View>
  );
}
