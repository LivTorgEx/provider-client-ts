import type { JsonValue } from "./json.js";

export type MappingRule = {
  target: string;
  source?: string;
  value?: JsonValue;
  operation?: string;
};

export type MappingContextRequest = {
  name: string;
  operation: string;
  input: JsonValue;
  mapping: MappingDocument;
  cache?: {
    mode: string;
    ttl_seconds: number;
    scope: string;
  } | null;
};

export type MappingDocument = {
  rules: MappingRule[];
  context?: MappingContextRequest[];
};

export type WebSocketFeatureSelector = {
  kind: "websocket";
  code: string;
  inst_type?: string;
};

export type FeatureOperation = {
  websocket_operation_code: string;
  input_mapping: MappingDocument | null;
  output_mapping: MappingDocument | null;
  router_key?: { request_program: string; frame_program: string } | null;
  match_condition?: string | null;
  match_priority: number;
};

export type FeatureLifecycleOperation = {
  phase: "before" | "after";
  sequence: number;
  websocket_operation_code: string;
  input_mapping: MappingDocument;
};

export type WebSocketOperation = {
  code: string;
  max_frame_bytes: number;
};

export type WebSocketStep = {
  operation: string;
  input_mapping: MappingDocument;
};

export type PublicWebSocketFeatureInstructions = {
  kind: "websocket";
  code: string;
  inst_type: string | null;
  feature_operations: FeatureOperation[];
  feature_lifecycle_operations: FeatureLifecycleOperation[];
  connection: {
    url: string;
    frame_mode: "text" | "binary";
    max_frame_bytes: number;
    start_steps: WebSocketStep[];
    logout_steps: WebSocketStep[];
    has_on_message_rules: boolean;
    heartbeat: {
      enabled: boolean;
      interval_ms: number;
      operation: string | null;
      message: string | null;
      input_mapping: MappingDocument;
    };
    operations: WebSocketOperation[];
  };
};

export type PublicFeaturesRequest = {
  features: WebSocketFeatureSelector[];
};

export type PublicFeaturesResponse = {
  features: PublicWebSocketFeatureInstructions[];
};
