import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { requestContext } from '../context/request-context.js';
import { ProblemException, problemType } from './problem.js';

/** Roles from the FRD permissions table. Travelers use signed links, not accounts. */
export const ROLES = [
  'advisor',
  'team_lead',
  'supplier_manager',
  'support',
  'finance',
  'admin',
] as const;
export type Role = (typeof ROLES)[number];

/** FR-AUTH-02: MFA is mandatory for these roles before they can use anything but enrolment. */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set([
  'advisor',
  'team_lead',
  'finance',
  'admin',
  'support',
]);

export interface AuthUser {
  id: string;
  role: Role;
  mfaVerified: boolean;
  sessionId: string;
}

export const SESSION_COOKIE = 'atp_session';

/**
 * Implemented by the identity module (inversion: the platform guard must not import a business module).
 */
export interface SessionResolver {
  resolve(token: string): Promise<AuthUser | null>;
}
export const SESSION_RESOLVER = Symbol('SESSION_RESOLVER');

const PUBLIC = 'atp:public';
const ROLES_KEY = 'atp:roles';
const ALLOW_WITHOUT_MFA = 'atp:allow-without-mfa';

/** No session needed (sign-up, login, webhooks, traveler links, health). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Only these roles may call the route. Ownership checks still happen in the module. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Reachable with a password-only session (MFA enrolment and challenge). */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
  if (!user) throw new Error('CurrentUser used on a public route');
  return user;
});

function sessionToken(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[SESSION_COOKIE];
}

/** Global guard: every route needs a session unless marked @Public(). Checks are server-side only. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SESSION_RESOLVER) private readonly sessions: SessionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    const token = sessionToken(req);
    const user = token ? await this.sessions.resolve(token) : null;
    if (user) {
      req.user = user;
      const ctx = requestContext.get();
      if (ctx) ctx.actorId = user.id;
    }

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    if (!user) {
      throw new ProblemException(
        HttpStatus.UNAUTHORIZED,
        problemType('unauthenticated'),
        'Sign in required',
      );
    }
    const allowWithoutMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, targets);
    if (!allowWithoutMfa && MFA_REQUIRED_ROLES.has(user.role) && !user.mfaVerified) {
      throw new ProblemException(
        HttpStatus.FORBIDDEN,
        problemType('mfa-required'),
        'Multi-factor authentication required',
        undefined,
        { next: '/v1/auth/mfa' },
      );
    }
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(user.role)) {
      throw new ProblemException(
        HttpStatus.FORBIDDEN,
        problemType('forbidden'),
        'You do not have access to this',
      );
    }
    return true;
  }
}
