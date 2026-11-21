import { useLocalSearchParams } from 'expo-router';
import { DecisionView } from '@/components/DecisionView';

// One decision on its own screen: on the phone, and when a desktop opens a link to it.
export default function DecisionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DecisionView id={id} />;
}
