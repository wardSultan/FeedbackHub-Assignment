import { SetMetadata } from '@nestjs/common';

export const REQUIRES_FEATURE_KEY = 'feedbackhub:requiresFeature';

/**
 * Gates a route behind a feature flag.
 *
 * The point of applying this on the server is that a flag which only hides a button is a
 * user-interface preference, not a feature flag: the endpoint is still there, and anyone
 * with the network tab open can call it. Hiding the control is for the person using the
 * application; this is for everyone else.
 */
export const RequiresFeature = (key: string): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_FEATURE_KEY, key);
