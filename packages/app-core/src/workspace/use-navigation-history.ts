import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceTab } from "./tabs";

export function useNavigationHistory(tabs: WorkspaceTab[], activeTabId: number) {
  const historyRef = useRef<number[]>([]);
  const indexRef = useRef(-1);
  const navigatingRef = useRef(false);
  const lastActiveTabIdRef = useRef(-1);
  const [, render] = useState(0);

  const push = useCallback((tabId: number) => {
    const history = historyRef.current;
    const index = indexRef.current;
    if (history[index] === tabId) return;
    historyRef.current = [...history.slice(0, index + 1), tabId];
    indexRef.current = historyRef.current.length - 1;
    queueMicrotask(() => render((current) => current + 1));
  }, []);

  useEffect(() => {
    if (activeTabId === lastActiveTabIdRef.current) return;
    lastActiveTabIdRef.current = activeTabId;
    if (navigatingRef.current) {
      navigatingRef.current = false;
      return;
    }
    const tab = tabs.find((candidate) => candidate.id === activeTabId);
    if (!tab || (!tab.document && !tab.pdf && !tab.preview && !tab.deferred && !tab.kind)) return;
    push(activeTabId);
  }, [activeTabId, push, tabs]);

  const nextIndex = (direction: -1 | 1) => {
    let index = indexRef.current + direction;
    while (index >= 0 && index < historyRef.current.length) {
      if (tabs.some((tab) => tab.id === historyRef.current[index])) return index;
      index += direction;
    }
    return -1;
  };

  const go = (direction: -1 | 1) => {
    const index = nextIndex(direction);
    if (index === -1) return;
    navigatingRef.current = true;
    indexRef.current = index;
    render((current) => current + 1);
    return historyRef.current[index];
  };

  return { nextIndex, go };
}
