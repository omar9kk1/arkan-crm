export interface ApiResponse<T> {
  data: T;
}
export interface ApiError {
  error: { statusCode: number; message: string | string[]; path: string };
}
