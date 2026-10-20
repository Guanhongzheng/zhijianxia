import { AppShell } from '@/components/layout/app-shell';
import { Providers } from '@/components/providers';

export default function Page() {
  return (
    <Providers>
      <AppShell />
    </Providers>
  );
}
