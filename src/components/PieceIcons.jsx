import React from 'react';
import { Hammer, Hand, Scissors } from 'lucide-react';

/**
 * Sử dụng icon có sẵn từ thư viện Lucide React
 * Thân icon được fill màu trắng (#ffffff), đường nét họa tiết viền đen (#0f172a)
 */
export function PieceSvg({ type, className = "w-6 h-6" }) {
  const iconProps = {
    className,
    fill: "#ffffff",
    stroke: "#0f172a",
    strokeWidth: 2,
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
