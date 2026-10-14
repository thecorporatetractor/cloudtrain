import { Link } from '@tanstack/react-router';
import { ChevronLeft, GraduationCap } from 'lucide-react';
import { RequireAccess } from '@/app/access';
import { EmptyState } from '@/components/ui';
import { teamExamsRoute } from '@/router';

/**
 * Exam simulation area. The navigation and routes are reserved here; the
 * screens (available simulations, attempts, results, team exam readiness) come
 * with the exam engine stream, which also adds the exam types to
 * packages/api-types.
 */
export function Exams() {
  return (
    <RequireAccess path="/exams">
      <div className="page">
        <header className="page-header">
          <div>
            <div className="page-eyebrow">Learner</div>
            <h1>Exams</h1>
            <p className="muted">Timed exam simulations on real environments, with the same grading as the labs.</p>
          </div>
        </header>
        <EmptyState icon={<GraduationCap size={20} />} title="Exam simulations are on their way" description="Available simulations, your attempts and results land here once the exam engine ships. Until then, the Skills page shows your readiness per framework." action={<Link to="/skills" search={{ framework: 'cks' }} className="btn btn-secondary btn-md">Open Skills</Link>} />
      </div>
    </RequireAccess>
  );
}

export function TeamExams() {
  const search = teamExamsRoute.useSearch();
  return (
    <RequireAccess path="/team">
      <div className="page">
        <Link to="/team" search={{ team: search.team }} className="link-quiet small" style={{ marginBottom: 14 }}>
          <ChevronLeft size={13} /> Team dashboard
        </Link>
        <header className="page-header">
          <div>
            <div className="page-eyebrow">Manager</div>
            <h1>Exam readiness</h1>
            <p className="muted">Who in the team has taken a simulation, how they scored, and who is ready to book the real exam.</p>
          </div>
        </header>
        <EmptyState icon={<GraduationCap size={20} />} title="Team exam readiness arrives with the exam engine" description="The team dashboard already shows framework readiness from lab evidence; simulation results will sit next to it here." action={<Link to="/team" search={{ team: search.team }} className="btn btn-secondary btn-md">Back to the dashboard</Link>} />
      </div>
    </RequireAccess>
  );
}
