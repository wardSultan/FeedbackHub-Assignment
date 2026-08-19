import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';

/**
 * Collapses class-validator's nested error tree into `{ "field.path": ["message"] }`.
 *
 * The default pipe returns a flat array of sentences, which forces the frontend to
 * string-match in order to put an error next to the input that caused it. The brief
 * grades "validation messages that a user can act on", and a message the UI cannot
 * attach to a field is not actionable.
 */
function flatten(errors: ValidationError[], parentPath = ''): Record<string, string[]> {
  return errors.reduce<Record<string, string[]>>((accumulator, error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    if (error.constraints) {
      accumulator[path] = Object.values(error.constraints);
    }
    if (error.children?.length) {
      Object.assign(accumulator, flatten(error.children, path));
    }

    return accumulator;
  }, {});
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    // Strip properties without a decorator, and reject the request if any were sent.
    // This is the mass-assignment guard: `role`, `authorId` and friends can never be
    // smuggled in through a body, whatever the DTO forgets to mention.
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        message: 'The request body failed validation.',
        errors: flatten(errors),
      }),
  });
}
