import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TokenVerifierService } from '../src/modules/auth/token-verifier.service';
import { PrismaService } from '../src/platform/prisma/prisma.service';
import { createValidationPipe } from '../src/platform/http/validation';
import { ProblemDetailsFilter } from '../src/platform/http/problem-details.filter';
import { AUTHORIZATION_MATRIX, expectedStatus, type Caller } from './authorization-matrix';

/**
 * The authorization matrix, checked at runtime.
 *
 * One request per (endpoint × caller), with the expected status derived from the matrix
 * rather than restated here — so this file cannot drift from `route-audit.ts`, and adding
 * an endpoint adds its tests automatically.
 *
 * Token verification is stubbed rather than run against Keycloak. That is possible because
 * the role lives in our own users table and not in a token claim (ADR-0012): the entire
 * suite runs against a constructed subject with no identity provider in the loop, which is
 * what makes it fast enough to run on every commit and therefore worth having.
 *
 * What is *not* stubbed is the database — these run against a real one, because the
 * ownership checks are queries and mocking them would be testing the mock.
 */
describe('authorization', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** The OIDC subject the stub returns, swapped per test. */
  let currentSubject: string | null = null;

  const subjects: Record<Exclude<Caller, 'anonymous'>, string> = {
    user: 'test-user',
    otherUser: 'test-other',
    author: 'test-author',
    admin: 'test-admin',
  };

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifierService)
      .useValue({
        verify: async (token: string) => {
          if (!currentSubject || token !== 'stub') {
            throw new Error('no subject');
          }
          return { sub: currentSubject, email: `${currentSubject}@example.test` };
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();

    prisma = app.get(PrismaService);

    for (const [caller, subject] of Object.entries(subjects)) {
      const user = await prisma.user.upsert({
        where: { idpSubject: subject },
        update: {},
        create: {
          idpSubject: subject,
          email: `${subject}@example.test`,
          displayName: subject,
          role: caller === 'admin' ? 'ADMIN' : 'USER',
        },
      });
      ids[caller] = user.id;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { idpSubject: { startsWith: 'test-' } } });
    await app.close();
  });

  const callers: Caller[] = ['anonymous', 'user', 'otherUser', 'author', 'admin'];

  for (const rule of AUTHORIZATION_MATRIX) {
    for (const caller of callers) {
      const expected = expectedStatus(rule, caller);

      // Only the refusals are asserted exactly. A permitted call may legitimately answer
      // 200, 201, 204 or 404 depending on whether the fixture id exists, and pinning those
      // would make this a test of fixtures rather than of authorization.
      if (expected !== 401 && expected !== 403) {
        continue;
      }

      it(`refuses ${caller} on ${rule.method} ${rule.path} with ${expected}`, async () => {
        currentSubject = caller === 'anonymous' ? null : subjects[caller];

        const path = `/api/v1${rule.path}`
          .replace(':requestId', ids['seedRequest'] ?? '00000000-0000-4000-8000-000000000001')
          .replace(':id', ids['seedRequest'] ?? '00000000-0000-4000-8000-000000000001')
          .replace(':key', 'comments.enabled');

        const call = request(app.getHttpServer())[
          rule.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'
        ](path);

        if (caller !== 'anonymous') {
          call.set('Authorization', 'Bearer stub');
        }

        await call.expect(expected);
      });
    }
  }
});
