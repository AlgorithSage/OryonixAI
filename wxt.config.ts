import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Oryonix AI Copilot',
    description: 'Privacy-first universal agentic browser copilot',
    version: '1.0.0',
    permissions: [
      'activeTab',
      'storage',
      'tabs',
      'scripting',
    ],
    host_permissions: [
      'http://localhost:11434/*',
      '*://*/*',
    ],
    action: {
      // No default_popup — clicking the icon triggers browser.action.onClicked
    },
  },
});


