import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** The browser's Push API subscription keys (RFC 8291). */
export class PushKeysDto {
  @IsString()
  @Length(20, 200)
  p256dh!: string;

  @IsString()
  @Length(10, 100)
  auth!: string;
}

/**
 * Body of `PUT /push/subscriptions`.
 *
 * The subscription is bound to the AUTHENTICATED manager and to the session
 * lineage the server resolved from the live session — never to an id the
 * browser supplies.
 */
export class SubscribePushDto {
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  /** Optional, for display only (never used for authorization). */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  userAgent?: string;
}

/** Body of `DELETE /push/subscriptions` — the endpoint of THIS device. */
export class UnsubscribePushDto {
  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  endpoint?: string;
}
