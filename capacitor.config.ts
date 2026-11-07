import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yjh832.auctionradar',
  appName: '竞价寻龙',
  webDir: 'dist',
  server: {
    url: 'https://yjh832.github.io/auction-radar/',
    cleartext: false,
    androidScheme: 'https'
  },
  android: {
    backgroundColor: '#F2EEE5',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  }
};

export default config;
