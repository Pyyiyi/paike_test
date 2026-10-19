import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ForbiddenView from './ForbiddenView.vue';
import NotFoundView from './NotFoundView.vue';
import { useSessionStore } from '@/shared/stores/session';

const StubView = { template: '<div />' };

async function mountResult(component: typeof ForbiddenView | typeof NotFoundView) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/403', component: StubView },
      { path: '/404', component: StubView },
      { path: '/', component: StubView },
      { path: '/me/timetable', component: StubView },
    ],
  });
  await router.push(component === ForbiddenView ? '/403' : '/404');
  await router.isReady();
  const session = useSessionStore();
  session.user = {
    userId: 'teacher-1',
    username: 'T1001',
    displayName: '张老师',
    role: 'TEACHER',
    teacherId: 'teacher-record-1',
    mustChangePassword: false,
  };
  session.loaded = true;
  const wrapper = mount(component, { global: { plugins: [pinia, router] } });
  return { wrapper, router };
}

describe('403 and 404 pages', () => {
  it('explains the forbidden reason and returns to the Teacher workspace', async () => {
    const { wrapper, router } = await mountResult(ForbiddenView);

    expect(wrapper.get('[data-result="403"]').text()).toContain('您没有权限访问此页面');
    expect(wrapper.text()).toContain('请联系教务管理员确认角色权限');

    const home = wrapper.findAll('button').find((button) => button.text().includes('返回工作台'));
    await home?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/me/timetable');
  });

  it('explains why a page is missing and returns to the workspace', async () => {
    const { wrapper, router } = await mountResult(NotFoundView);

    expect(wrapper.get('[data-result="404"]').text()).toContain('页面不存在');
    expect(wrapper.text()).toContain('可能已移动或删除');

    const home = wrapper.findAll('button').find((button) => button.text().includes('返回工作台'));
    await home?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/me/timetable');
  });
});
