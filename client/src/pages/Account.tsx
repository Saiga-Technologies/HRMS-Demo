import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { Button, Card, Field, Input, PageHeader, useToast } from '../components/ui';
import { useNavigate } from 'react-router-dom';

export default function Account() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const mustChange = !!user?.must_change_password;
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  usePageTour('Account', [
    { title: 'Your account', description: 'Your sign-in settings. The flow: confirm which account you are signed in as, then change your password: current password, new password, confirm, update.' },
    { element: '[data-tour="account-header"]', title: 'Signed in as', description: 'The email under the title is your user ID for signing in. HR set it when your login was created; ask HR if it needs to change.' },
    { element: '[data-tour="account-must-change"]', title: 'Temporary password', description: 'You signed in with a temporary password from HR. Until you choose your own, every page brings you back here.' },
    { element: '[data-tour="password-form"]', title: 'Change password', description: 'Do this the first time you sign in, and whenever you think someone else may know your password.' },
    { element: '[data-tour="account-current"]', title: 'Current password', description: 'The password you signed in with today (the temporary one from HR, if this is your first sign-in). It proves the change is really you.' },
    { element: '[data-tour="account-new"]', title: 'New password', description: 'At least 8 characters. A short phrase with a number is easy to remember and hard to guess.' },
    { element: '[data-tour="account-confirm"]', title: 'Confirm it', description: 'Type the new password again so a typo does not lock you out.' },
    { element: '[data-tour="account-submit"]', title: 'Update password', description: 'Saves the new password straight away; use it the next time you sign in. After a first-time change you are taken to your dashboard.' },
    { element: '[data-testid="user-menu"]', title: 'Find this page again', description: 'Open your name in the top bar and choose Change password to come back here at any time. Sign out is in the same menu.' },
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
      if (mustChange) navigate('/', { replace: true });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader tour="account-header" title="My account" subtitle={user?.email} />
      {mustChange ? <div className="alert alert-warning" style={{ marginBottom: 16 }} data-testid="must-change-password" data-tour="account-must-change">You signed in with a temporary password. Choose your own password to continue.</div> : null}
      <Card title="Change password" tour="password-form" className="narrow">
        <form onSubmit={submit} className="stack">
          <div data-tour="account-current"><Field label="Current password" required><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></Field></div>
          <div data-tour="account-new"><Field label="New password" required hint="At least 8 characters"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required /></Field></div>
          <div data-tour="account-confirm"><Field label="Confirm new password" required><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></Field></div>
          <div><Button type="submit" variant="primary" loading={busy} data-tour="account-submit">Update password</Button></div>
        </form>
      </Card>
    </>
  );
}
