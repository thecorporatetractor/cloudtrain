import { Check, Droplet, Lightbulb, Lock, Send, Trophy, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, useQuestions, useRevealQuestionHint, useSubmitAnswer } from '@/api/client';
import type { Question, QuestionHint, QuestionsView } from '@/api/types';
import { useShell } from '@/app/shell-context';
import { Prose } from '@/components/prose';
import { Badge, Button, ConfirmDialog, Input, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Props {
  sessionId: string | undefined;
  /** False while the environment is still being set up (answers are refused until then). */
  ready: boolean;
}

const STATE_LABEL: Record<Question['state'], string> = { open: 'open', locked: 'locked', solved: 'solved', closed: 'closed' };

/** Points chip: what the question is worth now, or what it earned. */
function PointsChip({ q }: { q: Question }) {
  if (q.state === 'solved') return <Badge tone="ok">+{q.awarded ?? 0} pts</Badge>;
  if (q.state === 'closed') return <Badge tone="neutral">0 pts</Badge>;
  return (
    <Badge tone="outline" title={q.available < q.points ? `Worth ${q.points} at full value` : undefined}>
      <span className="tnum">{q.available}</span>
      {q.available < q.points && <span className="subtle tnum"> / {q.points}</span>} pts
    </Badge>
  );
}

function attemptsText(q: Question): string {
  if (q.attemptsLeft === undefined) return 'Unlimited attempts';
  return `${q.attemptsLeft} of ${q.maxAttempts} attempt${q.maxAttempts === 1 ? '' : 's'} left`;
}

/**
 * The questions panel of a CTF lab: one answer box per question, graded on
 * submit, with remaining attempts, hints that cost points (confirmed first)
 * and the points total. Results are announced in a polite live region.
 */
export function QuestionsPanel({ sessionId, ready }: Props) {
  const { toast } = useShell();
  const view = useQuestions(sessionId);
  const submit = useSubmitAnswer(sessionId);
  const reveal = useRevealQuestionHint(sessionId);
  const [feedback, setFeedback] = useState<Record<string, { correct: boolean; message: string }>>({});
  const [announce, setAnnounce] = useState('');
  const [confirm, setConfirm] = useState<{ q: Question; hint: QuestionHint } | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<string | null>(null);

  const v = view.data;
  // After a correct answer, move focus to the question it opened.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || !v) return;
    const el = inputs.current.get(id);
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  }, [v]);

  if (!sessionId || view.isPending) {
    return (
      <section className="task-section" aria-busy="true" aria-label="Questions">
        <h2 className="task-h">Questions</h2>
        <Skeleton h={64} />
      </section>
    );
  }
  if (view.isError || !v) {
    return (
      <section className="task-section">
        <h2 className="task-h">Questions</h2>
        <p className="small text-err">{view.error instanceof Error ? view.error.message : 'The questions could not be loaded.'}</p>
      </section>
    );
  }

  const onSubmit = (q: Question, index: number, answer: string) => {
    const text = answer.trim();
    if (!text) {
      setFeedback((f) => ({ ...f, [q.id]: { correct: false, message: 'Type an answer first.' } }));
      return;
    }
    submit.mutate(
      { checkId: q.id, answer: text },
      {
        onSuccess: (r) => {
          setFeedback((f) => ({ ...f, [q.id]: { correct: r.correct, message: r.message } }));
          setAnnounce(`Question ${index + 1}: ${r.message}`);
          if (r.correct) {
            const next = r.view.questions.find((x, i) => i > index && x.state === 'open');
            pendingFocus.current = next?.id ?? null;
          }
        },
        onError: (e) => {
          const msg = e instanceof ApiError ? e.message : 'The answer could not be sent.';
          setFeedback((f) => ({ ...f, [q.id]: { correct: false, message: msg } }));
          setAnnounce(`Question ${index + 1}: ${msg}`);
          if (e instanceof ApiError && e.status === 429) toast({ title: 'Slow down', description: msg, tone: 'warn' });
        },
      },
    );
  };

  const doReveal = () => {
    if (!confirm) return;
    const { q, hint } = confirm;
    reveal.mutate(
      { checkId: q.id, index: hint.index },
      {
        onSuccess: () => {
          setConfirm(null);
          setAnnounce(`Hint ${hint.index + 1} revealed: ${hint.cost} points off this question.`);
        },
        onError: (e) => {
          setConfirm(null);
          toast({ title: 'Hint not revealed', description: e instanceof Error ? e.message : undefined, tone: 'warn' });
        },
      },
    );
  };

  return (
    <section className="task-section questions-section" aria-labelledby="questions-h">
      <div className="row-between" style={{ marginBottom: 8, gap: 8 }}>
        <h2 className="task-h" id="questions-h" style={{ margin: 0 }}>
          Questions
        </h2>
        <span className="row xs" style={{ gap: 8 }}>
          <span className="subtle tnum">
            {v.solved}/{v.total} solved
          </span>
          <Badge tone="accent" aria-label={`${v.earned} of ${v.possible} points`}>
            <Trophy size={11} aria-hidden /> <span className="tnum">{v.earned}</span>
            <span className="subtle tnum">/{v.possible}</span>
          </Badge>
        </span>
      </div>
      {v.event && (
        <p className="xs subtle questions-event">
          {v.event.title}
          {v.event.teamName ? ` · team ${v.event.teamName}: answers count for the whole team` : ''}
          {v.event.scoring === 'dynamic' ? ' · points drop as more teams solve a question' : ''}
        </p>
      )}
      {v.order === 'sequential' && <p className="xs subtle questions-order">Questions open one after another.</p>}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
      <ol className="questions">
        {v.questions.map((q, i) => (
          <QuestionItem
            key={q.id}
            q={q}
            index={i}
            view={v}
            ready={ready}
            busy={submit.isPending && submit.variables?.checkId === q.id}
            feedback={feedback[q.id]}
            inputRef={(el) => {
              if (el) inputs.current.set(q.id, el);
              else inputs.current.delete(q.id);
            }}
            onSubmit={(a) => onSubmit(q, i, a)}
            onHint={(hint) => setConfirm({ q, hint })}
          />
        ))}
      </ol>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `Reveal hint ${confirm.hint.index + 1}?` : 'Reveal hint?'}
        description={
          confirm
            ? `It costs ${confirm.hint.cost} points: this question is then worth at most ${Math.max(0, confirm.q.available - confirm.hint.cost)} points.`
            : undefined
        }
        confirmLabel={confirm ? `Reveal for ${confirm.hint.cost} points` : 'Reveal'}
        loading={reveal.isPending}
        onConfirm={doReveal}
      />
    </section>
  );
}

function QuestionItem({
  q,
  index,
  view,
  ready,
  busy,
  feedback,
  inputRef,
  onSubmit,
  onHint,
}: {
  q: Question;
  index: number;
  view: QuestionsView;
  ready: boolean;
  busy: boolean;
  feedback?: { correct: boolean; message: string };
  inputRef: (el: HTMLInputElement | null) => void;
  onSubmit: (answer: string) => void;
  onHint: (hint: QuestionHint) => void;
}) {
  const id = useId();
  const [value, setValue] = useState('');
  const metaId = `${id}-meta`;
  const fbId = `${id}-fb`;
  const titleId = `${id}-title`;
  const open = q.state === 'open';
  const wrong = feedback && !feedback.correct;
  const nextHint = q.hints.find((h) => !h.revealed);
  const event = !!view.event?.teamId;
  // Open questions list every hint; solved or closed ones only those that were revealed.
  const shownHints = q.state === 'open' ? q.hints : q.state === 'locked' ? [] : q.hints.filter((h) => h.revealed);

  const send = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(value);
  };

  return (
    <li className={cn('question', `question-${q.state}`)} aria-labelledby={titleId}>
      <div className="question-head">
        <span className="question-icon" aria-hidden>
          {q.state === 'solved' ? <Check size={12} /> : q.state === 'closed' ? <X size={12} /> : q.state === 'locked' ? <Lock size={11} /> : <span className="tnum">{index + 1}</span>}
        </span>
        <span className="grow small" id={titleId}>
          Question {index + 1}
          <span className="sr-only">, {STATE_LABEL[q.state]}</span>
        </span>
        {q.firstBlood && (
          <Badge tone="err" title="First solve of this question in the event">
            <Droplet size={10} aria-hidden /> first blood
          </Badge>
        )}
        <PointsChip q={q} />
      </div>

      <div className="question-body">
        {q.state === 'locked' ? (
          <p className="small subtle">Answer question {index} first.</p>
        ) : (
          <Prose text={q.prompt} className="small" />
        )}

        {q.state !== 'locked' && (
          <p className="xs subtle question-meta" id={metaId}>
            {q.state === 'solved'
              ? `Solved${q.solvedBy && event ? ` by ${q.solvedBy.name}` : ''}${q.wrongAttempts ? ` after ${q.wrongAttempts} wrong answer${q.wrongAttempts === 1 ? '' : 's'}` : ''}${q.hintCost ? `, hints −${q.hintCost}` : ''}.`
              : q.state === 'closed'
                ? 'No attempts left: this question is closed.'
                : `${attemptsText(q)}${q.penalty ? ` · −${q.penalty} per wrong answer` : ''}${q.hintCost ? ` · hints −${q.hintCost}` : ''}`}
          </p>
        )}

        {q.state === 'solved' && q.answer && (
          <p className="xs question-answer">
            <span className="subtle">{q.solvedBy && event ? 'Answer' : 'Your answer'}: </span>
            <code>{q.answer}</code>
          </p>
        )}

        {open && (
          <form className="question-form" onSubmit={send} noValidate>
            <label htmlFor={`${id}-input`} className="sr-only">
              Answer to question {index + 1}
            </label>
            <Input
              id={`${id}-input`}
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={q.placeholder ?? (q.input === 'number' ? 'A number' : 'Your answer')}
              inputMode={q.input === 'number' ? 'decimal' : undefined}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={512}
              disabled={!ready || busy}
              aria-invalid={wrong || undefined}
              aria-describedby={[metaId, feedback ? fbId : null].filter(Boolean).join(' ')}
            />
            <Button type="submit" variant="primary" size="sm" icon={<Send size={12} />} loading={busy} disabled={!ready || !value.trim()}>
              Submit
            </Button>
          </form>
        )}
        {open && !ready && <p className="xs subtle">Answers open once the lab environment is ready.</p>}

        {feedback && (q.state === 'open' || q.state === 'closed' || feedback.correct) && (
          <p id={fbId} className={cn('xs question-feedback', feedback.correct ? 'text-ok' : 'text-err')}>
            {feedback.message}
          </p>
        )}

        {shownHints.length > 0 && (
          <ul className="question-hints" aria-label={`Hints for question ${index + 1}`}>
            {shownHints.map((h) => (
              <li key={h.index} className={cn('hint', h.revealed && 'is-revealed')}>
                <div className="row-between" style={{ gap: 8 }}>
                  <span className="row small" style={{ gap: 7, minWidth: 0 }}>
                    <Lightbulb size={13} className={h.revealed ? 'text-warn' : 'subtle'} aria-hidden />
                    <span className={cn('truncate', !h.revealed && 'muted')}>
                      Hint {h.index + 1}
                      {h.revealed && h.revealedBy && event ? <span className="subtle"> · {h.revealedBy.name}</span> : null}
                    </span>
                  </span>
                  {h.revealed ? (
                    <Badge tone="neutral">−{h.cost} pts</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!open || h !== nextHint}
                      title={h !== nextHint ? 'Reveal the previous hint first' : !open ? 'Hints are only available while the question is open' : undefined}
                      onClick={() => onHint(h)}
                    >
                      Reveal · −{h.cost}
                    </Button>
                  )}
                </div>
                {h.revealed && h.body && (
                  <div className="hint-body">
                    <Prose text={h.body} className="small" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
