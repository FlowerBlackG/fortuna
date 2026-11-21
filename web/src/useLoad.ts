// SPDX-License-Identifier: MulanPSL-2.0
import { t } from "./i18n";
import { useCallback, useEffect, useRef, useState } from "react";

export function useLoad<T>(load: () => Promise<T>, dependencies: unknown[]) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  const generation = useRef(0);
  const pending = useRef<Promise<T> | null>(null);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      if (!pending.current)
        pending.current = loader.current().finally(() => {
          pending.current = null;
        });
      const result = await pending.current;
      if (current === generation.current) setData(result);
      return result;
    } catch (reason) {
      if (current === generation.current)
        setError(reason instanceof Error ? reason.message : t("Loading failed"));
      throw reason;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const counter = generation;
    void refresh().catch(() => {});
    return () => {
      counter.current++;
    };
    // Resource identity is supplied by each caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  return { data, setData, loading, error, refresh };
}
