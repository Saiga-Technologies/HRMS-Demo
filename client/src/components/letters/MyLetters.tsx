import React, { useState } from 'react';
import { fmtDate } from '../../lib/format';
import { Button, Card, EmptyState, Table, useToast } from '../ui';
import { Icon } from '../Icons';
import { Letter, LetterDetailModal, LetterStatusBadge, downloadLetter, letterRef } from './shared';

/** The signed-in employee's own letters: status of requests and downloads of generated PDFs. */
export function MyLetters({ letters, loading, onRequest }: { letters: Letter[]; loading: boolean; onRequest?: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState<number | null>(null);
  const ready = letters.filter((l) => l.status === 'generated').length;
  const waiting = letters.filter((l) => l.status === 'requested' || l.status === 'approved').length;
  return (
    <>
      <Card padded={false} tour="letters-mine"
        title={<span>My letters <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{ready} ready · {waiting} in progress</span></span>}>
        <Table<Letter>
          loading={loading && !letters.length}
          rows={letters}
          onRowClick={(l) => setOpen(l.id)}
          empty={<EmptyState title="No letters yet" description="Request an experience, salary or address proof letter and download the PDF here once HR has generated it." action={onRequest ? <Button variant="primary" onClick={onRequest}>Request a letter</Button> : undefined} />}
          columns={[
            { key: 'title', header: 'Letter', render: (l) => <span data-testid="my-letter-row"><strong>{l.title}</strong><div className="muted mono">{letterRef(l)}</div></span> },
            { key: 'status', header: 'Status', render: (l) => <LetterStatusBadge status={l.status} /> },
            { key: 'created_at', header: 'Requested', render: (l) => fmtDate(l.created_at) },
            { key: 'note', header: 'Note from HR', render: (l) => l.note ? <span className="muted">{l.note}</span> : <span className="muted">—</span> },
            {
              key: 'actions', header: '', align: 'right', render: (l) => l.status === 'generated' ? (
                <Button size="sm" variant="primary" data-testid="my-letter-download" onClick={(e) => { e.stopPropagation(); downloadLetter(l).then(() => toast.success('Download started')).catch((err) => toast.error(err)); }}>
                  <Icon name="download" size={14} /> PDF
                </Button>
              ) : null,
            },
          ]}
        />
      </Card>
      {open ? <LetterDetailModal id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
