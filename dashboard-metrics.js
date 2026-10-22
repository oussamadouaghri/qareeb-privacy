/* Shared by the browser and the regression tests. No network or DOM dependencies. */
(function(root) {
  const number = field => Number(field?.integerValue ?? field?.doubleValue ?? field ?? 0) || 0;
  const ratio = (n,d) => d > 0 ? n / d : null;
  function ads(fields, format = 'ALL') {
    const key = suffix => format === 'ALL' ? ({requests:'ad_requests_total',matched:'ad_matched_total',impressions:'total_ad_impressions',clicks:'total_ad_clicks',revenue_micros:'estimated_revenue_micros'})[suffix] : `ad_${format}_${suffix}`;
    const get = suffix => number(fields[key(suffix)]);
    const impressions = Math.max(0, get('impressions') - (format === 'ALL' ? number(fields.ad_revenue_event_impressions) : 0)), requests = get('requests'), matched = get('matched'), clicks = get('clicks');
    const revenueKnown = Object.hasOwn(fields,key('revenue_micros'));
    const revenue = revenueKnown ? get('revenue_micros') / 1e6 : null;
    return {requests,matched,impressions,clicks,revenue,match:matched<=requests?ratio(matched,requests):null,show:impressions<=matched?ratio(impressions,matched):null,ctr:ratio(clicks,impressions),ecpm:revenue === null ? null : ratio(revenue*1000,impressions)};
  }
  function countries(fields) {
    const result = new Map();
    for (const [key,value] of Object.entries(fields)) {
      const match = /^country_([A-Z]{2}|GLOBAL)(?:_(sessions|installs|returning))?$/.exec(key);
      if (!match) continue;
      const [,code,type] = match;
      if (!result.has(code)) result.set(code,{code,installs:0,returning:0,sessions:0});
      const row=result.get(code);
      if(type) row[type]=number(value);
      else if(!Object.hasOwn(fields,`country_${code}_sessions`)) row.sessions=number(value);
    }
    return [...result.values()].sort((a,b)=>b.sessions-a.sessions);
  }
  const csvCell = value => '"'+String(/^[=+@\-\t\r]/.test(String(value)) ? "'"+value : value).replaceAll('"','""')+'"';
  const api={number,ratio,ads,countries,csvCell};
  if(typeof module !== 'undefined') module.exports=api;
  else root.QareebMetrics=api;
})(typeof window === 'undefined' ? globalThis : window);
