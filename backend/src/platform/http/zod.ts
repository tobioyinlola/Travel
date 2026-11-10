import { applyDecorators, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

/** Zod schema -> OpenAPI 3.0 schema object (zod 4 has a built-in JSON Schema generator). */
export function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value); // ZodError -> 400 problem details (ProblemDetailsFilter)
  }
}

function describeMethod(
  target: object,
  key: string | symbol | undefined,
  decorator: MethodDecorator,
): void {
  if (key === undefined) return;
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor) decorator(target, key, descriptor);
}

/** `@ZBody(schema) body: z.infer<typeof schema>`: validates the body and documents it in OpenAPI. */
export function ZBody(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    describeMethod(target, key, ApiBody({ schema: openApiSchema(schema) }));
    Body(new ZodPipe(schema))(target, key, index);
  };
}

/** `@ZQuery(schema) query`: validates the query string and documents each property. */
export function ZQuery(schema: z.ZodObject): ParameterDecorator {
  return (target, key, index) => {
    const json = openApiSchema(schema) as {
      properties?: Record<string, object>;
      required?: string[];
    };
    for (const [name, prop] of Object.entries(json.properties ?? {})) {
      describeMethod(
        target,
        key,
        ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: prop as never }),
      );
    }
    Query(new ZodPipe(schema))(target, key, index);
  };
}

/** Documents a response body with a zod schema. */
export function ZResponse(
  status: number,
  schema: z.ZodType,
  description?: string,
): MethodDecorator {
  return applyDecorators(
    ApiResponse({ status, description, schema: openApiSchema(schema) as never }),
  );
}
