import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import App from './App.vue';
import { createAppRouter, installRouteGuards } from './router';
import { onUnauthorized } from './shared/api/http';
import { useSessionStore } from './shared/stores/session';
import './styles.css';

const app = createApp(App);
const pinia = createPinia();
const router = createAppRouter();

installRouteGuards(router);

onUnauthorized(() => {
  const session = useSessionStore(pinia);
  session.clear();
  session.loaded = true;
  const current = router.currentRoute.value;
  if (current.name && current.name !== 'login') {
    void router.replace({ name: 'login', query: { redirect: current.fullPath } });
  }
});

app.use(pinia);
app.use(router);
app.use(ElementPlus, { locale: zhCn });

void router.isReady().then(() => app.mount('#app'));
