# Prop Firm Account Setup Research

Last reviewed: 2026-05-07

Goal: the Add Account flow should ask for the details a trader receives from the prop firm first. Bridge URLs, shared secrets, app IDs, system UUIDs, symbol maps, and sizing maps are owner/operator setup, so they belong in advanced settings or environment variables.

## Platform Credential Pattern

| Platform route | Primary user-entered fields | Advanced / owner setup |
| --- | --- | --- |
| TopstepX / ProjectX | TopstepX username, ProjectX API key | Account IDs are discovered after login; optional account-level pause controls remain in-app. |
| Tradovate | Tradovate username, Tradovate password | Account ID/spec if multiple accounts, app ID/version, CID/secret, API base URL, futures symbol/size maps. |
| Rithmic | Rithmic user ID, password, account number, system, gateway | Bridge URL/secret, futures symbol/size maps. |
| MT5 | MT5 login, MT5 password, MT5 server | Bridge URL/secret, account ID, broker symbol map, lot map. |
| TradeLocker | TradeLocker email, password, server | Account ID, account number, route ID, instrument ID, API base URL, symbol/size maps. |
| cTrader | cTrader account ID plus Open API access token | Refresh token, bridge URL/secret, symbol/size maps, app client credentials handled outside the user form. |
| Match-Trader | Trading API token when the firm exposes it | Platform URL, system UUID, co-auth cookie, account ID, symbol/size maps. Normal web login credentials are not enough for this repo's current API route. |

## Futures Firms

| Firm | App-supported route | What a trader should expect to enter |
| --- | --- | --- |
| Topstep | ProjectX | TopstepX username and ProjectX API key. Topstep says the key is generated in TopstepX settings and used with the TopstepX username. |
| Apex Trader Funding | Tradovate or Rithmic | Tradovate username/password for Tradovate accounts; Rithmic user ID/password/system/gateway/account number for Rithmic accounts. Apex documents Rithmic, Tradovate, and WealthCharts, but this app supports the first two. |
| MyFundedFutures | Tradovate | MFFU dashboard Tradovate credentials. Official docs show Tradovate login with MFFU credentials and supported platforms including NinjaTrader, Tradovate, and TradingView. |
| Take Profit Trader | Tradovate or Rithmic | The chosen platform credentials from signup. Their platform list includes Tradovate and R|Trader among many other front ends. |
| Tradeify | Tradovate or Rithmic | Credentials for the broker selected at checkout. Tradeify says it supports Tradovate, Rithmic, and WealthCharts; this app supports Tradovate/Rithmic. |
| Elite Trader Funding | Tradovate or Rithmic | Tradovate credentials from the Trader Dashboard, or Rithmic credentials for Rithmic accounts. ETF has dedicated Tradovate and Rithmic help sections. |
| Earn2Trade | Rithmic | Rithmic data feed username/password from the "Rithmic Data Feed Credentials Created" email, then the account number to target the evaluation account. |
| Leeloo Trading | Rithmic | Rithmic User ID/password plus the account number. Leeloo distinguishes membership login from Rithmic trading credentials. |
| Bulenox | Rithmic | Rithmic user ID/password, system "Rithmic Paper Trading", gateway, and account number. |
| OneUp Trader | Rithmic | Welcome-email username/password, system "Rithmic Paper Trading", gateway, and account number. |

## Forex / CFD Firms

| Firm | App-supported route | What a trader should expect to enter |
| --- | --- | --- |
| E8 Markets | TradeLocker, Match-Trader, cTrader, MT5 | US clients use TradeLocker or MatchTrader. TradeLocker needs email/password/server, with E8 as server. MT5 uses login/password/server. cTrader uses cTrader login in the platform, but automation needs Open API token/account ID. |
| FTMO | MT5 or cTrader | MT5 login/password/server from the Client Area; cTrader users create/use a cTrader registration and can switch linked accounts. |
| The5ers | MT5 or cTrader | MT5 login/password/server for MT5 Hedge; cTrader email/cTrader ID and password for platform login, with account ID/token needed for automation. |
| FundedNext | MT5, cTrader, Match-Trader | MT5 login ID/password/server; cTrader login ID/password; Match-Trader login credentials by email. US traders are documented as Match-Trader only. |
| FundingPips | MT5, cTrader, Match-Trader | Current official homepage lists MetaTrader 5, Match-Trader, and cTrader. Treat TradeLocker as legacy/unverified unless a user's dashboard explicitly issues it. |
| Funded Trading Plus | MT5, cTrader, Match-Trader | FT+ documents MT5, DXtrade, Match Trader, and cTrader. This app supports MT5/cTrader/Match-Trader, not DXtrade. |
| Alpha Capital Group | MT5, cTrader, TradeLocker | Official docs list MT5, cTrader, DX Trade, and TradeLocker; US residents cannot use MT5. This app supports MT5/cTrader/TradeLocker, not DXtrade. |
| Blue Guardian | Match-Trader, TradeLocker, MT5 | Official docs list MatchTrade, MT5, and TradeLocker, with US clients limited to Match Trader and TradeLocker. |
| GOAT Funded Trader | cTrader, TradeLocker, Match-Trader, MT5 | Official docs list cTrader, TradeLocker, MatchTrader, Volumetrica, and MT5. This app supports all except Volumetrica. |
| BrightFunded | MT5 or cTrader | Official docs list DXTrade, cTrader, and MT5. This app supports MT5/cTrader, not DXTrade. |
| FXIFY | MT5 | Official docs list MT4, MT5, and DXtrade, with MetaTrader unavailable to US clients. This app currently supports MT5 only. |
| FunderPro | TradeLocker, cTrader, MT5 | Official pages show TradeLocker, cTrader, and MT5; spread-check credentials demonstrate the same login/password/server pattern. |

## Sources

- TopstepX API Access: https://help.topstep.com/en/articles/11187768-topstepx-api-access
- ProjectX API: https://help.projectx.com/settings/api
- Tradovate API access: https://tradovate.zendesk.com/hc/en-us/articles/4403105829523-How-Do-I-Get-Access-to-the-Tradovate-API
- Tradovate first API call: https://partner.tradovate.com/overview/quick-setup/first-api-call
- TradeLocker Public API: https://public-api.tradelocker.com/docs/getting-started
- cTrader Open API: https://help.ctrader.com/open-api/
- cTrader account authentication: https://help.ctrader.com/open-api/account-authentication/
- Match-Trader Platform API: https://match-trader.com/technology/platform-api/
- Apex platforms: https://support.apextraderfunding.com/hc/en-us/sections/31318567719963-Platforms
- Apex Tradovate setup: https://support.apextraderfunding.com/hc/en-us/articles/31519502179099-Tradovate-NinjaTrader-and-Copytrading
- MyFundedFutures Tradovate login: https://help.myfundedfutures.com/en/articles/8445591-tradovate-login-instructions
- MyFundedFutures platform overview: https://help.myfundedfutures.com/en/articles/8528335-overview-of-supported-platforms-at-mffu
- Take Profit Trader platform list: https://takeprofittraderhelp.zendesk.com/hc/en-us/articles/15141558433565-Choosing-Your-Platform
- Tradeify supported platforms: https://help.tradeify.co/en/articles/10468221-supported-platforms
- Elite Trader Funding Tradovate guide: https://help.elitetraderfunding.com/help/tradovate-connection-guide
- Elite Trader Funding Rithmic help: https://help.elitetraderfunding.com/help/rithmic
- Earn2Trade Rithmic setup: https://help.earn2trade.com/en/articles/6911655-how-do-i-set-up-my-evaluation
- Leeloo login credentials: https://support.leelootrading.com/kb/a34/making-sense-of-login-credentials.aspx
- Bulenox connection help: https://bulenox.com/index.php/help/connection/
- OneUp R|Trader guide: https://help.oneuptrader.com/article/392-must-start-here
- E8 platforms: https://help.e8markets.com/en/articles/9799834-available-trading-platforms
- E8 TradeLocker login: https://help.e8markets.com/en/articles/10751503-how-do-you-log-in-to-your-tradelocker-account
- E8 MT5 login: https://help.e8markets.com/en/articles/12414114-how-to-log-in-to-your-mt5-account
- FTMO trading platforms: https://ftmo.com/en/trading-platforms/
- FTMO platform login tutorial: https://ftmo.com/en/log-in-to-platforms-tutorial/
- The5ers Hyper Growth platform note: https://help.the5ers.com/how-does-the-hyper-growth-program-work/
- The5ers cTrader login: https://help.the5ers.com/how-to-log-in-to-ctrader-account-after-purchase/
- FundedNext supported platforms: https://help.fundednext.com/en/articles/8019808-which-platforms-can-i-use-for-trading-at-fundednext
- FundedNext MT5 PC login: https://help.fundednext.com/en/articles/10725745-how-do-i-log-in-to-the-mt5-platform-pc
- FundedNext cTrader login: https://help.fundednext.com/en/articles/10726716-how-do-i-log-in-to-the-ctrader-platform/
- FundedNext Match-Trader login: https://help.fundednext.com/en/articles/12866498-how-to-connect-match-trader-with-fundednext
- FundingPips homepage: https://fundingpips.com/
- Funded Trading Plus platforms: https://help.fundedtradingplus.com/which-platforms-do-you-offer/
- Alpha Capital platforms: https://help.alphacapitalgroup.uk/en/articles/6933883-what-trading-platforms-are-available-for-use
- Blue Guardian platforms: https://help.blueguardian.com/en/articles/9661529-what-is-the-platform
- GOAT Funded Trader platforms: https://help.goatfundedtrader.com/en/articles/10741900-which-platforms-can-i-trade-on
- BrightFunded platforms: https://help.brightfunded.com/en/articles/10855521-what-trading-platform-does-brightfunded-offer
- FXIFY platforms: https://fxify.com/faqs/all-faqs/what-platforms-can-i-use-to-trade-on/
- FunderPro spreads/platform credentials: https://funderpro.com/products-and-spreads/
- FunderPro homepage platform list: https://funderpro.com/
