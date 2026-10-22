import { ValidationError } from '@nestjs/common';
import { toInvalidParams } from './validation-params';

function error(
  property: string,
  constraints?: string[],
  children?: ValidationError[],
): ValidationError {
  return {
    property,
    constraints: constraints
      ? Object.fromEntries(constraints.map((c) => [c, `${c} secret-input`]))
      : undefined,
    children,
  };
}

describe('toInvalidParams', () => {
  it.each([
    [['isDefined', 'isString'], 'REQUIRED'],
    [['isNotEmpty'], 'REQUIRED'],
    [['minLength'], 'TOO_SHORT'],
    [['maxLength'], 'TOO_LONG'],
    [['isString'], 'INVALID_TYPE'],
    [['isObject'], 'INVALID_TYPE'],
    [['nestedValidation'], 'INVALID_TYPE'],
    [['min'], 'OUT_OF_RANGE'],
    [['max'], 'OUT_OF_RANGE'],
    [['isIn'], 'INVALID_VALUE'],
    [['somethingUnmapped'], 'INVALID_VALUE'],
  ])('maps %p to %s', (constraints, reason) => {
    expect(toInvalidParams([error('name', constraints)])).toEqual([
      { name: 'name', reason },
    ]);
  });

  it('uses dotted paths for nested properties', () => {
    const nested = error('consent', undefined, [
      error('terms_version', ['isDefined']),
    ]);
    expect(toInvalidParams([nested])).toEqual([
      { name: 'consent.terms_version', reason: 'REQUIRED' },
    ]);
  });

  it('never carries constraint messages', () => {
    expect(
      JSON.stringify(toInvalidParams([error('a', ['isString'])])),
    ).not.toContain('secret-input');
  });

  it('names a non-object body as (body)', () => {
    expect(toInvalidParams([error('', ['unknownValue'])])).toEqual([
      { name: '(body)', reason: 'INVALID_VALUE' },
    ]);
  });
});
