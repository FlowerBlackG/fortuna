// SPDX-License-Identifier: MulanPSL-2.0
import { createContext, useContext } from "react";
import type { AssetRecord, Metadata } from "./types";

export const emptyMetadata: Metadata = {
  currencies: [],
  institutions: [],
  asset_types: [],
  settings: {},
};
export const MetadataContext = createContext<{
  metadata: Metadata;
  refresh: () => Promise<Metadata>;
  ensure: (records: AssetRecord[]) => Promise<void>;
  update: (change: (metadata: Metadata) => Metadata) => void;
  loading: boolean;
  error: string;
}>({
  metadata: emptyMetadata,
  refresh: async () => emptyMetadata,
  ensure: async () => {},
  update: () => {},
  loading: true,
  error: "",
});
export function useMetadata() {
  return useContext(MetadataContext);
}
