import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class RefreshTokenDto {
  // Optional only for the cookie-based flow. The controller still rejects a
  // missing token in legacy/dual browserless refresh, preserving the old 400.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  refreshToken?: string;
}
