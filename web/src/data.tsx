// SPDX-License-Identifier: MulanPSL-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { request } from "./api";
import { emptyMetadata, MetadataContext } from "./metadata";
import type { AssetRecord, Metadata } from "./types";

export function MetadataProvider({ children }: { children: ReactNode }) {
  const [metadata, setMetadata] = useState(emptyMetadata);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latest = useRef(emptyMetadata);
  const revision = useRef(0);
  const pending = useRef<Promise<Metadata> | null>(null);
  const update = useCallback((change: (metadata: Metadata) => Metadata) => {
    revision.current++;
    latest.current = change(latest.current);
    setMetadata(latest.current);
  }, []);
  const refresh = useCallback(() => {
    if (pending.current) return pending.current;
    const version = revision.current;
    setLoading(true);
    setError("");
    pending.current = request<Metadata>("GET", "/metadata")
      .then((data) => {
        // A response started before a successful edit must not overwrite that edit.
        if (revision.current === version) {
          latest.current = data;
          setMetadata(data);
        }
        return latest.current;
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not refresh metadata");
        throw reason;
      })
      .finally(() => {
        pending.current = null;
        setLoading(false);
      });
    return pending.current;
  }, []);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);
  const ensure = useCallback(
    async (records: AssetRecord[]) => {
      if (pending.current) await pending.current;
      const current = latest.current;
      if (
        records.some(
          (record) =>
            !current.currencies.some((item) => item.currency_id === record.currency_id) ||
            !current.institutions.some((item) => item.institution_id === record.institution_id) ||
            !current.asset_types.some((item) => item.asset_type_id === record.asset_type_id),
        )
      )
        await refresh();
    },
    [refresh],
  );
  return (
    <MetadataContext.Provider value={{ metadata, refresh, ensure, update, loading, error }}>
      {children}
    </MetadataContext.Provider>
  );
}
