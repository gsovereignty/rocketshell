import { createPlatformTelemetry, type PlatformTelemetry } from "@project/platform-nap-contract";

/** The application-wide metric sink. Every service in this directory records through it. */
export const telemetry: PlatformTelemetry = createPlatformTelemetry();
