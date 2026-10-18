import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE = 'rawResponse';

/**
 * Marks a handler whose response must not be wrapped by the global
 * ResponseInterceptor (used for binary image streaming).
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);
