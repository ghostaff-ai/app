import { router } from 'expo-router';
import { MemoryList } from '@/components/memory/MemoryList';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useTabScreenTop } from '@/lib/tabs';

// «Memoria de la empresa», in Empresa (business-brain.md; agent-memory.md, The screens): what
// Secretaría filed from what people dropped in her chat, the latest changed first. Every member sees
// it; a file opens on its own screen (/memoria/[...path]), the same one a reply's link opens.

export default function MemoriaDeLaEmpresa() {
  const { active } = useActiveOrg();
  const top = useTabScreenTop();
  return (
    <MemoryList
      source={active ? { orgId: active.id } : null}
      title="Memoria de la empresa"
      subtitle="Lo que Secretaría ha guardado. Lo ve todo el equipo."
      empty={{ title: 'Aún no hay nada guardado', body: 'Cuéntale a Secretaría lo que quieras que recuerde, o pásale un enlace o una nota de voz.' }}
      top={top}
      onOpen={(path) => router.push(`/memoria/${path}`)}
    />
  );
}
