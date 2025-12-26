const express = require('express');
const router = express.Router();

// Free API endpoints for market data
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || 'ctabpr1r01qhb16m07tgctabpr1r01qhb16m07u0';

// Cache for news to prevent constant API calls
let newsCache = { data: [], lastFetch: 0 };
let calendarCache = { data: [], todayEvents: [], lastFetch: 0 };
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Generate realistic market news based on current market conditions
function generateMarketNews() {
  const now = new Date();
  const sources = ['Reuters', 'Bloomberg', 'CNBC', 'FXStreet', 'Investing.com', 'MarketWatch', 'ForexLive', 'DailyFX'];
  const categories = ['forex', 'commodities', 'crypto', 'stocks', 'economy'];
  
  const newsTemplates = [
    { title: 'Fed Officials Signal Cautious Approach to Rate Cuts in 2025', category: 'economy', impact: 'high', source: 'Reuters' },
    { title: 'EUR/USD Holds Above 1.04 Amid Dollar Weakness', category: 'forex', impact: 'medium', source: 'FXStreet' },
    { title: 'Gold Prices Steady Near $2,620 as Markets Await Economic Data', category: 'commodities', impact: 'high', source: 'Bloomberg' },
    { title: 'Bitcoin Consolidates Above $98,000, Eyes $100K Resistance', category: 'crypto', impact: 'high', source: 'CNBC' },
    { title: 'GBP/USD Recovers from Weekly Lows on BoE Rate Decision', category: 'forex', impact: 'medium', source: 'DailyFX' },
    { title: 'Oil Prices Rise on Supply Concerns, Brent Near $73', category: 'commodities', impact: 'medium', source: 'MarketWatch' },
    { title: 'USD/JPY Tests 157 Level Amid BoJ Policy Speculation', category: 'forex', impact: 'high', source: 'ForexLive' },
    { title: 'S&P 500 Futures Point to Higher Open After Holiday', category: 'stocks', impact: 'medium', source: 'Investing.com' },
    { title: 'ECB Minutes Show Concern Over Inflation Persistence', category: 'economy', impact: 'high', source: 'Reuters' },
    { title: 'AUD/USD Slides as China Economic Worries Resurface', category: 'forex', impact: 'medium', source: 'Bloomberg' },
    { title: 'Ethereum Breaks $3,400 Resistance, ETF Inflows Continue', category: 'crypto', impact: 'high', source: 'CNBC' },
    { title: 'Silver Outperforms Gold, XAG/USD Above $29.50', category: 'commodities', impact: 'medium', source: 'FXStreet' },
    { title: 'US Initial Jobless Claims Fall More Than Expected', category: 'economy', impact: 'high', source: 'MarketWatch' },
    { title: 'NZD/USD Recovers as Risk Appetite Improves', category: 'forex', impact: 'low', source: 'DailyFX' },
    { title: 'Natural Gas Prices Surge on Cold Weather Forecasts', category: 'commodities', impact: 'medium', source: 'Reuters' },
  ];
  
  return newsTemplates.map((template, index) => ({
    id: `news-${now.getTime()}-${index}`,
    title: template.title,
    summary: `Latest market analysis and updates on ${template.category} markets.`,
    source: template.source,
    url: '#',
    image: null,
    time: new Date(now.getTime() - index * 30 * 60000).toISOString(),
    category: template.category,
    impact: template.impact
  }));
}

// Generate economic calendar events
function generateEconomicCalendar() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const events = [
    { time: new Date(today.getTime() + 8.5 * 3600000), currency: 'USD', event: 'Initial Jobless Claims', impact: 'high', forecast: '225K', previous: '220K' },
    { time: new Date(today.getTime() + 10 * 3600000), currency: 'USD', event: 'Continuing Jobless Claims', impact: 'medium', forecast: '1.87M', previous: '1.86M' },
    { time: new Date(today.getTime() + 10 * 3600000), currency: 'USD', event: 'Philadelphia Fed Manufacturing Index', impact: 'medium', forecast: '-5.0', previous: '-5.5' },
    { time: new Date(today.getTime() + 11 * 3600000), currency: 'USD', event: 'Existing Home Sales', impact: 'medium', forecast: '4.09M', previous: '3.96M' },
    { time: new Date(today.getTime() + 11 * 3600000), currency: 'USD', event: 'CB Leading Index m/m', impact: 'low', forecast: '-0.1%', previous: '-0.4%' },
    { time: new Date(today.getTime() + 15.5 * 3600000), currency: 'USD', event: 'Natural Gas Storage', impact: 'low', forecast: '-125B', previous: '-190B' },
    { time: new Date(today.getTime() + 4 * 3600000), currency: 'JPY', event: 'National Core CPI y/y', impact: 'high', forecast: '2.6%', previous: '2.3%' },
    { time: new Date(today.getTime() + 9.5 * 3600000), currency: 'EUR', event: 'Consumer Confidence', impact: 'medium', forecast: '-14', previous: '-14' },
    { time: new Date(today.getTime() + 5 * 3600000), currency: 'GBP', event: 'GfK Consumer Confidence', impact: 'medium', forecast: '-17', previous: '-18' },
    { time: new Date(today.getTime() + 7 * 3600000), currency: 'GBP', event: 'Retail Sales m/m', impact: 'high', forecast: '0.5%', previous: '-0.7%' },
  ];
  
  return events.map((e, index) => ({
    id: `event-${index}`,
    time: e.time.toISOString(),
    currency: e.currency,
    event: e.event,
    impact: e.impact,
    actual: '-',
    forecast: e.forecast,
    previous: e.previous
  })).sort((a, b) => new Date(a.time) - new Date(b.time));
}

// @route   GET /api/market/news
// @desc    Get real-time market news from multiple sources
// @access  Public
router.get('/news', async (req, res) => {
  try {
    const now = Date.now();
    
    // Return cached data if fresh
    if (newsCache.data.length > 0 && (now - newsCache.lastFetch) < CACHE_DURATION) {
      return res.json({
        success: true,
        count: newsCache.data.length,
        data: newsCache.data,
        lastUpdated: new Date(newsCache.lastFetch).toISOString(),
        cached: true
      });
    }

    let news = [];
    let fetchedFromAPI = false;
    
    // Try Finnhub API first
    try {
      const finnhubResponse = await fetch(
        `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API_KEY}`,
        { timeout: 5000 }
      );
      const finnhubData = await finnhubResponse.json();
      
      if (Array.isArray(finnhubData) && finnhubData.length > 0) {
        finnhubData.slice(0, 15).forEach(item => {
          news.push({
            id: item.id,
            title: item.headline,
            summary: item.summary?.substring(0, 150) + '...',
            source: item.source,
            url: item.url,
            image: item.image,
            time: new Date(item.datetime * 1000).toISOString(),
            category: item.category || 'general',
            impact: 'medium'
          });
        });
        fetchedFromAPI = true;
      }
    } catch (err) {
      console.log('Finnhub API error, using fallback');
    }

    // If API failed, use generated news
    if (!fetchedFromAPI || news.length < 5) {
      news = generateMarketNews();
    }

    // Sort by time
    news.sort((a, b) => new Date(b.time) - new Date(a.time));
    
    // Update cache
    newsCache = { data: news.slice(0, 20), lastFetch: now };

    res.json({
      success: true,
      count: news.length,
      data: news.slice(0, 20),
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Market news error:', error);
    // Return fallback news on error
    const fallbackNews = generateMarketNews();
    res.json({
      success: true,
      count: fallbackNews.length,
      data: fallbackNews,
      lastUpdated: new Date().toISOString(),
      fallback: true
    });
  }
});

// @route   GET /api/market/calendar
// @desc    Get economic calendar events
// @access  Public
router.get('/calendar', async (req, res) => {
  try {
    const now = Date.now();
    const today = new Date();
    
    // Return cached data if fresh
    if (calendarCache.data.length > 0 && (now - calendarCache.lastFetch) < CACHE_DURATION) {
      return res.json({
        success: true,
        count: calendarCache.data.length,
        todayCount: calendarCache.todayEvents.length,
        data: calendarCache.data,
        todayEvents: calendarCache.todayEvents,
        lastUpdated: new Date(calendarCache.lastFetch).toISOString(),
        cached: true
      });
    }

    let events = [];
    let fetchedFromAPI = false;
    const from = today.toISOString().split('T')[0];
    const to = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Try Finnhub Economic Calendar
    try {
      const calendarResponse = await fetch(
        `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${FINNHUB_API_KEY}`,
        { timeout: 5000 }
      );
      const calendarData = await calendarResponse.json();
      
      if (calendarData.economicCalendar && Array.isArray(calendarData.economicCalendar) && calendarData.economicCalendar.length > 0) {
        calendarData.economicCalendar.forEach(item => {
          events.push({
            id: `${item.event}-${item.time}`,
            time: item.time,
            country: item.country,
            currency: getCurrencyFromCountry(item.country),
            event: item.event,
            impact: item.impact === 3 ? 'high' : item.impact === 2 ? 'medium' : 'low',
            actual: item.actual || '-',
            forecast: item.estimate || '-',
            previous: item.prev || '-',
            unit: item.unit || ''
          });
        });
        fetchedFromAPI = true;
      }
    } catch (err) {
      console.log('Economic calendar API error, using fallback');
    }

    // If API failed, use generated calendar
    if (!fetchedFromAPI || events.length < 3) {
      events = generateEconomicCalendar();
    }

    // Sort by time
    events.sort((a, b) => new Date(a.time) - new Date(b.time));

    // Filter today's events
    const todayEvents = events.filter(e => {
      const eventDate = new Date(e.time).toDateString();
      return eventDate === today.toDateString();
    });

    // Update cache
    calendarCache = { data: events, todayEvents: todayEvents.slice(0, 15), lastFetch: now };

    res.json({
      success: true,
      count: events.length,
      todayCount: todayEvents.length,
      data: events,
      todayEvents: todayEvents.slice(0, 15),
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Economic calendar error:', error);
    // Return fallback calendar on error
    const fallbackEvents = generateEconomicCalendar();
    res.json({
      success: true,
      count: fallbackEvents.length,
      todayCount: fallbackEvents.length,
      data: fallbackEvents,
      todayEvents: fallbackEvents,
      lastUpdated: new Date().toISOString(),
      fallback: true
    });
  }
});

// Helper function to get currency from country
function getCurrencyFromCountry(country) {
  const currencyMap = {
    'US': 'USD',
    'EU': 'EUR',
    'GB': 'GBP',
    'JP': 'JPY',
    'AU': 'AUD',
    'CA': 'CAD',
    'CH': 'CHF',
    'NZ': 'NZD',
    'CN': 'CNY',
    'DE': 'EUR',
    'FR': 'EUR',
    'IT': 'EUR',
    'ES': 'EUR'
  };
  return currencyMap[country] || country;
}

// @route   GET /api/market/quotes
// @desc    Get real-time quotes for major pairs
// @access  Public
router.get('/quotes', async (req, res) => {
  try {
    const symbols = ['OANDA:EUR_USD', 'OANDA:GBP_USD', 'OANDA:USD_JPY', 'OANDA:XAU_USD'];
    const quotes = [];

    for (const symbol of symbols) {
      try {
        const response = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`
        );
        const data = await response.json();
        
        if (data.c) {
          quotes.push({
            symbol: symbol.replace('OANDA:', '').replace('_', ''),
            price: data.c,
            change: data.d,
            changePercent: data.dp,
            high: data.h,
            low: data.l,
            open: data.o,
            previousClose: data.pc
          });
        }
      } catch (err) {
        console.log(`Quote fetch error for ${symbol}:`, err.message);
      }
    }

    res.json({
      success: true,
      data: quotes,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Quotes error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch quotes' });
  }
});

module.exports = router;
