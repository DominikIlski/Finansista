const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export type Holding = {
  id: number;
  ticker: string;
  market: string;
  company_name?: string | null;
  buy_date: string;
  buy_price: number;
  quantity: number;
  latest_quote: {
    price: number;
    currency: string | null;
    as_of: string;
    source: string;
    cached: boolean;
  };
  market_value: number;
  cost_basis: number;
  unrealized_pnl: number;
};

export type HoldingInput = {
  ticker: string;
  market: string;
  buy_date: string;
  buy_price: number;
  quantity: number;
};

export type PerformancePoint = {
  date: string;
  value: number;
};

export type ExchangeDefinition = {
  code: string;
  label: string;
  region: string;
  assetType: string;
  providerExchange: string;
  defaultQuote?: string;
  notes?: string;
};

export type ValidationResult = {
  valid: boolean;
  source: string;
  reason?: string;
  symbol?: {
    ticker: string;
    market: string;
    name?: string | null;
    currency?: string | null;
  };
  normalized?: {
    ticker: string;
    market: string;
  };
  supported_markets?: ExchangeDefinition[];
};

const handleResponse = async (response: Response) => {
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error || 'Request failed';
    throw new Error(message);
  }
  return data;
};

export const getExchanges = async (): Promise<ExchangeDefinition[]> => {
  const response = await fetch(`${API_URL}/api/exchanges`);
  const data = await handleResponse(response);
  return data.exchanges;
};

export const getHoldings = async (currency?: string): Promise<Holding[]> => {
  const params = new URLSearchParams();
  if (currency) params.set('currency', currency);
  const query = params.toString();
  const response = await fetch(`${API_URL}/api/holdings${query ? `?${query}` : ''}`);
  const data = await handleResponse(response);
  return data.holdings;
};

export const createHolding = async (input: HoldingInput): Promise<Holding> => {
  const response = await fetch(`${API_URL}/api/holdings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const data = await handleResponse(response);
  return data.holding;
};

export const deleteHolding = async (id: number): Promise<void> => {
  const response = await fetch(`${API_URL}/api/holdings/${id}`, {
    method: 'DELETE'
  });
  await handleResponse(response);
};

export const getPerformance = async (
  from?: string,
  to?: string,
  currency?: string
): Promise<PerformancePoint[]> => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (currency) params.set('currency', currency);
  const query = params.toString();
  const response = await fetch(`${API_URL}/api/portfolio/performance${query ? `?${query}` : ''}`);
  const data = await handleResponse(response);
  return data.series;
};

export const refreshData = async (
  from?: string,
  to?: string,
  currency?: string
): Promise<void> => {
  const response = await fetch(`${API_URL}/api/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, currency })
  });
  await handleResponse(response);
};

export const validateSymbol = async (ticker: string, market: string): Promise<ValidationResult> => {
  const response = await fetch(`${API_URL}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, market })
  });
  return handleResponse(response);
};
