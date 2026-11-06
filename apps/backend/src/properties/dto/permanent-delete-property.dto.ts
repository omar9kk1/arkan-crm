import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PermanentDeletePropertyDto {
  /** The Manager must type the exact property code to confirm. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  confirmationCode!: string;
}
