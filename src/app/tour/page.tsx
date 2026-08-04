"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./tour.module.css";

const FILM_SECONDS = 108;

type Dot = {
  delay: number;
  left: number;
  size: number;
  top: number;
  tone: "blue" | "gold" | "green" | "red";
};

const strategyRows = [
  ["NY Sweep + FVG", "ES", "3.41", "+$18,420"],
  ["Opening Range Retest", "NQ", "2.87", "+$14,260"],
  ["VWAP Pullback", "GC", "2.52", "+$9,840"],
  ["Momentum Continuation", "CL", "2.31", "+$7,190"],
];

const researchStages = [
  ["01", "Idea discovery", "24 signals"],
  ["02", "Formalization", "8 plans"],
  ["03", "Strategy coding", "6 ready"],
  ["04", "Backtest review", "4 passed"],
  ["05", "Live portfolio", "3 active"],
];

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`${styles.brandMark} ${compact ? styles.compactMark : ""}`} aria-hidden="true">
      <i />
      <b />
    </span>
  );
}

function Eyebrow({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <div className={styles.eyebrow}>
      <span>{index}</span>
      <i />
      <strong>{children}</strong>
    </div>
  );
}

function WindowChrome({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.window}>
      <div className={styles.windowBar}>
        <div className={styles.brandLockup}>
          <BrandMark compact />
          <span>korra</span>
        </div>
        <div className={styles.windowPath}>{label}</div>
        <div className={styles.windowStatus}>
          <i />
          live
        </div>
      </div>
      {children}
    </div>
  );
}

function LineChart({ variant = "blue" }: { variant?: "blue" | "green" | "gold" }) {
  const path =
    variant === "green"
      ? "M2 116 C40 110 54 123 88 98 S145 87 173 73 S218 83 251 55 S312 57 354 33 S423 42 478 10"
      : variant === "gold"
        ? "M2 118 C48 117 57 104 92 106 S148 78 178 83 S230 49 265 63 S322 39 350 44 S425 16 478 20"
        : "M2 119 C35 116 58 100 91 105 S139 79 172 86 S230 50 270 63 S328 34 366 41 S424 17 478 11";

  return (
    <svg className={`${styles.lineChart} ${styles[variant]}`} viewBox="0 0 480 130" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`fill-${variant}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className={styles.chartFill} d={`${path} L478 130 L2 130 Z`} fill={`url(#fill-${variant})`} />
      <path className={styles.chartStroke} d={path} />
      <circle className={styles.chartHead} cx="478" cy={variant === "green" ? 10 : variant === "gold" ? 20 : 11} r="4" />
    </svg>
  );
}

function SceneLabel({
  index,
  title,
  copy,
}: {
  index: string;
  title: React.ReactNode;
  copy: string;
}) {
  return (
    <div className={styles.sceneLabel}>
      <Eyebrow index={index}>Korra operating system</Eyebrow>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function Background() {
  return (
    <div className={styles.background} aria-hidden="true">
      <div className={styles.aurora} />
      <div className={styles.gridFloor} />
      <div className={styles.scanline} />
      <div className={styles.noise} />
    </div>
  );
}

function Film({
  capture,
  onComplete,
}: {
  capture: boolean;
  onComplete: () => void;
}) {
  const dots = useMemo<Dot[]>(
    () =>
      Array.from({ length: 68 }, (_, index) => ({
        delay: (index * 0.23) % 3.4,
        left: 8 + ((index * 37) % 84),
        size: 3 + ((index * 17) % 7),
        top: 8 + ((index * 53) % 80),
        tone: (["blue", "green", "gold", "red"] as const)[index % 4],
      })),
    [],
  );

  useEffect(() => {
    const timeout = window.setTimeout(onComplete, FILM_SECONDS * 1000);
    return () => window.clearTimeout(timeout);
  }, [onComplete]);

  return (
    <div className={`${styles.film} ${capture ? styles.capture : ""}`}>
      <Background />

      <section className={`${styles.scene} ${styles.intro}`} aria-label="Korra introduction">
        <div className={styles.introOrb}>
          <div className={styles.orbitOne} />
          <div className={styles.orbitTwo} />
          <div className={styles.introMark}>
            <BrandMark />
          </div>
        </div>
        <div className={styles.introCopy}>
          <p className={styles.introKicker}>Intelligent trading infrastructure</p>
          <h1>korra</h1>
          <div className={styles.revealRule} />
          <p className={styles.introPromise}>From market data to managed execution.</p>
        </div>
        <div className={styles.introTicker}>
          <span>ES</span><i>+0.82%</i><span>NQ</span><i>+1.16%</i><span>GC</span><i>+0.34%</i><span>BTC</span><i>+2.08%</i>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.strategies}`} aria-label="Strategy command center">
        <SceneLabel
          index="01"
          title={<>One command center.<br />Every market.</>}
          copy="Select, compare, and deploy the strategies that match your edge."
        />
        <div className={styles.strategyWindow}>
          <WindowChrome label="Futures / Strategies">
            <div className={styles.marketStrip}>
              <span className={styles.activeMarket}>Futures</span>
              <span>Forex</span>
              <span>Crypto</span>
              <span className={styles.marketCount}>28 strategies</span>
            </div>
            <div className={styles.strategyBody}>
              <aside className={styles.strategyRail}>
                <small>Portfolio</small>
                <strong>Selected strategies</strong>
                <span className={styles.bigMetric}>04</span>
                <div className={styles.selectionBar}><i /></div>
                <p>Balanced across four uncorrelated setups.</p>
              </aside>
              <div className={styles.strategyTable}>
                <div className={styles.tableHead}>
                  <span>Strategy</span><span>Market</span><span>PF</span><span>Net P&amp;L</span>
                </div>
                {strategyRows.map((row, index) => (
                  <div className={styles.strategyRow} style={{ "--row": index } as React.CSSProperties} key={row[0]}>
                    <span className={styles.check}><i /></span>
                    <strong>{row[0]}</strong>
                    <span>{row[1]}</span>
                    <span>{row[2]}</span>
                    <em>{row[3]}</em>
                  </div>
                ))}
              </div>
            </div>
          </WindowChrome>
        </div>
        <div className={styles.cursorDot} aria-hidden="true" />
      </section>

      <section className={`${styles.scene} ${styles.stats}`} aria-label="Portfolio statistics">
        <SceneLabel
          index="02"
          title={<>See the whole portfolio.<br />Not just a win rate.</>}
          copy="Drawdown, expectancy, risk, and performance—connected in one live view."
        />
        <div className={styles.statsWindow}>
          <WindowChrome label="Futures / Portfolio stats">
            <div className={styles.statsGrid}>
              <div className={styles.statsHero}>
                <div className={styles.metricHeader}>
                  <span>Portfolio equity</span>
                  <small>ALL TIME</small>
                </div>
                <strong className={styles.portfolioValue}>$128,460</strong>
                <span className={styles.growthBadge}>+28.46%</span>
                <div className={styles.heroChart}><LineChart variant="green" /></div>
                <div className={styles.chartMonths}><span>JAN</span><span>MAR</span><span>MAY</span><span>JUL</span><span>SEP</span><span>NOV</span></div>
              </div>
              <div className={styles.metricColumn}>
                <div><span>Profit factor</span><strong>3.18</strong><i className={styles.miniUp}>+0.42</i></div>
                <div><span>Max drawdown</span><strong>4.7%</strong><i>Within limit</i></div>
                <div><span>Trade expectancy</span><strong>$184</strong><i className={styles.miniUp}>+$26</i></div>
              </div>
              <div className={styles.riskBand}>
                <span>Risk allocation</span>
                <div className={styles.riskSegments}><i /><i /><i /><i /></div>
                <div className={styles.riskLegend}><span>Trend 34%</span><span>Mean reversion 27%</span><span>Breakout 23%</span><span>Other 16%</span></div>
              </div>
            </div>
          </WindowChrome>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.cluster}`} aria-label="Trade cluster map">
        <SceneLabel
          index="03"
          title={<>Find the pattern<br />behind every trade.</>}
          copy="Cluster thousands of outcomes to reveal what repeats—and what breaks."
        />
        <div className={styles.clusterWindow}>
          <WindowChrome label="Futures / Cluster map">
            <div className={styles.clusterCanvas}>
              <div className={styles.clusterAxisY}><span>Momentum</span></div>
              <div className={styles.clusterAxisX}>Trade environment →</div>
              <div className={styles.clusterHalo} />
              {dots.map((dot, index) => (
                <i
                  className={`${styles.clusterDot} ${styles[`tone${dot.tone}`]}`}
                  key={index}
                  style={{
                    "--delay": `${dot.delay}s`,
                    "--left": `${dot.left}%`,
                    "--size": `${dot.size}px`,
                    "--top": `${dot.top}%`,
                  } as React.CSSProperties}
                />
              ))}
              <svg className={styles.clusterRoute} viewBox="0 0 900 430" preserveAspectRatio="none" aria-hidden="true">
                <path d="M110 318 C205 274 245 325 330 237 S505 235 574 153 S708 139 796 76" />
              </svg>
              <div className={styles.clusterInsight}>
                <small>Pattern detected</small>
                <strong>NY open · trend continuation</strong>
                <span>82% historical similarity</span>
              </div>
              <div className={styles.clusterLegend}><span><i className={styles.greenKey} />Wins</span><span><i className={styles.redKey} />Losses</span><span><i className={styles.blueKey} />Live</span></div>
            </div>
          </WindowChrome>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.challenge}`} aria-label="Prop firm challenge replay">
        <SceneLabel
          index="04"
          title={<>Stress-test the rules.<br />Before they test you.</>}
          copy="Replay entire prop-firm challenges with daily loss, drawdown, and consistency rules."
        />
        <div className={styles.challengeWindow}>
          <WindowChrome label="Futures / Prop-firm replay">
            <div className={styles.challengeBody}>
              <div className={styles.challengeSummary}>
                <div className={styles.challengeTitle}><span>50K Evaluation</span><strong>Replay 07</strong></div>
                <div className={styles.challengeBalance}><small>Current balance</small><strong>$53,284</strong><i>+$3,284</i></div>
                <div className={styles.challengeChart}>
                  <LineChart variant="gold" />
                  <div className={styles.targetLine}><span>Profit target</span></div>
                  <div className={styles.drawdownLine}><span>Trailing drawdown</span></div>
                </div>
                <div className={styles.dayTicks}><span>D01</span><span>D05</span><span>D10</span><span>D15</span><span>D20</span></div>
              </div>
              <aside className={styles.rulePanel}>
                <div className={styles.ruleHead}><span>Rule monitor</span><i>4 / 4 clear</i></div>
                {[
                  ["Profit target", "$3,284 / $3,000", "100%"],
                  ["Daily loss", "$420 / $1,000", "42%"],
                  ["Max drawdown", "$1,104 / $2,000", "55%"],
                  ["Consistency", "Best day 31%", "31%"],
                ].map((rule, index) => (
                  <div className={styles.ruleRow} key={rule[0]}>
                    <span><strong>{rule[0]}</strong><small>{rule[1]}</small></span>
                    <div><i style={{ "--fill": rule[2] } as React.CSSProperties} /></div>
                  </div>
                ))}
                <div className={styles.passStamp}><i>✓</i><span>Challenge passed</span></div>
              </aside>
            </div>
          </WindowChrome>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.execution}`} aria-label="Live automatic execution">
        <SceneLabel
          index="05"
          title={<>A signal becomes<br />a managed trade.</>}
          copy="Korra routes entries, protection, updates, and alerts as one accountable lifecycle."
        />
        <div className={styles.executionFlow}>
          <div className={`${styles.flowNode} ${styles.signalNode}`}>
            <div className={styles.nodeTop}><span>Live signal</span><i>09:35:00</i></div>
            <div className={styles.signalPair}><strong>NQ</strong><span>LONG</span></div>
            <dl><div><dt>Entry</dt><dd>21,482.25</dd></div><div><dt>Target</dt><dd>21,536.25</dd></div><div><dt>Stop</dt><dd>21,453.75</dd></div></dl>
            <div className={styles.signalStrategy}>NY Sweep + FVG</div>
          </div>
          <div className={styles.flowLineOne}><i /><b /></div>
          <div className={`${styles.flowNode} ${styles.korraNode}`}>
            <BrandMark />
            <strong>Korra execution</strong>
            <div className={styles.executionSteps}>
              <span><i />Signal verified</span>
              <span><i />Risk sized</span>
              <span><i />Bracket attached</span>
            </div>
          </div>
          <div className={styles.flowLineTwo}><i /><b /></div>
          <div className={styles.destinationStack}>
            <div className={`${styles.flowNode} ${styles.brokerNode}`}><span>Broker</span><strong>Order filled</strong><i>2 contracts · 38ms</i></div>
            <div className={`${styles.flowNode} ${styles.alertNode}`}><span>Telegram</span><strong>Trade alert sent</strong><i>Delivered</i></div>
            <div className={`${styles.flowNode} ${styles.alertNode}`}><span>Discord</span><strong>Lifecycle synced</strong><i>Delivered</i></div>
          </div>
        </div>
        <div className={styles.executionFooter}>
          <span><i /> Entry</span><b />
          <span><i /> Stop protected</span><b />
          <span><i /> Target managed</span><b />
          <span><i /> Exit recorded</span>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.research}`} aria-label="Automated research workflow">
        <SceneLabel
          index="06"
          title={<>Turn an observation<br />into tested code.</>}
          copy="A structured research pipeline moves ideas from discovery to live portfolio."
        />
        <div className={styles.researchPipeline}>
          <div className={styles.pipelineRail}><i /></div>
          {researchStages.map((stage, index) => (
            <div className={styles.pipelineStage} style={{ "--stage": index } as React.CSSProperties} key={stage[0]}>
              <div className={styles.stageIndex}>{stage[0]}</div>
              <div className={styles.stageDoc}>
                <div className={styles.docLines}><i /><i /><i /></div>
                {index === 3 && <div className={styles.docChart}><LineChart variant="blue" /></div>}
                {index === 4 && <div className={styles.docLive}><i /> LIVE</div>}
              </div>
              <strong>{stage[1]}</strong>
              <span>{stage[2]}</span>
            </div>
          ))}
          <div className={styles.pipelinePulse} />
        </div>
        <div className={styles.researchProof}>
          <span>Research gate</span>
          <strong>Profit factor &gt; 2.0</strong>
          <i>Validated on unseen data</i>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.sync}`} aria-label="Market data sync and monitoring">
        <SceneLabel
          index="07"
          title={<>Always current.<br />Always accountable.</>}
          copy="Every dataset, signal check, backtest, and validity gate reports its state."
        />
        <div className={styles.syncWindow}>
          <WindowChrome label="System / Sync">
            <div className={styles.syncBody}>
              {[
                ["Market data sync", "Current", "28 assets · 6.4M rows", "Every 5 minutes"],
                ["Signal trade check", "Running", "24 live strategies", "After market sync"],
                ["Backtest history", "Current", "18,420 stored trades", "Snapshot 42s ago"],
                ["Data validity", "Verified", "0 gaps · 0 stale feeds", "Next review 04:00"],
              ].map((row, index) => (
                <div className={styles.syncRow} style={{ "--sync-row": index } as React.CSSProperties} key={row[0]}>
                  <div className={styles.syncIcon}><i /><b /></div>
                  <div><strong>{row[0]}</strong><span>{row[2]}</span></div>
                  <div className={styles.syncStatus}><i />{row[1]}</div>
                  <small>{row[3]}</small>
                  <div className={styles.syncTrace}><i /></div>
                </div>
              ))}
            </div>
          </WindowChrome>
        </div>
        <div className={styles.syncOrbit}><i /><b /><span><BrandMark compact /></span></div>
      </section>

      <section className={`${styles.scene} ${styles.mobile}`} aria-label="Responsive mobile workspace">
        <SceneLabel
          index="08"
          title={<>Your operating system.<br />Wherever the market moves.</>}
          copy="A focused mobile workspace keeps performance, positions, and system health within reach."
        />
        <div className={styles.phone}>
          <div className={styles.phoneSpeaker} />
          <div className={styles.phoneScreen}>
            <div className={styles.phoneTop}>
              <div className={styles.brandLockup}><BrandMark compact /><span>korra</span></div>
              <span>09:41</span>
            </div>
            <div className={styles.phoneMarkets}><span className={styles.phoneMarketActive}>Futures</span><span>Forex</span><span>Crypto</span></div>
            <div className={styles.phoneHero}>
              <small>Portfolio equity</small><strong>$128,460</strong><i>+28.46%</i>
              <LineChart variant="green" />
            </div>
            <div className={styles.phoneStats}><div><span>Live</span><strong>03</strong></div><div><span>PF</span><strong>3.18</strong></div><div><span>Risk</span><strong>0.72%</strong></div></div>
            <div className={styles.phoneTrade}><span><i /> NQ · LONG</span><strong>+$840</strong><small>NY Sweep + FVG</small></div>
            <div className={styles.phoneNav}><i /><i /><i /><i /></div>
          </div>
        </div>
        <div className={styles.marketOrbit}>
          <span>FUTURES</span><span>FOREX</span><span>CRYPTO</span><span>RESEARCH</span>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.outro}`} aria-label="Korra closing">
        <div className={styles.outroMark}><BrandMark /></div>
        <p>Research. Validate. Execute.</p>
        <h2>Trade the system.<br />Not the noise.</h2>
        <a href="https://korra.space">korra.space</a>
        <div className={styles.outroLine}><i /></div>
        <small>Intelligent trading infrastructure</small>
      </section>

      <div className={styles.filmGrain} aria-hidden="true" />
    </div>
  );
}

export default function TourPage() {
  const [iteration, setIteration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [complete, setComplete] = useState(false);
  const [capture, setCapture] = useState(false);
  const filmRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCapture(params.has("capture"));
    const frameParam = params.get("frame");
    if (frameParam === null) return;
    const frame = Number(frameParam);
    if (!Number.isFinite(frame)) return;

    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getAnimations().forEach((animation) => {
          animation.currentTime = Math.max(0, Math.min(FILM_SECONDS, frame)) * 1000;
          animation.pause();
        });
        document.documentElement.dataset.tourFrameReady = "true";
      });
    });

    return () => window.cancelAnimationFrame(firstFrame);
  }, []);

  const restart = () => {
    setComplete(false);
    setIsPlaying(true);
    setIteration((value) => value + 1);
  };

  const togglePlayback = () => setIsPlaying((value) => !value);

  return (
    <main className={styles.page}>
      <div className={`${styles.stage} ${!isPlaying ? styles.paused : ""}`} ref={filmRef}>
        <video
          className={styles.fallbackVideo}
          controls
          muted
          playsInline
          poster="/korra-product-tour-poster.jpg"
          preload="metadata"
        >
          <source src="/korra-product-tour.webm" type="video/webm" />
          <source src="/korra-product-tour.mp4" type="video/mp4" />
        </video>
        <Film key={iteration} capture={capture} onComplete={() => setComplete(true)} />
      </div>
      {!capture && (
        <div className={styles.controls}>
          <button type="button" onClick={togglePlayback}>{isPlaying ? "Pause" : "Play"}</button>
          <div className={styles.progressTrack}><i key={`${iteration}-${isPlaying}`} /></div>
          <span>{complete ? "1:48" : "Product tour"}</span>
          <button type="button" onClick={restart}>Restart</button>
          <Link href="/">Back to Korra</Link>
        </div>
      )}
    </main>
  );
}
