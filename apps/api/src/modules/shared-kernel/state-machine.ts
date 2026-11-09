/**
 * Fixed transition tables (FRD "State machines"): any transition not listed is rejected.
 */
export class IllegalTransitionError extends Error {
  override readonly name = 'IllegalTransitionError';
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly event: string,
  ) {
    super(`${machine}: no transition from ${from} on ${event}`);
  }
}

export interface Transition<S extends string, E extends string> {
  from: readonly S[];
  event: E;
  to: S;
}

export class StateMachine<S extends string, E extends string> {
  constructor(
    readonly name: string,
    private readonly transitions: readonly Transition<S, E>[],
  ) {}

  next(from: S, event: E): S {
    const t = this.transitions.find((x) => x.event === event && x.from.includes(from));
    if (!t) throw new IllegalTransitionError(this.name, from, event);
    return t.to;
  }

  can(from: S, event: E): boolean {
    return this.transitions.some((x) => x.event === event && x.from.includes(from));
  }
}
