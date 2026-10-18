import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, useCatalog } from '@/api/client';
import type { CreateCtfEventRequest, CtfEventDetail } from '@/api/types';
import { Button, Checkbox, Field, Input, Segmented, Switch, Textarea } from '@/components/ui';

/** datetime-local value (local time) from an ISO string, and back. */
const toLocal = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '');

function defaults(): CreateCtfEventRequest {
  const start = new Date(Date.now() + 24 * 3600_000);
  start.setMinutes(0, 0, 0);
  return {
    title: '',
    description: '',
    labIds: [],
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3 * 3600_000).toISOString(),
    mode: 'team',
    teamSizeMax: 4,
    teamFormation: 'self',
    scoring: 'dynamic',
    dynamicMinPct: 30,
    dynamicDecay: 10,
    firstBlood: true,
    freezeMinutes: 30,
    published: false,
  };
}

/**
 * Create or edit a CTF event: labs, window, solo or teams, scoring, first
 * bloods and the scoreboard freeze. Server validation errors (422 details)
 * are shown on their fields.
 */
export function EventForm({ initial, submitLabel, busy, onSubmit, onCancel }: { initial?: CtfEventDetail; submitLabel: string; busy: boolean; onSubmit: (v: CreateCtfEventRequest) => Promise<unknown>; onCancel?: () => void }) {
  const catalog = useCatalog();
  const [v, setV] = useState<CreateCtfEventRequest>(() => (initial ? { ...defaults(), ...initial, description: initial.description ?? '' } : defaults()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = <K extends keyof CreateCtfEventRequest>(k: K, val: CreateCtfEventRequest[K]) => setV((x) => ({ ...x, [k]: val }));
  const ctfLabs = useMemo(() => (catalog.data?.labs ?? []).filter((l) => l.questionCount), [catalog.data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!v.title.trim()) local.title = 'Give the event a title.';
    if (!v.labIds.length) local.labIds = 'Pick at least one CTF lab.';
    if (Date.parse(v.endsAt) <= Date.parse(v.startsAt)) local.endsAt = 'The end must be after the start.';
    setErrors(local);
    setFormError(undefined);
    if (Object.keys(local).length) return;
    try {
      await onSubmit(v);
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details as Record<string, string>);
      setFormError(err instanceof Error ? err.message : 'The event could not be saved.');
    }
  };

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit} noValidate>
      <Field label="Title" required error={errors.title}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} value={v.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder="Depot gateway night" />}
      </Field>
      <Field label="Description" hint="Shown to participants (Markdown).">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} />}
      </Field>

      <fieldset className="field" aria-describedby={errors.labIds ? 'labs-err' : undefined}>
        <legend className="field-label">CTF labs</legend>
        {ctfLabs.length === 0 ? (
          <p className="small subtle">{catalog.isPending ? 'Loading labs…' : 'No CTF labs (labs with questions) are available.'}</p>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {ctfLabs.map((l) => (
              <Checkbox
                key={l.id}
                label={l.title}
                description={`${l.questionCount} questions · ${l.difficulty} · ${l.estimatedMinutes} min`}
                checked={v.labIds.includes(l.id)}
                onChange={(e) => set('labIds', e.target.checked ? [...v.labIds, l.id] : v.labIds.filter((x) => x !== l.id))}
              />
            ))}
          </div>
        )}
        {errors.labIds && (
          <div id="labs-err" className="field-error xs text-err" role="alert">
            {errors.labIds}
          </div>
        )}
      </fieldset>

      <div className="grid-2">
        <Field label="Starts" required error={errors.startsAt}>
          {({ id, describedBy, invalid }) => <Input id={id} type="datetime-local" aria-describedby={describedBy} aria-invalid={invalid || undefined} value={toLocal(v.startsAt)} onChange={(e) => set('startsAt', fromLocal(e.target.value))} />}
        </Field>
        <Field label="Ends" required error={errors.endsAt}>
          {({ id, describedBy, invalid }) => <Input id={id} type="datetime-local" aria-describedby={describedBy} aria-invalid={invalid || undefined} value={toLocal(v.endsAt)} onChange={(e) => set('endsAt', fromLocal(e.target.value))} />}
        </Field>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="field-label">Participation</span>
        <Segmented label="Participation" value={v.mode} onChange={(m) => set('mode', m)} options={[{ value: 'solo', label: 'Solo' }, { value: 'team', label: 'Teams' }]} />
      </div>
      {v.mode === 'team' && (
        <div className="grid-2">
          <Field label="Largest team" error={errors.teamSizeMax}>
            {({ id, describedBy, invalid }) => <Input id={id} type="number" min={1} max={20} aria-describedby={describedBy} aria-invalid={invalid || undefined} value={v.teamSizeMax ?? 4} onChange={(e) => set('teamSizeMax', Number(e.target.value))} />}
          </Field>
          <div className="stack" style={{ gap: 6 }}>
            <span className="field-label">Teams are formed by</span>
            <Segmented label="Teams are formed by" value={v.teamFormation ?? 'self'} onChange={(f) => set('teamFormation', f)} options={[{ value: 'self', label: 'Learners' }, { value: 'manager', label: 'Me' }]} />
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 6 }}>
        <span className="field-label">Scoring</span>
        <Segmented
          label="Scoring"
          value={v.scoring}
          onChange={(s) => set('scoring', s)}
          options={[
            { value: 'static', label: 'Static', title: 'Every question is worth its points' },
            { value: 'dynamic', label: 'Dynamic', title: 'Questions lose value as more entrants solve them' },
          ]}
        />
      </div>
      {v.scoring === 'dynamic' && (
        <div className="grid-2">
          <Field label="Minimum value (%)" hint="A question never drops below this share of its points." error={errors.dynamicMinPct}>
            {({ id, describedBy, invalid }) => <Input id={id} type="number" min={1} max={100} aria-describedby={describedBy} aria-invalid={invalid || undefined} value={v.dynamicMinPct ?? 30} onChange={(e) => set('dynamicMinPct', Number(e.target.value))} />}
          </Field>
          <Field label="Solves to reach it" hint="The value decays over this many solves." error={errors.dynamicDecay}>
            {({ id, describedBy, invalid }) => <Input id={id} type="number" min={1} max={1000} aria-describedby={describedBy} aria-invalid={invalid || undefined} value={v.dynamicDecay ?? 10} onChange={(e) => set('dynamicDecay', Number(e.target.value))} />}
          </Field>
        </div>
      )}
      <div className="grid-2">
        <Field label="Freeze the scoreboard (minutes before the end)" hint="0 = never frozen. You always see it live." error={errors.freezeMinutes}>
          {({ id, describedBy, invalid }) => <Input id={id} type="number" min={0} max={1440} aria-describedby={describedBy} aria-invalid={invalid || undefined} value={v.freezeMinutes} onChange={(e) => set('freezeMinutes', Number(e.target.value))} />}
        </Field>
        <div className="stack" style={{ gap: 10, paddingTop: 22 }}>
          <Checkbox label="First-blood markers" description="Mark the first solve of every question" checked={v.firstBlood} onChange={(e) => set('firstBlood', e.target.checked)} />
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <Switch id="event-published" label="Published" checked={v.published} onCheckedChange={(p) => set('published', p)} />
        <label htmlFor="event-published" className="small">
          Published: learners can see and join it
        </label>
      </div>

      {formError && (
        <p className="small text-err" role="alert">
          {formError}
        </p>
      )}
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
