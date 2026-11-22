// SPDX-License-Identifier: MulanPSL-2.0

export interface BuildInfo {
  tag: string;
  code?: number;
  buildTime?: string;
}

export interface ServerInfo extends BuildInfo {
  environment?: "development" | "staging" | "production";
}

export default class Version {
  static code = 1;
  static tag = "1.0.0";

  /** in iso8601 format */
  static buildTime = "2026-11-22T20:50:36+08:00";

  private constructor() {}
}
