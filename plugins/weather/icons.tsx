import type { SVGProps } from 'react';

import { splitSymbol } from './met';

/**
 * Line icons for MET symbol codes, drawn on a 32 × 32 grid with currentColor.
 * A handful of shapes cover every code: sun or moon, cloud, drops, flakes,
 * fog lines, and a bolt. Combinations are layered.
 */

type IconProps = SVGProps<SVGSVGElement> & { code: string };

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Sun({ small = false }: { small?: boolean }) {
  const cx = small ? 21 : 16;
  const cy = small ? 10 : 15;
  const r = small ? 4 : 6;
  const rays = Array.from({ length: 8 }, (_, i) => (i * 360) / 8);
  return (
    <g {...stroke}>
      <circle cx={cx} cy={cy} r={r} />
      {rays.map((angle) => (
        <line
          key={angle}
          x1={cx}
          y1={cy - r - 2.5}
          x2={cx}
          y2={cy - r - 5}
          transform={`rotate(${angle} ${cx} ${cy})`}
        />
      ))}
    </g>
  );
}

function Moon({ small = false }: { small?: boolean }) {
  return small ? (
    <path {...stroke} d="M24 6a5 5 0 1 0 3 9 5.5 5.5 0 0 1-3-9Z" />
  ) : (
    <path {...stroke} d="M18 7a8 8 0 1 0 8 12 9 9 0 0 1-8-12Z" />
  );
}

function Cloud({ lifted = false }: { lifted?: boolean }) {
  const dy = lifted ? 3 : 0;
  return (
    <path
      {...stroke}
      transform={`translate(0 ${dy})`}
      d="M9 24h14a5 5 0 0 0 .6-10A7 7 0 0 0 10 15.5 4.3 4.3 0 0 0 9 24Z"
    />
  );
}

function Drops({ heavy = false }: { heavy?: boolean }) {
  const xs = heavy ? [10, 14, 18, 22] : [12, 16, 20];
  return (
    <g {...stroke}>
      {xs.map((x) => (
        <line key={x} x1={x} y1={26} x2={x - 1.5} y2={30} />
      ))}
    </g>
  );
}

function Flakes({ heavy = false }: { heavy?: boolean }) {
  const xs = heavy ? [10, 14.5, 19, 23] : [12, 16.5, 21];
  return (
    <g {...stroke}>
      {xs.map((x) => (
        <g key={x}>
          <line x1={x} y1={26.5} x2={x} y2={30} />
          <line x1={x - 1.5} y1={27.4} x2={x + 1.5} y2={29.1} />
          <line x1={x + 1.5} y1={27.4} x2={x - 1.5} y2={29.1} />
        </g>
      ))}
    </g>
  );
}

function Sleet() {
  return (
    <g {...stroke}>
      <line x1={12} y1={26} x2={10.5} y2={30} />
      <line x1={17} y1={26.5} x2={17} y2={30} />
      <line x1={15.5} y1={27.4} x2={18.5} y2={29.1} />
      <line x1={18.5} y1={27.4} x2={15.5} y2={29.1} />
      <line x1={22} y1={26} x2={20.5} y2={30} />
    </g>
  );
}

function Bolt() {
  return <path {...stroke} d="M17 23l-3 5h4l-2 4" />;
}

function Fog() {
  return (
    <g {...stroke}>
      <line x1={7} y1={19} x2={25} y2={19} />
      <line x1={9} y1={23} x2={23} y2={23} />
      <line x1={11} y1={27} x2={21} y2={27} />
    </g>
  );
}

export function WeatherIcon({ code, ...props }: IconProps) {
  const { base, night } = splitSymbol(code);
  const Sky = night ? Moon : Sun;
  const showers = base.includes('showers');
  const thunder = base.includes('thunder');
  const heavy = base.startsWith('heavy');
  const kind = base.includes('sleet')
    ? 'sleet'
    : base.includes('snow')
      ? 'snow'
      : base.includes('rain')
        ? 'rain'
        : base;

  let layers: React.ReactNode;
  if (base === 'clearsky') layers = <Sky />;
  else if (base === 'fair')
    layers = (
      <>
        <Sky small />
        <Cloud lifted />
      </>
    );
  else if (base === 'partlycloudy')
    layers = (
      <>
        <Sky small />
        <Cloud lifted />
      </>
    );
  else if (base === 'cloudy') layers = <Cloud />;
  else if (base === 'fog')
    layers = (
      <>
        <Cloud lifted />
        <Fog />
      </>
    );
  else {
    const precipitation =
      kind === 'snow' ? (
        <Flakes heavy={heavy} />
      ) : kind === 'sleet' ? (
        <Sleet />
      ) : (
        <Drops heavy={heavy} />
      );
    layers = (
      <>
        {showers && <Sky small />}
        <Cloud lifted={showers} />
        {precipitation}
        {thunder && <Bolt />}
      </>
    );
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...props}>
      {layers}
    </svg>
  );
}
