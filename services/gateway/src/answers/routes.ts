import type { FastifyInstance } from 'fastify';
import type { SubmitAnswerRequest } from '@cloudtrain/api-types';
import type { AnswerService } from './service.js';

/** `/api/sessions/:id/questions*`: the questions panel of a lab session (owner only, `lab.run`). */
export function registerAnswerRoutes(app: FastifyInstance, answers: AnswerService): void {
  const run = { config: { permission: 'lab.run' as const } };
  app.get<{ Params: { id: string } }>('/api/sessions/:id/questions', run, async (req) => answers.questions(req.principal, req.params.id));
  app.post<{ Params: { id: string; checkId: string }; Body: SubmitAnswerRequest }>('/api/sessions/:id/questions/:checkId/answer', run, async (req) =>
    answers.submit(req.principal, req.params.id, req.params.checkId, req.body?.answer, req.ip),
  );
  app.post<{ Params: { id: string; checkId: string; index: string } }>('/api/sessions/:id/questions/:checkId/hints/:index', run, async (req) =>
    answers.revealHint(req.principal, req.params.id, req.params.checkId, Number(req.params.index), req.ip),
  );
}
