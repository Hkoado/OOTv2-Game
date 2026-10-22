import React from 'react';
import { OTTBoard } from './ott-v2-ui-kit/react/index.mjs';
import { boardOptions } from './boardAdapter.js';

export default function GameBoard(props) {
  return <OTTBoard {...boardOptions(props)} />;
}