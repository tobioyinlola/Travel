import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from '../app.module.js';
import { loadConfig } from '../config.js';
import { AuthService } from '../modules/identity/index.js';
import { ROLES, type Role } from '../platform/http/auth.js';

/**
 * Creates a staff account (admin, finance, support, ...). Staff enrol MFA at first sign-in.
 *   pnpm --filter @atp/api create-staff --email ops@example.com --role admin
 * The password is read from STAFF_PASSWORD so it never lands in shell history.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      role: { type: 'string', default: 'admin' },
      name: { type: 'string' },
    },
  });
  const password = process.env.STAFF_PASSWORD;
  if (!values.email || !password)
    throw new Error('Usage: STAFF_PASSWORD=... create-staff --email <email> [--role admin]');
  if (!ROLES.includes(values.role as Role) || values.role === 'advisor')
    throw new Error(`Invalid staff role: ${values.role}`);
  if (password.length < 12) throw new Error('STAFF_PASSWORD must be at least 12 characters');

  const app = await NestFactory.createApplicationContext(AppModule.forRole(loadConfig(), 'cli'), {
    logger: false,
    abortOnError: false,
  });
  const id = await app.get(AuthService).createStaffUser({
    email: values.email.toLowerCase(),
    password,
    role: values.role as Role,
    ...(values.name ? { displayName: values.name } : {}),
  });
  console.log(`created ${values.role} ${values.email} (${id})`);
  await app.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
