import { useState, useEffect, useRef, useCallback } from 'react';
import { PortfolioData } from '../types/portfolio';

const POLL_INTERVAL_MS = 20000; // 20 seconds
const FLASH_DURATION_MS = 3000; // 3 seconds

export interface UsePortfolioReturn {
  data: PortfolioData | null;
  loading: boolean;
  error: Error | null;
  lastSyncTime: Date | null;
  secondsSinceSync: number;
  isPolling: boolean;
  flashingAccountIds: Set<string>;
  refetch: () => Promise<void>;
  apiUrl: string;
}

export function usePortfolio(): UsePortfolioReturn {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [secondsSinceSync, setSecondsSinceSync] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [flashingAccountIds, setFlashingAccountIds] = useState<Set<string>>(new Set());

  const previousChangeIdsRef = useRef<Set<string>>(new Set());
  const previousDataRef = useRef<PortfolioData | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getApiUrl = useCallback(() => {
    const apiBase = import.meta.env.VITE_API_BASE;
    if (apiBase) {
      return `${apiBase.replace(/\/$/, '')}/api/portfolio`;
    }
    return '/api/portfolio';
  }, []);

  const fetchData = useCallback(async (isInitial = false) => {
    if (!isInitial) {
      setIsPolling(true);
    }
    try {
      const response = await fetch(getApiUrl(), {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: PortfolioData = await response.json();
      const now = new Date();
      setLastSyncTime(now);
      setSecondsSinceSync(0);
      setError(null);

      // Detect changed accounts by analyzing new change_feed entries or data updates
      const currentChangeIds = new Set((json.change_feed || []).map(c => c.id));
      const newlyAddedChangeEntries = (json.change_feed || []).filter(
        c => !previousChangeIdsRef.current.has(c.id)
      );

      // If we have previous data and received new change events, flash the affected accounts
      if (previousDataRef.current && newlyAddedChangeEntries.length > 0) {
        const affectedAccounts = new Set<string>();
        for (const entry of newlyAddedChangeEntries) {
          if (entry.account_id) {
            affectedAccounts.add(entry.account_id);
          }
        }
        if (affectedAccounts.size > 0) {
          setFlashingAccountIds(affectedAccounts);
          if (flashTimeoutRef.current) {
            clearTimeout(flashTimeoutRef.current);
          }
          flashTimeoutRef.current = setTimeout(() => {
            setFlashingAccountIds(new Set());
          }, FLASH_DURATION_MS);
        }
      }

      previousChangeIdsRef.current = currentChangeIds;
      previousDataRef.current = json;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
      setIsPolling(false);
    }
  }, [getApiUrl]);

  // Initial fetch
  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // 20-second polling interval
  useEffect(() => {
    const pollTimer = setInterval(() => {
      fetchData(false);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(pollTimer);
  }, [fetchData]);

  // 1-second interval to increment secondsSinceSync accurately
  useEffect(() => {
    const tickTimer = setInterval(() => {
      if (lastSyncTime) {
        const diffSeconds = Math.floor((Date.now() - lastSyncTime.getTime()) / 1000);
        setSecondsSinceSync(diffSeconds);
      }
    }, 1000);

    return () => clearInterval(tickTimer);
  }, [lastSyncTime]);

  // Cleanup flash timer on unmount
  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  const refetch = useCallback(async () => {
    await fetchData(false);
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    lastSyncTime,
    secondsSinceSync,
    isPolling,
    flashingAccountIds,
    refetch,
    apiUrl: getApiUrl(),
  };
}
