// Набор линейных иконок (24×24, обводка currentColor)
const svg = (body, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const I = {
  home: svg('<path d="M3.5 10.2 12 3.5l8.5 6.7"/><path d="M5.5 8.8V19a1.5 1.5 0 0 0 1.5 1.5h3.2v-5.3h3.6v5.3H17a1.5 1.5 0 0 0 1.5-1.5V8.8"/>'),
  calendar: svg('<rect x="3.5" y="4.8" width="17" height="15.7" rx="3"/><path d="M3.5 9.6h17M8.3 3v3.4M15.7 3v3.4"/><path d="M8 13.4h.01M12 13.4h.01M16 13.4h.01M8 16.8h.01M12 16.8h.01"/>'),
  requests: svg('<path d="M9 4.2H7.2a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V6.2a2 2 0 0 0-2-2H15"/><rect x="9" y="2.8" width="6" height="3.2" rx="1"/><path d="m9 13.6 2.1 2.1 4-4.4"/>'),
  chart: svg('<path d="M4 20.5h16"/><path d="M7 17V12M12 17V6.5M17 17V9.5"/>'),
  user: svg('<circle cx="12" cy="8.2" r="3.9"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  bell: svg('<path d="M6.3 9a5.7 5.7 0 1 1 11.4 0c0 6.2 2.8 8 2.8 8H3.5s2.8-1.8 2.8-8"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>'),
  chevR: svg('<path d="m9.5 6 6 6-6 6"/>'),
  chevL: svg('<path d="m14.5 6-6 6 6 6"/>'),
  chevD: svg('<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>'),
  arrowR: svg('<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>'),
  arrowIn: svg('<path d="M17 7 7 17M16.5 17H7V7.5"/>'),
  arrowOut: svg('<path d="M7 17 17 7M7.5 7H17v9.5"/>'),
  alert: svg('<path d="M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>'),
  file: svg('<path d="M14 2.8H6.8a2 2 0 0 0-2 2v14.4a2 2 0 0 0 2 2h10.4a2 2 0 0 0 2-2V8z"/><path d="M14 2.8V8h5.2"/>'),
  check: svg('<path d="M20 6.5 9.2 17.3 4 12.1"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  bank: svg('<path d="M3 20.5h18M5.5 17.5v-7M10 17.5v-7M14 17.5v-7M18.5 17.5v-7M3 8.2 12 3.5l9 4.7v1H3z"/>'),
  cash: svg('<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5"/><path d="M4 3.8v4.7h4.7"/><path d="M4 13a8 8 0 0 0 14.3 4.6l1.7-2.1"/><path d="M20 20.2v-4.7h-4.7"/>'),
  logout: svg('<path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5"/><path d="m15.5 16.5 4.5-4.5-4.5-4.5M20 12H9"/>'),
  chat: svg('<path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.5-4.3a8.5 8.5 0 1 1 15.5-4.6z"/>'),
  tg: svg('<path d="M21 4.2 2.8 11.3c-.7.3-.7 1.2 0 1.5l4.6 1.6 1.8 5.5c.2.6 1 .8 1.4.3l2.6-2.6 4.6 3.4c.5.4 1.3.1 1.4-.5L21.9 5.1c.1-.6-.4-1.1-.9-.9z"/><path d="m7.4 14.4 9.4-6.6-6.9 8"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.6"/><path d="M12 7.5V12l3 2"/>'),
  sun: svg('<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2M12 19.2v2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M2.8 12h2M19.2 12h2M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>'),
  trendDown: svg('<path d="m21 17-7.5-7.5-4.5 4.5L3 8"/><path d="M15.5 17H21v-5.5"/>'),
  building: svg('<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M9.5 21v-3.6h5V21M8.5 7.5h.01M12 7.5h.01M15.5 7.5h.01M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="8.6"/><path d="M12 16v-4.5M12 8h.01"/>'),
  phone: svg('<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 18.5h3"/>'),
  shield: svg('<path d="M12 21s7.5-3.2 7.5-9.5V5.8L12 3 4.5 5.8v5.7C4.5 17.8 12 21 12 21z"/><path d="m9 12 2 2 4-4"/>'),
  pulse: svg('<path d="M2.5 12.5h4l2.5-6 4 11.5 2.8-5.5h5.7"/>'),
  download: svg('<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 20.5h15"/>'),
};

// Знак продукта: тёмный квадрат с коралловым «пульсом»
export const logoMark = (size = 40) => `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="14" fill="#141414"/><path d="M9 26h7l3.6-9.5 6.6 17 4.2-9.5H39" fill="none" stroke="#FF5B2E" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="39" cy="24" r="2.6" fill="#F4F1EA"/></svg>`;
