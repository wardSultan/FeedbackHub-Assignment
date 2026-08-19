/**
 * Static audit: the authorization matrix against the controllers.
 *
 * Runs with no dependencies installed —
 *
 *     npx tsx test/route-audit.ts
 *
 * It exists because the dangerous failure is a *missing* rule rather than a wrong one. A
 * new endpoint added without an authorization decision is invisible to a hand-written test
 * suite; here it fails immediately, and so does a matrix row whose claim no longer matches
 * the decorators on the handler.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AUTHORIZATION_MATRIX, type RouteRule } from './authorization-matrix';

interface DiscoveredRoute {
  method: string;
  path: string;
  file: string;
  adminGuarded: boolean;
  isPublic: boolean;
  feature: string | null;
}

const HTTP_DECORATORS = ['Get', 'Post', 'Patch', 'Put', 'Delete'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

function discoverRoutes(root = 'src'): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  for (const file of walk(root).filter((f) => f.endsWith('.controller.ts'))) {
    const source = readFileSync(file, 'utf8');

    const controller = source.match(
      /@Controller\(\s*(?:'([^']*)'|\{[^}]*path:\s*'([^']*)'[^}]*\}|)\s*\)/,
    );
    const base = (controller?.[1] ?? controller?.[2] ?? '').replace(/^\/|\/$/g, '');

    // A decorator applies to the whole controller when it sits above @Controller.
    const preamble = source.slice(0, source.indexOf('@Controller'));
    const classAdmin = /@Roles\([^)]*ADMIN[^)]*\)/.test(preamble);
    const classPublic = /@Public\(\)/.test(preamble);
    const classFeature = resolveFeature(
      preamble.match(/@RequiresFeature\(\s*([^)]+?)\s*\)/)?.[1],
      source,
    );

    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i]!.match(
        new RegExp(`^\\s*@(${HTTP_DECORATORS.join('|')})\\(\\s*(?:'([^']*)')?\\s*\\)`),
      );
      if (!match) continue;

      // A handler's decorators run from its HTTP decorator to its method signature. A
      // fixed lookahead window runs into the *next* handler's decorators and misreports
      // its guards — which it did, before this was bounded.
      let end = i + 1;
      while (end < lines.length && /^\s*@/.test(lines[end]!)) end++;
      const block = lines.slice(i, end).join('\n');

      const segment = (match[2] ?? '').replace(/^\/|\/$/g, '');

      routes.push({
        method: match[1]!.toUpperCase(),
        path: '/' + [base, segment].filter(Boolean).join('/'),
        file,
        adminGuarded: classAdmin || /@Roles\([^)]*ADMIN[^)]*\)/.test(block),
        isPublic: classPublic || /@Public\(\)/.test(block),
        feature:
          resolveFeature(block.match(/@RequiresFeature\(\s*([^)]+?)\s*\)/)?.[1], source) ??
          classFeature,
      });
    }
  }

  return routes;
}

/** The decorator takes a literal or a constant; resolve a constant declared in the file. */
function resolveFeature(raw: string | undefined, source: string): string | null {
  if (!raw) return null;
  if (raw.startsWith("'")) return raw.slice(1, -1);
  return source.match(new RegExp(`const\\s+${raw}\\s*=\\s*'([^']+)'`))?.[1] ?? raw;
}

const key = (r: { method: string; path: string }): string => `${r.method} ${r.path}`;

function audit(): number {
  const discovered = discoverRoutes();
  const byKey = new Map(AUTHORIZATION_MATRIX.map((rule) => [key(rule), rule]));
  const problems: string[] = [];

  for (const route of discovered) {
    const rule: RouteRule | undefined = byKey.get(key(route));

    if (!rule) {
      problems.push(
        `${key(route)} exists in ${route.file} but has no rule. Every endpoint needs an ` +
          `explicit authorization decision.`,
      );
      continue;
    }

    if (route.adminGuarded !== (rule.access === 'admin')) {
      problems.push(
        `${key(route)} is declared "${rule.access}" but the handler ` +
          `${route.adminGuarded ? 'has' : 'does not have'} an admin role guard.`,
      );
    }

    if (route.isPublic !== (rule.access === 'public')) {
      problems.push(
        `${key(route)} is declared "${rule.access}" but the handler ` +
          `${route.isPublic ? 'is' : 'is not'} marked @Public().`,
      );
    }

    if ((route.feature ?? null) !== (rule.feature ?? null)) {
      problems.push(
        `${key(route)} feature gate mismatch: code says ${route.feature ?? 'none'}, ` +
          `matrix says ${rule.feature ?? 'none'}.`,
      );
    }
  }

  const discoveredKeys = new Set(discovered.map(key));
  for (const rule of AUTHORIZATION_MATRIX) {
    if (!discoveredKeys.has(key(rule))) {
      problems.push(`${key(rule)} is in the matrix but no controller declares it.`);
    }
  }

  console.log(`${discovered.length} routes discovered, ${AUTHORIZATION_MATRIX.length} rules.`);
  const counts = { public: 0, authenticated: 0, 'owner-only': 0, 'owner-or-admin': 0, admin: 0 };
  for (const rule of AUTHORIZATION_MATRIX) counts[rule.access]++;
  console.log(
    Object.entries(counts)
      .map(([access, n]) => `  ${access}: ${n}`)
      .join('\n'),
  );

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  console.log('\nEvery route has an authorization rule, and every rule matches the code.');
  return 0;
}

process.exit(audit());
