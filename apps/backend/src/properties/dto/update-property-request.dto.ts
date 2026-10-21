import { IsOptional, IsString, MaxLength } from 'class-validator';
import { UpdatePropertyPayloadDto } from './update-property-payload.dto';

/**
 * The request body of `PATCH /properties/:id`.
 *
 * Two shapes are accepted:
 * - a plain JSON body with the edit fields (the common case, no image); and
 * - a multipart body that carries the SAME fields plus one `image` file — a
 *   replacement of the property's primary image. The fields travel in a
 *   `payload` JSON string (exactly like `POST /properties`), so the strict
 *   field allowlist is still enforced by `parseAndValidatePayload`.
 *
 * The `version` field is mandatory in both shapes (optimistic concurrency).
 */
export class UpdatePropertyRequestDto extends UpdatePropertyPayloadDto {
  /** The edit fields as a JSON string, when the request is multipart. */
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  payload?: string;
}
