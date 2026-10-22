import type { ValidationError } from '@nestjs/common';
import type {
  InvalidParam,
  InvalidParamReason,
} from '../../shared/domain-error';

/** class-validator constraint name to the master `invalid_params` reason. */
const REASON_BY_CONSTRAINT: Record<string, InvalidParamReason> = {
  isDefined: 'REQUIRED',
  isNotEmpty: 'REQUIRED',
  minLength: 'TOO_SHORT',
  maxLength: 'TOO_LONG',
  isString: 'INVALID_TYPE',
  isObject: 'INVALID_TYPE',
  isArray: 'INVALID_TYPE',
  isBoolean: 'INVALID_TYPE',
  isNumber: 'INVALID_TYPE',
  isInt: 'INVALID_TYPE',
  nestedValidation: 'INVALID_TYPE',
  min: 'OUT_OF_RANGE',
  max: 'OUT_OF_RANGE',
};

/** When a property fails several constraints, the most telling one wins. */
const PRECEDENCE: InvalidParamReason[] = [
  'REQUIRED',
  'INVALID_TYPE',
  'TOO_SHORT',
  'TOO_LONG',
  'OUT_OF_RANGE',
  'UNKNOWN_VERSION',
  'INVALID_VALUE',
];

const BODY = '(body)';

function reasonFor(constraints: string[]): InvalidParamReason {
  const reasons = constraints.map(
    (constraint) => REASON_BY_CONSTRAINT[constraint] ?? 'INVALID_VALUE',
  );
  return (
    PRECEDENCE.find((reason) => reasons.includes(reason)) ?? 'INVALID_VALUE'
  );
}

/**
 * Flattens class-validator errors into `invalid_params`: one entry per
 * property (dotted path for nested ones), with a master reason code. The
 * original constraint messages are dropped; they can echo input values.
 */
export function toInvalidParams(
  errors: ValidationError[],
  parent = '',
): InvalidParam[] {
  return errors.flatMap((error) => {
    const name = error.property
      ? parent
        ? `${parent}.${error.property}`
        : error.property
      : parent || BODY;
    const own: InvalidParam[] = error.constraints
      ? [{ name, reason: reasonFor(Object.keys(error.constraints)) }]
      : [];
    return [...own, ...toInvalidParams(error.children ?? [], name)];
  });
}
