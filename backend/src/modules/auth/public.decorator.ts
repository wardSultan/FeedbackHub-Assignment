import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'feedbackhub:isPublic';

/**
 * Opts a route out of authentication.
 *
 * Authentication is applied globally and routes opt *out*, rather than being applied
 * per-controller and opted in. Forgetting the decorator then produces a locked endpoint
 * somebody reports, instead of an open one nobody notices.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
