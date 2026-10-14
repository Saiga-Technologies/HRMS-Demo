import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';

const DEMO = [
  { label: 'HR admin', email: 'hr@acme.example' },
  { label: 'Manager', email: 'manager@acme.example' },
  { label: 'Employee', email: 'employee@acme.example' },
];

export default function Login() {
  const { login, company } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as any;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand large">
          <span className="brand-logo">{company.logo_text || 'H'}</span>
          <div>
            <div className="brand-name">{company.name || 'HRMS'}</div>
            <small>{company.tagline || 'Human resource management'}</small>
          </div>
        </div>
        <h1>Sign in</h1>
        <form onSubmit={submit} className="stack">
          <Field label="Email" required>
            <Input type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
          </Field>
          <Field label="Password" required>
            <Input type="password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          <Button type="submit" variant="primary" loading={busy} data-testid="login-submit">Sign in</Button>
        </form>
        <div className="demo-logins">
          <small>Demo accounts (password <code>Password123!</code>):</small>
          <div className="demo-row">
            {DEMO.map((d) => (
              <button key={d.email} type="button" className="pill" onClick={() => { setEmail(d.email); setPassword('Password123!'); }}>{d.label}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
