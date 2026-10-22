import React from 'react';
import '../../ui/ott-v2-ui-kit/ui-kit.css';
import './tournament.css';
import LocalCore from './LocalCore.jsx';
import { useTournamentTheme } from './tournamentTheme.js';

export default function CampusPortal() {
  const { theme, toggleTheme } = useTournamentTheme();
  return <div className="ott-ui tournament-app" data-theme={theme}>
    <LocalCore theme={theme} onToggleTheme={toggleTheme} />
  </div>;
}
