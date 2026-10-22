/**
 * tournamentTheme.js — Lựa chọn theme sáng/tối cho cổng giải đấu.
 * Chỉ lưu một khoá localStorage; mặc định là theme tối kiểu "arena".
 */
import { useCallback, useEffect, useState } from 'react';

export const THEME_STORAGE_KEY = 'oot_tournament_theme';
export const DEFAULT_THEME = 'dark';

export function resolveTheme(value) {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}

export function nextTheme(current) {
  return current === 'light' ? 'dark' : 'light';
}

function readStoredTheme() {
  try {
    return resolveTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyDocumentTheme(theme) {
  try {
    document.documentElement.dataset.theme = resolveTheme(theme);
    document.documentElement.style.colorScheme = resolveTheme(theme);
  } catch {
    /* SSR/test: bỏ qua */
  }
}

export function useTournamentTheme() {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    applyDocumentTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = nextTheme(current);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* chế độ riêng tư: chỉ đổi trong phiên */
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}

export default { useTournamentTheme, resolveTheme, nextTheme, THEME_STORAGE_KEY };
