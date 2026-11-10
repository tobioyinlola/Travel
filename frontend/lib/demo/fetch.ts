import { demoResponse } from './respond';

/** A drop-in `fetch` for openapi-fetch that answers from sample data. A short delay keeps loading states honest. */
export async function demoFetch(request: Request): Promise<Response> {
  let body: unknown;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      body = await request.clone().json();
    } catch {
      body = undefined;
    }
  }
  await new Promise((r) => setTimeout(r, 120));
  return demoResponse(request.method, request.url, body);
}
