import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import App from './App.vue';
import { createAppRouter, installRouteGuards } from './router';
import { installSessionExpiryRedirect } from './router/session-expiry';
import './styles.css';

const app = createApp(App);
const pinia = createPinia();
const router = createAppRouter();

installRouteGuards(router);

installSessionExpiryRedirect(router, pinia);

app.use(pinia);
app.use(router);
app.use(ElementPlus, { locale: zhCn });

void router.isReady().then(() => app.mount('#app'));
