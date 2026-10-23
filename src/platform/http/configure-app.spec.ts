import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { applyCors, applyTrustProxy, configureApp } from './configure-app';

function fakeApp(config: Record<string, unknown>) {
  const expressApp = { set: jest.fn() };
  const app = {
    use: jest.fn(),
    enableCors: jest.fn(),
    useBodyParser: jest.fn(),
    setGlobalPrefix: jest.fn(),
    useGlobalPipes: jest.fn(),
    get: () => ({ get: (key: string) => config[key] }),
    getHttpAdapter: () => ({ getInstance: () => expressApp }),
  } as unknown as INestApplication;
  return { app, expressApp };
}

describe('configureApp', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not publish the API docs in production', () => {
    const create = jest.spyOn(SwaggerModule, 'createDocument');
    const setup = jest.spyOn(SwaggerModule, 'setup');
    const { app } = fakeApp({
      NODE_ENV: 'production',
      TRUST_PROXY_HOPS: 1,
      CORS_ALLOWED_ORIGINS: [],
    });

    configureApp(app);

    expect(create).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it('publishes the API docs outside production', () => {
    jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockReturnValue({} as ReturnType<typeof SwaggerModule.createDocument>);
    const setup = jest
      .spyOn(SwaggerModule, 'setup')
      .mockImplementation(() => undefined);
    const { app } = fakeApp({
      NODE_ENV: 'development',
      TRUST_PROXY_HOPS: 0,
      CORS_ALLOWED_ORIGINS: [],
    });

    configureApp(app);

    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('applies the configured proxy hop count, never a boolean', () => {
    const { app, expressApp } = fakeApp({
      NODE_ENV: 'production',
      TRUST_PROXY_HOPS: 2,
      CORS_ALLOWED_ORIGINS: [],
    });

    configureApp(app);

    expect(expressApp.set).toHaveBeenCalledWith('trust proxy', 2);
  });
});

describe('applyCors', () => {
  it('adds no CORS headers when no origin is configured', () => {
    const { app } = fakeApp({});
    applyCors(app, [], 600);
    expect(app.enableCors).not.toHaveBeenCalled();
  });

  it('allows exactly the configured origins, without credentials', () => {
    const { app } = fakeApp({});
    applyCors(app, ['https://app.example.test'], 120);
    expect(app.enableCors).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: ['https://app.example.test'],
        credentials: false,
        maxAge: 120,
        allowedHeaders: expect.arrayContaining(['Authorization', 'X-Flow-ID']),
        exposedHeaders: expect.arrayContaining(['X-Flow-ID', 'Retry-After']),
      }),
    );
  });

  it('uses a wildcard origin for *', () => {
    const { app } = fakeApp({});
    applyCors(app, ['*'], 600);
    expect(app.enableCors).toHaveBeenCalledWith(
      expect.objectContaining({ origin: '*', credentials: false }),
    );
  });
});

describe('applyTrustProxy', () => {
  it('rejects a non-integer hop count', () => {
    const { app } = fakeApp({});
    expect(() => applyTrustProxy(app, -1)).toThrow();
    expect(() => applyTrustProxy(app, 1.5)).toThrow();
  });
});
