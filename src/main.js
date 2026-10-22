import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')

document.addEventListener("DOMContentLoaded", event => {
  // we can move only if we are not in a browser's tab
  const isBrowser = matchMedia("(display-mode: browser)").matches;
  if (!isBrowser) {
    // Restore saved size, or use defaults
    const savedWidth = localStorage.getItem('windowWidth') || 800;
    const savedHeight = localStorage.getItem('windowHeight') || 600;

    window.resizeTo(Number(savedWidth), Number(savedHeight));

    // Save size when window is resized
    window.addEventListener('resize', () => {
      localStorage.setItem('windowWidth', window.outerWidth);
      localStorage.setItem('windowHeight', window.outerHeight);
    });
  }
});
