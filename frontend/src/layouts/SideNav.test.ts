import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SideNav from './SideNav.vue';
import { ADMIN_NAV, TEACHER_NAV } from '@/shared/navigation';

const RouterLinkStub = {
  props: ['to'],
  template: '<a :data-to="to"><slot /></a>',
};

function mountNav(items: typeof ADMIN_NAV) {
  return mount(SideNav, {
    props: { items },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

describe('SideNav role visibility', () => {
  it('shows a Teacher only personal timetable, personal idle slots, and logout', () => {
    const wrapper = mountNav(TEACHER_NAV);
    const navText = wrapper.get('nav').text();

    expect(navText).toContain('我的课表');
    expect(navText).toContain('我的空闲时段');
    expect(navText).toContain('退出登录');
    expect(navText).not.toContain('学期');
    expect(navText).not.toContain('排课');
    expect(navText).not.toContain('统计');
    expect(navText).not.toContain('用户');
  });

  it('shows every Admin management entry', () => {
    const wrapper = mountNav(ADMIN_NAV);
    const navText = wrapper.get('nav').text();

    for (const label of ['系统概览', '学期管理', '作息模板', '一键排课', '多维度课表', '工作量统计', 'Excel 导出', '操作日志', '用户与角色']) {
      expect(navText).toContain(label);
    }
  });

  it('emits logout from the Teacher navigation', async () => {
    const wrapper = mountNav(TEACHER_NAV);
    const logout = wrapper.findAll('button').find((button) => button.text().includes('退出登录'));

    expect(logout).toBeDefined();
    await logout?.trigger('click');
    expect(wrapper.emitted('logout')).toHaveLength(1);
  });
});
