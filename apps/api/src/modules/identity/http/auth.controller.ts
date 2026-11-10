import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../../config.js';
import {
  AllowWithoutMfa,
  CurrentUser,
  Public,
  SESSION_COOKIE,
  type AuthUser,
} from '../../../platform/http/auth.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { AuthService, type Me } from '../application/auth.service.js';
import {
  loginSchema,
  meSchema,
  mfaChallengeSchema,
  mfaCodeSchema,
  mfaConfirmResponseSchema,
  mfaEnrollResponseSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerResponseSchema,
  registerSchema,
  resendSchema,
  verifySchema,
} from './schemas.js';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private setSession(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.NODE_ENV === 'production',
      path: '/',
      maxAge: this.config.SESSION_TTL_HOURS * 3600 * 1000,
    });
  }

  private token(req: Request): string {
    return (req as Request & { cookies: Record<string, string> }).cookies[SESSION_COOKIE] ?? '';
  }

  @Post('register')
  @Public()
  @ZResponse(201, registerResponseSchema)
  register(@ZBody(registerSchema) body: z.infer<typeof registerSchema>) {
    return this.auth.register(body);
  }

  @Post('verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, meSchema)
  async verify(
    @ZBody(verifySchema) body: z.infer<typeof verifySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    const { token, me } = await this.auth.verifyContact(body.userId, body.code);
    this.setSession(res, token);
    return me;
  }

  /** Always answers the same, whether or not the account exists. */
  @Post('password-reset/request')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestReset(
    @ZBody(passwordResetRequestSchema) body: z.infer<typeof passwordResetRequestSchema>,
    @Req() req: Request,
  ): Promise<{ sent: true }> {
    await this.auth.requestPasswordReset(body.identifier, req.ip ?? 'unknown');
    return { sent: true };
  }

  @Post('password-reset/confirm')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmReset(
    @ZBody(passwordResetConfirmSchema) body: z.infer<typeof passwordResetConfirmSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.confirmPasswordReset(body.token, body.password, req.ip ?? 'unknown');
  }

  @Post('verify/resend')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(@ZBody(resendSchema) body: z.infer<typeof resendSchema>): Promise<{ sent: true }> {
    await this.auth.resendCode(body.userId);
    return { sent: true };
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, meSchema)
  async login(
    @ZBody(loginSchema) body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    const { token, me } = await this.auth.login(
      body.identifier,
      body.password,
      req.ip ?? 'unknown',
    );
    this.setSession(res, token);
    return me;
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = this.token(req);
    if (token) await this.auth.logout(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @AllowWithoutMfa()
  @ZResponse(200, meSchema)
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.auth.me(user.id, user.mfaVerified);
  }

  @Post('mfa/enroll')
  @AllowWithoutMfa()
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, mfaEnrollResponseSchema)
  startEnrollment(@CurrentUser() user: AuthUser) {
    return this.auth.startMfaEnrollment(user.id);
  }

  @Post('mfa/enroll/confirm')
  @AllowWithoutMfa()
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, mfaConfirmResponseSchema)
  async confirmEnrollment(
    @CurrentUser() user: AuthUser,
    @ZBody(mfaCodeSchema) body: z.infer<typeof mfaCodeSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, recoveryCodes } = await this.auth.confirmMfaEnrollment(
      user.id,
      this.token(req),
      body.code,
    );
    this.setSession(res, token);
    return { recoveryCodes };
  }

  @Post('mfa/challenge')
  @AllowWithoutMfa()
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, meSchema)
  async challenge(
    @CurrentUser() user: AuthUser,
    @ZBody(mfaChallengeSchema) body: z.infer<typeof mfaChallengeSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    const token = await this.auth.passMfaChallenge(
      user.id,
      this.token(req),
      body,
      req.ip ?? 'unknown',
    );
    this.setSession(res, token);
    return this.auth.me(user.id, true);
  }
}
