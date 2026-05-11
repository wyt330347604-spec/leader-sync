import '@testing-library/jest-dom/vitest';

// cmdk uses ResizeObserver internally; polyfill for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// cmdk calls scrollIntoView on items; polyfill for jsdom
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}
