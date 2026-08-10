import { NextResponse } from "next/server";
import { assetForSymbol, isMarket } from "@/lib/assets";
import { fetchProjectXMarketDataBars } from "@/lib/projectx-market-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QUOTE_CACHE_MS = 2_500;
const quoteCache = new Map<string, { expiresAt: number; payload: LiveQuotePayload }>();
const quoteRequests = new Map<string, Promise<LiveQuotePayload>>();

type LiveQuotePayload = {
  bar: {
    close: number;
    high: number;
    index: number;
    low: number;
    open: number;
    time: string;
    volume?: number;
  };
  source: "projectx";
};

async function retrieveLiveQuote(symbol: string): Promise<LiveQuotePayload> {
  const asset = assetForSymbol(symbol);
  if (!asset || asset.market !== "futures") throw new Error("A futures symbol is required.");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const bars = await fetchProjectXMarketDataBars(asset, {
    endSeconds: nowSeconds + 60,
    includePartialBar: true,
    limit: 180,
    startSeconds: nowSeconds - 2 * 60 * 60,
    unit: 2,
    unitNumber: 1
  });
  const latest = bars
    .filter((bar) => Number.isFinite(bar.time) && bar.time <= nowSeconds + 60)
    .sort((left, right) => left.time - right.time)
    .at(-1);
  if (!latest) throw new Error("ProjectX has not published a current bar yet.");

  return {
    bar: {
      close: latest.close,
      high: latest.high,
      index: Math.floor(latest.time / 60),
      low: latest.low,
      open: latest.open,
      time: new Date(latest.time * 1000).toISOString(),
      volume: latest.volume
    },
    source: "projectx"
  };
}

async function cachedLiveQuote(symbol: string): Promise<LiveQuotePayload> {
  const cacheKey = symbol.trim().toUpperCase();
  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const existingRequest = quoteRequests.get(cacheKey);
  if (existingRequest) return existingRequest;

  const pending = retrieveLiveQuote(cacheKey)
    .then((payload) => {
      quoteCache.set(cacheKey, { expiresAt: Date.now() + QUOTE_CACHE_MS, payload });
      return payload;
    })
    .finally(() => quoteRequests.delete(cacheKey));
  quoteRequests.set(cacheKey, pending);
  return pending;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.trim() ?? "";
  const market = searchParams.get("market")?.trim().toLowerCase() ?? "";
  const asset = assetForSymbol(symbol);

  if (!asset || asset.market !== "futures" || (market && isMarket(market) && market !== "futures")) {
    return NextResponse.json({ error: "A futures symbol is required." }, { status: 400 });
  }

  try {
    return NextResponse.json(await cachedLiveQuote(symbol), {
      headers: { "Cache-Control": "private, no-store, max-age=0" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ProjectX live quote is unavailable." },
      { headers: { "Cache-Control": "private, no-store, max-age=0" }, status: 503 }
    );
  }
}
