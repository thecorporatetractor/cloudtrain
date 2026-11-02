import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowRight, Clock, Layers } from 'lucide-react';
import { Fragment, useEffect, type ReactNode } from 'react';
import { publicQueries, useSite } from '@/api/public';
import { DifficultyBadge, DomainIcon } from '@/components/domain';
import { Card, PageSkeleton } from '@/components/ui';
import { formatMinutes, titleCase } from '@/lib/utils';
import type { LearnCrumb, LearnDoc, LearnDomainDoc, LearnExamDoc, LearnExamLink, LearnExamsIndexDoc, LearnLabDoc, LearnLabLink, LearnLabsIndexDoc, LearnPathDoc, LearnPathLink, LearnPathsIndexDoc } from '@/site/learnDoc';
import { applyPageHead } from '@/site/seoHead';
import { SiteNotFound } from './Pages';

/*
 * The public lab pages under /learn (coming-soon and live): what a lab, a learning path, an exam
 * simulation or a domain is, with internal links in both directions. Labs are not open yet, so the
 * only action on these pages is the waitlist; nothing says or suggests a visitor can run a lab today.
 * Links are real anchors, prerendered: the pages read the same without a script.
 */

const to = (href: string) => href as '/';

function Crumbs({ items }: { items: LearnCrumb[] }) {
  return (
    <nav className="site-crumbs xs muted" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <Fragment key={c.label}>
          {i > 0 && <span aria-hidden>/</span>}
          {c.to ? (
            <Link to={to(c.to)} className="link-quiet">
              {c.label}
            </Link>
          ) : (
            <span aria-current="page">{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="learn-section" aria-labelledby={id}>
      <h2 id={id} className="site-h3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function LabLinks({ labs }: { labs: LearnLabLink[] }) {
  return (
    <ul className="learn-links">
      {labs.map((l) => (
        <li key={l.id}>
          <Link to={to(l.to)}>{l.title}</Link>
          <span className="learn-meta">
            {titleCase(l.difficulty)}, {formatMinutes(l.minutes)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PathLinks({ paths }: { paths: LearnPathLink[] }) {
  return (
    <ul className="learn-cards">
      {paths.map((p) => (
        <li key={p.id}>
          <Link to={to(p.to)} className="card card-interactive learn-card">
            <h3>{p.title}</h3>
            <p className="xs muted">
              {p.labs} labs, {p.time}
              {p.level ? `, ${p.level}` : ''}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ExamLinks({ exams }: { exams: LearnExamLink[] }) {
  return (
    <ul className="learn-links learn-links-single">
      {exams.map((e) => (
        <li key={e.id}>
          <Link to={to(e.to)}>{e.title}</Link>
          {e.tasks !== undefined && e.minutes !== undefined && (
            <span className="learn-meta">
              {e.tasks} tasks, {formatMinutes(e.minutes)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Honest about the state of things in the words of content/site.yaml: not open yet, the waitlist is the way in. */
function WaitlistCta({ what }: { what: string }) {
  const site = useSite().data;
  const l = site?.launch;
  if (!site?.waitlist?.enabled) return null;
  return (
    <Card className="learn-cta">
      <h2 className="site-h3">{what} not open yet</h2>
      <p className="muted">{l?.status ? `${l.status}.` : ''} Join the waitlist and we will write when your place opens.</p>
      <Link to="/" hash="waitlist" className="btn btn-primary btn-md">
        {l?.ctaLabel ?? 'Join the waitlist'} <ArrowRight size={14} aria-hidden />
      </Link>
    </Card>
  );
}

function Head({ doc, eyebrow, children }: { doc: LearnDoc; eyebrow: ReactNode; children?: ReactNode }) {
  return (
    <>
      <Crumbs items={doc.crumbs} />
      <header className="site-page-head site-page-head-stack">
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 className="site-h1">{doc.title}</h1>
        <p className="muted site-lead-sm">{doc.lead}</p>
        {children}
      </header>
    </>
  );
}

function LabPage({ doc }: { doc: LearnLabDoc }) {
  const { lab } = doc;
  const site = useSite().data;
  const graded = site?.launch?.points?.find((p) => /graded/i.test(p.title));
  return (
    <>
      <Head doc={doc} eyebrow="Hands-on lab">
        <dl className="learn-facts">
          <div>
            <dt>Difficulty</dt>
            <dd>
              <DifficultyBadge difficulty={lab.difficulty} />
            </dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd className="row" style={{ gap: 5 }}>
              <Clock size={13} aria-hidden /> {formatMinutes(lab.minutes)}
            </dd>
          </div>
          {lab.domain && (
            <div>
              <dt>Domain</dt>
              <dd>
                <Link to={to(lab.domain.to)} className="row" style={{ gap: 5 }}>
                  <DomainIcon domain={lab.domain.id} size={13} aria-hidden /> {lab.domain.name}
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </Head>
      <Section id="skills" title="Skills you practise">
        <ul className="learn-skills">
          {lab.skills.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>
      {lab.paths.length > 0 && (
        <Section id="paths" title={lab.paths.length === 1 ? 'Part of this learning path' : 'Part of these learning paths'}>
          <ul className="learn-links learn-links-single">
            {lab.paths.map((p) => (
              <li key={p.id}>
                <Link to={to(p.to)}>{p.title}</Link>
                <span className="learn-meta">{p.module}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {graded && (
        <Section id="grading" title={graded.title}>
          <p className="muted">{graded.body}</p>
        </Section>
      )}
      {lab.related.length > 0 && (
        <Section id="related" title="Related labs">
          <LabLinks labs={lab.related} />
        </Section>
      )}
      <WaitlistCta what="This lab is" />
    </>
  );
}

function PathPage({ doc }: { doc: LearnPathDoc }) {
  const p = doc.learningPath;
  return (
    <>
      <Head doc={doc} eyebrow="Learning path">
        <dl className="learn-facts">
          <div>
            <dt>Labs</dt>
            <dd className="row" style={{ gap: 5 }}>
              <Layers size={13} aria-hidden /> {p.labs}
            </dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd className="row" style={{ gap: 5 }}>
              <Clock size={13} aria-hidden /> {p.time}
            </dd>
          </div>
          {p.level && (
            <div>
              <dt>Level</dt>
              <dd>{p.level}</dd>
            </div>
          )}
          {p.domain && (
            <div>
              <dt>Domain</dt>
              <dd>
                <Link to={to(p.domain.to)}>{p.domain.name}</Link>
              </dd>
            </div>
          )}
        </dl>
      </Head>
      {p.prerequisites.length > 0 && (
        <Section id="prerequisites" title="Before this path">
          <PathLinks paths={p.prerequisites} />
        </Section>
      )}
      {p.modules.map((m, i) => (
        <section key={m.id} className="learn-section" aria-labelledby={`module-${m.id}`}>
          <h2 id={`module-${m.id}`} className="site-h3">
            <span className="subtle tnum" style={{ marginRight: 8 }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            {m.title}
          </h2>
          <LabLinks labs={m.labs} />
        </section>
      ))}
      {p.exams.length > 0 && (
        <Section id="exams" title="Exam simulations in this domain">
          <ExamLinks exams={p.exams} />
        </Section>
      )}
      {p.related.length > 0 && (
        <Section id="more" title="More learning paths">
          <PathLinks paths={p.related} />
        </Section>
      )}
      <WaitlistCta what="This path is" />
    </>
  );
}

function ExamPage({ doc }: { doc: LearnExamDoc }) {
  const e = doc.exam;
  return (
    <>
      <Head doc={doc} eyebrow="Exam simulation">
        <dl className="learn-facts">
          <div>
            <dt>Tasks</dt>
            <dd>{e.tasks}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{formatMinutes(e.minutes)}</dd>
          </div>
          <div>
            <dt>Pass mark</dt>
            <dd>{e.passMark}%</dd>
          </div>
          {e.domain && (
            <div>
              <dt>Domain</dt>
              <dd>
                <Link to={to(e.domain.to)}>{e.domain.name}</Link>
              </dd>
            </div>
          )}
        </dl>
      </Head>
      <Section id="objectives" title="What it covers">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Objective</th>
              <th scope="col">Share of the score</th>
            </tr>
          </thead>
          <tbody>
            {e.objectives.map((o) => (
              <tr key={o.name}>
                <td>{o.name}</td>
                <td className="tnum">{o.weight}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section id="rules" title="How it runs">
        <ul className="learn-skills">
          {e.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {e.docsAllowed && <li>Documentation allowed: {e.docsAllowed}</li>}
        </ul>
        <p className="muted small" style={{ marginTop: 12 }}>
          A simulation is practice: it is not affiliated with any certifying body and confers no certification.
        </p>
      </Section>
      {e.paths.length > 0 && (
        <Section id="paths" title="Learning paths in this domain">
          <PathLinks paths={e.paths} />
        </Section>
      )}
      <WaitlistCta what="Exam simulations are" />
    </>
  );
}

function DomainPage({ doc }: { doc: LearnDomainDoc }) {
  const d = doc.domain;
  return (
    <>
      <Head doc={doc} eyebrow="Hands-on labs" />
      {d.paths.length > 0 && (
        <Section id="paths" title="Learning paths">
          <PathLinks paths={d.paths} />
        </Section>
      )}
      {d.exams.length > 0 && (
        <Section id="exams" title="Exam simulations">
          <ExamLinks exams={d.exams} />
        </Section>
      )}
      <section className="learn-section" aria-labelledby="labs">
        <h2 id="labs" className="site-h3">
          Labs in this domain
        </h2>
        <p className="xs muted">{d.labCount} listed on this page</p>
        {d.groups.map((g) => (
          <div key={g.id} className="learn-section">
            <h3>{g.title}</h3>
            <LabLinks labs={g.labs} />
          </div>
        ))}
      </section>
      <WaitlistCta what="These labs are" />
    </>
  );
}

function LabsIndex({ doc }: { doc: LearnLabsIndexDoc }) {
  const i = doc.labsIndex;
  return (
    <>
      <Head doc={doc} eyebrow="Labs" />
      <Section id="domains" title="Labs by domain">
        <ul className="learn-cards">
          {i.domains.map((d) => (
            <li key={d.id}>
              <Link to={to(d.to)} className="card card-interactive learn-card">
                <h3 className="row" style={{ gap: 6 }}>
                  <DomainIcon domain={d.id} size={15} aria-hidden /> {d.name}
                </h3>
                <p className="small muted">{d.lead}</p>
                <p className="xs muted" style={{ marginTop: 8 }}>
                  {d.labs} labs listed, {d.paths} learning paths
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="paths" title="Start with a learning path">
        <PathLinks paths={i.paths} />
        <p style={{ marginTop: 14 }}>
          <Link to={to('/learn/paths')} className="link-quiet small">
            All {i.pathCount} learning paths <ArrowRight size={12} aria-hidden />
          </Link>
        </p>
      </Section>
      <Section id="exams" title="Exam simulations">
        <p className="muted">Timed practical simulations, reported per objective against a pass mark.</p>
        <p style={{ marginTop: 10 }}>
          <Link to={to('/learn/exams')} className="link-quiet small">
            All {i.examCount} exam simulations <ArrowRight size={12} aria-hidden />
          </Link>
        </p>
      </Section>
      <WaitlistCta what="These labs are" />
    </>
  );
}

function PathsIndex({ doc }: { doc: LearnPathsIndexDoc }) {
  return (
    <>
      <Head doc={doc} eyebrow="Learning paths" />
      {doc.pathsIndex.domains.map((d) => (
        <section key={d.id} className="learn-section" aria-labelledby={`domain-${d.id}`}>
          <h2 id={`domain-${d.id}`} className="site-h3">
            <Link to={to(d.to)}>{d.name}</Link>
          </h2>
          <PathLinks paths={d.paths} />
        </section>
      ))}
      <WaitlistCta what="These paths are" />
    </>
  );
}

function ExamsIndex({ doc }: { doc: LearnExamsIndexDoc }) {
  return (
    <>
      <Head doc={doc} eyebrow="Exam simulations" />
      <Section id="exams" title="All exam simulations">
        <ExamLinks exams={doc.examsIndex.exams} />
      </Section>
      <p className="muted small" style={{ marginTop: 20 }}>
        A simulation is practice: it is not affiliated with any certifying body and confers no certification.
      </p>
      <WaitlistCta what="Exam simulations are" />
    </>
  );
}

function Page({ doc }: { doc: LearnDoc }) {
  switch (doc.kind) {
    case 'lab':
      return <LabPage doc={doc} />;
    case 'path':
      return <PathPage doc={doc} />;
    case 'exam':
      return <ExamPage doc={doc} />;
    case 'domain':
      return <DomainPage doc={doc} />;
    case 'labs-index':
      return <LabsIndex doc={doc} />;
    case 'paths-index':
      return <PathsIndex doc={doc} />;
    case 'exams-index':
      return <ExamsIndex doc={doc} />;
  }
}

export function Learn() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const page = useQuery(publicQueries.learn(pathname));
  const site = useSite();
  const doc = page.data;
  useEffect(() => {
    if (doc) applyPageHead(pathname, doc.head);
  }, [doc, pathname]);
  if (page.isError) return <SiteNotFound />;
  if (!doc || site.isPending) {
    return (
      <div className="site-container site-page site-pending">
        <PageSkeleton />
      </div>
    );
  }
  // The marker tells the prerender (build-site.mjs) that this URL's document is on screen.
  return (
    <div className="site-container site-page site-page-narrow" data-learn-page={doc.path} data-no-stops>
      <Page doc={doc} />
    </div>
  );
}
