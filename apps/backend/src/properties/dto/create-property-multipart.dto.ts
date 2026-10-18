import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The only non-file field accepted by `POST /properties`. */
export class CreatePropertyMultipartDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  payload!: string;
}
