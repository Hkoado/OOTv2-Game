import React from 'react';
import tokens from '../../../docs/ui-style/tokens.json';
import '../../../docs/ui-style/tokens.css';
import './tournament.css';
import LocalCore from './LocalCore.jsx';
import { useTournamentTheme } from './tournamentTheme.js';

/** Chuyển token JSON thành CSS custom properties cho theme đang chọn. */
function themeVariables(value, prefix = '--ott') {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      entry && typeof entry === 'object'
        ? Object.entries(themeVariables(entry, `${prefix}-${key}`))
        : [[`${prefix}-${key}`, entry]]
    )
  );
}

/**
 * Vỏ duy nhất của ứng dụng: theme + cổng giải đấu.
 * Không có tab phòng chơi/spectator — các luồng đó nằm trong `LegacyApp.jsx` và không được mount.
 */
export default function CampusPortal() {
  const { theme, toggleTheme } = useTournamentTheme();

  return (
    <div className="tournament-app" data-theme={theme} style={themeVariables(tokens.themes[theme])}>
      <LocalCore theme={theme} onToggleTheme={toggleTheme} />
    </div>
  );
}
