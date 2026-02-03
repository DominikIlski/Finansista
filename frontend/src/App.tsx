import { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  Legend,
  PointElement,
  LineElement,
  Tooltip,
  Filler
} from 'chart.js';
import { Doughnut, Line } from 'react-chartjs-2';
import {
  createHolding,
  deleteHolding,
  getExchanges,
  getHoldings,
  getPerformance,
  refreshData,
  validateSymbol,
  ExchangeDefinition,
  Holding,
  HoldingInput,
  PerformancePoint,
  ValidationResult
} from './api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler, ArcElement, Legend);

type ChartMode = 'value' | 'gains';
type ChartPeriod = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';
type BaseCurrency = 'PLN' | 'USD' | 'EUR' | 'GBP';

type ValidationState = {
  status: 'idle' | 'checking' | 'valid' | 'invalid';
  message?: string;
  result?: ValidationResult | null;
};

const defaultForm: HoldingInput = {
  ticker: '',
  market: 'NASDAQ',
  buy_date: '',
  buy_price: 0,
  quantity: 0
};

const normalizeMoney = (value: number) => (Math.abs(value) < 0.005 ? 0 : value);

const formatMoney = (value: number, currency: string) => {
  if (!Number.isFinite(value)) return '—';
  const display = normalizeMoney(value);
  return display.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
};

const formatAxisCurrency = (value: string | number, currency: string) => {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return '';
  const abs = Math.abs(numeric);
  if (abs < 1) return numeric.toFixed(2);
  if (abs >= 1_000_000) return `${currency} ${(numeric / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${currency} ${(numeric / 1_000).toFixed(1)}k`;
  return numeric.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
};

const App = () => {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [series, setSeries] = useState<PerformancePoint[]>([]);
  const [exchanges, setExchanges] = useState<ExchangeDefinition[]>([]);
  const [form, setForm] = useState<HoldingInput>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' });
  const [chartMode, setChartMode] = useState<ChartMode>('value');
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('1M');
  const [showForm, setShowForm] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState<BaseCurrency>('PLN');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const getPeriodRange = (period: ChartPeriod) => {
    if (period === 'ALL') return { from: undefined, to: undefined };
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    const start = new Date(today);
    if (period === 'YTD') {
      start.setMonth(0, 1);
    } else if (period === '1M') {
      start.setMonth(start.getMonth() - 1);
    } else if (period === '3M') {
      start.setMonth(start.getMonth() - 3);
    } else if (period === '6M') {
      start.setMonth(start.getMonth() - 6);
    } else if (period === '1Y') {
      start.setFullYear(start.getFullYear() - 1);
    }
    const from = start.toISOString().slice(0, 10);
    return { from, to: end };
  };

  const loadData = async (period: ChartPeriod, currency: BaseCurrency) => {
    try {
      setLoading(true);
      let loadError: string | null = null;
      const exchangeData = await getExchanges();
      setExchanges(exchangeData);

      const { from, to } = getPeriodRange(period);
      const [holdingsResult, seriesResult] = await Promise.allSettled([
        getHoldings(currency),
        getPerformance(from, to, currency)
      ]);

      if (holdingsResult.status === 'fulfilled') {
        setHoldings(holdingsResult.value);
      } else {
        setHoldings([]);
        loadError = 'Holdings failed to load. Check provider settings.';
      }

      if (seriesResult.status === 'fulfilled') {
        setSeries(seriesResult.value);
      } else {
        setSeries([]);
        loadError = 'Performance failed to load. Check provider settings.';
      }

      setError(loadError);

      if (!form.market && exchangeData.length) {
        setForm((prev) => ({ ...prev, market: exchangeData[0].code }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      const { from, to } = getPeriodRange(chartPeriod);
      await refreshData(from, to, baseCurrency);
      await loadData(chartPeriod, baseCurrency);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData(chartPeriod, baseCurrency);
  }, [chartPeriod, baseCurrency]);

  useEffect(() => {
    if (!form.ticker || !form.market) {
      setValidation({ status: 'idle', result: null });
      return;
    }

    const handle = setTimeout(async () => {
      setValidation({ status: 'checking' });
      try {
        const result = await validateSymbol(form.ticker, form.market);
        if (result.valid) {
          const name = result.symbol?.name ? ` • ${result.symbol.name}` : '';
          setValidation({
            status: 'valid',
            message: `Validated${name}`,
            result
          });
        } else {
          const reason = result.reason === 'unsupported_market'
            ? 'Market not supported in this MVP.'
            : 'Ticker not found.';
          setValidation({
            status: 'invalid',
            message: reason,
            result
          });
        }
      } catch (err) {
        setValidation({
          status: 'invalid',
          message: err instanceof Error ? err.message : 'Validation failed'
        });
      }
    }, 500);

    return () => clearTimeout(handle);
  }, [form.ticker, form.market]);

  const totals = useMemo(() => {
    const totalValue = holdings.reduce((sum, holding) => sum + holding.market_value, 0);
    const costBasis = holdings.reduce((sum, holding) => sum + holding.cost_basis, 0);
    const pnl = totalValue - costBasis;
    return { totalValue, costBasis, pnl, pnlDisplay: normalizeMoney(pnl) };
  }, [holdings]);

  const dailyChange = useMemo(() => {
    if (series.length < 2) return { delta: 0, pct: 0, label: '24h Change' };
    const last = series[series.length - 1]?.value ?? 0;
    let prevIndex = series.length - 2;
    while (prevIndex >= 0 && series[prevIndex]?.value === last) {
      prevIndex -= 1;
    }
    const prev = prevIndex >= 0 ? series[prevIndex]?.value ?? last : last;
    const delta = normalizeMoney(last - prev);
    const pct = prev ? (delta / prev) * 100 : 0;
    const label = prevIndex < series.length - 2 ? 'Since Last Close' : '24h Change';
    return { delta, pct, label };
  }, [series]);

  const exchangeMap = useMemo(() => {
    return new Map(exchanges.map((exchange) => [exchange.code, exchange]));
  }, [exchanges]);

  const groupedHoldings = useMemo(() => {
    const map = new Map<string, {
      key: string;
      ticker: string;
      market: string;
      company_name: string | null;
      lots: Holding[];
      totalQty: number;
      totalValue: number;
      totalCost: number;
      totalPnl: number;
      avgBuy: number;
      lastPrice: number;
    }>();

    holdings.forEach((holding) => {
      const key = `${holding.ticker}|${holding.market}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          ticker: holding.ticker,
          market: holding.market,
          company_name: holding.company_name || null,
          lots: [holding],
          totalQty: holding.quantity,
          totalValue: holding.market_value,
          totalCost: holding.cost_basis,
          totalPnl: holding.unrealized_pnl,
          avgBuy: 0,
          lastPrice: 0
        });
        return;
      }
      existing.lots.push(holding);
      existing.totalQty += holding.quantity;
      existing.totalValue += holding.market_value;
      existing.totalCost += holding.cost_basis;
      existing.totalPnl += holding.unrealized_pnl;
      if (!existing.company_name && holding.company_name) {
        existing.company_name = holding.company_name;
      }
    });

    const groups = Array.from(map.values());
    groups.forEach((group) => {
      group.avgBuy = group.totalQty ? group.totalCost / group.totalQty : 0;
      group.lastPrice = group.totalQty ? group.totalValue / group.totalQty : 0;
      group.totalPnl = normalizeMoney(group.totalPnl);
    });
    groups.sort((a, b) => b.totalValue - a.totalValue);
    return groups;
  }, [holdings]);

  const breakdown = useMemo(() => {
    const total = groupedHoldings.reduce((sum, holding) => sum + holding.totalValue, 0);
    return groupedHoldings
      .slice(0, 4)
      .map((holding) => ({
        label: holding.ticker,
        value: holding.totalValue,
        pct: total ? (holding.totalValue / total) * 100 : 0
      }));
  }, [groupedHoldings]);

  const allocation = useMemo(() => {
    const totals = new Map<string, number>();
    groupedHoldings.forEach((holding) => {
      const region = exchangeMap.get(holding.market)?.region || 'Other';
      totals.set(region, (totals.get(region) || 0) + holding.totalValue);
    });
    const totalValue = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    return Array.from(totals.entries())
      .map(([region, value]) => ({
        label: region,
        value,
        pct: totalValue ? (value / totalValue) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value);
  }, [groupedHoldings, exchangeMap]);

  const movers = useMemo(() => {
    return [...groupedHoldings]
      .sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl))
      .slice(0, 3);
  }, [groupedHoldings]);

  const chartSeries = useMemo(() => {
    if (!series.length) {
      return { labels: [], values: [] as number[], costBasis: [] as number[] };
    }

    const dates = series.map((point) => point.date);
    const sortedHoldings = [...holdings].sort((a, b) => a.buy_date.localeCompare(b.buy_date));
    const costBasis: number[] = [];
    let runningCost = 0;
    let idx = 0;

    for (const date of dates) {
      while (idx < sortedHoldings.length && sortedHoldings[idx].buy_date <= date) {
        runningCost += sortedHoldings[idx].buy_price * sortedHoldings[idx].quantity;
        idx += 1;
      }
      costBasis.push(runningCost);
    }

    const values =
      chartMode === 'value'
        ? series.map((point) => Math.round(point.value * 100) / 100)
        : series.map((point, index) => {
            const raw = point.value - costBasis[index];
            const rounded = Math.round(raw * 100) / 100;
            return Math.abs(rounded) < 0.01 ? 0 : rounded;
          });

    return { labels: dates, values, costBasis };
  }, [series, holdings, chartMode]);

  const selectedExchange = exchanges.find((exchange) => exchange.code === form.market);

  const handleChange = (field: keyof HoldingInput, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: field === 'buy_price' || field === 'quantity' ? Number(value) : value
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createHolding(form);
      setForm((prev) => ({ ...defaultForm, market: prev.market }));
      await loadData(chartPeriod, baseCurrency);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add holding');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteHolding(id);
      await loadData(chartPeriod, baseCurrency);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete holding');
    }
  };

  const chartData = {
    labels: chartSeries.labels,
    datasets: [
      {
        label: chartMode === 'value' ? 'Portfolio Value' : 'Unrealized Gains',
        data: chartSeries.values,
        fill: true,
        tension: 0.35,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.15)',
        pointRadius: 0
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      x: {
        ticks: { color: '#64748b' },
        grid: { color: 'rgba(15, 23, 42, 0.08)' }
      },
      y: {
        ticks: {
          color: '#64748b',
          callback: (value: string | number) => formatAxisCurrency(value, baseCurrency)
        },
        grid: { color: 'rgba(15, 23, 42, 0.08)' }
      }
    }
  };

  const isSubmitDisabled =
    saving ||
    validation.status === 'checking' ||
    validation.status === 'invalid' ||
    !form.ticker ||
    !form.market;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <p className="eyebrow">Portfolio Tracker MVP</p>
          <h1>Portfolio Atlas</h1>
          <p className="subtitle">
            Track US, UK, EU, and crypto positions with fast validation and live cache-aware pricing.
          </p>
        </div>
        <div className="topbar-actions">
          <div className="currency-switch">
            <span>Base Currency</span>
            <select
              value={baseCurrency}
              onChange={(event) => setBaseCurrency(event.target.value as BaseCurrency)}
            >
              {(['PLN', 'USD', 'EUR', 'GBP'] as BaseCurrency[]).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="ghost refresh-button" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh data'}
          </button>
        </div>
      </header>

      {error && <div className="alert">{error}</div>}

      <section className="dashboard">
        <div className="card balance-card">
          <div className="card-header">
            <span className="card-label">Total Balance</span>
            <button className="ghost icon" type="button" aria-label="Balance options">
              ...
            </button>
          </div>
          <strong className="metric">{formatMoney(totals.totalValue, baseCurrency)}</strong>
          <span className={`delta ${dailyChange.delta >= 0 ? 'positive' : 'negative'}`}>
            {dailyChange.label} {dailyChange.delta >= 0 ? '+' : ''}
            {formatMoney(dailyChange.delta, baseCurrency)} ({dailyChange.pct >= 0 ? '+' : ''}
            {dailyChange.pct.toFixed(2)}%)
          </span>
        </div>

        <div className="card breakdown-card">
          <div className="card-header">
            <span className="card-label">Portfolio Breakdown</span>
            <button className="ghost icon" type="button" aria-label="Breakdown options">
              ...
            </button>
          </div>
          <div className="breakdown-list">
            {breakdown.length ? (
              breakdown.map((item) => (
                <div className="breakdown-item" key={item.label}>
                  <div className="breakdown-meta">
                    <span>{item.label}</span>
                    <span>{item.pct.toFixed(1)}%</span>
                  </div>
                  <div className="breakdown-bar">
                    <span style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <p className="placeholder">No holdings yet.</p>
            )}
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-header">
            <div>
              <span className="card-label">Portfolio Chart</span>
              <span className="card-subtitle">
                {series.length ? `${series[0].date} → ${series[series.length - 1].date}` : 'No data yet'}
              </span>
            </div>
            <div className="chart-controls">
              <div className="period-toggle">
                {(['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as ChartPeriod[]).map((period) => (
                  <button
                    key={period}
                    type="button"
                    className={chartPeriod === period ? 'active' : ''}
                    onClick={() => setChartPeriod(period)}
                  >
                    {period}
                  </button>
                ))}
              </div>
              <div className="chart-toggle">
                <button
                  type="button"
                  className={chartMode === 'value' ? 'active' : ''}
                  onClick={() => setChartMode('value')}
                >
                  Value
                </button>
                <button
                  type="button"
                  className={chartMode === 'gains' ? 'active' : ''}
                  onClick={() => setChartMode('gains')}
                >
                  Gains
                </button>
              </div>
            </div>
          </div>
          <div className="chart-wrapper">
            {loading ? <div className="placeholder">Loading chart...</div> : <Line data={chartData} options={chartOptions} />}
          </div>
        </div>

        <div className="card allocation-card">
          <div className="card-header">
            <span className="card-label">Asset Allocation</span>
            <button className="ghost icon" type="button" aria-label="Allocation options">
              ...
            </button>
          </div>
          <div className="allocation-body">
            <div className="donut">
              <Doughnut
                data={{
                  labels: allocation.map((item) => item.label),
                  datasets: [
                    {
                      data: allocation.map((item) => item.value),
                      backgroundColor: ['#2563eb', '#16a34a', '#7c3aed', '#f97316', '#0ea5e9'],
                      borderWidth: 0
                    }
                  ]
                }}
                options={{
                  cutout: '70%',
                  plugins: { legend: { display: false } },
                  responsive: true,
                  maintainAspectRatio: false
                }}
              />
            </div>
            <div className="allocation-legend">
              {allocation.length ? (
                allocation.map((item) => (
                  <div className="legend-row" key={item.label}>
                    <span>{item.label}</span>
                    <span>{item.pct.toFixed(1)}%</span>
                  </div>
                ))
              ) : (
                <p className="placeholder">No data yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="card movers-card">
          <div className="card-header">
            <span className="card-label">Top Movers</span>
            <button className="ghost icon" type="button" aria-label="Movers options">
              ...
            </button>
          </div>
          <div className="movers-list">
            {movers.length ? (
              movers.map((holding) => (
                <div className="mover-row" key={holding.key}>
                  <div>
                    <strong>{holding.ticker}</strong>
                    <span>{holding.company_name || 'Name unavailable'}</span>
                  </div>
                  <span className={holding.totalPnl >= 0 ? 'positive' : 'negative'}>
                    {formatMoney(holding.totalPnl, baseCurrency)}
                  </span>
                </div>
              ))
            ) : (
              <p className="placeholder">No movers yet.</p>
            )}
          </div>
        </div>

        <div className="card table-card">
          <div className="card-header">
            <div>
              <span className="card-label">Holdings</span>
              <span className="card-subtitle">{groupedHoldings.length} positions</span>
            </div>
          </div>
          <div className="table">
            <div className="table-row table-head">
              <span className="cell">Company</span>
              <span className="cell numeric">Buy</span>
              <span className="cell numeric">Qty</span>
              <span className="cell numeric">Last</span>
              <span className="cell numeric">Value</span>
              <span className="cell numeric">P/L</span>
              <span className="cell actions"></span>
            </div>
            {loading ? (
              <div className="placeholder">Loading holdings...</div>
            ) : groupedHoldings.length ? (
              groupedHoldings.map((group) => {
                const isExpanded = !!expandedGroups[group.key];
                const canExpand = group.lots.length > 1;
                return (
                  <div key={group.key}>
                    <div className={`table-row group-row ${canExpand ? 'has-lots' : ''}`}>
                      <span className="cell ticker">
                        <span className="ticker-block">
                          <span className="ticker-line">
                            {canExpand && (
                              <button
                                type="button"
                                className={`lot-toggle ${isExpanded ? 'open' : ''}`}
                                onClick={() =>
                                  setExpandedGroups((prev) => ({
                                    ...prev,
                                    [group.key]: !prev[group.key]
                                  }))
                                }
                                aria-label={isExpanded ? 'Collapse lots' : 'Expand lots'}
                              >
                                &gt;
                              </button>
                            )}
                            <strong>{group.ticker}</strong>
                          </span>
                          <span>{group.company_name || 'Name unavailable'}</span>
                        </span>
                      </span>
                      <span className="cell numeric">{formatMoney(group.avgBuy, baseCurrency)}</span>
                      <span className="cell numeric">{group.totalQty}</span>
                      <span className="cell numeric">{formatMoney(group.lastPrice, baseCurrency)}</span>
                      <span className="cell numeric">{formatMoney(group.totalValue, baseCurrency)}</span>
                      <span className={`cell numeric ${group.totalPnl >= 0 ? 'positive' : 'negative'}`}>
                        {formatMoney(group.totalPnl, baseCurrency)}
                      </span>
                      <span className="cell actions" />
                    </div>
                    {isExpanded && (
                      <div className="lot-rows">
                        {group.lots.map((lot) => {
                          const lotPnl = normalizeMoney(lot.unrealized_pnl);
                          return (
                            <div className="table-row lot-row" key={lot.id}>
                              <span className="cell ticker">
                                <span className="ticker-block">
                                  <span className="lot-label">Lot - {lot.buy_date}</span>
                                </span>
                              </span>
                              <span className="cell numeric">{formatMoney(lot.buy_price, baseCurrency)}</span>
                              <span className="cell numeric">{lot.quantity}</span>
                              <span className="cell numeric">{formatMoney(lot.latest_quote.price, baseCurrency)}</span>
                              <span className="cell numeric">{formatMoney(lot.market_value, baseCurrency)}</span>
                              <span className={`cell numeric ${lotPnl >= 0 ? 'positive' : 'negative'}`}>
                                {formatMoney(lotPnl, baseCurrency)}
                              </span>
                              <span className="cell actions">
                                <button className="ghost" onClick={() => handleDelete(lot.id)}>
                                  Remove
                                </button>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="placeholder">No holdings yet. Add one below.</div>
            )}
          </div>
        </div>

        <div className="card add-card">
          <div className="card-header">
            <div>
              <span className="card-label">Add Holding</span>
              <span className="card-subtitle">Validate by ticker + market</span>
            </div>
            <button
              type="button"
              className={`ghost form-toggle ${showForm ? 'active' : ''}`}
              onClick={() => setShowForm((prev) => !prev)}
            >
              {showForm ? 'Hide' : 'Add'}
            </button>
          </div>
          {showForm ? (
            <form onSubmit={handleSubmit} className="form">
              <label>
                Ticker
                <input
                  data-testid="ticker-input"
                  value={form.ticker}
                  onChange={(e) => handleChange('ticker', e.target.value)}
                  placeholder={selectedExchange?.assetType === 'crypto' ? 'BTC/USDT' : 'AAPL'}
                  required
                />
                {validation.status !== 'idle' && (
                  <span
                    className={`validation ${validation.status}`}
                  >
                    {validation.status === 'checking' ? 'Checking...' : validation.message}
                  </span>
                )}
                {selectedExchange?.notes && (
                  <span className="hint">{selectedExchange.notes}</span>
                )}
              </label>
              <label>
                Market / Exchange
                <select
                  data-testid="market-select"
                  value={form.market}
                  onChange={(e) => handleChange('market', e.target.value)}
                  disabled={!exchanges.length}
                  required
                >
                  {exchanges.map((exchange) => (
                    <option key={exchange.code} value={exchange.code}>
                      {exchange.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Buy Date
                <input
                  data-testid="buy-date-input"
                  type="date"
                  value={form.buy_date}
                  onChange={(e) => handleChange('buy_date', e.target.value)}
                  required
                />
              </label>
              <label>
                Buy Price
                <input
                  data-testid="buy-price-input"
                  type="number"
                  step="0.01"
                  value={form.buy_price || ''}
                  onChange={(e) => handleChange('buy_price', e.target.value)}
                  required
                />
              </label>
              <label>
                Quantity
                <input
                  data-testid="quantity-input"
                  type="number"
                  step="0.0001"
                  value={form.quantity || ''}
                  onChange={(e) => handleChange('quantity', e.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={isSubmitDisabled} data-testid="submit-holding">
                {saving ? 'Saving...' : 'Add Holding'}
              </button>
            </form>
          ) : (
            <div className="form-collapsed">
              Add holdings when you need to update your portfolio.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default App;
