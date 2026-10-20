import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * Body of `POST /clients/:id/follow-ups`.
 *
 * The follow-up's structured detail (method/outcome/note) is stored inside the
 * existing `FollowUp.notes` column as a small JSON object, because the schema
 * has no dedicated columns for it and no migration may run without approval.
 * The service owns the packing so the read path always returns parsed fields.
 */
export class CreateClientFollowUpDto {
  /** Calendar date the next contact is due (YYYY-MM-DD). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dueAt must be a YYYY-MM-DD date',
  })
  dueAt!: string;

  /** Contact method: اتصال / رسالة / معاينة (free text, bounded). */
  @IsString()
  @Length(1, 50)
  method!: string;

  /** Result of the contact, required exactly like the existing form. */
  @IsString()
  @Length(1, 250)
  outcome!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
