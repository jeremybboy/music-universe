import { defineConfig } from 'vite';

const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<rect width="24" height="24" rx="5" fill="#100d18"/>' +
  '<path d="M3 13v-2m4 5V8m5 13V3m5 14V7m4 7v-4" fill="none" stroke="#d6a7f8" stroke-width="1.7" stroke-linecap="round"/>' +
  '</svg>';

export default defineConfig({
  base: '/music-universe/',
  plugins: [{
    name: 'pages-favicon',
    transformIndexHtml: () => [{
      tag: 'link',
      attrs: {
        rel: 'icon',
        type: 'image/svg+xml',
        href: 'data:image/svg+xml,' + encodeURIComponent(icon),
      },
    }],
  }],
});
