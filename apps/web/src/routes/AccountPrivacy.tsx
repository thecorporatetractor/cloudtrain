import { AlertTriangle, CheckCircle2, Download, ExternalLink, Hand, KeyRound, PauseCircle, ShieldCheck, Trash2, Undo2, UserPen } from 'lucide-react';
import { useState } from 'react';
import { reauthUrl, useAccountPrivacy, useAdminPrivacy, useCloseAccount, useDeleteAccount, useDownloadMyData, useLedgerView, useObjection, useRestriction, useWithdrawConsent } from '@/api/privacy';
import type { AccountCloseResponse, AccountDeleteResponse, AccountPrivacySummary, LedgerView, ObjectionProcessing } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { Badge, Button, Card, ErrorState, Field, Input, PageSkeleton, Textarea } from '@/components/ui';
import { formatDate } from '@/lib/utils';

/*
 * `/account/privacy`: the person's data-subject rights. Copy states what stays and why before anything
 * is pressed, and a sole admin or a paying subscriber is told what to do first rather than
 * being offered a button that would fail. `/platform/privacy`: completed requests from the
 * ledger, with no identifiers.
 */

const inputIds = (ids: { id: string; describedBy?: string; invalid: boolean }) => ({ id: ids.id, ...(ids.describedBy ? { 'aria-describedby': ids.describedBy } : {}), ...(ids.invalid ? { 'aria-invalid': true as const } : {}) });

export interface PrivacySectionProps {
  summary: AccountPrivacySummary;
  confirmEmail: string;
  deleting?: boolean;
  downloading?: boolean;
  withdrawing?: boolean;
  deleteError?: string;
  restricting?: boolean;
  objecting?: boolean;
  objected?: { requestId: string; contact: string };
  onConfirmEmail: (v: string) => void;
  onRestrict: (on: boolean) => void;
  onObject: (processing: ObjectionProcessing, note: string) => void;
  onDownload: () => void;
  onWithdraw: () => void;
  onDelete: () => void;
  closing?: boolean;
  onClose: () => void;
}

/** Presentational, so tests can render each state. */
export function PrivacySection({ summary, confirmEmail, deleting, downloading, withdrawing, deleteError, restricting, objecting, objected, closing, onConfirmEmail, onRestrict, onObject, onDownload, onWithdraw, onDelete, onClose }: PrivacySectionProps) {
  const blocked = summary.blockers.length > 0;
  const signInAgain = (
    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
      <p className="muted small">For your safety we ask you to sign in again first.</p>
      <div>
        <a className="btn btn-secondary btn-sm" href={reauthUrl(summary.email)}>
          <KeyRound size={13} aria-hidden /> Sign in again
        </a>
      </div>
    </div>
  );
  const matches = confirmEmail.trim().toLowerCase() === summary.email.toLowerCase();
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Card>
        <h2 className="h3">
          <Download size={16} aria-hidden /> Download my data
        </h2>
        <p className="muted small">A JSON file with your profile, memberships, lab and exam history, answers, billing records and your activity log, across every organisation you belong to.</p>
        {summary.recentSignIn ? (
          <Button variant="secondary" loading={!!downloading} onClick={onDownload} icon={<Download size={14} />}>
            Download my data
          </Button>
        ) : (
          signInAgain
        )}
      </Card>

      <Card>
        <h2 className="h3">
          <UserPen size={16} aria-hidden /> Correct my details
        </h2>
        <p className="small">
          {summary.name} &middot; {summary.email}
        </p>
        {summary.rectification.managedBy === 'identity_account' ? (
          <>
            <p className="muted small">Your name and email address come from your sign-in account, so you correct them there. The change reaches CloudTrain the next time you sign in.</p>
            {summary.rectification.url && (
              <a className="btn btn-secondary btn-sm" href={summary.rectification.url} target="_blank" rel="noopener noreferrer">
                Open my sign-in account <ExternalLink size={13} aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </>
        ) : (
          <p className="muted small">Your name and email address come from {summary.rectification.organisation ?? 'your organisation'}'s identity provider, so only your organisation can correct them. Ask your administrator. The change reaches CloudTrain the next time you sign in.</p>
        )}
        <p className="muted small">
          Anything else wrong, such as a job title or a lab result? Write to <a href={`mailto:${summary.contact}`}>{summary.contact}</a>.
        </p>
      </Card>

      <Card>
        <h2 className="h3">
          <PauseCircle size={16} aria-hidden /> Restrict processing
        </h2>
        {summary.restrictedAt ? (
          <>
            <p className="small" role="status">
              <Badge tone="warn">Restricted</Badge> since {formatDate(summary.restrictedAt)}. You cannot start labs or exams, and we keep your data without using it for reports.
            </p>
            <Button variant="secondary" loading={!!restricting} onClick={() => onRestrict(false)}>
              Lift the restriction
            </Button>
          </>
        ) : (
          <>
            <p className="muted small">If you dispute the accuracy of your data, or need it kept but not used, we can hold it without processing it further. Any running lab ends and you cannot start labs or exams. Team dashboards and progress exports leave you out. Your administrators can still see that your account exists, and the security log keeps recording your sign-ins. You can lift this at any time.</p>
            <Button variant="secondary" loading={!!restricting} onClick={() => onRestrict(true)}>
              Restrict processing
            </Button>
          </>
        )}
      </Card>

      <ObjectionCard {...(objected ? { objected } : {})} {...(objecting ? { objecting } : {})} onObject={onObject} />

      <Card>
        <h2 className="h3">
          <Undo2 size={16} aria-hidden /> Withdraw consent
        </h2>
        {summary.waitlistEntry ? (
          <>
            <p className="muted small">You are on our early-access waitlist, which rests on your consent. Withdrawing it erases that entry. Your account is not affected.</p>
            <Button variant="secondary" loading={!!withdrawing} onClick={onWithdraw}>
              Withdraw consent
            </Button>
          </>
        ) : (
          <p className="muted small">Nothing in your account rests on consent at the moment: labs and exams are the service you signed up for, or that your organisation provides. Cookie choices are in the website footer.</p>
        )}
      </Card>

      <Card>
        <h2 className="h3">
          <Trash2 size={16} aria-hidden /> Delete my account
        </h2>
        <p className="small">This cannot be undone. It ends any running lab or exam, removes you from every organisation, deletes your sign-in and your payment-provider customer record, and erases your lab history, exam results, answers and profile.</p>
        <p className="muted small">If your organisation signs you in through its own identity provider, your account there stays, and signing in again could create a new CloudTrain account.</p>
        <h3 className="small" style={{ marginTop: 12 }}>
          What stays, and why
        </h3>
        <ul className="muted small" style={{ paddingLeft: 18 }}>
          {summary.retained.map((r) => (
            <li key={r.category}>{r.explanation}</li>
          ))}
        </ul>
        {!summary.recentSignIn ? (
          signInAgain
        ) : blocked ? (
          <div role="alert" className="stack" style={{ gap: 8, marginTop: 12 }}>
            <p className="small row" style={{ gap: 6 }}>
              <AlertTriangle size={14} aria-hidden /> Your account cannot be deleted yet:
            </p>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {summary.blockers.map((b) => (
                <li key={b.code}>{b.message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="stack" style={{ gap: 10, marginTop: 12, maxWidth: 420 }}>
            <Field label={`Type ${summary.email} to confirm`} {...(deleteError ? { error: deleteError } : {})}>
              {(ids) => <Input {...inputIds(ids)} value={confirmEmail} autoComplete="off" onChange={(e) => onConfirmEmail(e.target.value)} />}
            </Field>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button variant="danger" disabled={!matches} loading={!!deleting} onClick={onDelete} icon={<Trash2 size={14} />}>
                Delete my account
              </Button>
              <Button variant="secondary" disabled={!matches} loading={!!closing} onClick={onClose}>
                Close my account
              </Button>
            </div>
            <p className="muted small">{summary.closureDays ? `Closing ends your access now and deletes everything the same way after ${summary.closureDays} days. Until then we can reopen it if you write to ${summary.contact}. Download your data first: you cannot sign in once it is closed.` : `Closing ends your access now and keeps your data until you ask us to delete it. Write to ${summary.contact} to reopen it. Download your data first: you cannot sign in once it is closed.`}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

const OBJECTIONS: { value: ObjectionProcessing; label: string }[] = [
  { value: 'security_log', label: 'The security and audit log of my activity' },
  { value: 'progress_reporting', label: 'Reports of my progress to managers and instructors' },
  { value: 'observation', label: 'Instructors observing my lab terminal' },
  { value: 'other', label: 'Something else' },
];

function ObjectionCard({ objecting, objected, onObject }: { objecting?: boolean; objected?: { requestId: string; contact: string }; onObject: (processing: ObjectionProcessing, note: string) => void }) {
  const [processing, setProcessing] = useState<ObjectionProcessing>('progress_reporting');
  const [note, setNote] = useState('');
  return (
    <Card>
      <h2 className="h3">
        <Hand size={16} aria-hidden /> Object to processing
      </h2>
      {objected ? (
        <p className="small" role="status">
          We received your objection and emailed you a confirmation. A person from {objected.contact} will answer within a month. Nothing changes until then.
        </p>
      ) : (
        <>
          <p className="muted small">Some processing rests on legitimate interest rather than on your contract. You can object to it. A person reviews each objection and answers within a month; nothing changes automatically.</p>
          <div className="stack" style={{ gap: 10, maxWidth: 520 }}>
            <Field label="What do you object to?">{(ids) => (
              <select {...inputIds(ids)} className="input" value={processing} onChange={(e) => setProcessing(e.target.value as ObjectionProcessing)}>
                {OBJECTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}</Field>
            <Field label="Why? (optional)">{(ids) => <Textarea {...inputIds(ids)} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <div>
              <Button variant="secondary" loading={!!objecting} onClick={() => onObject(processing, note)}>
                Send my objection
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

export function ClosedNotice({ result }: { result: AccountCloseResponse }) {
  return (
    <Card role="status">
      <h2 className="h3 row" style={{ gap: 8 }}>
        <CheckCircle2 size={16} aria-hidden /> Your account is closed
      </h2>
      <p className="small">You have been signed out. {result.deleteAfter ? `We will delete your data on or after ${formatDate(result.deleteAfter)}.` : 'Your data stays until you ask us to delete it.'} We have emailed you the details.</p>
      <a className="btn btn-secondary btn-md" href="/">
        Close
      </a>
    </Card>
  );
}

/** After the request: `pending` does not claim anything is gone yet. */
export function DeletedNotice({ result }: { result: AccountDeleteResponse }) {
  const pending = result.status === 'pending';
  return (
    <Card role="status">
      <h2 className="h3 row" style={{ gap: 8 }}>
        {pending ? <AlertTriangle size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
        {pending ? 'Your deletion is in progress' : 'Your account has been deleted'}
      </h2>
      <p className="small">
        {pending
          ? 'You have been signed out and your access has ended, but the deletion is not finished yet. We keep trying and will email you when it is complete. You do not need to do anything.'
          : 'We have recorded that this was done, in a record that does not contain your email address or name.'}
      </p>
      <ul className="muted small" style={{ paddingLeft: 18 }}>
        {result.retained.map((r) => (
          <li key={r.category}>{r.explanation}</li>
        ))}
      </ul>
      <a className="btn btn-secondary btn-md" href="/">
        Close
      </a>
    </Card>
  );
}

export function AccountPrivacy() {
  const q = useAccountPrivacy();
  const { toast } = useShell();
  const download = useDownloadMyData();
  const withdraw = useWithdrawConsent();
  const del = useDeleteAccount();
  const close = useCloseAccount();
  const restriction = useRestriction();
  const objection = useObjection();
  const [confirmEmail, setConfirmEmail] = useState('');
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, tone: 'err' });

  let body;
  if (del.data) body = <DeletedNotice result={del.data} />;
  else if (close.data) body = <ClosedNotice result={close.data} />;
  else if (q.isPending) body = <PageSkeleton />;
  else if (q.isError) body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  else {
    body = (
      <PrivacySection
        summary={q.data}
        confirmEmail={confirmEmail}
        deleting={del.isPending}
        downloading={download.isPending}
        withdrawing={withdraw.isPending}
        restricting={restriction.isPending}
        objecting={objection.isPending}
        {...(objection.data ? { objected: { requestId: objection.data.requestId, contact: objection.data.contact } } : {})}
        onRestrict={(on) =>
          restriction.mutate(on, {
            onSuccess: (r) => toast(on ? { title: 'Processing restricted', ...(r.endedLabs ? { description: `${r.endedLabs} running lab${r.endedLabs === 1 ? '' : 's'} ended.` } : {}), tone: 'ok' } : { title: 'Restriction lifted', tone: 'ok' }),
            onError: fail('Could not change the restriction'),
          })
        }
        onObject={(processing, note) => objection.mutate({ processing, ...(note.trim() ? { note: note.trim() } : {}) }, { onError: fail('Could not send your objection') })}
        {...(del.error ? { deleteError: del.error.message } : {})}
        onConfirmEmail={setConfirmEmail}
        onDownload={() => download.mutate(undefined, { onSuccess: () => toast({ title: 'Your data has been downloaded', tone: 'ok' }), onError: fail('Could not download your data') })}
        onWithdraw={() =>
          withdraw.mutate(undefined, {
            onSuccess: (r) => toast(r.status === 'completed' ? { title: 'Consent withdrawn', description: 'Your waitlist entry has been erased.', tone: 'ok' } : { title: 'Still in progress', description: 'It is not finished yet. We will email you when it is complete.', tone: 'neutral' }),
            onError: fail('Could not withdraw consent'),
          })
        }
        onDelete={() => del.mutate(confirmEmail)}
        closing={close.isPending}
        onClose={() => close.mutate(confirmEmail, { onError: fail('Could not close your account') })}
      />
    );
  }
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Account</div>
          <h1>Privacy</h1>
          <p className="muted">Get a copy of your data, correct it, limit or object to how it is used, or delete your account.</p>
        </div>
      </header>
      {body}
    </div>
  );
}

export function LedgerTable({ view }: { view: LedgerView }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card>
        <p className="small row" style={{ gap: 8 }}>
          <ShieldCheck size={16} aria-hidden />
          <Badge tone={view.chain.ok ? 'ok' : 'err'}>{view.chain.ok ? 'Chain verifies' : `${view.chain.problems} problem(s)`}</Badge>
          {view.chain.count} records, newest {view.chain.headSeq}
        </p>
        <p className="xs subtle mono" style={{ overflowWrap: 'anywhere' }}>
          {view.chain.headHash}
        </p>
      </Card>
      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Actor</th>
              <th>Completed</th>
              <th>Systems</th>
            </tr>
          </thead>
          <tbody>
            {view.requests.map((r) => (
              <tr key={r.requestId}>
                <td>{r.seq}</td>
                <td>
                  {r.type}
                  {r.reason ? ` (${r.reason})` : ''}
                </td>
                <td>{r.scope}</td>
                <td>{r.actor}</td>
                <td>{formatDate(r.completedAt)}</td>
                <td className="xs">{r.outcomes.map((o) => `${o.system}: ${o.action} ${o.rows}`).join(', ') || 'nothing held'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** For someone who cannot act themselves: a deactivated user who wrote in, or a closed account to reopen. */
function AdminRequestCard() {
  const { erase, reopen } = useAdminPrivacy();
  const { toast } = useShell();
  const [email, setEmail] = useState('');
  const [again, setAgain] = useState('');
  const same = !!email.trim() && email.trim().toLowerCase() === again.trim().toLowerCase();
  return (
    <Card>
      <h2 className="h3">Act on a request by mail</h2>
      <p className="muted small">Erase someone with no active membership, such as a deactivated user who wrote to us. The address is not stored in the ledger, and the person is told by email. Anyone with an active membership erases their own account.</p>
      <div className="stack" style={{ gap: 10, maxWidth: 420 }}>
        <Field label="Their email address">{(ids) => <Input {...inputIds(ids)} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Type it again to confirm">{(ids) => <Input {...inputIds(ids)} autoComplete="off" value={again} onChange={(e) => setAgain(e.target.value)} />}</Field>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="danger"
            disabled={!same}
            loading={erase.isPending}
            onClick={() =>
              erase.mutate(
                { email: email.trim(), confirmEmail: again.trim() },
                {
                  onSuccess: (r) => {
                    toast(r.status === 'completed' ? { title: 'Account erased', tone: 'ok' } : { title: 'Erasure in progress', description: 'It is not finished yet. It carries on by itself.', tone: 'neutral' });
                    setEmail('');
                    setAgain('');
                  },
                  onError: (e) => toast({ title: 'Could not erase', description: e.message, tone: 'err' }),
                },
              )
            }
          >
            Erase this account
          </Button>
          <Button variant="secondary" disabled={!same} loading={reopen.isPending} onClick={() => reopen.mutate(email.trim(), { onSuccess: () => toast({ title: 'Account reopened', tone: 'ok' }), onError: (e) => toast({ title: 'Could not reopen', description: e.message, tone: 'err' }) })}>
            Reopen a closed account
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function PlatformPrivacy() {
  const q = useLedgerView();
  return (
    <RequireAccess path="/platform/privacy">
      <div className="stack" style={{ gap: 16 }}>
        <AdminRequestCard />
        {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <LedgerTable view={q.data} />}
      </div>
    </RequireAccess>
  );
}
