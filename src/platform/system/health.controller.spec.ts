import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports liveness without any detail', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
  });
});
