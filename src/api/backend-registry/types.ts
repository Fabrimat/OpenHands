export type BackendKind = "local" | "cloud";
export type BackendAuthMode = "api-key" | "cookie";

export interface Backend {
  id: string;
  name: string;
  host: string;
  apiKey: string;
  kind: BackendKind;
  authMode?: BackendAuthMode;
  /** Changes whenever connection credentials change, invalidating keyed data. */
  connectionRevision?: number;
  /** Per-browser choice of the server that stores shared project data. */
  isPrimary?: boolean;
}

export interface BackendSelection {
  backendId: string;
  orgId?: string | null;
}

export interface ResolvedActiveBackend {
  backend: Backend;
  orgId: string | null;
}
