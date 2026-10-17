import { memo, useId, type CSSProperties } from "react";

// Decorative artwork, independent of account balances and financial reports.
export default memo(function EarningsScene() {
  const gradient = useId().replaceAll(":", "");
  return (
    <div className="earnings-scene">
      <div className="earnings-orb orb-gold" />
      <div className="earnings-orb orb-green" />
      <div className="wealth-waves" aria-hidden="true">
        <div className="wealth-aura" />
        <svg
          className="wealth-ribbons"
          viewBox="0 0 1440 900"
          preserveAspectRatio="none"
          fill="none"
        >
          <defs>
            <linearGradient id={`${gradient}-gold-wave`} x2="1" y2="0">
              <stop stopColor="#8b652c" stopOpacity=".1" />
              <stop offset=".17" stopColor="#e1b964" />
              <stop offset=".36" stopColor="#fff0bd" />
              <stop offset=".55" stopColor="#a18142" stopOpacity=".25" />
              <stop offset=".78" stopColor="#f7d894" />
              <stop offset="1" stopColor="#98743a" stopOpacity=".3" />
            </linearGradient>
          </defs>
          <g className="wealth-ribbon wealth-ribbon-front">
            {Array.from({ length: 19 }, (_, index) => (
              <path
                key={index}
                d={`M-120 ${630 + index * 6} C180 ${400 + index * 9} 295 ${810 - index * 3} 720 ${738 - index * 5} S1150 ${450 + index * 10} 1560 ${580 + index * 6}`}
                stroke={`url(#${gradient}-gold-wave)`}
                opacity={0.22 + (index % 5) * 0.11}
              />
            ))}
            <path
              className="wealth-wave-glint"
              pathLength="1"
              d="M-120 678 C180 472 295 786 720 698 S1150 530 1560 628"
              stroke="#ffe7ab"
            />
          </g>
          <g className="wealth-ribbon wealth-ribbon-back">
            {Array.from({ length: 13 }, (_, index) => (
              <path
                key={index}
                d={`M-120 ${300 + index * 10} C180 ${65 + index * 7} 230 ${420 + index * 8} 630 ${285 + index * 2} S1120 ${50 + index * 7} 1560 ${190 + index * 10}`}
                stroke={`url(#${gradient}-gold-wave)`}
                opacity={0.15 + (index % 4) * 0.08}
              />
            ))}
          </g>
        </svg>
        <div className="wealth-dust">
          {Array.from({ length: 16 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  left: `${4 + ((index * 29) % 92)}%`,
                  top: `${15 + ((index * 19) % 70)}%`,
                  "--dust-delay": `${index * -1.3}s`,
                  "--dust-size": `${index % 3 === 0 ? 3 : 2}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>
      <div className="earnings-coin coin-main">
        <div className="coin-body">
          <span>₹</span>
          <i />
        </div>
        <div className="coin-shadow" />
      </div>
      <div className="earnings-coin coin-small">
        <div className="coin-body">
          <span>₹</span>
          <i />
        </div>
      </div>
      <div className="earnings-panel earnings-progress">
        <div className="earnings-panel-top">
          <i />
          <span>THE EARNING JOURNEY</span>
          <b>↗</b>
        </div>
        <div className="earnings-panel-title">
          Small steps.
          <br />
          <em>Greater possibilities.</em>
        </div>
        <div className="earnings-bars-scene">
          <div className="earnings-bars-floor" />
          <div className="earnings-bars">
            {[32, 53, 74, 100, 130].map((height, index) => (
              <div
                className={`earnings-bar bar-${index}`}
                key={index}
                style={
                  {
                    "--bar-size": `${height}px`,
                    "--bar-order": index,
                  } as CSSProperties
                }
              >
                <i className="bar-front" />
                <i className="bar-side" />
                <i className="bar-top" />
              </div>
            ))}
          </div>
          <svg className="earnings-rise" viewBox="0 0 260 175" fill="none">
            <path d="M18 121 63 108 107 90 153 71 206 29 239 12" />
            <path d="m218 12 21 0-3 21" />
          </svg>
        </div>
        <div className="earnings-panel-bottom">
          <span>WORK</span>
          <i />
          <span>PROGRESS</span>
          <i />
          <span>REWARDS</span>
        </div>
        <small className="earnings-art-label">GROWTH ILLUSTRATION</small>
      </div>
      <div className="earnings-panel earnings-momentum">
        <div className="earnings-panel-top">
          <i />
          <span>BUILT ON PROGRESS</span>
          <b>↗</b>
        </div>
        <div className="earnings-panel-title">
          Your next
          <br />
          <em>chapter starts here.</em>
        </div>
        <svg className="earnings-line-chart" viewBox="0 0 280 155" fill="none">
          <defs>
            <linearGradient
              id={`${gradient}-fill`}
              x1="140"
              y1="15"
              x2="140"
              y2="150"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#94e3ac" stopOpacity=".3" />
              <stop offset="1" stopColor="#94e3ac" stopOpacity="0" />
            </linearGradient>
            <linearGradient
              id={`${gradient}-line`}
              x1="12"
              y1="130"
              x2="266"
              y2="20"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#61997e" />
              <stop offset="1" stopColor="#e5d095" />
            </linearGradient>
          </defs>
          <g className="earnings-chart-grid">
            {[30, 65, 100, 135].map((y) => (
              <path key={y} d={`M12 ${y} H268`} />
            ))}
            {[18, 78, 138, 198, 258].map((x) => (
              <path key={x} d={`M${x} 15 V145`} />
            ))}
          </g>
          <path
            d="M12 126 C35 126 43 111 60 115 S90 124 109 93 S131 102 150 77 S174 85 190 59 S220 70 238 37 S252 39 267 18 V150 H12Z"
            fill={`url(#${gradient}-fill)`}
          />
          <path
            className="earnings-growth-line"
            pathLength="1"
            d="M12 126 C35 126 43 111 60 115 S90 124 109 93 S131 102 150 77 S174 85 190 59 S220 70 238 37 S252 39 267 18"
            stroke={`url(#${gradient}-line)`}
          />
          <circle className="earnings-chart-halo" cx="267" cy="18" r="12" />
          <circle cx="267" cy="18" r="4" fill="#e5d095" />
          <circle cx="150" cy="77" r="3" fill="#96cf9d" />
        </svg>
        <div className="earnings-panel-bottom">
          <span>ACTIVITY</span>
          <span className="earnings-trend">POSITIVE MOMENTUM ↗</span>
        </div>
        <small className="earnings-art-label">GROWTH ILLUSTRATION</small>
      </div>
      <div className="earnings-orbit-label">
        <span>₹</span> WORK. CONNECT. GROW.
      </div>
    </div>
  );
});
