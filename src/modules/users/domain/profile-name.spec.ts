import { InvalidRequestError } from '../../../shared/domain-error';
import { ProfileName } from './profile-name';

function reasonOf(input: unknown) {
  try {
    ProfileName.parse(input);
  } catch (error) {
    return (error as InvalidRequestError).params;
  }
  throw new Error('expected a failure');
}

describe('ProfileName', () => {
  it('trims surrounding whitespace', () => {
    expect(ProfileName.parse('  Elena  ').value).toBe('Elena');
  });

  it('accepts the boundaries 2 and 100 characters', () => {
    expect(ProfileName.parse('Al').value).toBe('Al');
    expect(ProfileName.parse('x'.repeat(100)).value).toHaveLength(100);
  });

  it('measures length after trimming', () => {
    expect(reasonOf('  A  ')).toEqual([{ name: 'name', reason: 'TOO_SHORT' }]);
    expect(ProfileName.parse(` ${'x'.repeat(100)} `).value).toHaveLength(100);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(ProfileName.parse('😀😀').value).toBe('😀😀');
    expect(reasonOf('😀')).toEqual([{ name: 'name', reason: 'TOO_SHORT' }]);
  });

  it.each([
    [undefined, 'REQUIRED'],
    [null, 'REQUIRED'],
    ['', 'REQUIRED'],
    ['    ', 'REQUIRED'],
    [42, 'INVALID_TYPE'],
    [{}, 'INVALID_TYPE'],
    ['x'.repeat(101), 'TOO_LONG'],
    ['El\u0000ena', 'INVALID_VALUE'],
    ['El\u0007ena', 'INVALID_VALUE'],
    ['El\nena', 'INVALID_VALUE'],
  ])('rejects %p with %s', (input, reason) => {
    expect(reasonOf(input)).toEqual([{ name: 'name', reason }]);
  });
});
