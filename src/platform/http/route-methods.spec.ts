import { allowedMethodsFor, type RouterLike } from './route-methods';

function layer(path: string, methods: string[]) {
  return {
    match: (p: string) => p === path,
    route: {
      methods: Object.fromEntries(methods.map((m) => [m, true])),
    },
  };
}

describe('allowedMethodsFor', () => {
  const router: RouterLike = {
    stack: [
      { match: () => true },
      layer('/me', ['get']),
      layer('/me', ['put']),
      layer('/other', ['post']),
    ],
  };

  it('lists the methods of every route matching the path, sorted', () => {
    expect(allowedMethodsFor(router, '/me')).toEqual(['GET', 'PUT']);
  });

  it('returns nothing for an unknown path', () => {
    expect(allowedMethodsFor(router, '/nope')).toEqual([]);
  });

  it('returns nothing when a route answers every method', () => {
    expect(allowedMethodsFor({ stack: [layer('/x', ['_all'])] }, '/x')).toEqual(
      [],
    );
  });
});
