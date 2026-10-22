import React, { useLayoutEffect, useRef } from 'react';
import { createAsset } from '../ui/ott-v2-ui-kit/assets.mjs';
export function PieceSvg({ type, className = '' }) {
  const host = useRef(null);
  useLayoutEffect(() => { host.current.replaceChildren(createAsset(type, { label: type })); }, [type]);
  return <span className={`piece-symbol ${className}`} ref={host} />;
}
