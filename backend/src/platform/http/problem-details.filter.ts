import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ProblemDetails } from './problem-details';

interface ValidationExceptionBody {
  errors?: Record<string, string[]>;
  message?: string;
}

/**
 * Turns every escaping exception into a single response shape.
 *
 * Two rules worth stating explicitly, because both are easy to get wrong and both have
 * security consequences:
 *
 *  - An exception we did not raise deliberately is a 500, and its message never reaches
 *    the client. Driver errors and stack traces routinely contain table names, query
 *    fragments and file paths.
 *  - Everything is logged server-side with the request path, so returning nothing useful
 *    to the caller does not mean losing the ability to diagnose it.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const problem = this.toProblemDetails(exception, request.url);

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${problem.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${problem.status}: ${problem.title}`);
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblemDetails(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return { type: 'about:blank', title: body, status, instance };
      }

      const { errors, message } = body as ValidationExceptionBody;

      return {
        type: 'about:blank',
        title: this.titleFor(status),
        status,
        ...(message ? { detail: message } : {}),
        ...(errors ? { errors } : {}),
        instance,
      };
    }

    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred.',
      instance,
    };
  }

  private titleFor(status: number): string {
    const titles: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
    };

    return titles[status] ?? 'Error';
  }
}
