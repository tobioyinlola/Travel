import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '../../config.js';
import { AssistantService } from './application/assistant.service.js';
import { IndexerService } from './application/indexer.service.js';
import { MODEL_PORT } from './application/model.port.js';
import { AiAdminController, AiController } from './http/ai.controller.js';
import { FakeModel } from './infrastructure/fake-model.js';

/**
 * Ai module (top layer). Retrieval Q&A over catalog, partner and course content plus the advisor's own client
 * notes, and drafts that need advisor approval (FR-AI). Owns schema: ai.
 * Model: a stand-in until the hosted model is chosen (decision D8) behind `ModelPort`.
 */
@Module({})
export class AiModule {
  static forRoot(config: AppConfig): DynamicModule {
    if (config.PROVIDERS_MODE !== 'fake')
      throw new Error('Live model adapter not implemented yet (decision D8)');
    return {
      module: AiModule,
      controllers: [AiController, AiAdminController],
      providers: [
        AssistantService,
        IndexerService,
        { provide: MODEL_PORT, useValue: new FakeModel() },
      ],
      exports: [],
    };
  }
}
