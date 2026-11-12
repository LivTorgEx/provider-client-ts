import { applyMapping, assertMappingSupported, type MappingContext } from "../mapping/index.js";
import type {
  FeatureLifecycleOperation,
  JsonValue,
  PublicWebSocketFeatureInstructions,
  PublicTrade,
  WebSocketOperation,
  WebSocketStep,
} from "../types/index.js";
import type { WebSocketFactory, WebSocketLike } from "../types/websocket.js";

export type DirectFeatureOptions = {
  instructions: PublicWebSocketFeatureInstructions;
  requestedFeatureCode: string;
  providerCode: string;
  input: JsonValue;
  createWebSocket: WebSocketFactory;
  onTrade: (trade: PublicTrade) => void;
  onOpen: () => void;
  onFailure: (reason: string) => void;
};

export function connectDirectFeature(options: DirectFeatureOptions): () => void {
  assertDirectInstructions(options.instructions, options.requestedFeatureCode);

  const { instructions } = options;
  const socket = options.createWebSocket(instructions.connection.url);
  let stopped = false;
  let activated = false;
  let failureReported = false;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (connectTimer !== undefined) clearTimeout(connectTimer);
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
    connectTimer = undefined;
    heartbeatTimer = undefined;

    if (activated) {
      for (const operation of lifecycleOperations(instructions, "after")) {
        try {
          sendLifecycle(socket, instructions, options.providerCode, operation, options.input);
        } catch {
          // The provider connection may already be closing.
        }
      }
      for (const step of instructions.connection.logout_steps) {
        try {
          sendStep(socket, instructions, options.providerCode, options.input, step);
        } catch {
          // The provider connection may already be closing.
        }
      }
    }
    if (socket.readyState < 2) socket.close();
  };

  const fail = (reason: string) => {
    if (stopped || failureReported) return;
    failureReported = true;
    options.onFailure(reason);
  };

  connectTimer = setTimeout(() => {
    if (!activated) fail("Direct provider WebSocket connection timed out");
  }, 10_000);

  socket.onopen = () => {
    if (stopped) return;
    if (connectTimer !== undefined) clearTimeout(connectTimer);
    connectTimer = undefined;
    try {
      for (const step of instructions.connection.start_steps) {
        sendStep(socket, instructions, options.providerCode, options.input, step);
      }
      for (const operation of lifecycleOperations(instructions, "before")) {
        sendLifecycle(socket, instructions, options.providerCode, operation, options.input);
      }
      activated = true;
      options.onOpen();
      heartbeatTimer = startHeartbeat(socket, instructions, options.providerCode, options.input);
    } catch (error) {
      fail(errorMessage(error));
    }
  };

  socket.onmessage = (event) => {
    if (stopped || typeof event.data !== "string") return;
    if (new TextEncoder().encode(event.data).byteLength > instructions.connection.max_frame_bytes) {
      fail("Direct provider WebSocket frame exceeds the public feature limit");
      return;
    }

    let frame: JsonValue;
    try {
      frame = JSON.parse(event.data) as JsonValue;
    } catch {
      return;
    }

    for (const mapping of instructions.feature_operations) {
      if (!mapping.output_mapping) continue;
      try {
        const mapped = applyMapping<PublicTrade | PublicTrade[]>(
          mapping.output_mapping,
          frame,
          contextFor(options.providerCode, options.input),
        );
        for (const trade of flattenTrades(mapped)) options.onTrade(trade);
      } catch (error) {
        fail(errorMessage(error));
        return;
      }
    }
  };

  socket.onerror = () => fail("Direct provider WebSocket connection failed");
  socket.onclose = () => {
    if (!stopped) fail("Direct provider WebSocket closed");
  };

  return stop;
}

function assertDirectInstructions(
  instructions: PublicWebSocketFeatureInstructions,
  requestedFeatureCode: string,
): void {
  if (instructions.kind !== "websocket" || instructions.code !== requestedFeatureCode) {
    throw new Error("Public feature response does not match the requested WebSocket feature");
  }
  if (new URL(instructions.connection.url).protocol !== "wss:") {
    throw new Error("Direct public subscriptions require WSS");
  }
  if (instructions.connection.frame_mode !== "text") {
    throw new Error("Direct subscriptions currently support text WebSocket frames only");
  }
  if (instructions.connection.has_on_message_rules) {
    throw new Error("Catalog WebSocket message rules are not supported by this client version");
  }

  for (const step of [...instructions.connection.start_steps, ...instructions.connection.logout_steps]) {
    assertMappingSupported(step.input_mapping);
    findOperation(instructions, step.operation);
  }
  for (const operation of instructions.feature_operations) {
    findOperation(instructions, operation.websocket_operation_code);
    if (operation.match_condition || operation.router_key) {
      throw new Error("Catalog trade routing expressions are not supported by this client version");
    }
    if (operation.input_mapping) assertMappingSupported(operation.input_mapping);
    if (!operation.output_mapping) {
      throw new Error("Catalog trade operation has no output mapping");
    }
    assertMappingSupported(operation.output_mapping);
  }
  for (const operation of instructions.feature_lifecycle_operations) {
    findOperation(instructions, operation.websocket_operation_code);
    assertMappingSupported(operation.input_mapping);
  }

  const heartbeat = instructions.connection.heartbeat;
  if (heartbeat.operation !== null) {
    findOperation(instructions, heartbeat.operation);
    assertMappingSupported(heartbeat.input_mapping);
  }
}

function lifecycleOperations(
  instructions: PublicWebSocketFeatureInstructions,
  phase: FeatureLifecycleOperation["phase"],
): FeatureLifecycleOperation[] {
  return instructions.feature_lifecycle_operations
    .filter((operation) => operation.phase === phase)
    .sort((left, right) => left.sequence - right.sequence);
}

function startHeartbeat(
  socket: WebSocketLike,
  instructions: PublicWebSocketFeatureInstructions,
  providerCode: string,
  input: JsonValue,
): ReturnType<typeof setInterval> | undefined {
  const heartbeat = instructions.connection.heartbeat;
  if (!heartbeat.enabled || heartbeat.interval_ms <= 0) return undefined;

  return setInterval(() => {
    if (socket.readyState !== 1) return;
    try {
      if (heartbeat.message !== null) socket.send(heartbeat.message);
      else if (heartbeat.operation !== null) {
        sendOperation(
          socket,
          instructions,
          providerCode,
          heartbeat.operation,
          heartbeat.input_mapping,
          input,
        );
      }
    } catch {
      socket.close();
    }
  }, heartbeat.interval_ms);
}

function sendLifecycle(
  socket: WebSocketLike,
  instructions: PublicWebSocketFeatureInstructions,
  providerCode: string,
  operation: FeatureLifecycleOperation,
  input: JsonValue,
): void {
  sendOperation(
    socket,
    instructions,
    providerCode,
    operation.websocket_operation_code,
    operation.input_mapping,
    input,
  );
}

function sendStep(
  socket: WebSocketLike,
  instructions: PublicWebSocketFeatureInstructions,
  providerCode: string,
  input: JsonValue,
  step: WebSocketStep,
): void {
  sendOperation(socket, instructions, providerCode, step.operation, step.input_mapping, input);
}

function sendOperation(
  socket: WebSocketLike,
  instructions: PublicWebSocketFeatureInstructions,
  providerCode: string,
  operationCode: string,
  mapping: WebSocketStep["input_mapping"],
  input: JsonValue,
): void {
  const operation = findOperation(instructions, operationCode);
  const output = applyMapping(mapping, input, contextFor(providerCode, input));
  const serialized = JSON.stringify(output);
  if (new TextEncoder().encode(serialized).byteLength > operation.max_frame_bytes) {
    throw new Error("Catalog WebSocket request exceeds the operation frame limit");
  }
  socket.send(serialized);
}

function findOperation(
  instructions: PublicWebSocketFeatureInstructions,
  code: string,
): WebSocketOperation {
  const operation = instructions.connection.operations.find((candidate) => candidate.code === code);
  if (!operation) throw new Error(`Catalog WebSocket operation is unavailable: ${code}`);
  return operation;
}

function contextFor(providerCode: string, input: JsonValue): MappingContext {
  return { input, provider_code: providerCode, state: {} };
}

function flattenTrades(value: PublicTrade | PublicTrade[]): PublicTrade[] {
  return Array.isArray(value) ? value.flatMap(flattenTrades) : [value];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown WebSocket failure";
}
