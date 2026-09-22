import React from 'react';
import { Hammer, Hand, Scissors } from 'lucide-react';

/**
 * Icon quân cờ Oẳn Tù Tì v2
 * Sử dụng nét vẽ gốc tự nhiên từ Lucide React (stroke: currentColor), loại bỏ viền đen thân trắng
 */
export function PieceSvg({ type, className = "w-6 h-6", strokeWidth = 2.2 }) {
  const iconProps = {
    className,
    stroke: "currentColor",
    fill: "none",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  if (type === 'rock') {
    return <Hammer {...iconProps} />;
  }

  if (type === 'paper') {
    return <Hand {...iconProps} />;
  }

  if (type === 'scissors') {
    return <Scissors {...iconProps} />;
  }

  return null;
}

