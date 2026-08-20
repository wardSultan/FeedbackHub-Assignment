import type { RegistrationPolicy } from '@prisma/client';

/**
 * Whether an email address is permitted to be provisioned an account.
 *
 * A pure function over plain data, deliberately: the rule is small, security-relevant and
 * easy to get subtly wrong, and keeping it free of Prisma and Nest means it can be tested
 * exhaustively on its own.
 *
 * The policy is an *application* setting, so the application is the authoritative gate.
 * Keycloak owns registration and will happily create an account; provisioning is where
 * this application decides whether that account may exist here. See docs/SCOPE.md, A-4.
 */
export interface RegistrationRules {
  policy: RegistrationPolicy;
  /** Domains for DOMAIN_RESTRICTED; addresses for INVITE_ONLY. */
  allowedEmailDomains: string[];
}

export type RegistrationDecision = { allowed: true } | { allowed: false; reason: string };

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');

  // No '@', nothing before it, or nothing after it: not an address this can reason about.
  if (at <= 0 || at === email.length - 1) {
    return null;
  }

  return email.slice(at + 1).toLowerCase();
}

export function decideRegistration(
  email: string,
  existingUser: boolean,
  rules: RegistrationRules,
): RegistrationDecision {
  // The policy governs who may *join*. Tightening it must not lock out people who already
  // have accounts — that would be a configuration change silently revoking access.
  if (existingUser) {
    return { allowed: true };
  }

  const address = email.trim().toLowerCase();
  const domain = domainOf(address);

  if (!domain) {
    return { allowed: false, reason: 'That account has no usable email address.' };
  }

  switch (rules.policy) {
    case 'OPEN':
      return { allowed: true };

    case 'DOMAIN_RESTRICTED': {
      const allowed = rules.allowedEmailDomains.map((entry) =>
        entry.trim().toLowerCase().replace(/^@/, ''),
      );

      // Exact match, never endsWith. `endsWith('acme.com')` also accepts
      // `evil-acme.com` and `acme.com.attacker.net` — the classic way this check is
      // written and the classic way it is bypassed.
      return allowed.includes(domain)
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'This board is restricted to specific email domains.',
          };
    }

    case 'INVITE_ONLY': {
      // Implemented as an administrator-managed allowlist of addresses rather than a
      // token-and-email invitation flow. See docs/SCOPE.md, A-5.
      const invited = rules.allowedEmailDomains.map((entry) => entry.trim().toLowerCase());

      return invited.includes(address)
        ? { allowed: true }
        : { allowed: false, reason: 'This board is invite only.' };
    }

    // Unreachable while the enum has three members, and deliberately present anyway: if a
    // policy is ever added and this switch is not updated, the honest failure is to refuse
    // rather than to fall through and admit everyone. A security check with no terminal
    // branch is one enum value away from being no check at all.
    default:
      return {
        allowed: false,
        reason: 'Registration is not available at the moment.',
      };
  }
}
