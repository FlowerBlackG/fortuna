// SPDX-License-Identifier: MulanPSL-2.0
import type { IResponse } from "./response.js";

export type ConnectionMode = "builtin" | "file" | "remote";
export interface DesktopRuntime {
  mode: ConnectionMode;
  remote: string;
  databaseName: string;
  fileSession: string;
  error: string;
}
export interface DesktopAPI {
  runtime(): Promise<DesktopRuntime>;
  setMode(mode: ConnectionMode): Promise<DesktopRuntime>;
  chooseDatabase(action: "open" | "create"): Promise<boolean>;
  connect(address: string): Promise<void>;
  ping<T>(address: string): Promise<IResponse<T>>;
  request<T>(
    mode: ConnectionMode,
    address: string,
    token: string,
    method: string,
    route: string,
    data?: unknown,
  ): Promise<IResponse<T>>;
  reveal(): Promise<void>;
  backup(): Promise<boolean>;
  onUnavailable(callback: (message: string) => void): () => void;
}
export type DesktopOperations = Omit<DesktopAPI, "onUnavailable">;
