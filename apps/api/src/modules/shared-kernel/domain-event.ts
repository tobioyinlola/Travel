/** What a module hands to `tx.publish()`. The platform fills in id, producer, time and correlation id. */
export interface DomainEventInput<TPayload = Record<string, unknown>> {
  type: string;
  version: number;
  payload: TPayload;
}
