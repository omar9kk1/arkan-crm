import { IsBoolean } from 'class-validator';

/**
 * Body of `PATCH /employees/:id/activation`.
 *
 * The desired account state is the ONLY accepted field. Role, email, name and
 * password are not just ignored — the global ValidationPipe rejects any
 * non-whitelisted field with 400 — so this operation can never be used to
 * escalate or rewrite an account.
 */
export class SetEmployeeActivationDto {
  @IsBoolean()
  isActive!: boolean;
}
