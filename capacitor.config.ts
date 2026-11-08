import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yjh832.auctionradar',
  appName: '竞价雷达',
  webDir: 'dist',
  server: {
    url: 'https://yjh832.github.io/auction-radar/',
    cleartext: false,
    androidScheme: 'https'
  },
  android: {
    backgroundColor: '#EEF4FB',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  }
};

export default config;
