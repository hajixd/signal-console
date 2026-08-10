#property strict
#property version   "1.01"
#property description "Korra MT5 execution EA. Polls korra.space and executes queued forex orders."

#include <Trade/Trade.mqh>

input string BackendBaseUrl = "https://www.korra.space";
input string IngestToken = "";
input string ConnectionId = "";
input bool EnableOrderExecution = true;
input int PollSeconds = 2;
input int HeartbeatSeconds = 10;
input int RequestTimeoutMs = 8000;
input long MagicNumber = 260809;
input int SlippagePoints = 20;

CTrade g_trade;
string g_base_url = "";
string g_connection_id = "";
datetime g_last_heartbeat = 0;

string Trim(string value)
{
   StringTrimLeft(value);
   StringTrimRight(value);
   return value;
}

string WithoutTrailingSlash(string value)
{
   value = Trim(value);
   while(StringLen(value) > 0 && StringSubstr(value, StringLen(value) - 1, 1) == "/")
      value = StringSubstr(value, 0, StringLen(value) - 1);
   return value;
}

string JsonEscape(const string value)
{
   string output = value;
   StringReplace(output, "\\", "\\\\");
   StringReplace(output, "\"", "\\\"");
   StringReplace(output, "\r", "\\r");
   StringReplace(output, "\n", "\\n");
   return output;
}

string UrlEncode(const string value)
{
   string output = "";
   for(int index = 0; index < StringLen(value); index++)
   {
      const ushort ch = (ushort)StringGetCharacter(value, index);
      const bool safe =
         (ch >= '0' && ch <= '9') ||
         (ch >= 'A' && ch <= 'Z') ||
         (ch >= 'a' && ch <= 'z') ||
         ch == '-' || ch == '_' || ch == '.' || ch == '~';
      if(safe)
         output += StringSubstr(value, index, 1);
      else
         output += StringFormat("%%%02X", (int)ch);
   }
   return output;
}

bool HttpRequest(const string method, const string path, const string body, string &response, int &status)
{
   char request_data[];
   char response_data[];
   string response_headers = "";
   string headers =
      "Authorization: Bearer " + IngestToken + "\r\n" +
      "Accept: application/json\r\n" +
      "Content-Type: application/json\r\n" +
      "X-EA-Version: 1.01\r\n";

   ArrayResize(request_data, 0);
   ArrayResize(response_data, 0);
   if(StringLen(body) > 0)
      StringToCharArray(body, request_data, 0, StringLen(body), CP_UTF8);

   ResetLastError();
   status = WebRequest(
      method,
      g_base_url + path,
      headers,
      MathMax(1000, RequestTimeoutMs),
      request_data,
      response_data,
      response_headers
   );
   if(status == -1)
   {
      PrintFormat("Korra EA request failed. MT5 error=%d path=%s", GetLastError(), path);
      response = "";
      return false;
   }

   response = CharArrayToString(response_data, 0, -1, CP_UTF8);
   if(status < 200 || status >= 300)
   {
      PrintFormat("Korra EA request returned HTTP %d. path=%s body=%s", status, path, response);
      return false;
   }
   return true;
}

bool HttpPost(const string path, const string body)
{
   string response = "";
   int status = -1;
   return HttpRequest("POST", path, body, response, status);
}

int SkipJsonWhitespace(const string json, int index)
{
   while(index < StringLen(json))
   {
      const ushort ch = (ushort)StringGetCharacter(json, index);
      if(ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n')
         break;
      index++;
   }
   return index;
}

int JsonValueStart(const string json, const string key)
{
   const string needle = "\"" + key + "\"";
   int index = StringFind(json, needle);
   if(index < 0)
      return -1;
   index = StringFind(json, ":", index + StringLen(needle));
   if(index < 0)
      return -1;
   return SkipJsonWhitespace(json, index + 1);
}

string JsonString(const string json, const string key)
{
   int index = JsonValueStart(json, key);
   if(index < 0 || StringSubstr(json, index, 1) != "\"")
      return "";
   index++;
   string output = "";
   bool escaped = false;
   for(; index < StringLen(json); index++)
   {
      const string ch = StringSubstr(json, index, 1);
      if(escaped)
      {
         if(ch == "n") output += "\n";
         else if(ch == "r") output += "\r";
         else if(ch == "t") output += "\t";
         else output += ch;
         escaped = false;
      }
      else if(ch == "\\")
         escaped = true;
      else if(ch == "\"")
         break;
      else
         output += ch;
   }
   return output;
}

double JsonNumber(const string json, const string key, const double fallback = 0.0)
{
   int index = JsonValueStart(json, key);
   if(index < 0 || StringSubstr(json, index, 4) == "null")
      return fallback;
   int end = index;
   while(end < StringLen(json))
   {
      const ushort ch = (ushort)StringGetCharacter(json, end);
      if((ch >= '0' && ch <= '9') || ch == '-' || ch == '+' || ch == '.' || ch == 'e' || ch == 'E')
         end++;
      else
         break;
   }
   if(end <= index)
      return fallback;
   const double parsed = StringToDouble(StringSubstr(json, index, end - index));
   return MathIsValidNumber(parsed) ? parsed : fallback;
}

string NormalizedSymbolName(string value)
{
   StringToUpper(value);
   string normalized = "";
   for(int index = 0; index < StringLen(value); index++)
   {
      const ushort ch = (ushort)StringGetCharacter(value, index);
      if((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9'))
         normalized += StringSubstr(value, index, 1);
   }
   return normalized;
}

string ResolveSymbol(const string requested)
{
   const string clean_requested = Trim(requested);
   if(StringLen(clean_requested) == 0)
      return "";

   // Exact broker symbols remain the preferred path.
   if(SymbolSelect(clean_requested, true))
      return clean_requested;

   // Prop brokers commonly add prefixes or suffixes (EURUSD.a, EURUSDm,
   // pro_EURUSD). Find the closest server symbol automatically so users do
   // not need to maintain a manual symbol map for every account.
   const string normalized_requested = NormalizedSymbolName(clean_requested);
   string best = "";
   int best_extra_characters = 2147483647;
   int best_offset = 2147483647;
   const int symbol_count = SymbolsTotal(false);
   for(int index = 0; index < symbol_count; index++)
   {
      const string candidate = SymbolName(index, false);
      const string normalized_candidate = NormalizedSymbolName(candidate);
      const int offset = StringFind(normalized_candidate, normalized_requested);
      if(offset < 0)
         continue;
      const int extra_characters = StringLen(normalized_candidate) - StringLen(normalized_requested);
      if(extra_characters < best_extra_characters ||
         (extra_characters == best_extra_characters && offset < best_offset))
      {
         best = candidate;
         best_extra_characters = extra_characters;
         best_offset = offset;
      }
   }
   return StringLen(best) > 0 ? best : clean_requested;
}

double NormalizeVolume(const string symbol, const double requested)
{
   double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maximum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(minimum <= 0.0) minimum = 0.01;
   if(maximum < minimum) maximum = minimum;
   if(step <= 0.0) step = 0.01;

   double volume = MathMax(minimum, MathMin(maximum, requested));
   volume = minimum + MathFloor((volume - minimum) / step + 1e-9) * step;
   int digits = 0;
   double probe = step;
   while(digits < 8 && MathAbs(probe - MathRound(probe)) > 1e-9)
   {
      probe *= 10.0;
      digits++;
   }
   return NormalizeDouble(volume, digits);
}

string OrderMemoryKey(const string order_id)
{
   return "KorraEA." + StringSubstr(order_id, 0, 52);
}

bool ReportOrderResult(
   const string order_id,
   const string status_value,
   const ulong ticket,
   const double fill_price,
   const uint retcode,
   const string error_message
)
{
   const string body =
      "{\"status\":\"" + JsonEscape(status_value) + "\"" +
      ",\"brokerTicket\":" + StringFormat("%I64u", ticket) +
      ",\"fillPrice\":" + DoubleToString(fill_price, 10) +
      ",\"retcode\":" + IntegerToString((int)retcode) +
      ",\"retcodeLabel\":\"" + JsonEscape(g_trade.ResultRetcodeDescription()) + "\"" +
      ",\"errorMessage\":\"" + JsonEscape(error_message) + "\"}";
   return HttpPost("/api/ea/orders/result/" + UrlEncode(order_id), body);
}

void ProcessOrder(const string object_json)
{
   const string order_id = JsonString(object_json, "_id");
   const string kind = JsonString(object_json, "kind");
   const string requested_symbol = JsonString(object_json, "symbol");
   const string side = JsonString(object_json, "side");
   const double requested_volume = JsonNumber(object_json, "volume");
   const double stop_loss = JsonNumber(object_json, "sl");
   const double take_profit = JsonNumber(object_json, "tp");
   const double entry_price = JsonNumber(object_json, "entryPrice");

   if(StringLen(order_id) == 0)
      return;

   const string memory_key = OrderMemoryKey(order_id);
   if(GlobalVariableCheck(memory_key))
   {
      const double remembered = GlobalVariableGet(memory_key);
      if(remembered > 0)
         ReportOrderResult(order_id, "filled", (ulong)remembered, 0.0, TRADE_RETCODE_DONE, "replayed result; order was already accepted");
      else
         ReportOrderResult(order_id, "rejected", 0, 0.0, (uint)MathAbs(remembered), "replayed result; order was already rejected");
      return;
   }

   if(!EnableOrderExecution)
   {
      GlobalVariableSet(memory_key, -1.0);
      ReportOrderResult(order_id, "rejected", 0, 0.0, 1, "EnableOrderExecution is off in the EA settings");
      return;
   }

   const string symbol = ResolveSymbol(requested_symbol);
   if(StringLen(symbol) == 0 || !SymbolSelect(symbol, true))
   {
      GlobalVariableSet(memory_key, -2.0);
      ReportOrderResult(order_id, "rejected", 0, 0.0, 2, "MT5 could not select symbol " + symbol);
      return;
   }

   const double volume = NormalizeVolume(symbol, requested_volume);
   g_trade.SetTypeFillingBySymbol(symbol);
   bool accepted = false;
   if(kind == "limit")
   {
      if(side == "buy")
         accepted = g_trade.BuyLimit(volume, entry_price, symbol, stop_loss, take_profit);
      else if(side == "sell")
         accepted = g_trade.SellLimit(volume, entry_price, symbol, stop_loss, take_profit);
   }
   else
   {
      if(side == "buy")
         accepted = g_trade.Buy(volume, symbol, 0.0, stop_loss, take_profit, "Korra test/auto-trade");
      else if(side == "sell")
         accepted = g_trade.Sell(volume, symbol, 0.0, stop_loss, take_profit, "Korra test/auto-trade");
   }

   const uint retcode = g_trade.ResultRetcode();
   const ulong ticket = g_trade.ResultOrder() > 0 ? g_trade.ResultOrder() : g_trade.ResultDeal();
   const bool successful_retcode =
      retcode == TRADE_RETCODE_DONE ||
      retcode == TRADE_RETCODE_PLACED ||
      retcode == TRADE_RETCODE_DONE_PARTIAL;
   if(accepted && successful_retcode)
   {
      GlobalVariableSet(memory_key, (double)MathMax((long)1, (long)ticket));
      ReportOrderResult(order_id, "filled", ticket, g_trade.ResultPrice(), retcode, "");
      PrintFormat("Korra EA accepted %s %s %.2f lots. ticket=%I64u", side, symbol, volume, ticket);
   }
   else
   {
      GlobalVariableSet(memory_key, -(double)MathMax((int)1, (int)retcode));
      ReportOrderResult(order_id, "rejected", 0, 0.0, retcode, g_trade.ResultRetcodeDescription());
      PrintFormat("Korra EA rejected order %s. retcode=%u %s", order_id, retcode, g_trade.ResultRetcodeDescription());
   }
}

void ProcessOrdersPayload(const string json)
{
   const int orders_key = StringFind(json, "\"orders\"");
   if(orders_key < 0)
      return;
   const int array_start = StringFind(json, "[", orders_key);
   if(array_start < 0)
      return;

   int object_start = -1;
   int depth = 0;
   bool in_string = false;
   bool escaped = false;
   for(int index = array_start + 1; index < StringLen(json); index++)
   {
      const string ch = StringSubstr(json, index, 1);
      if(in_string)
      {
         if(escaped) escaped = false;
         else if(ch == "\\") escaped = true;
         else if(ch == "\"") in_string = false;
         continue;
      }
      if(ch == "\"")
      {
         in_string = true;
         continue;
      }
      if(ch == "{")
      {
         if(depth == 0) object_start = index;
         depth++;
      }
      else if(ch == "}")
      {
         depth--;
         if(depth == 0 && object_start >= 0)
         {
            ProcessOrder(StringSubstr(json, object_start, index - object_start + 1));
            object_start = -1;
         }
      }
      else if(ch == "]" && depth == 0)
         break;
   }
}

void SendHeartbeatAndState()
{
   const bool terminal_connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   const bool trade_allowed =
      (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
      (bool)MQLInfoInteger(MQL_TRADE_ALLOWED) &&
      (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) &&
      EnableOrderExecution;
   const long login = AccountInfoInteger(ACCOUNT_LOGIN);
   const string server = AccountInfoString(ACCOUNT_SERVER);
   const string heartbeat =
      "{\"eaVersion\":\"1.01\"" +
      ",\"terminalBuild\":" + IntegerToString((int)TerminalInfoInteger(TERMINAL_BUILD)) +
      ",\"terminalConnected\":" + (terminal_connected ? "true" : "false") +
      ",\"tradeAllowed\":" + (trade_allowed ? "true" : "false") +
      ",\"accountLogin\":" + StringFormat("%I64d", login) +
      ",\"accountServer\":\"" + JsonEscape(server) + "\"}";
   HttpPost("/api/ea/heartbeat/" + UrlEncode(g_connection_id), heartbeat);

   const string state =
      "{\"bridgeStatus\":\"" + (terminal_connected ? "connected" : "offline") + "\"" +
      ",\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) +
      ",\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) +
      ",\"margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2) +
      ",\"freeMargin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) +
      ",\"marginLevelPct\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) +
      ",\"floatingPnL\":" + DoubleToString(AccountInfoDouble(ACCOUNT_PROFIT), 2) +
      ",\"openPositionCount\":" + IntegerToString(PositionsTotal()) + "}";
   HttpPost("/api/ea/state/" + UrlEncode(g_connection_id), state);
   g_last_heartbeat = TimeLocal();
}

void PollOrders()
{
   string response = "";
   int status = -1;
   if(HttpRequest(
      "GET",
      "/api/ea/orders/pending/" + UrlEncode(g_connection_id) + "?includeStaleClaimed=true",
      "",
      response,
      status
   ))
      ProcessOrdersPayload(response);
}

int OnInit()
{
   g_base_url = WithoutTrailingSlash(BackendBaseUrl);
   g_connection_id = Trim(ConnectionId);
   if(StringLen(g_connection_id) == 0)
      g_connection_id = StringFormat("%I64d", AccountInfoInteger(ACCOUNT_LOGIN));

   if(StringLen(g_base_url) == 0 || StringLen(IngestToken) < 16)
   {
      Print("Korra EA setup is incomplete. Enter BackendBaseUrl and the EA Ingest Token.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(AccountInfoInteger(ACCOUNT_LOGIN) <= 0)
   {
      Print("Korra EA cannot start until MT5 is signed in to a trading account.");
      return INIT_FAILED;
   }

   g_trade.SetExpertMagicNumber(MagicNumber);
   g_trade.SetDeviationInPoints(MathMax(0, SlippagePoints));
   EventSetTimer(MathMax(1, PollSeconds));
   SendHeartbeatAndState();
   PollOrders();
   PrintFormat(
      "Korra EA started. Connection ID=%s login=%I64d server=%s",
      g_connection_id,
      AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoString(ACCOUNT_SERVER)
   );
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   if(TimeLocal() - g_last_heartbeat >= MathMax(2, HeartbeatSeconds))
      SendHeartbeatAndState();
   PollOrders();
}

void OnTick()
{
}

void OnTradeTransaction(
   const MqlTradeTransaction &transaction,
   const MqlTradeRequest &request,
   const MqlTradeResult &result
)
{
   if(transaction.type != TRADE_TRANSACTION_DEAL_ADD || transaction.deal == 0)
      return;
   if(!HistoryDealSelect(transaction.deal))
      return;
   const long entry = HistoryDealGetInteger(transaction.deal, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY)
      return;
   const long magic = HistoryDealGetInteger(transaction.deal, DEAL_MAGIC);
   if(magic != MagicNumber)
      return;

   const string body =
      "{\"ticket\":" + StringFormat("%I64u", transaction.deal) +
      ",\"dealType\":" + IntegerToString((int)HistoryDealGetInteger(transaction.deal, DEAL_TYPE)) +
      ",\"symbol\":\"" + JsonEscape(HistoryDealGetString(transaction.deal, DEAL_SYMBOL)) + "\"" +
      ",\"volume\":" + DoubleToString(HistoryDealGetDouble(transaction.deal, DEAL_VOLUME), 4) +
      ",\"price\":" + DoubleToString(HistoryDealGetDouble(transaction.deal, DEAL_PRICE), 10) +
      ",\"profit\":" + DoubleToString(HistoryDealGetDouble(transaction.deal, DEAL_PROFIT), 2) +
      ",\"commission\":" + DoubleToString(HistoryDealGetDouble(transaction.deal, DEAL_COMMISSION), 2) +
      ",\"swap\":" + DoubleToString(HistoryDealGetDouble(transaction.deal, DEAL_SWAP), 2) +
      ",\"reason\":" + IntegerToString((int)HistoryDealGetInteger(transaction.deal, DEAL_REASON)) +
      ",\"positionTicket\":" + StringFormat("%I64d", HistoryDealGetInteger(transaction.deal, DEAL_POSITION_ID)) + "}";
   HttpPost("/api/ea/fills/" + UrlEncode(g_connection_id), body);
}
