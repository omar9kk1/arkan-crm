import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TrashPropertyDto {
  /** Optional Manager note explaining why the property was moved to Trash. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
