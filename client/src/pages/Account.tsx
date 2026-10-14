import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { Button, Card, Field, Input, PageHeader, useToast } from '../components/ui';

export default function Account() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  usePageTour('Account', [
    { element: '[data-tour="password-form"]', title: 'Change your password', description: 'Enter your current password and a new one of at least 8 characters.' },
  ]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return toast.error('New passwords do not match');
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { current_password: current, new_password: next });
      toast.success('Password updated');
      setCurrent(''); setNext(''); setConfirm('');
      await refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="My account" subtitle={user?.email} />
      <Card title="Change password" tour="password-form" className="narrow">
        <form onSubmit={submit} className="stack">
          <Field label="Current password" required><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></Field>
          <Field label="New password" required hint="At least 8 characters"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required /></Field>
          <Field label="Confirm new password" required><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></Field>
          <div><Button type="submit" variant="primary" loading={busy}>Update password</Button></div>
        </form>
      </Card>
    </>
  );
}
