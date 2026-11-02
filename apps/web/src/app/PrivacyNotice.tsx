import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { post } from '@/api/client';
import { useSite } from '@/api/public';
import { useBrandName } from '@/components/brand';
import { Button } from '@/components/ui';
import { hrefFor, surfaceConfig } from '@/lib/surface';

/*
 * The information notice at first sign-in (GDPR Art. 13 and 14; docs/gdpr.md). A learner added by
 * their organisation never saw the website's privacy notice, so this is where they learn who
 * processes what. It informs: nothing depends on it, and "Got it" is not a consent.
 */

export function PrivacyNoticeBody({ brand, legalName, orgName }: { brand: string; legalName?: string | undefined; orgName?: string | undefined }) {
  return (
    <div className="stack small" style={{ gap: 10 }}>
      {orgName ? (
        <p>
          <strong>{orgName}</strong> gave you access to {brand} and manages your account. It decides why your training data is used, and {legalName ?? brand} processes it for them. You may not have signed up yourself, which is why we are telling you now.
        </p>
      ) : (
        <p>{legalName ?? brand} processes your data to provide this service.</p>
      )}
      <div>
        <p className="muted">What we process:</p>
        <ul style={{ paddingLeft: 18 }}>
          <li>Your name, email address, job title and roles.</li>
          <li>Your labs, exams, answers, scores and skills.{orgName ? ` Your managers and instructors at ${orgName} can see your progress.` : ''}</li>
          <li>Your lab terminal. An instructor can watch it read-only, and you see a banner while they do.</li>
          <li>Sign-ins and activity, with your IP address, for security.</li>
          <li>Your plan and usage, if you pay yourself. Our payment provider handles card details.</li>
        </ul>
      </div>
      <p>
        Read the <a style={{ textDecoration: 'underline' }} href={hrefFor(surfaceConfig, '/legal/privacy')}>privacy notice</a>. Under <a style={{ textDecoration: 'underline' }} href="/account/privacy">Privacy</a> in your account you can download or correct your data, restrict or object to processing, or delete your account.
      </p>
    </div>
  );
}

export function PrivacyNoticeDialog({ version, orgName }: { version: string; orgName?: string | undefined }) {
  const [open, setOpen] = useState(true);
  const brand = useBrandName();
  const site = useSite();
  const qc = useQueryClient();
  const ack = useMutation({ mutationFn: () => post<void>('/api/me/privacy/notice', { version }), onSettled: () => void qc.invalidateQueries({ queryKey: ['me'] }) });
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog" style={{ width: 560, maxWidth: 'calc(100vw - 32px)' }} aria-describedby={undefined}>
          <div className="dialog-header">
            <DialogPrimitive.Title className="dialog-title">How {brand} uses your data</DialogPrimitive.Title>
          </div>
          <PrivacyNoticeBody brand={brand} legalName={site.data?.brand.legalName} orgName={orgName} />
          <div className="dialog-actions">
            <Button
              variant="primary"
              loading={ack.isPending}
              onClick={() =>
                ack.mutate(undefined, {
                  // It was shown either way; if the record failed, it shows once more next time.
                  onSettled: () => setOpen(false),
                })
              }
            >
              Got it
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
