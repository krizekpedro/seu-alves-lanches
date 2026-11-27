import { useEffect, useState } from 'react';
import { api, STORE_ID, type Session } from '../api';

interface Staff { id: string; name: string; role: string }
const ROLE_LABEL: Record<string, string> = { DONO: 'Dono', GERENTE: 'Gerente', CAIXA: 'Caixa', ATENDENTE: 'Atendente', COZINHA: 'Cozinha' };
const initials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

export function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [tab, setTab] = useState<'pin' | 'email'>('pin');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [pick, setPick] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!STORE_ID) return;
    api<Staff[]>(`/auth/stores/${STORE_ID}/staff`).then(setStaff).catch(() => setStaff([]));
  }, []);

  const submitPin = async (value: string) => {
    if (!pick) return;
    setError('');
    try {
      onLogin(await api<Session>('/auth/pin', { method: 'POST', body: JSON.stringify({ userId: pick.id, storeId: STORE_ID, pin: value }) }));
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    }
  };
  const press = (k: string) => {
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submitPin(next);
  };
  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      onLogin(await api<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex min-h-screen flex-wrap">
      <section className="flex flex-[1_1_380px] flex-col justify-between gap-10 bg-wine p-8 md:p-12">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold/60 bg-base font-display text-xl font-extrabold text-cream">SA</div>
          <div>
            <div className="font-display text-xl font-extrabold text-cream">Seu Alves</div>
            <div className="text-sm text-cream-deep">Gestão de Delivery</div>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-4xl font-extrabold leading-tight text-cream">Bom turno, equipe.</h1>
          <p className="mt-3 hidden text-cream-deep md:block">Cada pessoa entra com o próprio acesso e vê só as telas da sua função.</p>
        </div>
        <span className="text-sm text-cream-deep">Loja Vila Kosmos</span>
      </section>

      <section className="flex flex-[999_1_460px] justify-center bg-base px-4 py-8 md:px-8 md:py-12">
        <div className="flex w-full max-w-xl flex-col gap-6">
          <div role="tablist" className="flex gap-1 rounded-2xl border border-white/10 bg-surface p-1">
            {(['pin', 'email'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`min-h-11 flex-1 rounded-xl text-sm font-bold ${tab === t ? 'bg-gold text-base' : 'text-zinc-300'}`}>
                {t === 'pin' ? 'Equipe da loja' : 'Dono e gerentes'}
              </button>
            ))}
          </div>

          {error && <div role="alert" className="rounded-xl bg-late/15 px-4 py-3 text-sm font-semibold text-red-300">{error}</div>}

          {tab === 'pin' ? (
            <div className="flex flex-col gap-5">
              <div>
                <h2 className="font-display text-2xl font-extrabold">Quem está entrando?</h2>
                <p className="text-sm text-zinc-400">Toque no seu nome e digite seu PIN de 4 números.</p>
              </div>
              {!STORE_ID && <p className="text-sm text-warn">Configure VITE_STORE_ID para listar a equipe.</p>}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                {staff.map((s) => (
                  <button key={s.id} onClick={() => { setPick(s); setPin(''); }}
                    className={`flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 bg-surface p-3 ${pick?.id === s.id ? 'border-gold' : 'border-white/10'}`}>
                    <span className={`flex h-11 w-11 items-center justify-center rounded-full font-extrabold ${pick?.id === s.id ? 'bg-gold text-base' : 'bg-wine text-cream'}`}>{initials(s.name)}</span>
                    <span className="font-bold">{s.name}</span>
                    <span className="text-xs text-zinc-400">{ROLE_LABEL[s.role] ?? s.role}</span>
                  </button>
                ))}
              </div>
              {pick && (
                <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-surface p-5">
                  <span>PIN de <strong className="text-gold-soft">{pick.name}</strong></span>
                  <div className="flex gap-3" aria-label="Dígitos digitados">
                    {[0, 1, 2, 3].map((i) => <span key={i} className={`h-4 w-4 rounded-full border-2 border-gold ${i < pin.length ? 'bg-gold' : ''}`} />)}
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
                      <button key={k} onClick={() => press(k)} className="h-14 w-[72px] rounded-xl border border-white/10 bg-surface2 text-2xl font-bold">{k}</button>
                    ))}
                    <button onClick={() => setPin(pin.slice(0, -1))} aria-label="Apagar" className="h-14 w-[72px] rounded-xl border border-white/10 bg-surface2 text-lg">⌫</button>
                    <button onClick={() => press('0')} className="h-14 w-[72px] rounded-xl border border-white/10 bg-surface2 text-2xl font-bold">0</button>
                    <span />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={submitEmail} className="flex flex-col gap-4">
              <h2 className="font-display text-2xl font-extrabold">Acesso do dono e gerentes</h2>
              <label className="text-sm text-zinc-300" htmlFor="email">E-mail</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-12 rounded-xl border border-white/15 bg-surface px-4" />
              <label className="text-sm text-zinc-300" htmlFor="password">Senha</label>
              <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="min-h-12 rounded-xl border border-white/15 bg-surface px-4" />
              <button type="submit" className="min-h-13 rounded-xl bg-gold py-3.5 font-extrabold text-base">Entrar</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
