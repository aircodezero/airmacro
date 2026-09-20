/*
 * Explications statiques AirMacro (anglais, contenu éditorial sans chiffres de
 * marché) : affichées instantanément dans la fiche détaillée et servant de
 * repli quand aucun modèle n'est disponible. Partagé serveur/client.
 */

/** @typedef {{ title: string, what: string, why: string, read: string }} Explainer */

/** @type {Record<string, Explainer>} */
export const EVENT_EXPLAINERS = {
  fomc: {
    title: 'FOMC rate decision',
    what: 'The Federal Open Market Committee sets the target range for the federal funds rate, the overnight rate at which banks lend reserves to each other. It meets eight times a year; the decision is published at 2:00 PM New York time with a policy statement, followed by the Chair’s press conference. Four meetings a year also publish the Summary of Economic Projections, including the “dot plot” of rate expectations.',
    why: 'The policy rate anchors short-term interest rates and, through expectations, influences bond yields, the dollar, equity valuations and credit conditions. Decisions are usually priced in advance, so the market reaction often comes from the statement wording, dissents, the projections and the press conference.',
    read: 'Compare the new range with the consensus forecast and the previous range: a move different from expectations is a genuine surprise. Then read the guidance — changes in the statement, the vote split and the median dot path. Hawkish (tighter) signals tend to lift short-term yields and the dollar; dovish signals tend to do the opposite.',
  },
  ecb: {
    title: 'ECB rate decision',
    what: 'The ECB Governing Council sets the euro area’s key interest rates; the deposit facility rate is the one that steers money-market rates. Decisions are published at 2:15 PM Frankfurt time, followed by a press conference at 2:45 PM. Staff macroeconomic projections are released at the March, June, September and December meetings.',
    why: 'ECB policy drives euro-area borrowing costs and the euro exchange rate, and the gap between ECB and Fed policy is a major driver of EUR/USD.',
    read: 'Compare the decision with expectations, then look for changes in guidance, the updated projections and the tone of the press conference on inflation and growth.',
  },
  boe: {
    title: 'Bank of England rate decision',
    what: 'The Bank of England’s Monetary Policy Committee sets Bank Rate. The decision is published at noon London time with a policy summary, the minutes and the votes of its nine members; quarterly meetings add the Monetary Policy Report.',
    why: 'Bank Rate sets UK borrowing costs and influences sterling; the vote split is a strong signal of the committee’s direction.',
    read: 'Look at the decision versus expectations, the vote split (for example 5–4 versus 9–0) and changes in guidance on future moves.',
  },
  boj: {
    title: 'Bank of Japan rate decision',
    what: 'The Bank of Japan’s Policy Board sets its short-term policy rate at two-day meetings. The statement is released when the meeting ends — there is no fixed time — and the Governor holds a press conference in the afternoon, Tokyo time. Four meetings a year include the Outlook Report.',
    why: 'BoJ policy moves the yen and global bond markets, because Japanese investors are large holders of foreign assets and the yen is a major funding currency.',
    read: 'Compare the decision with expectations and read the guidance on the pace of further moves and on bond purchases.',
  },
  cpi: {
    title: 'Consumer price index (CPI)',
    what: 'The consumer price index measures the change in prices paid by households for a basket of goods and services. Headline CPI includes food and energy; core CPI excludes them to show the underlying trend. In the US, the BLS publishes it around mid-month for the previous month.',
    why: 'Inflation drives central-bank decisions: inflation persistently above target argues for tighter policy, while cooling inflation opens the door to rate cuts.',
    read: 'Markets focus on core CPI month over month and on the gap to consensus — a 0.1-point surprise on core is significant. Year-over-year rates also move with base effects from twelve months earlier.',
  },
  pce: {
    title: 'PCE price index',
    what: 'The personal consumption expenditures price index, published by the BEA near the end of the month for the previous month, is the Federal Reserve’s preferred inflation measure; the Fed’s 2% target is defined on it. Core PCE excludes food and energy.',
    why: 'Core PCE is what the Fed watches most closely to judge underlying inflation. It is often well anticipated because much of it can be estimated from the CPI and PPI released earlier.',
    read: 'Compare core PCE month over month and year over year with the forecast; a surprise matters most when it changes the inflation trajectory relative to the Fed’s projections.',
  },
  nfp: {
    title: 'US jobs report (Employment Situation)',
    what: 'The BLS Employment Situation report, usually released on the first Friday of the month, includes nonfarm payrolls (jobs added or lost by employers), the unemployment rate (from a household survey) and average hourly earnings.',
    why: 'It is the broadest monthly read on the US labor market — the other half of the Fed’s dual mandate alongside stable prices.',
    read: 'Look at the payroll change versus consensus, revisions to the two prior months, the unemployment rate and wage growth. Strong jobs and wages tend to push yields and the dollar up; weak numbers tend to do the opposite. Monthly figures are noisy, so the three-month average is steadier.',
  },
  claims: {
    title: 'Initial jobless claims',
    what: 'Initial claims count new applications for unemployment insurance, published every Thursday by the US Department of Labor.',
    why: 'They are the most timely labor-market indicator: a sustained rise can signal layoffs before they show up in payrolls.',
    read: 'Focus on the trend, such as the four-week average, rather than a single week, which holiday timing, weather or seasonal adjustment can distort.',
  },
  jolts: {
    title: 'JOLTS job openings',
    what: 'The Job Openings and Labor Turnover Survey from the BLS reports job openings, hires, quits and layoffs, with a lag of about five weeks.',
    why: 'Openings relative to the number of unemployed workers gauge labor-market tightness; the quits rate tends to lead wage growth.',
    read: 'Compare openings with consensus and recent months, and look at quits and hires for confirmation.',
  },
  gdp: {
    title: 'Gross domestic product (GDP)',
    what: 'GDP measures the value of goods and services produced. In the US, the BEA publishes each quarter in three estimates (advance, second and third), expressed as a real quarter-over-quarter growth rate at a seasonally adjusted annual rate.',
    why: 'It is the broadest gauge of economic momentum and shapes views on recession risk, corporate earnings and the policy outlook.',
    read: 'Compare with the forecast and look at the composition — consumer spending, business investment, inventories and net exports. Later estimates revise the advance figure.',
  },
  ism: {
    title: 'ISM business surveys',
    what: 'The ISM purchasing managers’ indexes survey US manufacturing and services firms on new orders, production, employment and prices.',
    why: 'They are timely, forward-looking reads on activity; the prices-paid component is watched for inflation pressure.',
    read: 'A reading above 50 indicates expansion and below 50 contraction. Look at new orders and prices alongside the headline.',
  },
  pmi: {
    title: 'Purchasing managers’ index (PMI)',
    what: 'PMIs, such as S&P Global’s flash surveys, ask companies about output, new orders, employment and prices.',
    why: 'They are among the earliest monthly signals on activity in each economy.',
    read: 'A reading above 50 indicates expansion and below 50 contraction; the direction of change often matters as much as the level.',
  },
  retail: {
    title: 'Retail sales',
    what: 'Retail sales measure monthly spending at retailers and restaurants (US Census Bureau), in nominal terms — not adjusted for inflation. “Core” retail sales exclude autos.',
    why: 'Consumer spending is about two-thirds of US GDP, and retail sales are an early read on it.',
    read: 'Compare with consensus. Headline figures can swing with car sales and gasoline prices, so the ex-autos and control-group measures give a steadier signal.',
  },
  sentiment: {
    title: 'Consumer sentiment & inflation expectations',
    what: 'Surveys such as the University of Michigan’s measure household confidence and expected inflation over the next year and the next five to ten years.',
    why: 'Inflation expectations matter to central banks because they can become self-fulfilling through wage and price setting.',
    read: 'Compare with the forecast and watch the longer-run inflation expectations for signs of de-anchoring.',
  },
  labor: {
    title: 'Labor-market data',
    what: 'Labor statistics such as the UK claimant count, unemployment rates and average earnings measure changes in employment, joblessness and pay.',
    why: 'Labor-market slack and wage growth shape the central bank’s view of domestic inflation pressure.',
    read: 'Compare with consensus; wage growth is often the most market-moving component.',
  },
  speech: {
    title: 'Central-bank speech',
    what: 'Speeches and testimony by central-bank leaders can shift expectations for policy between meetings.',
    why: 'Markets parse the remarks for changes in tone on inflation, growth and the timing of rate moves.',
    read: 'Look for departures from the latest policy statement. Fed officials do not discuss policy publicly during the blackout period around each FOMC meeting.',
  },
  meeting: {
    title: 'Policy meeting in session',
    what: 'The committee is meeting; nothing is announced on the first day of a two-day meeting.',
    why: 'The decision, statement and press conference follow on the second day.',
    read: 'Use the time to review the consensus forecast and the data released since the previous meeting.',
  },
  other: {
    title: 'Economic release',
    what: 'A scheduled economic release selected for its potential market impact.',
    why: 'Data that differ from expectations can move interest-rate expectations and asset prices.',
    read: 'Compare the actual figure with the consensus forecast and the previous value.',
  },
}

/** @type {Record<string, Explainer>} */
export const INDICATOR_EXPLAINERS = {
  cpiYoY: {
    title: 'CPI inflation, year over year',
    what: 'The change in the US consumer price index (CPI-U, all items) over the past twelve months, not seasonally adjusted — the official year-over-year measure published by the BLS.',
    why: 'Headline inflation shapes household purchasing power and inflation expectations, and feeds into the Fed’s reaction function.',
    read: 'Compare with the 2% objective and with core inflation: a gap driven by food or energy can reverse quickly, while core trends are stickier.',
  },
  coreCpiYoY: {
    title: 'Core CPI inflation, year over year',
    what: 'The twelve-month change in the CPI excluding food and energy (BLS, not seasonally adjusted).',
    why: 'Core inflation filters out volatile components and better reflects underlying price pressure.',
    read: 'Watch the direction over several months; shelter and services components tend to move slowly.',
  },
  corePceYoY: {
    title: 'Core PCE inflation, year over year',
    what: 'The twelve-month change in the PCE price index excluding food and energy, from the BEA — the Federal Reserve’s preferred measure of underlying inflation. The Fed’s 2% target is defined on the PCE index.',
    why: 'It is the inflation gauge that maps most directly onto Fed policy decisions and projections.',
    read: 'Compare with 2% and with the Fed’s latest projections; it is usually published about two weeks after the CPI for the same month.',
  },
  unrate: {
    title: 'Unemployment rate',
    what: 'The share of the labor force without a job and actively looking for one (U-3), seasonally adjusted, from the BLS household survey.',
    why: 'It is the headline measure of labor-market slack in the Fed’s maximum-employment mandate.',
    read: 'Small monthly moves are noise; a sustained rise of several tenths of a point from its low has historically been an early recession signal.',
  },
  nfp: {
    title: 'Nonfarm payrolls',
    what: 'The monthly change in total nonfarm payroll employment from the BLS establishment survey, in thousands. The latest month is preliminary and is revised in the next two reports.',
    why: 'Job creation drives income and spending, and signals how tight the labor market is.',
    read: 'Use the three-month average to smooth noise, and check revisions: large downward revisions can change the picture.',
  },
  fedTarget: {
    title: 'Fed funds target range',
    what: 'The Federal Reserve’s target range for the federal funds rate, set by the FOMC. The effective federal funds rate (EFFR) is the volume-weighted median of overnight fed funds trades, published by the New York Fed each business day.',
    why: 'It is the anchor of US short-term interest rates and the main lever of monetary policy.',
    read: 'The EFFR normally trades inside the range. Compare the range with inflation to judge how restrictive policy is in real terms.',
  },
  y10: {
    title: '10-year Treasury yield',
    what: 'The yield on the 10-year US Treasury note from the Treasury’s daily par yield curve (constant maturity).',
    why: 'It is the benchmark for mortgages, corporate borrowing and equity valuations, and reflects expected policy rates, inflation and a term premium.',
    read: 'Rising yields tighten financial conditions; compare the move with changes in policy expectations to see whether the term premium is driving it.',
  },
  spread10y3m: {
    title: '10-year minus 3-month Treasury spread',
    what: 'The difference between the 10-year and 3-month Treasury yields, in basis points.',
    why: 'An inverted curve (negative spread) has preceded US recessions historically, and the New York Fed’s recession-probability model is based on this spread.',
    read: 'Positive means a normal upward-sloping curve; negative means inversion. Historically, recessions have tended to begin after an inversion, often once the curve had started to re-steepen.',
  },
  vix: {
    title: 'VIX volatility index',
    what: 'The Cboe Volatility Index measures the 30-day volatility implied by S&P 500 options — often called the market’s “fear gauge”.',
    why: 'It captures how much protection investors are paying for; spikes usually coincide with equity sell-offs.',
    read: 'Readings below roughly 15 are generally considered calm and above roughly 30 stressed; the level mean-reverts over time.',
  },
  dxy: {
    title: 'US dollar index',
    what: 'The dollar’s value against a basket of six major currencies, with the euro at about 58% of the weight. When the live index is unavailable, AirMacro shows a replica computed with the official ICE formula from ECB reference rates.',
    why: 'A stronger dollar tightens global financial conditions and weighs on commodity prices and on emerging markets.',
    read: 'Relative interest-rate expectations are a key driver: hawkish Fed surprises tend to support the dollar.',
  },
  wti: {
    title: 'WTI crude oil',
    what: 'The price of West Texas Intermediate crude oil in US dollars per barrel — the front-month NYMEX future, or the Cushing spot price published by the EIA when the future is unavailable.',
    why: 'Energy prices feed directly into headline inflation and consumer spending power.',
    read: 'Large moves pass through to gasoline prices and headline CPI within weeks; core inflation reacts more slowly.',
  },
  gdp: {
    title: 'Real GDP growth',
    what: 'Real gross domestic product growth, quarter over quarter at a seasonally adjusted annual rate, from the BEA.',
    why: 'It is the broadest measure of the economy’s momentum.',
    read: 'Two consecutive negative quarters are a common rule of thumb for recession, but US recessions are officially dated by the NBER using a broader set of indicators.',
  },
}

/** Clé d'explication d'un événement (réunion jour 1 → « meeting »). */
export const explainerKeyForEvent = (event) =>
  event?.category === 'meeting' ? 'meeting' : EVENT_EXPLAINERS[event?.kind] ? event.kind : 'other'

export const eventExplainer = (event) => EVENT_EXPLAINERS[explainerKeyForEvent(event)]

export const indicatorExplainer = (key) => INDICATOR_EXPLAINERS[key] ?? null
