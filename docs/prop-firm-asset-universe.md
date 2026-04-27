# Prop-Firm Asset Universe

This repo now includes a practical prop-firm overlap set that can be downloaded with the current `DATABENTO_API_KEY` and `TWELVEDATA_API_KEYS`.

## Research Summary

- FTMO states that traders can use the instruments available on their platform across `Forex`, `Indices`, `Commodities`, `Stocks`, and `Crypto`.
  Source: https://ftmo.com/en/faq/which-instruments-can-i-trade-and-what-strategies-am-i-allowed-to-use/
- Topstep states that its Trading Combine is futures-only and publishes a CME Group product list that includes `6S`, `6N`, `ZC`, `ZT`, `ZF`, `MBT`, and `MET`.
  Source: https://help.topstep.com/en/articles/8284206-when-and-what-products-can-i-trade
- Databento's `GLBX.MDP3` dataset supports futures `continuous` symbology, and Databento documents `ohlcv-1m` as an available OHLCV schema. This repo imports 1-minute bars from Databento and aggregates them into 15-minute candles before rebuilding the higher timeframes.
  Sources:
  https://databento.com/datasets/GLBX.MDP3
  https://databento.com/docs/standards-and-conventions/symbology
  https://databento.com/docs/schemas-and-data-formats/ohlcv
- Twelve Data documents reference catalogs for `forex_pairs`, `cryptocurrencies`, and `commodities`, plus 15-minute intervals on `time_series`. The current Twelve Data keys in this workspace successfully returned historical 15-minute data for the FX crosses and crypto spot symbols added below.
  Sources:
  https://support.twelvedata.com/en/articles/5620513-how-to-find-all-available-symbols-at-twelve-data
  https://twelvedata.com/docs

## Added Assets

### Topstep-style futures via Databento

- `swiss_franc_futures` (`6S`)
- `new_zealand_dollar_futures` (`6N`)
- `corn_futures` (`ZC`)
- `us_treasury_2y_note_futures` (`ZT`)
- `us_treasury_5y_note_futures` (`ZF`)
- `micro_bitcoin_futures` (`MBT`)
- `micro_ether_futures` (`MET`)

### FTMO-style spot / CFD proxies via Twelve Data

- `aud_nzd` (`AUD/NZD`)
- `eur_cad` (`EUR/CAD`)
- `eur_chf` (`EUR/CHF`)
- `eur_gbp` (`EUR/GBP`)
- `eur_jpy` (`EUR/JPY`)
- `gbp_jpy` (`GBP/JPY`)
- `btc_usd` (`BTC/USD`)
- `eth_usd` (`ETH/USD`)

## Practical Limits Observed On 2026-04-26

- FTMO allows broader categories than this repo now stores. I did not add FTMO cash indices or silver spot here because the current Twelve Data keys returned plan-gated errors for symbols such as `NDX` and `XAG/USD` during live API checks on 2026-04-26.
- The current Databento path is best suited to CME Group futures. That lines up well with Topstep, which is futures-only.

## Import Workflow

- `python backtest-engine/import_provider_data.py --asset <asset_key> [--asset <asset_key> ...] --start-date 2020-01-01 --prepare-data`
- The importer writes `data/15m/<asset>.csv`.
- `--prepare-data` rebuilds `30m`, `45m`, `1h`, `4h`, `1d`, and `1w` from the shared `15m` base files.
