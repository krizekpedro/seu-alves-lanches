import { useState } from 'react';
import type { Session } from './api';
import { LoginPage } from './pages/Login';
import { KdsPage } from './pages/Kds';

const KEY = 'seualves.session';

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);

  const onLogin = (s: Session) => {
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* modo privado */ }
    setSession(s);
  };
  const onLogout = () => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    setSession(null);
  };

  if (!session) return <LoginPage onLogin={onLogin} />;
  return <KdsPage session={session} onLogout={onLogout} />;
}
