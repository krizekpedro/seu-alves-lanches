import { useCallback, useEffect, useState } from 'react';
import { slaStatus, type OrderStatus } from '@seu-alves/shared';
import { api, type Session } from '../api';

interface KdsOrder {
  id: string;
  shortNumber: number;
  channel: string;
  type: string;
  status: OrderStatus;
  createdAt: string;
  acceptedAt: string | null;
  items: { id: string; name: string; quantity: number; note: string | null; options: { name: string }[] }[];
}

const CHANNEL: Record<string, { label: string; cls: string }> = {
  IFOOD: { label: 'iFood', cls: 'bg-ch-ifood' },
  CARDAPIO: { label: 'Cardápio', cls: 'bg-ch-cardapio' },
  WHATSAPP: { label: 'WhatsApp', cls: 'bg-ch-whatsapp' },
  BALCAO: { label: 'Balcão', cls: 'bg-ch-balcao' },
  OLACLICK: { label: 'OlaClick', cls: 'bg-zinc-300' },
};
const TYPE: Record<string, string> = { ENTREGA: 'Entrega', RETIRADA: 'Retirada', MESA: 'Mesa', BALCAO: 'Balcão' };
const COLOR = { ok: 'border-ok text-ok', atencao: 'border-warn text-warn', atrasado: 'border-late text-late' } as const;

const minutesSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

export function KdsPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [error, setError] = useState('');
  const storeId = session.user.storeId;

  const load = useCallback(async () => {
    try {
      setOrders(await api<KdsOrder[]>(`/stores/${storeId}/orders?status=CRIADO,CONFIRMADO,EM_PREPARO`, {}, session));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [storeId, session]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000); // tempo real por WebSocket entra na Fase 1
    return () => clearInterval(t);
  }, [load]);

  const move = async (o: KdsOrder) => {
    const steps: OrderStatus[] = o.status === 'CRIADO' ? ['CONFIRMADO', 'EM_PREPARO'] : o.status === 'CONFIRMADO' ? ['EM_PREPARO', 'PRONTO'] : ['PRONTO'];
    for (const to of steps) await api(`/orders/${o.id}/status`, { method: 'POST', body: JSON.stringify({ to }) }, session);
    await load();
  };

  const pending = orders.filter((o) => o.status === 'CRIADO');
  const sorted = [...pending, ...orders.filter((o) => o.status !== 'CRIADO')];

  return (
    <div className="min-h-screen px-4 py-5 md:px-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Cozinha · fila de preparo</h1>
          <p className="text-sm text-zinc-400">
            <strong className="text-cream">{pending.length}</strong> aguardando aceite · <strong className="text-white">{orders.length - pending.length}</strong> em preparo
          </p>
        </div>
        <button onClick={onLogout} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-semibold">
          {session.user.name} · Trocar usuário
        </button>
      </header>
      {error && <div role="alert" className="mb-4 rounded-xl bg-late/15 px-4 py-3 text-sm text-red-300">{error}</div>}
      {sorted.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 bg-surface p-12 text-center text-zinc-400">Fila zerada. Bom trabalho, cozinha!</div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
        {sorted.map((o) => {
          const isNew = o.status === 'CRIADO';
          const mins = minutesSince(isNew ? o.createdAt : (o.acceptedAt ?? o.createdAt));
          const sla = isNew ? slaStatus(mins, 2) : slaStatus(mins, 15);
          const ch = CHANNEL[o.channel] ?? { label: o.channel, cls: 'bg-zinc-300' };
          return (
            <article key={o.id} className={`flex flex-col gap-3 rounded-2xl border border-t-[6px] border-white/10 bg-surface p-4 ${isNew ? 'border-t-cream' : COLOR[sla].split(' ')[0]}`}>
              <div className="flex items-center justify-between">
                <span className="num font-display text-2xl font-extrabold">#{o.shortNumber}</span>
                <span className={`num font-bold ${isNew ? 'text-cream' : COLOR[sla].split(' ')[1]}`}>{isNew ? `chegou há ${mins} min` : `${mins} min`}</span>
              </div>
              <span className={`self-start rounded-md px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider ${isNew ? 'bg-cream text-base' : 'bg-gold/15 text-amber-200'}`}>
                {isNew ? 'Novo · aguardando aceite' : 'Em preparo'}
              </span>
              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold text-base ${ch.cls}`}>{ch.label}</span>
                <span className="rounded-full bg-surface2 px-2.5 py-1 text-xs font-semibold text-cream">{TYPE[o.type] ?? o.type}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {o.items.map((i) => (
                  <li key={i.id}>
                    <div className="font-semibold">{i.quantity}× {i.name}</div>
                    {(i.options.length > 0 || i.note) && (
                      <div className="text-sm text-gold-soft">{[...i.options.map((x) => `+ ${x.name}`), i.note].filter(Boolean).join(' · ')}</div>
                    )}
                  </li>
                ))}
              </ul>
              <button onClick={() => void move(o)} className={`mt-auto min-h-13 rounded-xl py-3.5 font-extrabold text-base ${isNew ? 'bg-cream' : 'bg-gold'}`}>
                {isNew ? 'Aceitar e começar' : 'Pronto'}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
