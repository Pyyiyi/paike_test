import { afterEach } from 'vitest';
import ElementPlus from 'element-plus';
import { config } from '@vue/test-utils';

config.global.plugins = [ElementPlus];

afterEach(() => {
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
  }
});
