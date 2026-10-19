<script setup lang="ts">
import ConfirmDialogHost from '@/shared/components/ConfirmDialogHost.vue';
import VersionConflictNotice from '@/shared/components/VersionConflictNotice.vue';
</script>

<template>
  <RouterView />
  <VersionConflictNotice />
  <ConfirmDialogHost />
</template>
