import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

/** How long to wait before trying again by itself after a failed load. */
const RETRY_MS = 10000;

/** Keeps retrying a failed load while the screen is open. */
export function useRetry(failures: number, load: () => void) {
  useFocusEffect(
    useCallback(() => {
      if (failures === 0) return;
      const timer = setTimeout(load, RETRY_MS);
      return () => clearTimeout(timer);
    }, [failures, load]),
  );
}
