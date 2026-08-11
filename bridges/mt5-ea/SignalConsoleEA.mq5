//+------------------------------------------------------------------+
//| SignalConsoleEA — pull-based executor for the signal-console app. |
//|                                                                  |
//| The app queues orders; this EA polls for them, places them on the |
//| local terminal, and reports the result back. Nothing inbound is   |
//| ever opened on this machine — every call goes OUT over HTTPS, so  |
//| the box needs no public port and the token never crosses the wire |
//| in cleartext. That is why the pull design is preferred over       |
//| bridges/mt5 (plain http.server, secret in the request body).      |
//|                                                                  |
//| Endpoints (all Authorization: Bearer <IngestToken>):              |
//|   GET  /api/ea/orders/pending/{acct}   -> { orders: [...] }       |
//|   POST /api/ea/orders/result/{orderId} <- fill / reject           |
//|   POST /api/ea/state/{acct}            <- balance, equity, margin |
//|   POST /api/ea/heartbeat/{acct}        <- liveness for the UI     |
//|                                                                  |
//| SETUP: the base URL must be added to                              |
//|   Tools > Options > Expert Advisors > Allow WebRequest for URL    |
//+------------------------------------------------------------------+
#property copyright "PartnerPro"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

input string BridgeUrl       = "https://example.vercel.app"; // app base URL, no trailing slash
input string BridgeAccountId = "mt5-demo-100k";              // must match MT5_EA_DEMO_ACCOUNT_ID
input string IngestToken     = "";                           // must match EA_INGEST_TOKEN
input int    PollSeconds     = 5;
input int    MagicNumber     = 990101;
input int    DeviationPoints = 20;
input bool   DryRun          = true;                         // true = log only, place nothing

CTrade   trade;
datetime lastHeartbeat = 0;

//--- minimal JSON readers -------------------------------------------------
// The payload shapes are fixed and flat, so a full parser is not warranted.

string JsonStr(const string src, const string key)
  {
   string pat = "\"" + key + "\":\"";
   int p = StringFind(src, pat);
   if(p < 0) return "";
   p += StringLen(pat);
   int e = StringFind(src, "\"", p);
   if(e < 0) return "";
   return StringSubstr(src, p, e - p);
  }

double JsonNum(const string src, const string key, const double def)
  {
   string pat = "\"" + key + "\":";
   int p = StringFind(src, pat);
   if(p < 0) return def;
   p += StringLen(pat);
   if(StringGetCharacter(src, p) == '"') return def;   // string, not a number
   int e = p;
   while(e < StringLen(src))
     {
      ushort c = StringGetCharacter(src, e);
      if((c >= '0' && c <= '9') || c == '-' || c == '.' || c == '+' || c == 'e' || c == 'E') e++;
      else break;
     }
   if(e == p) return def;
   return StringToDouble(StringSubstr(src, p, e - p));
  }

//--- HTTP ------------------------------------------------------------------

bool Http(const string method, const string path, const string body, string &out)
  {
   string url = BridgeUrl + path;
   string headers = "Authorization: Bearer " + IngestToken + "\r\nContent-Type: application/json\r\n";
   char post[], result[];
   string resultHeaders;
   if(StringLen(body) > 0) StringToCharArray(body, post, 0, StringLen(body), CP_UTF8);
   ResetLastError();
   int code = WebRequest(method, url, headers, 10000, post, result, resultHeaders);
   if(code == -1)
     {
      int err = GetLastError();
      PrintFormat("WebRequest failed (%d) for %s — is '%s' in the WebRequest allowlist?", err, url, BridgeUrl);
      return false;
     }
   out = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code < 200 || code >= 300)
     {
      PrintFormat("HTTP %d from %s: %s", code, path, StringSubstr(out, 0, 200));
      return false;
     }
   return true;
  }

//--- split the orders array into individual objects -----------------------

int SplitOrders(const string json, string &items[])
  {
   ArrayResize(items, 0);
   int start = StringFind(json, "\"orders\"");
   if(start < 0) return 0;
   int i = StringFind(json, "[", start);
   if(i < 0) return 0;
   int depth = 0, objStart = -1, n = 0;
   for(int p = i; p < StringLen(json); p++)
     {
      ushort c = StringGetCharacter(json, p);
      if(c == '{') { if(depth == 0) objStart = p; depth++; }
      else if(c == '}')
        {
         depth--;
         if(depth == 0 && objStart >= 0)
           {
            ArrayResize(items, n + 1);
            items[n++] = StringSubstr(json, objStart, p - objStart + 1);
            objStart = -1;
           }
        }
      else if(c == ']' && depth == 0) break;
     }
   return n;
  }

//--- report -----------------------------------------------------------------

void ReportResult(const string orderId, const string status, const ulong ticket,
                  const double fillPrice, const int retcode, const string errMsg, const int latencyMs)
  {
   string body = StringFormat(
      "{\"status\":\"%s\",\"brokerTicket\":%I64u,\"fillPrice\":%.5f,\"retcode\":%d,\"retcodeLabel\":\"%s\",\"errorMessage\":\"%s\",\"latencyMs\":%d}",
      status, ticket, fillPrice, retcode, IntegerToString(retcode), errMsg, latencyMs);
   string resp;
   if(!Http("POST", "/api/ea/orders/result/" + orderId, body, resp))
      PrintFormat("failed to report result for %s", orderId);
  }

//--- execute one order ------------------------------------------------------

void Execute(const string obj)
  {
   string id     = JsonStr(obj, "_id");
   string kind   = JsonStr(obj, "kind");
   string symbol = JsonStr(obj, "symbol");
   string side   = JsonStr(obj, "side");
   double volume = JsonNum(obj, "volume", 0.0);
   double sl     = JsonNum(obj, "sl", 0.0);
   double tp     = JsonNum(obj, "tp", 0.0);
   double entry  = JsonNum(obj, "entryPrice", 0.0);

   if(id == "" || symbol == "" || volume <= 0.0)
     {
      PrintFormat("skipping malformed order: %s", StringSubstr(obj, 0, 160));
      return;
     }
   if(kind == "") kind = "market";

   if(!SymbolSelect(symbol, true))
     {
      ReportResult(id, "rejected", 0, 0.0, 0, "symbol not available: " + symbol, 0);
      return;
     }

   if(DryRun)
     {
      PrintFormat("DRY  %s %s %s vol=%.2f entry=%.5f sl=%.5f tp=%.5f", kind, side, symbol, volume, entry, sl, tp);
      return;
     }

   bool isBuy = (side == "buy");
   uint t0 = GetTickCount();
   bool ok = false;

   if(kind == "market")
      ok = isBuy ? trade.Buy(volume, symbol, 0.0, sl, tp) : trade.Sell(volume, symbol, 0.0, sl, tp);
   else if(kind == "limit")
      ok = isBuy ? trade.BuyLimit(volume, entry, symbol, sl, tp) : trade.SellLimit(volume, entry, symbol, sl, tp);
   else if(kind == "stop")
      ok = isBuy ? trade.BuyStop(volume, entry, symbol, sl, tp) : trade.SellStop(volume, entry, symbol, sl, tp);
   else
     {
      ReportResult(id, "rejected", 0, 0.0, 0, "unsupported kind: " + kind, 0);
      return;
     }

   int latency = (int)(GetTickCount() - t0);
   uint rc = trade.ResultRetcode();
   if(ok)
      ReportResult(id, "filled", trade.ResultOrder(), trade.ResultPrice(), (int)rc, "", latency);
   else
      ReportResult(id, "rejected", 0, 0.0, (int)rc, trade.ResultRetcodeDescription(), latency);
  }

//--- state + heartbeat ------------------------------------------------------

void PushState()
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   double mar = AccountInfoDouble(ACCOUNT_MARGIN);
   double fm  = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double ml  = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   string body = StringFormat(
      "{\"bridgeStatus\":\"ok\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"freeMargin\":%.2f,\"marginLevelPct\":%.2f,\"floatingPnL\":%.2f,\"openPositionCount\":%d}",
      bal, eq, mar, fm, ml, eq - bal, PositionsTotal());
   string resp;
   Http("POST", "/api/ea/state/" + BridgeAccountId, body, resp);
  }

void PushHeartbeat()
  {
   string body = StringFormat(
      "{\"eaVersion\":\"1.00\",\"terminalBuild\":%d,\"terminalConnected\":%s,\"tradeAllowed\":%s,\"accountLogin\":%I64d,\"accountServer\":\"%s\"}",
      TerminalInfoInteger(TERMINAL_BUILD),
      TerminalInfoInteger(TERMINAL_CONNECTED) ? "true" : "false",
      (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) && MQLInfoInteger(MQL_TRADE_ALLOWED)) ? "true" : "false",
      AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoString(ACCOUNT_SERVER));
   string resp;
   Http("POST", "/api/ea/heartbeat/" + BridgeAccountId, body, resp);
  }

//--- lifecycle --------------------------------------------------------------

int OnInit()
  {
   if(StringLen(IngestToken) == 0)
     {
      Print("IngestToken is empty — set it to the app's EA_INGEST_TOKEN.");
      return INIT_PARAMETERS_INCORRECT;
     }
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   EventSetTimer(MathMax(1, PollSeconds));
   PrintFormat("SignalConsoleEA started — acct=%s url=%s dryRun=%s",
               BridgeAccountId, BridgeUrl, DryRun ? "true" : "false");
   PushHeartbeat();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer()
  {
   string resp;
   if(Http("GET", "/api/ea/orders/pending/" + BridgeAccountId, "", resp))
     {
      string items[];
      int n = SplitOrders(resp, items);
      for(int i = 0; i < n; i++) Execute(items[i]);
     }
   if(TimeCurrent() - lastHeartbeat >= 30)
     {
      lastHeartbeat = TimeCurrent();
      PushHeartbeat();
      PushState();
     }
  }
