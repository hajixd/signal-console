# High-Confidence Strategy Selection

Generated from completed strict backtest CSVs at the restored `publish-main`/`main` branch state.

## Result

- Selected: 110 strategies (54 forex, 56 futures).
- Target: 50 forex and 50 futures.
- Shortfall: 0 forex and 0 futures.
- Qualified before exact-trade de-duplication: 110 (54 forex, 56 futures).
- Rule rejections: 0.
- Missing/unfinished trade CSVs: 0.
- Exact-overlap duplicate rejections: 0.

## Gates

- Overall profit factor > 2.0.
- At least 20 trades.
- 4 chronological quarters, each with at least 5 trades.
- Every chronological quarter must have PF > 1.0.
- Bootstrap resampling 5th percentile PF must be > 1.0.
- Odd/even trade-order PF must both be > 1.0.
- At least 60% of calendar-year walk-forward windows with enough trades must have PF > 1.0.
- Strategies on the same asset may not share exact entries or same-side entries within 15 minutes.
- Per-asset selection maximizes count first, then robustness score.

## Selected

| Rank | Market | Symbol | Strategy | PF | Trades | Min Quarter PF | Bootstrap PF p05 |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | forex | USDJPY | USDJPY US opening-range reversal into the close (Wednesday longs) | 3.984448 | 74 | 2.545385 | 2.361974 |
| 2 | forex | EURCHF | EURCHF 5-day daily momentum into RTH (February filter) | 3.220641 | 94 | 2.986694 | 1.679923 |
| 3 | forex | EURJPY | EURJPY US opening-range continuation into the close (Wednesday longs) | 3.430396 | 64 | 2.681117 | 1.957779 |
| 4 | forex | AUDNZD | AUDNZD 5-day daily mean reversion overnight (Friday longs) | 2.747430 | 87 | 2.097478 | 1.742741 |
| 5 | forex | EURCAD | EURCAD London opening-range continuation into the US close (August filter) | 2.725629 | 87 | 2.122056 | 1.685990 |
| 6 | forex | USDCAD | USDCAD 5-day daily momentum overnight (December filter) | 3.022206 | 74 | 2.069056 | 1.654965 |
| 7 | forex | USDCAD | USDCAD London opening-range continuation into New York (December filter) | 2.776294 | 79 | 2.032717 | 1.785044 |
| 8 | forex | USDCAD | USDCAD US opening-range continuation into the close (March filter) | 2.637082 | 108 | 1.921319 | 1.506705 |
| 9 | forex | USDJPY | USDJPY overnight long close-to-open bias (October filter) | 2.668913 | 89 | 2.112049 | 1.527483 |
| 10 | forex | USDCHF | USDCHF 10-day daily momentum overnight (December filter) | 3.111397 | 75 | 1.215199 | 1.997824 |
| 11 | forex | EURJPY | EURJPY 3-day daily mean reversion overnight (Wednesday shorts) | 2.183703 | 142 | 1.851670 | 1.456102 |
| 12 | forex | AUDUSD | AUDUSD London opening-range continuation into New York (April filter) | 2.341394 | 103 | 1.998946 | 1.476914 |
| 13 | forex | GBPJPY | GBPJPY London opening-range continuation into the US close (Friday longs) | 2.800876 | 81 | 1.646683 | 1.663631 |
| 14 | forex | EURUSD | EURUSD 20-day daily mean reversion overnight (January filter) | 2.456138 | 100 | 1.834344 | 1.543344 |
| 15 | forex | EURCAD | EURCAD US opening-range continuation into midday (October filter) | 2.774717 | 63 | 1.924581 | 1.648633 |
| 16 | forex | USDJPY | USDJPY Asia range breakout into London (Wednesday longs) | 2.188032 | 87 | 2.022736 | 1.396223 |
| 17 | forex | GBPJPY | GBPJPY 5-day daily mean reversion overnight (October filter) | 2.316028 | 89 | 1.682011 | 1.543671 |
| 18 | forex | USDCHF | USDCHF US opening-range reversal into midday (January filter) | 2.500264 | 110 | 1.236387 | 1.552773 |
| 19 | forex | GBPJPY | GBPJPY London opening-range reversal into the US close (Friday longs) | 2.730689 | 64 | 1.538021 | 1.680786 |
| 20 | forex | GBPUSD | GBPUSD 3-day daily momentum overnight (July filter) | 2.217421 | 88 | 1.799164 | 1.481020 |
| 21 | forex | AUDUSD | AUDUSD 20-day daily momentum overnight (December filter) | 2.498047 | 79 | 1.547798 | 1.544348 |
| 22 | forex | EURJPY | EURJPY 5-day daily momentum into RTH (June filter) | 2.667123 | 68 | 1.496442 | 1.620477 |
| 23 | forex | AUDUSD | AUDUSD 20-day daily mean reversion overnight (June filter) | 2.198377 | 84 | 1.858741 | 1.418520 |
| 24 | forex | EURUSD | EURUSD overnight long close-to-open bias (December filter) | 2.391463 | 73 | 1.598496 | 1.463706 |
| 25 | forex | GBPUSD | GBPUSD NY sweep playbook | 2.750000 | 38 | 2.000000 | 1.619048 |
| 26 | forex | GBPJPY | GBPJPY London opening-range reversal into New York (June filter) | 2.598616 | 59 | 1.524627 | 1.573853 |
| 27 | forex | EURJPY | EURJPY 20-day daily momentum overnight (Friday longs) | 2.152995 | 135 | 1.250261 | 1.312438 |
| 28 | forex | GBPJPY | GBPJPY US opening-range reversal into the close (Wednesday longs) | 2.337304 | 118 | 1.019742 | 1.472326 |
| 29 | forex | GBPJPY | GBPJPY 20-day daily momentum into RTH (June filter) | 2.910659 | 68 | 1.010576 | 1.483095 |
| 30 | forex | EURGBP | EURGBP US opening-range reversal into the close (Tuesday shorts) | 2.085624 | 73 | 1.924717 | 1.256847 |
| 31 | forex | EURJPY | EURJPY US opening-range continuation into midday (August filter) | 2.397194 | 57 | 1.900424 | 1.261149 |
| 32 | forex | NZDUSD | NZDUSD 10-day daily mean reversion into RTH (February filter) | 2.382285 | 100 | 1.114924 | 1.376309 |
| 33 | forex | GBPJPY | GBPJPY NY open gap follow-through (September filter) | 2.151636 | 68 | 1.806280 | 1.249290 |
| 34 | forex | NZDUSD | NZDUSD London opening-range continuation into New York (April filter) | 2.112209 | 102 | 1.213980 | 1.422968 |
| 35 | forex | EURJPY | EURJPY London opening-range reversal into New York (September filter) | 2.044452 | 84 | 1.674651 | 1.194116 |
| 36 | forex | USDCAD | USDCAD 20-day daily momentum overnight (October filter) | 2.103122 | 89 | 1.483644 | 1.259504 |
| 37 | forex | EURCHF | EURCHF US opening-range continuation into midday (June filter) | 2.349479 | 59 | 1.586180 | 1.374650 |
| 38 | forex | EURCHF | EURCHF 20-day daily mean reversion overnight (Wednesday shorts) | 2.067461 | 97 | 1.229577 | 1.314654 |
| 39 | forex | GBPJPY | GBPJPY 20-day daily mean reversion overnight (September filter) | 2.016196 | 86 | 1.510196 | 1.178731 |
| 40 | forex | NZDUSD | NZDUSD US opening-range continuation into midday (April filter) | 2.161741 | 73 | 1.485132 | 1.224086 |
| 41 | forex | GBPJPY | GBPJPY US opening-range continuation into the close (Wednesday longs) | 2.396708 | 68 | 1.042769 | 1.400793 |
| 42 | forex | GBPJPY | GBPJPY NY open gap fade (January filter) | 2.053985 | 100 | 1.076423 | 1.277133 |
| 43 | forex | EURGBP | EURGBP London opening-range reversal into New York (Friday longs) | 2.161411 | 70 | 1.243385 | 1.292056 |
| 44 | forex | EURGBP | EURGBP US opening-range reversal into midday (May filter) | 2.046060 | 70 | 1.478836 | 1.166028 |
| 45 | forex | AUDUSD | AUDUSD US opening-range reversal into the close (December filter) | 2.357436 | 60 | 1.237057 | 1.255583 |
| 46 | forex | USDJPY | USDJPY London opening-range reversal into New York (September filter) | 2.158641 | 68 | 1.215988 | 1.303265 |
| 47 | forex | GBPUSD | GBPUSD US opening-range reversal into the close (October filter) | 2.514715 | 57 | 1.100484 | 1.253855 |
| 48 | forex | EURJPY | EURJPY US opening-range reversal into the close (Friday longs) | 2.226343 | 49 | 1.430443 | 1.172071 |
| 49 | forex | USDCAD | USDCAD US opening-range reversal into midday (December filter) | 2.192216 | 61 | 1.196593 | 1.172112 |
| 50 | forex | GBPUSD | GBPUSD London opening-range reversal into the US close (January filter) | 2.039310 | 80 | 1.172944 | 1.052485 |
| 51 | forex | GBPJPY | GBPJPY London opening-range continuation into New York (Thursday shorts) | 2.044440 | 75 | 1.152851 | 1.043124 |
| 52 | forex | AUDUSD | AUDUSD NY open gap fade (October filter) | 2.082419 | 65 | 1.093491 | 1.161481 |
| 53 | forex | EURCHF | EURCHF NY open gap fade (September filter) | 2.034742 | 64 | 1.105421 | 1.205384 |
| 54 | forex | AUDNZD | AUDNZD London opening-range reversal into the US close (Monday longs) | 2.133229 | 53 | 1.107159 | 1.199540 |
| 55 | futures | 6J | 6J US opening-range reversal into the close (Wednesday shorts) | 4.349795 | 75 | 3.333813 | 2.533815 |
| 56 | futures | MBT | MBT 3-day daily mean reversion overnight (Tuesday longs) | 3.553443 | 104 | 3.253263 | 2.366515 |
| 57 | futures | MET | MET 3-day daily mean reversion overnight (Tuesday longs) | 3.949600 | 105 | 1.876390 | 2.587332 |
| 58 | futures | CL | CL overnight long close-to-open bias (January filter) | 3.231682 | 102 | 2.603495 | 1.987660 |
| 59 | futures | ZC | ZC US opening-range continuation into midday (Thursday longs) | 3.220191 | 81 | 2.127655 | 1.990645 |
| 60 | futures | MET | MET London opening-range continuation into New York (Thursday shorts) | 3.566552 | 53 | 2.547305 | 1.972434 |
| 61 | futures | 6J | 6J overnight short close-to-open bias (October filter) | 2.869072 | 89 | 2.059050 | 1.655715 |
| 62 | futures | RTY | RTY NY open gap fade (February filter) | 2.853419 | 59 | 2.415245 | 1.771335 |
| 63 | futures | ES | ES 20-day daily mean reversion overnight (Tuesday longs) | 2.728575 | 82 | 2.041491 | 1.629768 |
| 64 | futures | 6A | 6A NY open gap fade (February filter) | 2.596410 | 75 | 2.203902 | 1.612131 |
| 65 | futures | NQ | NQ 20-day daily mean reversion overnight (Tuesday longs) | 2.519324 | 83 | 2.062665 | 1.630989 |
| 66 | futures | HG | HG US opening-range reversal into the close (Monday longs) | 2.925557 | 75 | 1.706024 | 1.699791 |
| 67 | futures | MET | MET London opening-range reversal into New York (Monday longs) | 3.058952 | 44 | 2.446970 | 1.683094 |
| 68 | futures | 6C | 6C overnight short close-to-open bias (October filter) | 2.850315 | 89 | 1.404705 | 1.789772 |
| 69 | futures | NG | NG US opening-range continuation into the close (September filter) | 3.104639 | 56 | 1.955240 | 1.649262 |
| 70 | futures | ZF | ZF 20-day daily mean reversion overnight (Friday shorts) | 2.985631 | 95 | 1.217212 | 1.727728 |
| 71 | futures | ZT | ZT 20-day daily mean reversion overnight (Friday shorts) | 3.076242 | 96 | 1.167254 | 1.586042 |
| 72 | futures | ZF | ZF US opening-range continuation into the close (Wednesday longs) | 2.883844 | 74 | 1.580397 | 1.630931 |
| 73 | futures | YM | YM 10-day daily momentum overnight (Tuesday longs) | 2.210431 | 132 | 1.618157 | 1.515133 |
| 74 | futures | GC | GC US opening-range reversal into the close (Monday longs) | 2.784599 | 71 | 1.596351 | 1.720451 |
| 75 | futures | CL | CL US opening-range continuation into midday (April filter) | 2.538398 | 102 | 1.514534 | 1.572836 |
| 76 | futures | 6B | 6B 3-day daily momentum overnight (July filter) | 2.394517 | 87 | 1.856988 | 1.508477 |
| 77 | futures | SI | SI 20-day daily mean reversion overnight (Tuesday longs) | 2.667724 | 87 | 1.317197 | 1.573749 |
| 78 | futures | RTY | RTY 10-day daily momentum overnight (July filter) | 2.555337 | 81 | 1.543350 | 1.507263 |
| 79 | futures | 6N | 6N US opening-range reversal into the close (December filter) | 3.449856 | 48 | 1.017082 | 1.797018 |
| 80 | futures | 6S | 6S US opening-range continuation into midday (May filter) | 2.339639 | 91 | 1.576022 | 1.466816 |
| 81 | futures | 6S | 6S overnight short close-to-open bias (October filter) | 2.421766 | 89 | 1.423530 | 1.550559 |
| 82 | futures | YM | YM 20-day daily momentum overnight (Wednesday shorts) | 2.639693 | 83 | 1.046220 | 1.730962 |
| 83 | futures | ZB | ZB 20-day daily mean reversion overnight (Friday shorts) | 2.240353 | 96 | 1.551961 | 1.394549 |
| 84 | futures | 6B | 6B US opening-range reversal into the close (October filter) | 2.626916 | 57 | 1.752922 | 1.436823 |
| 85 | futures | MBT | MBT 10-day daily momentum into RTH (Wednesday shorts) | 2.355672 | 101 | 1.242443 | 1.468033 |
| 86 | futures | SI | SI London opening-range continuation into New York (Monday shorts) | 2.454070 | 90 | 1.311296 | 1.419556 |
| 87 | futures | ES | ES US opening-range reversal into the close (Monday longs) | 2.662900 | 59 | 1.436695 | 1.579726 |
| 88 | futures | ZT | ZT US opening-range continuation into the close (Thursday longs) | 2.101062 | 91 | 1.690192 | 1.350448 |
| 89 | futures | ZT | ZT US opening-range continuation into the close (Friday longs) | 2.519809 | 66 | 1.541739 | 1.443001 |
| 90 | futures | GC | GC 3-day daily momentum overnight (Tuesday longs) | 2.143666 | 116 | 1.333561 | 1.359312 |
| 91 | futures | ZN | ZN 20-day daily mean reversion overnight (Friday shorts) | 2.214323 | 96 | 1.365969 | 1.415186 |
| 92 | futures | 6N | 6N NY open gap fade (February filter) | 2.069898 | 79 | 1.740724 | 1.304199 |
| 93 | futures | ZN | ZN US opening-range continuation into the close (Wednesday longs) | 2.078009 | 105 | 1.380163 | 1.276743 |
| 94 | futures | 6E | 6E 5-day daily mean reversion into RTH (December filter) | 2.398338 | 62 | 1.623853 | 1.271421 |
| 95 | futures | NQ | NQ London opening-range continuation into New York (Thursday shorts) | 2.014500 | 109 | 1.296279 | 1.335908 |
| 96 | futures | ZF | ZF US opening-range continuation into the close (Friday longs) | 2.214931 | 99 | 1.194064 | 1.320105 |
| 97 | futures | 6B | 6B London opening-range reversal into the US close (January filter) | 2.388944 | 78 | 1.293733 | 1.261075 |
| 98 | futures | 6C | 6C 5-day daily momentum overnight (December filter) | 2.327248 | 82 | 1.207398 | 1.325801 |
| 99 | futures | GC | GC 20-day daily mean reversion overnight (Thursday longs) | 2.247497 | 79 | 1.303928 | 1.298484 |
| 100 | futures | HG | HG 10-day daily mean reversion overnight (Tuesday longs) | 2.014037 | 101 | 1.250348 | 1.285951 |
| 101 | futures | ES | ES 20-day daily momentum overnight (Wednesday shorts) | 2.237155 | 81 | 1.091164 | 1.383181 |
| 102 | futures | ZC | ZC London opening-range reversal into New York (Thursday shorts) | 2.001805 | 100 | 1.190079 | 1.285348 |
| 103 | futures | ZB | ZB 3-day daily momentum overnight (Monday longs) | 2.014209 | 75 | 1.477491 | 1.237830 |
| 104 | futures | 6A | 6A NY open gap fade (October filter) | 2.235863 | 65 | 1.452598 | 1.168790 |
| 105 | futures | SI | SI London opening-range continuation into New York (Friday longs) | 2.201532 | 80 | 1.106088 | 1.311121 |
| 106 | futures | 6A | 6A US opening-range reversal into the close (December filter) | 2.361094 | 61 | 1.287567 | 1.237570 |
| 107 | futures | ZT | ZT NY open gap fade (December filter) | 2.215788 | 62 | 1.316406 | 1.287599 |
| 108 | futures | HG | HG US opening-range reversal into the close (Friday shorts) | 2.010287 | 69 | 1.399933 | 1.242271 |
| 109 | futures | NQ | NQ Round Hundred Rejection 15m | 2.122670 | 54 | 1.333333 | 1.233695 |
| 110 | futures | 6J | 6J London opening-range reversal into New York (September filter) | 2.116793 | 69 | 1.152270 | 1.128589 |

The 100-strategy target is not reachable from the completed non-cheating backtests under these gates.
