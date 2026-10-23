import { PROBLEMS, toProblem } from './problem-details';
import { ERROR_CODES } from '../../shared/domain-error';

describe('problem table', () => {
  it('has an entry for every stable domain error code', () => {
    for (const code of ERROR_CODES) expect(PROBLEMS[code]).toBeDefined();
  });

  it('builds a complete problem object for an SSE error event', () => {
    expect(
      toProblem('reply-generation-failed', '/api/v1/sessions/s/x', 'flow-1'),
    ).toEqual({
      type: '/problems/reply-generation-failed',
      title: 'Reply Generation Failed',
      status: 502,
      detail: 'The patient reply could not be produced.',
      instance: '/api/v1/sessions/s/x',
      flow_id: 'flow-1',
    });
    expect(toProblem('service-unavailable', '/x', 'f').status).toBe(503);
  });
});
