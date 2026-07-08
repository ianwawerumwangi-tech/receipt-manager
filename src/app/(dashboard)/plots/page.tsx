import { getSession } from '@/lib/auth';
import { PlotsClient } from './PlotsClient';
import { getPlots } from '@/actions/plot.actions';

export default async function PlotsPage() {
  const session = await getSession();
  const plots = await getPlots();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Plots</h1>
          <p className="text-muted-foreground">{plots.length} plots</p>
        </div>
      </div>

      <PlotsClient plots={plots as any} isAdmin={session?.role === 'admin'} />
    </div>
  );
}
