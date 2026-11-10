/**
 * OpenTelemetry bootstrap. Off by default; enable with OTEL_ENABLED=true and the standard OTEL_* exporter
 * variables. Install @opentelemetry/sdk-node and @opentelemetry/auto-instrumentations-node when the APM
 * vendor is chosen (Sprint 10 hardening); until then this is a no-op hook so entry points stay stable.
 */
export async function startTracing(enabled: boolean): Promise<void> {
  if (!enabled) return;
  const sdkModule = '@opentelemetry/sdk-node';
  const autoModule = '@opentelemetry/auto-instrumentations-node';
  try {
    const { NodeSDK } = await import(sdkModule);
    const { getNodeAutoInstrumentations } = await import(autoModule);
    new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] }).start();
  } catch {
    console.warn(
      'OTEL_ENABLED=true but OpenTelemetry packages are not installed; tracing disabled',
    );
  }
}
