<script setup lang="ts">
import type { NavItem } from '@/shared/navigation';

defineProps<{
  items: NavItem[];
}>();

defineEmits<{
  logout: [];
}>();
</script>

<template>
  <div class="side-nav">
    <RouterLink class="brand" to="/" aria-label="返回系统概览">
      <span class="brand__mark" aria-hidden="true">排</span>
      <span>
        <strong>智能排课系统</strong>
        <small>教务工作台</small>
      </span>
    </RouterLink>

    <nav aria-label="主导航">
      <template v-for="item in items" :key="item.key">
        <div v-if="item.children?.length" class="nav-group">
          <div class="nav-group__label">{{ item.label }}</div>
          <RouterLink v-for="child in item.children" :key="child.key" class="nav-link nav-link--child" :to="child.to || '/'">
            <span class="nav-link__bullet" aria-hidden="true"></span>
            {{ child.label }}
          </RouterLink>
        </div>
        <button v-else-if="item.action === 'logout'" :key="item.key" class="nav-link nav-link--button" type="button" @click="$emit('logout')">
          <span class="nav-link__bullet" aria-hidden="true"></span>
          {{ item.label }}
        </button>
        <RouterLink v-else :key="item.key" class="nav-link" :to="item.to || '/'">
          <span class="nav-link__bullet" aria-hidden="true"></span>
          {{ item.label }}
        </RouterLink>
      </template>
    </nav>
  </div>
</template>

<style scoped>
.side-nav {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 24px;
  padding: 18px 14px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px 16px;
  border-bottom: 1px solid #33445d;
  color: #f8fafc;
  text-decoration: none;
}

.brand__mark {
  display: grid;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid #8fb1df;
  border-radius: 8px;
  background: #21314a;
  color: #e9f1ff;
  font-weight: 700;
}

.brand strong,
.brand small {
  display: block;
}

.brand strong {
  font-size: 15px;
}

.brand small {
  margin-top: 2px;
  color: #b7c7dc;
  font-size: 11px;
  letter-spacing: 0.08em;
}

nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-group {
  margin-bottom: 10px;
}

.nav-group__label {
  padding: 9px 12px 5px;
  color: #91a3bb;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 7px;
  color: #d5deeb;
  font: inherit;
  text-decoration: none;
}

.nav-link:hover,
.nav-link:focus-visible {
  background: #22344e;
  color: #fff;
  outline: 2px solid #83a9d8;
  outline-offset: -2px;
}

.nav-link.router-link-active {
  background: #2e517b;
  color: #fff;
  font-weight: 600;
}

.nav-link--child {
  margin-left: 13px;
  padding-left: 10px;
  color: #c5d0e0;
}

.nav-link--button {
  width: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.nav-link__bullet {
  width: 5px;
  height: 5px;
  flex: 0 0 5px;
  border-radius: 50%;
  background: #8fa6c3;
}
</style>
