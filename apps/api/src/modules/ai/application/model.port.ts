export interface SourceForModel {
  id: string;
  title: string;
  type: string;
  text: string;
}

/**
 * The language model behind the assistant (ARCH `ModelPort`; decision D8: hosted model). Adapters must treat
 * `sources` as untrusted quoted data, never as instructions, and must only use what the sources say.
 */
export interface ModelPort {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
  generate(input: {
    task: 'answer' | 'draft';
    question: string;
    sources: SourceForModel[];
    recipientFirstName?: string;
  }): Promise<{ text: string; citedSourceIds: string[] }>;
}

export const MODEL_PORT = Symbol('ModelPort');
